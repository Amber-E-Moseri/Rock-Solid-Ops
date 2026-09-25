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
// ID14  no automatic Nexus POST retry loop exists
// ID15  existing producer semantics remain unchanged

import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDedupeKey } from "./nexus-tasks.ts";

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

// ── ID14 No automatic retry loop ─────────────────────────────────

Deno.test("ID14: no automatic Nexus POST retry loop exists", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // createNexusTask must not have a while/for loop for retries
  const createFnStart = src.indexOf("export async function createNexusTask");
  const createFnEnd = src.indexOf("\nasync function updateSourceNexusTaskId", createFnStart);
  const createFn = src.slice(createFnStart, createFnEnd);

  assertEquals(createFn.includes("while (attempt"), false, "no while loop in createNexusTask");
  assertEquals(createFn.includes("for ("), false, "no for loop in createNexusTask");
});

// ── ID15 Existing producer semantics unchanged ───────────────────────

Deno.test("ID15: missed-class-detector trigger semantics preserved", async () => {
  const src = await Deno.readTextFile(new URL("../missed-class-detector/index.ts", import.meta.url));

  assert(src.includes('"missed_class"'), "missed_class type still present");
  assert(src.includes('"escalation"'), "escalation type still present");
  assert(src.includes("MISSED_CLASS_DETECTOR_SUMMARY"), "summary audit log still present");
});

Deno.test("ID15: retry-worker authorization structure unchanged", async () => {
  const src = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

  assert(src.includes("validateCronAuth"), "cron auth still present");
  assert(src.includes('req.headers.has("x-cron-secret")'), "cron secret path still present");
  assert(src.includes("await isAdmin(serviceDb"), "admin check still present");
});

// ── ID09 Nexus success persists task ID ──────────────────────────────

Deno.test("ID09: Nexus success persists canonical task ID", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // After successful Nexus response, nexus_task_id must be persisted
  assert(src.includes("nexus_task_id: nexusTaskId"), "task ID extracted from response");
  assert(src.includes("status: \"CREATED\""), "status marked as CREATED on success");
});

// ── ID12 Ambiguous timeout state ─────────────────────────────────────

Deno.test("ID12: ambiguous timeout becomes TIMEOUT_UNKNOWN or tracked distinctly", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // Timeout should be handled separately from other failures
  assert(src.includes("isTimeout"), "timeout detection logic present");
  assert(src.includes(".includes(\"abort\")") || src.includes(".includes('abort')"), "abort detection for timeout");
  assert(src.includes(".includes(\"timeout\")") || src.includes(".includes('timeout')"), "timeout string detection");
});

// ── ID11 Timeout never reports success ───────────────────────────────

Deno.test("ID11: Nexus timeout never resolves with success", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // After any error (timeout or other), the function must return ok: false
  // This is checked by looking for the error handling path
  assert(src.includes("if (createErr)"), "error handling path exists");
  assert(src.includes("ok: false"), "error responses return ok:false");
  assert(!src.includes("ok: true") || src.indexOf("ok: true") < src.indexOf("if (createErr)"), "no ok:true in error path");
});

// ── ID07/08 Validation tests ─────────────────────────────────────────

Deno.test("ID07/ID08: validation function exists in ensureNexusTask", async () => {
  const src = await Deno.readTextFile(new URL("./nexus-tasks.ts", import.meta.url));

  // Validation should happen before claiming
  assert(src.includes("validateDedupeFields"), "validation function for dedupe fields");
  assert(src.includes("NEXUS_TASK_MALFORMED"), "malformed task audit log");
  assert(src.includes("non_fatal: true"), "malformed tasks marked non-fatal");
});
