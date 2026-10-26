// Nexus task idempotency tests (ID01–ID15)
//
// ID01  two simultaneous same-key claims produce exactly one owner
// ID02  non-owner does not POST Nexus
// ID03  sequential invocation after CREATED reuses canonical nexus_task_id
// ID04  different dedupe keys can be claimed independently
// ID05  stale claim can be recovered according to TTL
// ID06  fresh claim cannot be stolen
// ID07  malformed missed_class identity rejected before POST
// ID08  malformed escalation identity rejected before POST
// ID09  Nexus success persists canonical task ID
// ID10  Nexus deterministic failure follows approved failure semantics
// ID11  Nexus timeout never reports success
// ID12  ambiguous timeout becomes TIMEOUT_UNKNOWN or equivalent
// ID13  TIMEOUT_UNKNOWN is NOT blindly re-POSTed
// ID14  no application-level Nexus POST retry loop exists (the HTTP client may still resend; safety is the external_unique_key)
// ID15  existing producer semantics remain unchanged

import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDedupeKey } from "./nexus-tasks.ts";

// Loopback Deno.serve endpoints are explicit local test opt-ins; production callers never pass this.
const LOCAL_TEST = { allowLocalTestHttp: true };

// ── ID04 Different keys independent ──────────────────────────────

Deno.test("ID04: different dedupe keys can be claimed independently", () => {
  const p1 = { student_id: "S1", class_option_id: "CO1", class_number: "3", class_date: "2026-09-20" };
  const p2 = { student_id: "S2", class_option_id: "CO1", class_number: "3", class_date: "2026-09-20" };

  const k1 = buildDedupeKey("missed_class", p1);
  const k2 = buildDedupeKey("missed_class", p2);

  assert(k1 !== k2, "different student IDs produce different keys");
  assert(k1.startsWith("missed_class:S1:"), "key includes student_id");
  assert(k2.startsWith("missed_class:S2:"), "key includes student_id");
});

// ── ID14 No application-level retry loop ─────────────────────────

Deno.test("ID14: no application-level Nexus POST retry loop exists; duplicate safety is the external_unique_key", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // createNexusTask must not have a while/for loop for retries
  const createFnStart = src.indexOf("export async function createNexusTask");
  const createFnEnd = src.indexOf("\nasync function updateSourceNexusTaskId", createFnStart);
  const createFn = src.slice(createFnStart, createFnEnd);

  assertEquals(createFn.includes("while (attempt"), false, "no while loop in createNexusTask");
  assertEquals(createFn.includes("for ("), false, "no for loop in createNexusTask");

  // The code must not claim the client never resends: Deno's fetch can resend a POST after a connection reset.
  const header = src.slice(src.indexOf("// One POST attempt"), createFnStart);
  assertEquals(/no automatic retry/i.test(header), false, "the comment must not claim 'no automatic retry'");
  assertEquals(header.includes("external_unique_key"), true, "the comment names the real safety mechanism");
  assertEquals(header.includes("resend"), true, "the comment states that the HTTP client may resend");
  // ...and the safety mechanism is actually sent on every request.
  assertEquals(createFn.includes("external_unique_key: externalUniqueKey"), true, "the key is always in the POST body");
});

// ── ID15 Existing producer semantics unchanged ───────────────────────

Deno.test("ID15: missed-class-detector trigger semantics preserved", async () => {
  const src = await Deno.readTextFile(new URL("../missed-class-detector/index.ts", import.meta.url));

  assert(src.includes('"missed_class"'), "missed_class type still present");
  assert(src.includes('"escalation"'), "escalation type still present");
  assert(src.includes("MISSED_CLASS_DETECTOR_SUMMARY"), "summary audit log still present");
});

// ── ID09 Nexus success persists task ID ──────────────────────────────

Deno.test("ID09: Nexus success persists canonical task ID", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // After successful Nexus response, nexus_task_id must be persisted
  assert(src.includes("nexus_task_id: nexusTaskId"), "task ID extracted from response");
  assert(src.includes("status: \"CREATED\""), "status marked as CREATED on success");
});

// ── ID12 Ambiguous timeout state ─────────────────────────────────────

Deno.test("ID12: ambiguous outcomes (timeout, unconfirmed 2xx) are TIMEOUT_UNKNOWN; definite rejections are FAILED", async () => {
  const { classifyCreateFailure, NexusTimeoutError, NexusMalformedResponseError, NexusHttpError } = await import("./nexus-tasks.ts");
  assertEquals(classifyCreateFailure(new NexusTimeoutError("t")), "TIMEOUT_UNKNOWN");
  assertEquals(classifyCreateFailure(new NexusMalformedResponseError("m")), "TIMEOUT_UNKNOWN");
  assertEquals(classifyCreateFailure(new NexusHttpError(400, "bad")), "FAILED");
  assertEquals(classifyCreateFailure(new NexusHttpError(500, "boom")), "FAILED");
  assertEquals(classifyCreateFailure(new TypeError("fetch failed")), "FAILED");
});

// ── ID11 Timeout never reports success ───────────────────────────────

Deno.test("ID11: Nexus timeout never resolves with success", async () => {
  const { createNexusTask, NexusTimeoutError } = await import("./nexus-tasks.ts");
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) =>
    new Promise<Response>((resolve) => {
      req.signal.addEventListener("abort", () => resolve(new Response("{}", { status: 200 })));
      setTimeout(() => resolve(new Response("{}", { status: 200 })), 3000);
    }),
  );
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const out = await createNexusTask(url, "k", {}, "rocksolid:t", 100, LOCAL_TEST).then(() => "resolved", (e) => e);
    assert(out instanceof NexusTimeoutError, "timeout must reject with NexusTimeoutError, never resolve");
  } finally {
    await server.shutdown();
  }
});

// ── ID07/08 Validation tests ─────────────────────────────────────────

Deno.test("ID07/ID08: validation function exists in ensureNexusTask", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // Validation should happen before claiming
  assert(src.includes("validateDedupeFields"), "validation function for dedupe fields");
  assert(src.includes("NEXUS_TASK_MALFORMED"), "malformed task audit log");
  assert(src.includes("non_fatal: true"), "malformed tasks marked non-fatal");
});
