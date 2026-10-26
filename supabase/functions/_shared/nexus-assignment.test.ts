// Nexus assignment regression (NA01–NA10).
//
// Assignment is direct: rocksolid_admin_mappings.nexus_user_id -> Nexus task-api `assignee_id`.
// There is NO Sprint or Team dependency anywhere in the request.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { buildDedupeKey, ensureNexusTask } from "./nexus-tasks.ts";
import { reconcileUnknownNexusTasks } from "./nexus-reconcile.ts";
import { FakeNexus, FakeNexusDb } from "./nexus-test-support.ts";

const CFG = { nexusUrl: "https://nexus.test/task-api", nexusApiKey: "key", timeoutMs: 60 };
const ADMIN_A = "11111111-1111-4111-8111-111111111111"; // group-level admin
const ADMIN_B = "22222222-2222-4222-8222-222222222222"; // subgroup admin
const MIN = 60_000;

const payload = (group = "G1", subgroup = "SG1") => ({
  student_id: "S1", student_name: "Jane", email: "j@x.test",
  class_option_id: "CO1", class_number: "3", class_date: "2026-09-20",
  group_id: group, subgroup_id: subgroup,
});
// deno-lint-ignore no-explicit-any
const ensure = (db: FakeNexusDb, p = payload()) => ensureNexusTask(db as any, "missed_class", p, "test@system", CFG);

async function withEnv(fn: (e: { db: FakeNexusDb; nexus: FakeNexus }) => Promise<void>) {
  const db = new FakeNexusDb();
  const nexus = new FakeNexus().install();
  try {
    await fn({ db, nexus });
  } finally {
    nexus.restore();
  }
}

const ALLOWED_BODY_KEYS = new Set([
  "title", "description", "priority", "due_date", "source_name", "source_type", "assignee_id", "external_unique_key",
]);

Deno.test("NA01: a mapped existing Nexus user receives the task as assignee_id, using x-api-key auth", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: ADMIN_B });
    const r = await ensure(db);
    assert(r.ok);
    assertEquals(nexus.posts.length, 1);
    assertEquals(nexus.posts[0].body.assignee_id, ADMIN_B);
    assertEquals(nexus.posts[0].headers.get("x-api-key"), "key");
  });
});

Deno.test("NA02: subgroup mapping wins over group mapping; group mapping is the fallback; inactive mappings are ignored", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: null, nexus_user_id: ADMIN_A });
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: ADMIN_B });
    db.addMapping({ group_id: "G1", subgroup_id: "SG9", nexus_user_id: "33333333-3333-4333-8333-333333333333", active: false });

    assert((await ensure(db, payload("G1", "SG1"))).ok);
    assertEquals(nexus.posts[0].body.assignee_id, ADMIN_B, "subgroup-level mapping");

    const p2 = { ...payload("G1", "SG2"), student_id: "S2" };
    assert((await ensure(db, p2)).ok);
    assertEquals(nexus.posts[1].body.assignee_id, ADMIN_A, "falls back to the group-level mapping");

    const p3 = { ...payload("G1", "SG9"), student_id: "S3" };
    assert((await ensure(db, p3)).ok);
    assertEquals(nexus.posts[2].body.assignee_id, ADMIN_A, "inactive subgroup mapping is ignored");
  });
});

Deno.test("NA03: no mapping at all: task is still created, unassigned, and the audit row says so", async () => {
  await withEnv(async ({ db, nexus }) => {
    const r = await ensure(db, payload("GX", "SGX"));
    assert(r.ok);
    assertFalse("assignee_id" in nexus.posts[0].body, "no assignee_id key is sent");
    const audit = db.tables.audit_logs.find((a) => a.action === "NEXUS_TASK_CREATED")!;
    assertEquals(audit.details.assignment, "unassigned_no_mapping");
    assertEquals(audit.details.assignee_id, null);
  });
});

Deno.test("NA04: an invalid mapped id fails safely: no POST, FAILED with INVALID_ASSIGNEE_MAPPING, audited", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: "not-a-uuid" });
    const r = await ensure(db);
    assertFalse(r.ok);
    assert(String(r.error).startsWith("INVALID_ASSIGNEE_MAPPING"), String(r.error));
    assertEquals(nexus.posts.length, 0, "a malformed assignee is never sent to Nexus");
    const row = db.link(buildDedupeKey("missed_class", payload()))!;
    assertEquals(row.status, "FAILED");
    assert(db.auditActions().includes("NEXUS_TASK_FAILED"));
  });
});

Deno.test("NA05: Nexus rejecting the assignee (400 assignee not found) is a definite, TERMINAL failure (ASSIGNEE_REJECTED), never an unknown outcome", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: ADMIN_B });
    nexus.postMode = "http_400";
    const r = await ensure(db);
    assertFalse(r.ok);
    const row = db.link(buildDedupeKey("missed_class", payload()))!;
    // Was FAILED (re-POSTed forever). Now terminal manual-attention: see nexus-assignee-policy.test.ts.
    assertEquals(row.status, "ASSIGNEE_REJECTED");
    db.advance(30 * MIN);
    assertEquals((await reconcileUnknownNexusTasks(db as never, CFG, "t")).claimed, 0);
  });
});

Deno.test("NA06: after the mapping is corrected, the retry carries the corrected assignee on the same key", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: "bad" });
    assertFalse((await ensure(db)).ok);
    db.tables.rocksolid_admin_mappings[0].nexus_user_id = ADMIN_B;
    assert((await ensure(db)).ok);
    assertEquals(nexus.posts.length, 1);
    assertEquals(nexus.posts[0].body.assignee_id, ADMIN_B);
    assertEquals(nexus.tasks.length, 1);
  });
});

Deno.test("NA07: reconciliation + retry preserve the assignment (timeout, absent, re-POST)", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: ADMIN_B });
    nexus.postMode = "timeout_without_create";
    assertFalse((await ensure(db)).ok);
    nexus.postMode = "ok";
    db.advance(6 * MIN);
    assertEquals((await reconcileUnknownNexusTasks(db as never, CFG, "t")).absent_released, 1);
    assert((await ensure(db)).ok);
    assertEquals(nexus.posts.map((p) => p.body.assignee_id), [ADMIN_B, ADMIN_B]);
    assertEquals(nexus.tasks.length, 1);
    assertEquals(nexus.tasks[0].assignee_id, ADMIN_B);
  });
});

Deno.test("NA08: the request carries no Sprint, Team, Space or List fields (only the verified task-api keys)", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: ADMIN_B });
    assert((await ensure(db)).ok);
    for (const k of Object.keys(nexus.posts[0].body)) assert(ALLOWED_BODY_KEYS.has(k), `unexpected request key: ${k}`);
    for (const forbidden of ["sprint_id", "team_id", "sprint_team_id", "space_id", "list_id", "department_id", "assignees"]) {
      assertFalse(forbidden in nexus.posts[0].body, `${forbidden} must not be sent`);
    }
  });
});

Deno.test("NA09: no Sprint/Team dependency in the task client, reconciler or mapping resolution (code, comments excluded)", async () => {
  for (const f of ["./nexus-tasks.ts", "./nexus-reconcile.ts"]) {
    const code = (await Deno.readTextFile(new URL(f, import.meta.url))).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
    assertFalse(/sprint|team/i.test(code), `${f} must not reference sprint/team`);
  }
});

Deno.test("NA10: task creation does not require a configured Nexus space: the key's own scope places the task", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: ADMIN_B });
    // Config carries only url + key. There is no listId/spaceId anywhere.
    assertEquals(Object.keys(CFG).sort(), ["nexusApiKey", "nexusUrl", "timeoutMs"]);
    assert((await ensure(db)).ok);
    assertEquals(nexus.tasks.length, 1);
  });
});
