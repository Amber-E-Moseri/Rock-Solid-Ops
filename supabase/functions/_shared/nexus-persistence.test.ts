// Durable-persistence regression (PS01–PS08).
//
// Certified defect (b13b7e5): Nexus created/returned a task but ensureNexusTask never checked its own
// UPDATE ... status='CREATED'. When that write failed the row stayed CLAIMING with no id, yet the caller was
// told success and a NEXUS_TASK_CREATED audit row was written.
//
// Required behaviour: success is reported (and audited) only after the canonical Nexus id is durably stored
// on THIS worker's claimed row. A database error parks the row for reconciliation (never a blind re-POST);
// a zero-row update (claim_token lost to a newer owner) is a distinct outcome and writes nothing.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { buildDedupeKey, buildExternalUniqueKey, ensureNexusTask } from "./nexus-tasks.ts";
import { reconcileUnknownNexusTasks } from "./nexus-reconcile.ts";
import { FakeNexus, FakeNexusDb } from "./nexus-test-support.ts";

const CFG = { nexusUrl: "https://nexus.test/task-api", nexusApiKey: "key", timeoutMs: 60 };
const MIN = 60_000;
const payload = () => ({
  student_id: "S1", student_name: "Jane", email: "j@x.test",
  class_option_id: "CO1", class_number: "3", class_date: "2026-09-20", group_id: "G1", subgroup_id: "SG1",
});
const KEY = buildDedupeKey("missed_class", payload());
const EXT = buildExternalUniqueKey(KEY);
// deno-lint-ignore no-explicit-any
const ensure = (db: FakeNexusDb, p: any = payload()) => ensureNexusTask(db as any, "missed_class", p, "test@system", CFG);

async function withEnv(fn: (e: { db: FakeNexusDb; nexus: FakeNexus }) => Promise<void>) {
  const db = new FakeNexusDb();
  const nexus = new FakeNexus().install();
  try {
    await fn({ db, nexus });
  } finally {
    nexus.restore();
  }
}
const isCreatedWrite = (p: Record<string, unknown> | null) => p?.status === "CREATED";
const isParkWrite = (p: Record<string, unknown> | null) => p?.status === "TIMEOUT_UNKNOWN";
const count = (db: FakeNexusDb, action: string) => db.auditActions().filter((a) => a === action).length;

Deno.test("PS01: healthy path persists the id on the claimed row, then (and only then) audits success", async () => {
  await withEnv(async ({ db, nexus }) => {
    const r = await ensure(db);
    assert(r.ok);
    assertEquals(r.nexus_task_id, "nexus-task-1");
    assertEquals(db.link(KEY)?.status, "CREATED");
    assertEquals(db.link(KEY)?.nexus_task_id, "nexus-task-1");
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 1);
    assertEquals(nexus.posts.length, 1);
  });
});

Deno.test("PS02: Nexus succeeds but the local CREATED write FAILS -> not reported as success, parked for reconciliation, no success audit", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.failWrite({ table: "rocksolid_task_links", op: "update", when: isCreatedWrite, message: "connection to database lost" });

    const r = await ensure(db);

    assertFalse(r.ok, "must NOT be reported as success");
    assertEquals(r.nexus_task_id, null, "the caller must not be handed an id that was never recorded");
    assert(r.non_fatal);
    assertStringIncludes(String(r.error), "PERSISTENCE_FAILED");
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 0, "no success audit before durable persistence");
    assertEquals(count(db, "NEXUS_TASK_FAILED"), 1, "the failure is audited");

    // The remote task exists exactly once and was NOT re-POSTed.
    assertEquals(nexus.posts.length, 1);
    assertEquals(nexus.tasks.filter((t) => t.external_unique_key === EXT).length, 1);

    // Safe recovery condition: TIMEOUT_UNKNOWN with the reconcile clock armed, naming the remote id.
    const row = db.link(KEY)!;
    assertEquals(row.status, "TIMEOUT_UNKNOWN");
    assertEquals(row.nexus_task_id ?? null, null);
    assert(row.next_reconcile_at, "reconciliation is scheduled");
    assertStringIncludes(String(row.error_message), "nexus-task-1");
    const audit = db.tables.audit_logs.find((a) => a.action === "NEXUS_TASK_FAILED")!;
    assertEquals(audit.details.persistence_failed, true);
    assertEquals(audit.details.state_persisted, true);
  });
});

Deno.test("PS03: after PS02 an ordinary re-run does not POST; reconciliation then recovers the SAME task id", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.failWrite({ table: "rocksolid_task_links", op: "update", when: isCreatedWrite });
    await ensure(db);

    const again = await ensure(db);
    assertFalse(again.ok, "TIMEOUT_UNKNOWN is never re-claimed by the producer path");
    assertEquals(nexus.posts.length, 1, "no second POST while awaiting reconciliation");

    db.advance(6 * MIN);
    const sum = await reconcileUnknownNexusTasks(db as never, CFG, "test@system");
    assertEquals(sum.found, 1);
    assertEquals(db.link(KEY)?.status, "CREATED");
    assertEquals(db.link(KEY)?.nexus_task_id, "nexus-task-1");
    assertEquals(nexus.posts.length, 1, "reconciliation never POSTs");
    assertEquals(nexus.tasks.length, 1);
  });
});

Deno.test("PS04: if the recovery write ALSO fails the row stays CLAIMING; the 2-minute lease then re-claims and the same-key re-POST is a Nexus duplicate", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.failWrite({ table: "rocksolid_task_links", op: "update", when: isCreatedWrite });
    db.failWrite({ table: "rocksolid_task_links", op: "update", when: isParkWrite });

    const r = await ensure(db);
    assertFalse(r.ok);
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 0);
    assertEquals(db.link(KEY)?.status, "CLAIMING");
    const audit = db.tables.audit_logs.find((a) => a.action === "NEXUS_TASK_FAILED")!;
    assertEquals(audit.details.state_persisted, false, "the audit row is honest that the state could not be stored");

    // While the lease is live nobody else may POST.
    assertFalse((await ensure(db)).ok);
    assertEquals(nexus.posts.length, 1);

    // Lease expires -> recovered; Nexus must answer "duplicate", never create a second task.
    db.advance(3 * MIN);
    const healed = await ensure(db);
    assert(healed.ok);
    assert(healed.reused, "Nexus reported duplicate:true");
    assertEquals(nexus.posts.length, 2);
    assertEquals(nexus.posts[0].body.external_unique_key, nexus.posts[1].body.external_unique_key);
    assertEquals(nexus.tasks.length, 1, "exactly one Nexus task for the key");
    assertEquals(db.link(KEY)?.nexus_task_id, "nexus-task-1");
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 1);
  });
});

Deno.test("PS05: a remote DUPLICATE whose local write fails is also not reported as success", async () => {
  await withEnv(async ({ db, nexus }) => {
    nexus.tasks.unshift({ id: "pre-existing", title: "t", external_unique_key: EXT });
    db.failWrite({ table: "rocksolid_task_links", op: "update", when: isCreatedWrite });
    const r = await ensure(db);
    assertFalse(r.ok);
    assertEquals(r.nexus_task_id, null);
    assertStringIncludes(String(db.link(KEY)?.error_message), "returned existing");
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 0);
  });
});

Deno.test("PS06: claim lost before persisting (zero rows) is its own outcome: nothing is written, no success, no source-link write", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.tables.applicants.push({ id: "A1", clickup_task_id: null });
    const esc = { source: "applicants", source_id: "A1", student_name: "J", reason: "r", error_code: "TIMEOUT", group_id: "G1", subgroup_id: "SG1" };
    const escKey = buildDedupeKey("escalation", esc as never);
    // A newer worker takes the row while this worker's POST is in flight.
    nexus.afterPost = () => {
      const row = db.link(escKey)!;
      row.claim_token = "newer-owner-token";
      row.claimed_at = db.now();
    };

    const r = await ensureNexusTask(db as never, "escalation", esc, "test@system", CFG);

    assertFalse(r.ok);
    assertEquals(r.nexus_task_id, null);
    assertStringIncludes(String(r.error), "claim lost");
    const row = db.link(escKey)!;
    assertEquals(row.claim_token, "newer-owner-token", "the newer claim is untouched");
    assertEquals(row.nexus_task_id ?? null, null, "stale worker wrote nothing");
    assertEquals(row.status, "CLAIMING");
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 0);
    assertEquals(count(db, "NEXUS_TASK_CLAIM_LOST"), 1, "distinguished from a database error");
    assertEquals(count(db, "NEXUS_TASK_FAILED"), 0, "not a failure of the newer owner's row");
    assertEquals(db.tables.applicants[0].clickup_task_id, null, "no source-row link written by the stale worker");
  });
});

Deno.test("PS07: an old worker can never overwrite a newer owner's COMPLETED result", async () => {
  await withEnv(async ({ db, nexus }) => {
    nexus.afterPost = () => {
      const row = db.link(KEY)!;
      row.claim_token = "newer-owner-token";
      row.nexus_task_id = "newer-owner-id";
      row.status = "CREATED";
    };
    const r = await ensure(db);
    assertFalse(r.ok);
    assertEquals(db.link(KEY)?.nexus_task_id, "newer-owner-id");
    assertEquals(db.link(KEY)?.status, "CREATED");
    assertEquals(count(db, "NEXUS_TASK_CREATED"), 0, "only the owner that persisted may audit success");
  });
});

Deno.test("PS08: the fault-injection hook is itself one-shot (guards against a test that passes for the wrong reason)", async () => {
  await withEnv(async ({ db }) => {
    db.failWrite({ table: "rocksolid_task_links", op: "update", when: isCreatedWrite, times: 1 });
    await ensure(db); // consumes the fault
    assertEquals(db.faults.filter((f) => f.times > 0).length, 0);
  });
});
