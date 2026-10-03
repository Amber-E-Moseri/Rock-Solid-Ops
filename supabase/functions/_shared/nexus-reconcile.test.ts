// TIMEOUT_UNKNOWN reconciliation behaviour (RC01–RC24).
//
// Edge-logic tests against FakeNexusDb (mirrors the SQL RPC semantics + the real Supabase builder, which
// has no .catch()) and FakeNexus (mirrors Nexus task-api find-or-create). They prove the call ordering,
// state transitions and interleavings of the edge code. They do NOT prove the SQL: the RPCs themselves
// (row locks, SKIP LOCKED, ACLs) need a real Postgres and remain a blocked gate.
import { assert, assertEquals, assertFalse, assertNotEquals } from "jsr:@std/assert@1";
import { buildDedupeKey, buildExternalUniqueKey, ensureNexusTask } from "./nexus-tasks.ts";
import { reconcileUnknownNexusTasks } from "./nexus-reconcile.ts";
import { FakeNexus, FakeNexusDb, type GetMode } from "./nexus-test-support.ts";

const CFG = { nexusUrl: "http://nexus.test/task-api", nexusApiKey: "key", timeoutMs: 60 };
const USER = "7c1c7d5e-2b0e-4c43-9a37-1b7a3f1d2c11";
const MIN = 60_000;

const missed = (student = "S1") => ({
  student_id: student,
  student_name: `Student ${student}`,
  email: `${student}@x.test`,
  class_option_id: "CO1",
  class_number: "3",
  class_date: "2026-09-20",
  group_id: "G1",
  subgroup_id: "SG1",
});
const keyOf = (student = "S1") => buildDedupeKey("missed_class", missed(student));

async function withEnv(fn: (e: { db: FakeNexusDb; nexus: FakeNexus }) => Promise<void>) {
  const db = new FakeNexusDb();
  db.addMapping({ group_id: "G1", subgroup_id: "SG1", nexus_user_id: USER });
  const nexus = new FakeNexus().install();
  try {
    await fn({ db, nexus });
  } finally {
    nexus.restore();
  }
}

// deno-lint-ignore no-explicit-any
const ensure = (db: FakeNexusDb, student = "S1", cfg = CFG) => ensureNexusTask(db as any, "missed_class", missed(student), "test@system", cfg);
// deno-lint-ignore no-explicit-any
const reconcile = (db: FakeNexusDb, cfg = CFG, limit?: number) => reconcileUnknownNexusTasks(db as any, cfg, "test@system", { limit });

async function timeoutUnknown(db: FakeNexusDb, nexus: FakeNexus, mode: "timeout_after_create" | "timeout_without_create", student = "S1") {
  nexus.postMode = mode;
  const r = await ensure(db, student);
  assertFalse(r.ok);
  nexus.postMode = "ok";
  const row = db.link(keyOf(student))!;
  assertEquals(row.status, "TIMEOUT_UNKNOWN");
  return row;
}

Deno.test("RC01: task EXISTS remotely: found by stable key, id persisted, NO second POST", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_after_create");
    assertEquals(row.nexus_task_id, null);
    assert(row.next_reconcile_at, "first reconcile is scheduled");
    assertEquals(nexus.posts.length, 1);
    assertEquals(nexus.tasks.length, 1, "the timed-out request did create the task");

    // The producer path never re-POSTs an unknown outcome.
    const again = await ensure(db);
    assertFalse(again.ok);
    assertEquals(nexus.posts.length, 1, "producer rerun must not POST a TIMEOUT_UNKNOWN row");

    // Not due yet: reconciler leaves it alone and does not even call Nexus.
    const early = await reconcile(db);
    assertEquals(early.claimed, 0);
    assertEquals(nexus.gets, 0);

    db.advance(6 * MIN);
    const s = await reconcile(db);
    assertEquals([s.claimed, s.found], [1, 1]);
    assertEquals(nexus.posts.length, 1, "reconciliation never POSTs");
    assertEquals(row.status, "CREATED");
    assertEquals(row.nexus_task_id, nexus.tasks[0].id);
    assertEquals(row.error_message, null);

    const reuse = await ensure(db);
    assert(reuse.ok && reuse.reused);
    assertEquals(reuse.nexus_task_id, nexus.tasks[0].id);
    assertEquals(nexus.posts.length, 1);
    assert(db.auditActions().includes("NEXUS_TASK_RECONCILED"));
  });
});

Deno.test("RC02: task ABSENT: released to FAILED, then re-POSTed with the SAME key and assignee; exactly one task", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_without_create");
    assertEquals(nexus.tasks.length, 0);
    db.advance(6 * MIN);
    const s = await reconcile(db);
    assertEquals([s.claimed, s.absent_released, s.found], [1, 1, 0]);
    assertEquals(row.status, "FAILED");
    assert(String(row.error_message).startsWith("RECONCILED_ABSENT"));
    assertEquals(nexus.posts.length, 1, "reconciliation itself does not POST");

    const retry = await ensure(db);
    assert(retry.ok);
    assertEquals(nexus.posts.length, 2);
    assertEquals(nexus.posts[1].body.external_unique_key, nexus.posts[0].body.external_unique_key, "same stable key");
    assertEquals(nexus.posts[1].body.external_unique_key, buildExternalUniqueKey(keyOf()));
    assertEquals(nexus.posts[1].body.assignee_id, USER);
    assertEquals(nexus.posts[0].body.assignee_id, nexus.posts[1].body.assignee_id, "retry preserves assignment");
    assertEquals(nexus.tasks.length, 1, "exactly one Nexus task");
    assertEquals(row.status, "CREATED");
    assertEquals(row.nexus_task_id, nexus.tasks[0].id);
  });
});

for (const mode of ["down", "timeout", "http_500", "http_401", "bad_json", "bad_shape", "bad_item"] as GetMode[]) {
  Deno.test(`RC03: Nexus lookup "${mode}" is NOT proof of absence: stays TIMEOUT_UNKNOWN, no POST, attempt recorded`, async () => {
    await withEnv(async ({ db, nexus }) => {
      const row = await timeoutUnknown(db, nexus, "timeout_without_create");
      nexus.getMode = mode;
      db.advance(6 * MIN);
      const s = await reconcile(db);
      assertEquals([s.claimed, s.still_unknown, s.absent_released, s.found], [1, 1, 0, 0]);
      assertEquals(row.status, "TIMEOUT_UNKNOWN");
      assertEquals(row.reconcile_attempts, 1);
      assertEquals(row.nexus_task_id, null);
      assert(String(row.error_message).startsWith("TIMEOUT_UNKNOWN:"), String(row.error_message));
      assert((row.next_reconcile_at as number) > db.now(), "backoff scheduled in the future");
      assertEquals(nexus.posts.length, 1, "a failed lookup must never cause a POST");
      assertEquals(row.reconcile_claim_token, null, "lease released");
    });
  });
}

Deno.test("RC04: backoff: not claimable before next_reconcile_at, claimable after; attempts accumulate", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_without_create");
    nexus.getMode = "down";
    db.advance(6 * MIN);
    await reconcile(db);
    const gets = nexus.gets;
    assertEquals((await reconcile(db)).claimed, 0, "immediately after: not due");
    assertEquals(nexus.gets, gets);
    db.advance(12 * MIN);
    assertEquals((await reconcile(db)).claimed, 1);
    assertEquals(row.reconcile_attempts, 2);
  });
});

Deno.test("RC05: repeated reconciliation is idempotent; a replayed resolve is a no-op", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_after_create");
    db.advance(6 * MIN);
    await reconcile(db);
    const id = row.nexus_task_id;
    const snapshot = { ...row };
    for (let i = 0; i < 3; i++) {
      db.advance(10 * MIN);
      const s = await reconcile(db);
      assertEquals(s.claimed, 0);
    }
    assertEquals(row.nexus_task_id, id);
    assertEquals(row.reconcile_attempts, snapshot.reconcile_attempts);
    const replay = await db.rpc("resolve_nexus_reconciliation", {
      p_row_id: row.id, p_claim_token: crypto.randomUUID(), p_outcome: "ABSENT", p_nexus_task_id: null, p_error: null,
    });
    assertEquals(replay.data[0].applied, false);
    assertEquals(row.status, "CREATED", "an already-resolved row cannot be pushed back to FAILED");
    assertEquals(nexus.posts.length, 1);
  });
});

Deno.test("RC06: concurrent reconcilers on one row: one effective recovery, one Nexus read, no duplicate", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_after_create");
    db.advance(6 * MIN);
    const [a, b, c] = await Promise.all([reconcile(db), reconcile(db), reconcile(db)]);
    assertEquals(a.claimed + b.claimed + c.claimed, 1);
    assertEquals(a.found + b.found + c.found, 1);
    assertEquals(nexus.gets, 1, "only the lease holder reads Nexus");
    assertEquals(nexus.posts.length, 1);
    assertEquals(nexus.tasks.length, 1);
    assertEquals(row.status, "CREATED");
  });
});

Deno.test("RC07: concurrent reconcilers on many rows get disjoint batches; every row resolved once", async () => {
  await withEnv(async ({ db, nexus }) => {
    for (const s of ["S1", "S2", "S3", "S4"]) await timeoutUnknown(db, nexus, "timeout_after_create", s);
    db.advance(6 * MIN);
    const [a, b] = await Promise.all([reconcile(db, CFG, 2), reconcile(db, CFG, 2)]);
    assertEquals([a.claimed, b.claimed], [2, 2]);
    assertEquals(a.found + b.found, 4);
    assertEquals(nexus.posts.length, 4, "no POSTs beyond the four original attempts");
    assertEquals(nexus.tasks.length, 4);
    assertEquals(new Set(db.links.map((r) => r.nexus_task_id)).size, 4);
  });
});

Deno.test("RC08: lost lease: a resolver whose lease expired cannot overwrite the new lease holder", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_after_create");
    db.advance(6 * MIN);
    const tokenA = crypto.randomUUID();
    const claimA = await db.rpc("claim_nexus_reconciliations", { p_limit: 5, p_claim_token: tokenA, p_lease_seconds: 120 });
    assertEquals(claimA.data.length, 1);

    // Lease still valid: B gets nothing.
    assertEquals((await reconcile(db)).claimed, 0);

    // Lease expires; B recovers the row and resolves it.
    db.advance(3 * MIN);
    const b = await reconcile(db);
    assertEquals([b.claimed, b.found], [1, 1]);

    // A finally reports a (now stale) verdict.
    const late = await db.rpc("resolve_nexus_reconciliation", {
      p_row_id: row.id, p_claim_token: tokenA, p_outcome: "ABSENT", p_nexus_task_id: null, p_error: null,
    });
    assertEquals(late.data[0].applied, false);
    assertEquals(row.status, "CREATED");
    assertEquals(row.nexus_task_id, nexus.tasks[0].id);
  });
});

Deno.test("RC09: rows that are already resolved are never claimed", async () => {
  await withEnv(async ({ db, nexus }) => {
    const created = await ensure(db, "S1");
    assert(created.ok);
    await timeoutUnknown(db, nexus, "timeout_without_create", "S2");
    db.advance(6 * MIN);
    await reconcile(db); // S2 -> FAILED (absent)
    db.advance(30 * MIN);
    const s = await reconcile(db);
    assertEquals(s.claimed, 0, "CREATED and FAILED rows are not reconciliation candidates");
  });
});

Deno.test("RC10: stale-claim semantics are preserved; unresolved outcomes are never reclaimed", async () => {
  await withEnv(async ({ db, nexus }) => {
    // stale CLAIMING (>2 min) is recoverable by a new owner, who POSTs once
    db.links.push({
      id: "r-stale", source_type: "missed_class", source_id: "x", dedupe_key: keyOf("S1"), nexus_task_id: null,
      status: "CLAIMING", claim_token: "old-token", claimed_at: db.now() - 3 * MIN, created_at: db.now() - 3 * MIN,
      reconcile_attempts: 0, next_reconcile_at: null,
    });
    const recovered = await ensure(db, "S1");
    assert(recovered.ok);
    assertEquals(nexus.posts.length, 1);

    // fresh CLAIMING (<2 min) cannot be stolen
    db.links.push({
      id: "r-fresh", source_type: "missed_class", source_id: "x", dedupe_key: keyOf("S2"), nexus_task_id: null,
      status: "CLAIMING", claim_token: "other-token", claimed_at: db.now() - 30_000, created_at: db.now(),
      reconcile_attempts: 0, next_reconcile_at: null,
    });
    const blocked = await ensure(db, "S2");
    assertFalse(blocked.ok);
    assertEquals(nexus.posts.length, 1);

    // TIMEOUT_UNKNOWN stays unclaimable however old it gets
    await timeoutUnknown(db, nexus, "timeout_without_create", "S3");
    const afterTimeout = nexus.posts.length;
    db.advance(30 * 24 * 60 * MIN);
    assertFalse((await ensure(db, "S3")).ok);
    assertEquals(nexus.posts.length, afterTimeout);

    // RECONCILE_FAILED likewise
    db.link(keyOf("S3"))!.status = "RECONCILE_FAILED";
    assertFalse((await ensure(db, "S3")).ok);
    assertEquals(nexus.posts.length, afterTimeout);
  });
});

Deno.test("RC11: 24 inconclusive attempts end in terminal RECONCILE_FAILED; never auto-POSTed or re-reconciled", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_without_create");
    nexus.getMode = "down";
    for (let i = 1; i <= 24; i++) {
      db.advance(7 * 60 * MIN);
      const s = await reconcile(db);
      assertEquals(s.claimed, 1, `attempt ${i}`);
    }
    assertEquals(row.status, "RECONCILE_FAILED");
    assertEquals(row.reconcile_attempts, 24);
    assert(String(row.error_message).startsWith("RECONCILE_EXHAUSTED"));
    db.advance(7 * 24 * 60 * MIN);
    assertEquals((await reconcile(db)).claimed, 0);
    assertFalse((await ensure(db)).ok);
    assertEquals(nexus.posts.length, 1, "never POSTed after the original attempt");
  });
});

Deno.test("RC12: Nexus task API not configured: reconciler skips without consuming attempts or touching rows", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_without_create");
    db.advance(6 * MIN);
    const s = await reconcile(db, { ...CFG, nexusApiKey: "" });
    assertEquals(s.skipped, "nexus_task_api_not_configured");
    assertEquals(s.claimed, 0);
    assertEquals(row.reconcile_attempts, 0);
    assertEquals(row.reconcile_claim_token, null);
    assertFalse(db.rpcCalls.some((c) => c.name === "claim_nexus_reconciliations"));
    assertEquals(nexus.gets, 0);
  });
});

Deno.test("RC13: ABSENT with a full 200-row window is flagged, and the later POST is made safe by the server-side key", async () => {
  await withEnv(async ({ db, nexus }) => {
    const row = await timeoutUnknown(db, nexus, "timeout_after_create"); // task exists remotely
    nexus.filler = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, title: "other", external_unique_key: `other:${i}` }));
    db.advance(6 * MIN);
    const s = await reconcile(db);
    assertEquals([s.absent_released, s.found], [1, 0], "task is outside the newest-200 window, so the scan cannot see it");
    const audit = db.tables.audit_logs.find((a) => a.action === "NEXUS_TASK_RECONCILED")!;
    assertEquals(audit.details.window_truncated, true);
    assertEquals(row.status, "FAILED");

    const retry = await ensure(db);
    assert(retry.ok && retry.reused, "Nexus answered duplicate:true");
    assertEquals(nexus.posts.length, 2);
    assertEquals(nexus.tasks.length, 1, "still exactly one remote task: duplicate-safety comes from external_unique_key");
    assertEquals(row.nexus_task_id, nexus.tasks[0].id);
  });
});

Deno.test("RC14: a 2xx that does not confirm a task is an unknown outcome, then resolved by lookup without re-POST", async () => {
  await withEnv(async ({ db, nexus }) => {
    nexus.postMode = "malformed_after_create";
    const r = await ensure(db);
    assertFalse(r.ok);
    const row = db.link(keyOf())!;
    assertEquals(row.status, "TIMEOUT_UNKNOWN");
    nexus.postMode = "ok";
    db.advance(6 * MIN);
    const s = await reconcile(db);
    assertEquals(s.found, 1);
    assertEquals(nexus.posts.length, 1);
    assertEquals(row.nexus_task_id, nexus.tasks[0].id);
  });
});

for (const mode of ["http_400", "http_500", "http_429"] as const) {
  Deno.test(`RC15: definite rejection (${mode}) is FAILED, not unknown; reconciler ignores it; producer may retry the same key`, async () => {
    await withEnv(async ({ db, nexus }) => {
      nexus.postMode = mode;
      assertFalse((await ensure(db)).ok);
      const row = db.link(keyOf())!;
      assertEquals(row.status, "FAILED");
      db.advance(30 * MIN);
      assertEquals((await reconcile(db)).claimed, 0);
      nexus.postMode = "ok";
      assert((await ensure(db)).ok);
      assertEquals(nexus.tasks.length, 1);
      assertEquals(nexus.posts[1].body.external_unique_key, nexus.posts[0].body.external_unique_key);
    });
  });
}

Deno.test("RC16: reconciled escalation updates its source row's task link", async () => {
  await withEnv(async ({ db, nexus }) => {
    db.tables.applicants.push({ id: "A1", clickup_task_id: null });
    nexus.postMode = "timeout_after_create";
    const payload = {
      source: "applicants" as const, source_id: "A1", student_name: "Pat", email: "p@x.test",
      group_id: "G1", subgroup_id: "SG1", reason: "stuck", error_code: "REVIEW_STALE_48H", error_message: "m",
    };
    // deno-lint-ignore no-explicit-any
    const r = await ensureNexusTask(db as any, "escalation", payload, "test@system", CFG);
    assertFalse(r.ok);
    assertEquals(db.tables.applicants[0].clickup_task_id, null);
    nexus.postMode = "ok";
    db.advance(6 * MIN);
    assertEquals((await reconcile(db)).found, 1);
    assertEquals(db.tables.applicants[0].clickup_task_id, nexus.tasks[0].id);
  });
});

Deno.test("RC17: producer failures after Nexus success are not lost to audit-log errors (builder has no .catch)", async () => {
  const db = new FakeNexusDb();
  // Fidelity guard: the real Supabase builder is thenable without .catch(); the fake must be too.
  assertEquals(typeof (db.from("audit_logs").insert({}) as unknown as { catch?: unknown }).catch, "undefined");
  await withEnv(async ({ db: d, nexus }) => {
    const r = await ensure(d);
    assert(r.ok, "ensureNexusTask must complete (previously _logAudit threw 'catch is not a function')");
    assert(d.auditActions().includes("NEXUS_TASK_CREATED"));
    nexus.postMode = "http_500";
    assertFalse((await ensure(d, "S2")).ok);
    assert(d.auditActions().includes("NEXUS_TASK_FAILED"));
  });
});

Deno.test("RC18: stale writer cannot overwrite the new owner's result (writes are claim_token guarded)", async () => {
  await withEnv(async ({ db, nexus }) => {
    // Worker 1 claims and is slow at Nexus; its lease is then recovered by worker 2.
    nexus.postMode = "ok";
    const slow = ensure(db);
    db.links.length && (db.links[0].claim_token = "someone-else"); // lease recovered mid-flight
    const r = await slow;
    const row = db.link(keyOf())!;
    // The guarded UPDATE (claim_token = worker 1's token) matched nothing; the new owner's token stands.
    assertEquals(row.claim_token, "someone-else");
    assertEquals(row.nexus_task_id, null, "stale writer must not persist its result over the new owner");
    assert(r.ok, "the POST itself succeeded; Nexus holds the task");
    // The new owner's later POST is safe: same key -> duplicate:true.
    db.links[0].claimed_at = db.now() - 5 * MIN; // lease expired
    const again = await ensure(db);
    assert(again.ok && again.reused);
    assertEquals(nexus.tasks.length, 1);
    assertEquals(row.nexus_task_id, nexus.tasks[0].id);
  });
});

Deno.test("RC19: the reconciler module cannot create tasks (no POST, no createNexusTask)", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-reconcile.ts", import.meta.url));
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assertFalse(/method:\s*["']POST["']/.test(code));
  assertFalse(/createNexusTask|ensureNexusTask/.test(code));
  assert(/method:\s*["']GET["']/.test(code));
});

Deno.test("RC20: retry-worker reconciles BEFORE any step of the cron sweep that could reach ensureNexusTask", async () => {
  const src = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));
  const handlerStart = src.indexOf("Deno.serve(");
  const reconcileAt = src.indexOf("reconcileUnknownNexusTasks(serviceDb", src.indexOf("if (isCronCall && !id)", handlerStart));
  const sweepAt = src.indexOf("sweepMoodleEnrollmentRetries(serviceDb, limit)", handlerStart);
  assert(reconcileAt > 0 && sweepAt > 0 && reconcileAt < sweepAt, "reconcile must precede the sweep/escalation");
  assert(src.includes('"reconcile_nexus"'), "explicit operator action present");
  assert(src.includes("NEXUS_RECONCILE_ERROR"), "a reconcile failure must not break the sweep");
});

Deno.test("RC21: migration 202610030001 is additive/idempotent, locks with SKIP LOCKED + tokens, and is service_role only", async () => {
  const sql = (await Deno.readTextFile(new URL("../../migrations/202610030001_nexus_task_reconciliation.sql", import.meta.url)))
    .replace(/^\s*--.*$/gm, "");
  assert(/^begin;/m.test(sql) && /^commit;/m.test(sql));
  assert(/add column if not exists reconcile_attempts/.test(sql));
  assertFalse(/drop\s+(table|column)|rename\s+(to|column)|truncate|delete\s+from/i.test(sql), "must be additive");
  assert(/for update skip locked/i.test(sql));
  assert(/status in \('TIMEOUT_UNKNOWN', 'RECONCILE_FAILED'\)/.test(sql), "RECONCILE_FAILED is non-claimable");
  for (const fn of ["claim_nexus_reconciliations\\(integer, uuid, integer\\)", "resolve_nexus_reconciliation\\(uuid, uuid, text, text, text\\)", "claim_nexus_task\\(text, text, text, uuid\\)"]) {
    assert(new RegExp(`grant execute on function public\\.${fn} to service_role`).test(sql), `service_role grant for ${fn}`);
    assertFalse(new RegExp(`grant[^;]*${fn}[^;]*(authenticated|anon|public)`, "i").test(sql.replace(/revoke[^;]*;/gi, "")), `no broader grant for ${fn}`);
  }
  assertEquals((sql.match(/security definer set search_path = 'public'/g) ?? []).length, 3);
});

Deno.test("RC22: unknown reconciliation verdicts are rejected by the RPC", async () => {
  await withEnv(async ({ db }) => {
    const r = await db.rpc("resolve_nexus_reconciliation", { p_row_id: "x", p_claim_token: "t", p_outcome: "MAYBE" });
    assert(r.error, "invalid outcome must error");
    assertNotEquals(r.error!.message, "");
  });
});
