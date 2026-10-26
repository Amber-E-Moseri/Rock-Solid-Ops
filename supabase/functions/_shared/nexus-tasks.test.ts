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
// NT13  existing missed-class trigger semantics unchanged
// NT15  C3B Moodle retry eligibility unchanged (the Nexus escalation-log check is a Layer 2 requirement)
//
// Layer 2 wiring and retry-worker auth cases (formerly NT09-NT12, NT14, and the NT15 escalation check) live in
// nexus-layer2-requirements.test.ts. They are not Layer 1 unit tests.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildDedupeKey,
  buildTask,
  buildExternalUniqueKey,
  createNexusTask,
  NEXUS_TIMEOUT_MS,
  NexusHttpError,
  NexusMalformedResponseError,
  NexusTimeoutError,
} from "./nexus-tasks.ts";

// Loopback Deno.serve endpoints are explicit local test opt-ins; production callers never pass this.
const LOCAL_TEST = { allowLocalTestHttp: true };

const nexusSrc  = await Deno.readTextFile(new URL("./nexus-tasks.ts",                    import.meta.url));
const missedSrc = await Deno.readTextFile(new URL("../missed-class-detector/index.ts",  import.meta.url));
const retrySrc  = await Deno.readTextFile(new URL("../retry-worker/index.ts",           import.meta.url));

// ── NT01 ─────────────────────────────────────────────────────────────────────

Deno.test("NT01: missed_class payload maps to the Nexus task-api shape", () => {
  const payload = {
    student_id: "S001",
    student_name: "Jane Smith",
    class_option_id: "CO1",
    class_number: "3",
    class_date: "2026-09-20",
    group_id: "G1",
    subgroup_id: "SG1",
  };
  const userId = "7c1c7d5e-2b0e-4c43-9a37-1b7a3f1d2c11";
  const task = buildTask("missed_class", payload, userId);
  assert((task.title as string).includes("Jane Smith"), "title includes student name");
  assertEquals(task.priority, "medium", "missed_class is medium priority (Nexus enum)");
  assertEquals(task.assignee_id, userId, "single assignee_id is set when provided");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(task.due_date)), "due_date is YYYY-MM-DD (Nexus validates this)");
  assertEquals(task.source_name, "rocksolid");
  assertEquals(task.source_type, "missed_class");
  assert((task.description as string).includes("missed_class"), "description includes task type");
  // Fields of the retired ClickUp-shaped body must not be sent: Nexus ignores or rejects them.
  for (const legacy of ["name", "assignees", "list_id", "space_id"]) {
    assertEquals(legacy in task, false, `${legacy} must not be sent to Nexus`);
  }
  assertEquals("assignee_id" in buildTask("missed_class", payload, ""), false, "no assignee_id key when unmapped");
});

// ── NT02 ─────────────────────────────────────────────────────────────────────

Deno.test("NT02: createNexusTask authenticates with x-api-key (not Authorization: Bearer)", async () => {
  let seen: Headers | null = null;
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    seen = req.headers;
    return new Response(JSON.stringify({ task: { id: "t-1" } }), { status: 201 });
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    await createNexusTask(`http://127.0.0.1:${port}`, "nexus-key-123", { title: "t" }, "rocksolid:k", 5000, LOCAL_TEST);
    assertEquals(seen!.get("x-api-key"), "nexus-key-123");
    assertEquals(seen!.get("authorization"), null, "no Authorization header is sent to Nexus");
  } finally {
    await server.shutdown();
  }
  const fnStart = nexusSrc.indexOf("export async function createNexusTask");
  const fnEnd   = nexusSrc.indexOf("\nexport async function linkEscalationSource");
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
    await createNexusTask(`http://127.0.0.1:${port}`, "test-key", { title: "test" }, "rocksolid:test", 100, LOCAL_TEST);
    assert(false, "should have thrown on timeout");
  } catch (e) {
    assert(e instanceof NexusTimeoutError, `timeout must surface as NexusTimeoutError; got: ${e}`);
  } finally {
    await server.shutdown();
  }
});

// ── NT04 ─────────────────────────────────────────────────────────────────────

Deno.test("NT04: Nexus 201 {task:{id}} returns the task id; 200 {duplicate:true} returns the existing id", async () => {
  let n = 0;
  const server = Deno.serve({ port: 0, onListen: () => {} }, () =>
    n++ === 0
      ? new Response(JSON.stringify({ task: { id: "nexus-task-abc" } }), { status: 201 })
      : new Response(JSON.stringify({ duplicate: true, task: { id: "nexus-task-abc" }, message: "exists" }), { status: 200 }),
  );
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const created = await createNexusTask(url, "key", {}, "rocksolid:test", 5000, LOCAL_TEST);
    assertEquals(created, { id: "nexus-task-abc", duplicate: false });
    const replay = await createNexusTask(url, "key", {}, "rocksolid:test", 5000, LOCAL_TEST);
    assertEquals(replay, { id: "nexus-task-abc", duplicate: true });
  } finally {
    await server.shutdown();
  }
});

Deno.test("NT04b: a 2xx that does not confirm a task id fails closed (NexusMalformedResponseError)", async () => {
  const bodies: Array<[number, unknown]> = [
    [201, { id: "legacy-shape" }],             // old/other contract: id not under task
    [201, { task: {} }],
    [200, { task: { id: "x" } }],              // 200 without duplicate:true
    [200, {}],
  ];
  let i = 0;
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
    const [status, body] = bodies[i++];
    return new Response(JSON.stringify(body), { status });
  });
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    for (let k = 0; k < bodies.length; k++) {
      const err = await createNexusTask(url, "key", {}, "rocksolid:test", 5000, LOCAL_TEST).then(() => null, (e) => e);
      assert(err instanceof NexusMalformedResponseError, `case ${k} must be malformed, got ${err}`);
    }
    const notJson = Deno.serve({ port: 0, onListen: () => {} }, () => new Response("<html>", { status: 201 }));
    const e2 = await createNexusTask(`http://127.0.0.1:${(notJson.addr as Deno.NetAddr).port}`, "k", {}, "rocksolid:t", 5000, LOCAL_TEST).then(() => null, (e) => e);
    assert(e2 instanceof NexusMalformedResponseError, "non-JSON 2xx is malformed");
    await notJson.shutdown();
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
    await createNexusTask(`http://127.0.0.1:${port}`, "key", {}, "rocksolid:test", 5000, LOCAL_TEST);
    assert(false, "should have thrown");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    assertEquals(callCount, 1, "4xx must not be retried — only one attempt");
    assert(e instanceof NexusHttpError && (e as NexusHttpError).status === 400, "typed NexusHttpError carrying the status");
    assert(msg.includes("400"), "error message must include status code");
  } finally {
    await server.shutdown();
  }
});

// ── NT06 ─────────────────────────────────────────────────────────────────────

Deno.test("NT06: createNexusTask treats 5xx as a typed non-2xx failure with a single attempt", async () => {
  let calls = 0;
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  });
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const err = await createNexusTask(url, "key", {}, "rocksolid:test", 5000, LOCAL_TEST).then(() => null, (e) => e);
    assert(err instanceof NexusHttpError && err.status === 500);
    assertEquals(calls, 1, "no retry loop");
  } finally {
    await server.shutdown();
  }
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
    const result = await createNexusTask(`http://127.0.0.1:${port}`, "key", {}, "rocksolid:test", 100, LOCAL_TEST)
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

// ── NT13 ─────────────────────────────────────────────────────────────────────

Deno.test("NT13: missed-class-detector trigger semantics are preserved", () => {
  assert(missedSrc.includes('"missed_class"'),       "missed_class type still present");
  assert(missedSrc.includes('"escalation"'),         "escalation type still present");
  assert(missedSrc.includes("MISSED_CLASS_DETECTOR_SUMMARY"), "summary audit log still present");
  assert(missedSrc.includes("attendance_log"),       "attendance check still present");
  assert(missedSrc.includes('"REVIEW"'),             "REVIEW status escalation still present");
  assert(missedSrc.includes("48 * 60 * 60 * 1000"),  "48h review threshold preserved");
});

// ── NT15 ─────────────────────────────────────────────────────────────────────

Deno.test("NT15: C3B Moodle retry eligibility rules are preserved in retry-worker", () => {
  assert(retrySrc.includes("isRetryableMoodleError"),    "retry eligibility function still present");
  assert(retrySrc.includes("MOODLE_WAF_BLOCK"),          "WAF block retryable case preserved");
  assert(retrySrc.includes("MOODLE_REST_DISABLED"),      "REST disabled non-retryable preserved");
  assert(retrySrc.includes("MOODLE_PERMISSION_DENIED"),  "permission denied non-retryable preserved");
  assert(retrySrc.includes("sweepMoodleEnrollmentRetries"), "moodle sweep function still present");
});

// ── I01 external_unique_key sent in POST body ────────────────────────────────

Deno.test("I01: outgoing Nexus POST includes external_unique_key", async () => {
  let body: Record<string, unknown> = {};
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    body = await req.json();
    return new Response(JSON.stringify({ task: { id: "t" } }), { status: 201 });
  });
  try {
    await createNexusTask(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`, "k", { title: "x" }, "rocksolid:the-key", 5000, LOCAL_TEST);
    assertEquals(body.external_unique_key, "rocksolid:the-key");
    assertEquals(body.title, "x");
  } finally {
    await server.shutdown();
  }
  assert(nexusSrc.includes("buildExternalUniqueKey"), "buildExternalUniqueKey function called");
});

// ── I02/I03 deterministic key generation ────────────────────────────────────

Deno.test("I02/I03: external_unique_key determinism and uniqueness", () => {
  const key1 = buildExternalUniqueKey("missed_class:S001:CO1:3:2026-09-20");
  const key2 = buildExternalUniqueKey("missed_class:S001:CO1:3:2026-09-20");
  const key3 = buildExternalUniqueKey("missed_class:S002:CO1:3:2026-09-20");
  assertEquals(key1, key2, "same dedupe identity produces same external key");
  assertEquals(key1, "rocksolid:missed_class:S001:CO1:3:2026-09-20", "key is namespaced");
  assertEquals(key1 === key3, false, "different identities produce different keys");
});

// ── I04 namespacing ────────────────────────────────────────────────────────

Deno.test("I04: external_unique_key is namespaced to Rock Solid", () => {
  const key = buildExternalUniqueKey("test:data");
  assert(key.startsWith("rocksolid:"), "key is prefixed with rocksolid: namespace");
});

// ── I05/I06 response compatibility ────────────────────────────────────────────

Deno.test("I05/I06: the Nexus task id is read from task.id (task-api contract) and persisted", () => {
  assert(nexusSrc.includes("task.id"), "response parser reads task.id");
  assert(nexusSrc.includes("nexus_task_id: nexusTaskId"), "task ID persisted to state");
  assertEquals(nexusSrc.includes("created?.id"), false, "legacy top-level id extraction removed");
});
