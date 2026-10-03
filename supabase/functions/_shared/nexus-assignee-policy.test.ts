// Permanent-assignee-failure policy (AP01–AP09).
//
// Certified behaviour to fix: a mapping to a Nexus user that does not exist makes task-api answer
//   400 { "error": "assignee not found" }
// on every attempt, and the row stayed FAILED, which is re-claimed immediately, so Nexus was re-POSTed forever.
//
// Policy: ONLY 400 + the exact body "assignee not found", and ONLY when an assignee_id was sent, becomes the
// terminal manual-attention status ASSIGNEE_REJECTED. Everything else keeps its retryable behaviour.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { buildDedupeKey, ensureNexusTask, isAssigneeNotFound, NexusHttpError, nexusErrorText } from "./nexus-tasks.ts";
import { FakeNexus, FakeNexusDb } from "./nexus-test-support.ts";

const CFG = { nexusUrl: "http://nexus.test/task-api", nexusApiKey: "key", timeoutMs: 60 };
const GHOST = "dead0000-0000-4000-8000-000000000001";
const REAL = "11111111-1111-4111-8111-111111111111";
const payload = () => ({
  student_id: "S1", student_name: "Jane", email: "j@x.test",
  class_option_id: "CO1", class_number: "3", class_date: "2026-09-20", group_id: "G1", subgroup_id: "SG1",
});
const KEY = buildDedupeKey("missed_class", payload());
// deno-lint-ignore no-explicit-any
const ensure = (db: FakeNexusDb) => ensureNexusTask(db as any, "missed_class", payload(), "test@system", CFG);
const count = (db: FakeNexusDb, a: string) => db.auditActions().filter((x) => x === a).length;

async function withEnv(fn: (e: { db: FakeNexusDb; nexus: FakeNexus }) => Promise<void>) {
  const db = new FakeNexusDb();
  const nexus = new FakeNexus().install();
  try {
    await fn({ db, nexus });
  } finally {
    nexus.restore();
  }
}

Deno.test("AP01: confirmed 'assignee not found' with a mapped assignee -> terminal ASSIGNEE_REJECTED, audited for manual attention", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: GHOST });
    nexus.postMode = "http_400";
    const r = await ensure(db);
    assertFalse(r.ok);
    assert(r.non_fatal);
    assertEquals(db.link(KEY)?.status, "ASSIGNEE_REJECTED");
    assertStringIncludes(String(db.link(KEY)?.error_message), GHOST);
    assertStringIncludes(String(db.link(KEY)?.error_message), "ASSIGNEE_NOT_FOUND");
    assertEquals(count(db, "NEXUS_TASK_ASSIGNEE_REJECTED"), 1);
    const a = db.tables.audit_logs.find((x) => x.action === "NEXUS_TASK_ASSIGNEE_REJECTED")!;
    assertEquals(a.status, "FAILED");
    assertEquals(a.details.assignee_id, GHOST);
    assertEquals(a.details.needs_manual_attention, true);
    assertEquals(nexus.posts.length, 1);
  });
});

Deno.test("AP02: the dead mapping is no longer hammered: later producer runs make ZERO further POSTs", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: GHOST });
    nexus.postMode = "http_400";
    await ensure(db);
    for (let i = 0; i < 5; i++) {
      const r = await ensure(db);
      assertFalse(r.ok);
      assertStringIncludes(String(r.error), "ASSIGNEE_REJECTED");
    }
    assertEquals(nexus.posts.length, 1, "exactly one POST in total across six runs");
    db.advance(24 * 60 * 60_000);
    await ensure(db);
    assertEquals(nexus.posts.length, 1, "terminal even after a day: it never expires into a retry");
  });
});

Deno.test("AP03: a TEMPORARY or different 400 is NOT misclassified: it stays FAILED and is retried", async () => {
  for (const msg of ["title is required", "priority must be one of: 'urgent', 'high', 'medium', 'low'", "due_date must be a valid YYYY-MM-DD date", "assignee_id must be a valid UUID", "assignee not found for this workspace", ""]) {
    await withEnv(async ({ db, nexus }) => {
      db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: REAL });
      nexus.postMode = "http_400";
      nexus.badRequestMessage = msg;
      await ensure(db);
      assertEquals(db.link(KEY)?.status, "FAILED", `400 "${msg}" must stay retryable`);
      await ensure(db);
      assertEquals(nexus.posts.length, 2, `400 "${msg}" is re-POSTed on the next run`);
      assertEquals(count(db, "NEXUS_TASK_ASSIGNEE_REJECTED"), 0);
    });
  }
});

Deno.test("AP04: non-400 statuses are never classified as an assignee rejection (401/403/404/409/429/500)", () => {
  for (const status of [401, 403, 404, 409, 429, 500, 502, 503]) {
    assertFalse(isAssigneeNotFound(new NexusHttpError(status, "m", "assignee not found")), `status ${status}`);
  }
  assertFalse(isAssigneeNotFound(new Error("assignee not found")));
  assertFalse(isAssigneeNotFound(new TypeError("fetch failed")));
  assert(isAssigneeNotFound(new NexusHttpError(400, "m", "assignee not found")));
  assert(isAssigneeNotFound(new NexusHttpError(400, "m", "  Assignee Not Found ")), "whitespace/case tolerant, otherwise exact");
});

Deno.test("AP05: 'assignee not found' while NO assignee was sent cannot be about our mapping: stays FAILED", async () => {
  await withEnv(async ({ db, nexus }) => {
    nexus.postMode = "http_400"; // no mapping row -> task is created unassigned
    await ensure(db);
    assertEquals(nexus.posts[0].body.assignee_id, undefined);
    assertEquals(db.link(KEY)?.status, "FAILED");
    await ensure(db);
    assertEquals(nexus.posts.length, 2);
  });
});

Deno.test("AP06: operator release path: fix the mapping, set FAILED, the next run POSTs the SAME key with the new assignee", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: GHOST });
    nexus.postMode = "http_400";
    await ensure(db);
    assertEquals(db.link(KEY)?.status, "ASSIGNEE_REJECTED");

    // operator: correct the mapping and release the row (documented SQL)
    db.tables.rocksolid_admin_mappings[0].nexus_user_id = REAL;
    db.link(KEY)!.status = "FAILED";
    db.link(KEY)!.error_message = null;
    nexus.postMode = "ok";

    const r = await ensure(db);
    assert(r.ok);
    assertEquals(nexus.posts.length, 2);
    assertEquals(nexus.posts[1].body.assignee_id, REAL);
    assertEquals(nexus.posts[0].body.external_unique_key, nexus.posts[1].body.external_unique_key);
    assertEquals(nexus.tasks.length, 1);
    assertEquals(db.link(KEY)?.status, "CREATED");
  });
});

Deno.test("AP07: the reconciler never touches ASSIGNEE_REJECTED rows (only TIMEOUT_UNKNOWN)", async () => {
  const { reconcileUnknownNexusTasks } = await import("./nexus-reconcile.ts");
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: GHOST });
    nexus.postMode = "http_400";
    await ensure(db);
    db.advance(10 * 60_000);
    const sum = await reconcileUnknownNexusTasks(db as never, CFG, "test@system");
    assertEquals(sum.claimed, 0);
    assertEquals(nexus.gets, 0);
    assertEquals(db.link(KEY)?.status, "ASSIGNEE_REJECTED");
  });
});

Deno.test("AP08: nexusErrorText only trusts the {error: string} shape", () => {
  assertEquals(nexusErrorText('{"error":"assignee not found"}'), "assignee not found");
  assertEquals(nexusErrorText('{"error":{"x":1}}'), "");
  assertEquals(nexusErrorText("<html>assignee not found</html>"), "");
  assertEquals(nexusErrorText(""), "");
});

Deno.test("AP09: migration 202610030004 makes ASSIGNEE_REJECTED terminal and changes nothing else", async () => {
  const sql = (await Deno.readTextFile(new URL("../../migrations/202610030004_claim_nexus_task_assignee_rejected_terminal.sql", import.meta.url))).replace(/--[^\n]*/g, "");
  assert(sql.includes("('TIMEOUT_UNKNOWN', 'RECONCILE_FAILED', 'ASSIGNEE_REJECTED')"));
  assert(/on conflict \(dedupe_key\) do nothing/i.test(sql), "keeps the conflict-safe first claim");
  assert(sql.includes("v_ttl_minutes int := 2"));
  assertFalse(/grant execute[^;]*to (anon|authenticated|public)/i.test(sql));
  assertFalse(/add constraint|alter table/i.test(sql), "no schema or constraint change");
});
