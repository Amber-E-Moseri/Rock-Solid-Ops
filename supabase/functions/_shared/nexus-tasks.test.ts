// NT01–NT15 — Nexus task shared module tests (ClickUp → Nexus migration)
//
// NT01  missed_class payload maps to Nexus task with student context
// NT02  createNexusTask auth is server-side Bearer from config, not anon/service key
// NT03  timeout aborts at configured bound
// NT04  Nexus 2xx returns task id (success path)
// NT05  Nexus 4xx produces deterministic failure with no retry
// NT06  Nexus 5xx classification proven in source (avoid 15 s backoff in CI)
// NT07  timeout does not report success
// NT08  buildDedupeKey produces deterministic keys; different events differ
// NT09  missed-class-detector imports from _shared/nexus-tasks, not clickup-sync
// NT10  retry-worker imports from _shared/nexus-tasks, not clickup-sync
// NT11  no clickup-sync HTTP invocation from missed-class-detector
// NT12  no clickup-sync HTTP invocation from retry-worker
// NT13  existing missed-class trigger semantics unchanged
// NT14  existing retry-worker authorization unchanged
// NT15  C3B Moodle retry behavior unchanged

import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDedupeKey, buildTask, createNexusTask, NEXUS_TIMEOUT_MS } from "./nexus-tasks.ts";

const nexusSrc  = await Deno.readTextFile(new URL("./nexus-tasks.ts",                    import.meta.url));
const missedSrc = await Deno.readTextFile(new URL("../missed-class-detector/index.ts",  import.meta.url));
const retrySrc  = await Deno.readTextFile(new URL("../retry-worker/index.ts",           import.meta.url));

// ── NT01 ─────────────────────────────────────────────────────────────────────

Deno.test("NT01: missed_class payload maps to correct Nexus task shape", () => {
  const payload = {
    student_id: "S001",
    student_name: "Jane Smith",
    class_option_id: "CO1",
    class_number: "3",
    class_date: "2026-09-20",
    group_id: "G1",
    subgroup_id: "SG1",
  };
  const task = buildTask("missed_class", payload, "user-456");
  assert((task.name as string).includes("Jane Smith"), "task name includes student name");
  assertEquals(task.priority, 3, "missed_class is normal priority (3)");
  assertEquals((task.assignees as string[]).length, 1, "assignee is set when provided");
  assert((task.description as string).includes("missed_class"), "description includes task type");
  assert(typeof task.due_date === "number" && (task.due_date as number) > Date.now(), "due_date is in the future");
});

// ── NT02 ─────────────────────────────────────────────────────────────────────

Deno.test("NT02: createNexusTask uses Authorization: Bearer from caller-supplied apiKey", () => {
  assert(nexusSrc.includes("Authorization: `Bearer ${apiKey}`"), "auth header uses passed-in apiKey");
  const fnStart = nexusSrc.indexOf("export async function createNexusTask");
  const fnEnd   = nexusSrc.indexOf("\nasync function updateSourceNexusTaskId");
  const fn = nexusSrc.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
  assertEquals(fn.includes("anon"),         false, "no anon key in createNexusTask");
  assertEquals(fn.includes("service_role"), false, "no service_role key in createNexusTask");
  assertEquals(fn.includes("SUPABASE"),     false, "no Supabase credential in createNexusTask");
});

// ── NT03 ─────────────────────────────────────────────────────────────────────

Deno.test("NT03: Nexus timeout aborts the request and throws", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) =>
    new Promise<Response>((resolve) => {
      req.signal.addEventListener("abort", () => resolve(new Response("{}", { status: 200 })));
      setTimeout(() => resolve(new Response("{}", { status: 200 })), 3000);
    }),
  );
  try {
    const port = (server.addr as Deno.NetAddr).port;
    await createNexusTask(`http://127.0.0.1:${port}`, "test-key", { name: "test" }, 100);
    assert(false, "should have thrown on timeout");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(
      msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("signal") || msg.toLowerCase().includes("cancel"),
      `timeout error must indicate abort; got: "${msg}"`,
    );
  } finally {
    await server.shutdown();
  }
});

// ── NT04 ─────────────────────────────────────────────────────────────────────

Deno.test("NT04: Nexus 200 returns task id from response", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, () =>
    new Response(JSON.stringify({ id: "nexus-task-abc" }), { status: 200 }),
  );
  try {
    const port = (server.addr as Deno.NetAddr).port;
    const result = await createNexusTask(`http://127.0.0.1:${port}`, "key", {}, 5000);
    assertEquals(result.id, "nexus-task-abc");
  } finally {
    await server.shutdown();
  }
});

// ── NT05 ─────────────────────────────────────────────────────────────────────

Deno.test("NT05: Nexus 4xx throws immediately with no retry", async () => {
  let callCount = 0;
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
    callCount += 1;
    return new Response("bad request", { status: 400 });
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    await createNexusTask(`http://127.0.0.1:${port}`, "key", {}, 5000);
    assert(false, "should have thrown");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assertEquals(callCount, 1, "4xx must not be retried — only one attempt");
    assert(msg.includes("400"), "error message must include status code");
  } finally {
    await server.shutdown();
  }
});

// ── NT06 ─────────────────────────────────────────────────────────────────────

Deno.test("NT06: createNexusTask treats 5xx as non-2xx failure (source inspection)", () => {
  // Single-attempt design: no retry loop. Any !res.ok throws immediately.
  // This prevents duplicate Nexus tasks when no server-side idempotency key is available.
  assert(nexusSrc.includes("if (!res.ok)"), "non-2xx check must be present");
  assert(nexusSrc.includes("throw new Error"), "non-2xx must throw");
  assertEquals(nexusSrc.includes("while (attempt"), false, "createNexusTask must NOT have a retry loop");
});

// ── NT07 ─────────────────────────────────────────────────────────────────────

Deno.test("NT07: timeout does not return a nexus_task_id (throws, not resolves)", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) =>
    new Promise<Response>((resolve) => {
      req.signal.addEventListener("abort", () => resolve(new Response("{}", { status: 200 })));
      setTimeout(() => resolve(new Response("{}", { status: 200 })), 3000);
    }),
  );
  try {
    const port = (server.addr as Deno.NetAddr).port;
    const result = await createNexusTask(`http://127.0.0.1:${port}`, "key", {}, 100)
      .catch((e: unknown) => ({ __error: true, msg: e instanceof Error ? e.message : String(e) }));
    assert("__error" in result, "timeout must reject, not resolve with a task id");
  } finally {
    await server.shutdown();
  }
});

// ── NT08 ─────────────────────────────────────────────────────────────────────

Deno.test("NT08: buildDedupeKey is deterministic; different events produce different keys", () => {
  const p1 = { student_id: "S1", class_option_id: "CO1", class_number: "3", class_date: "2026-09-20" };
  const p2 = { ...p1, student_name: "Ignored Field" };
  assertEquals(buildDedupeKey("missed_class", p1), buildDedupeKey("missed_class", p2),
    "extra fields don't change the key");

  const e1 = { source: "moodle_enrollment_sync" as const, source_id: "row-1", error_code: "TIMEOUT" };
  const e2 = { ...e1, student_name: "Different Name" };
  assertEquals(buildDedupeKey("escalation", e1), buildDedupeKey("escalation", e2),
    "extra fields don't change escalation key");

  const e3 = { source: "moodle_enrollment_sync" as const, source_id: "row-2", error_code: "TIMEOUT" };
  assert(buildDedupeKey("escalation", e1) !== buildDedupeKey("escalation", e3),
    "different source_id must produce different keys");

  assert(buildDedupeKey("missed_class", p1) !== buildDedupeKey("escalation", e1),
    "different types must produce different key prefixes");
});

// ── NT09 ─────────────────────────────────────────────────────────────────────

Deno.test("NT09: missed-class-detector imports ensureNexusTask from _shared/nexus-tasks", () => {
  assert(missedSrc.includes('from "../_shared/nexus-tasks.ts"'),
    "missed-class-detector must import from nexus-tasks.ts");
  assert(missedSrc.includes("ensureNexusTask("),
    "missed-class-detector must call ensureNexusTask");
});

// ── NT10 ─────────────────────────────────────────────────────────────────────

Deno.test("NT10: retry-worker imports ensureNexusTask from _shared/nexus-tasks", () => {
  assert(retrySrc.includes('from "../_shared/nexus-tasks.ts"'),
    "retry-worker must import from nexus-tasks.ts");
  assert(retrySrc.includes("ensureNexusTask("),
    "retry-worker must call ensureNexusTask");
});

// ── NT11 ─────────────────────────────────────────────────────────────────────

Deno.test("NT11: no clickup-sync HTTP invocation from missed-class-detector", () => {
  assertEquals(missedSrc.includes("/functions/v1/clickup-sync"), false,
    "no clickup-sync URL in missed-class-detector");
  assertEquals(missedSrc.includes("invokeClickupSync"), false,
    "invokeClickupSync function must be removed");
  assertEquals(missedSrc.includes('"x-internal-secret": internalSecret'), false,
    "no internal-secret clickup pathway in missed-class-detector");
});

// ── NT12 ─────────────────────────────────────────────────────────────────────

Deno.test("NT12: no clickup-sync HTTP invocation from retry-worker", () => {
  assertEquals(retrySrc.includes("/functions/v1/clickup-sync"), false,
    "no clickup-sync URL in retry-worker");
  assertEquals(retrySrc.includes("triggerClickupEscalation"), false,
    "triggerClickupEscalation function must be removed");
});

// ── NT13 ─────────────────────────────────────────────────────────────────────

Deno.test("NT13: missed-class-detector trigger semantics are preserved", () => {
  assert(missedSrc.includes('"missed_class"'),       "missed_class type still present");
  assert(missedSrc.includes('"escalation"'),         "escalation type still present");
  assert(missedSrc.includes("MISSED_CLASS_DETECTOR_SUMMARY"), "summary audit log still present");
  assert(missedSrc.includes("attendance_log"),       "attendance check still present");
  assert(missedSrc.includes('"REVIEW"'),             "REVIEW status escalation still present");
  assert(missedSrc.includes("48 * 60 * 60 * 1000"),  "48h review threshold preserved");
});

// ── NT14 ─────────────────────────────────────────────────────────────────────

Deno.test("NT14: retry-worker authorization structure is unchanged", () => {
  assert(retrySrc.includes("validateCronAuth"),               "cron auth still present");
  assert(retrySrc.includes('req.headers.has("x-cron-secret")'), "cron secret path still present");
  assert(retrySrc.includes("serviceDb.auth.getUser"),         "user JWT path still present");
  assert(retrySrc.includes("await isAdmin(serviceDb"),        "admin check still present");
  assert(retrySrc.includes("Admin access required"),          "admin error message preserved");
});

// ── NT15 ─────────────────────────────────────────────────────────────────────

Deno.test("NT15: C3B Moodle retry eligibility rules are preserved in retry-worker", () => {
  assert(retrySrc.includes("isRetryableMoodleError"),    "retry eligibility function still present");
  assert(retrySrc.includes("MOODLE_WAF_BLOCK"),          "WAF block retryable case preserved");
  assert(retrySrc.includes("MOODLE_REST_DISABLED"),      "REST disabled non-retryable preserved");
  assert(retrySrc.includes("MOODLE_PERMISSION_DENIED"),  "permission denied non-retryable preserved");
  assert(retrySrc.includes("sweepMoodleEnrollmentRetries"), "moodle sweep function still present");
  assert(retrySrc.includes("RETRY_WORKER_NEXUS_ESCALATION_ERROR"), "escalation error log renamed to NEXUS");
});
