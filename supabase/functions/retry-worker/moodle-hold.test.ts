import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  isMoodleRetryCertified,
  isMoodleRetryHeld,
  isMoodleSweepHeld,
  isUnauthenticatedRequestAllowed,
  MOODLE_RETRY_SOURCES,
} from "./moodle-hold.ts";

// ── Certification flag: defaults to false, only the exact value "true" lifts the hold ─────────

Deno.test("certification defaults to false when the environment variable is unset", () => {
  assertEquals(isMoodleRetryCertified(undefined), false);
  assertEquals(isMoodleRetryCertified(null), false);
  assertEquals(isMoodleRetryCertified(""), false);
});

Deno.test("certification fails closed for any value other than the exact string true", () => {
  for (const raw of ["false", "0", "1", "yes", "TRUE", "True", "on", "enabled"]) {
    assertEquals(isMoodleRetryCertified(raw), false, `value ${JSON.stringify(raw)}`);
  }
});

Deno.test("certification is true only for the exact string true, ignoring surrounding whitespace", () => {
  assertEquals(isMoodleRetryCertified("true"), true);
  assertEquals(isMoodleRetryCertified(" true "), true);
});

// ── Direct retry: both Moodle identifiers are held while certification is false ─────────────

Deno.test("both Moodle source identifiers are listed for the hold", () => {
  assertEquals([...MOODLE_RETRY_SOURCES].sort(), ["moodle_enrollment_sync", "moodle_sync"]);
});

Deno.test("direct retry of moodle_enrollment_sync is held while certification is false", () => {
  assertEquals(isMoodleRetryHeld("retry", "moodle_enrollment_sync", false), true);
});

Deno.test("direct retry of the legacy moodle_sync identifier is held while certification is false", () => {
  assertEquals(isMoodleRetryHeld("retry", "moodle_sync", false), true);
});

Deno.test("retry with surrounding whitespace in the action or source is still held", () => {
  assertEquals(isMoodleRetryHeld(" retry ", "moodle_enrollment_sync", false), true);
  assertEquals(isMoodleRetryHeld("retry", " moodle_sync ", false), true);
});

Deno.test("no Moodle retry is permitted while certification is false, whatever the action casing", () => {
  // The index lower-cases the action before this call, so an upper-case action is not a retry.
  assertEquals(isMoodleRetryHeld("RETRY", "moodle_enrollment_sync", false), false);
});

// ── Permitted behavior: certification true, resolve, and non-Moodle retries ─────────────────

Deno.test("with certification enabled, Moodle retry is not held (original path preserved)", () => {
  assertEquals(isMoodleRetryHeld("retry", "moodle_enrollment_sync", true), false);
  assertEquals(isMoodleRetryHeld("retry", "moodle_sync", true), false);
});

Deno.test("resolve of a Moodle source is never held, so Resolve keeps working", () => {
  assertEquals(isMoodleRetryHeld("resolve", "moodle_enrollment_sync", false), false);
  assertEquals(isMoodleRetryHeld("resolve", "moodle_sync", false), false);
  assertEquals(isMoodleRetryHeld("", "moodle_enrollment_sync", false), false);
});

Deno.test("non-Moodle retries are never held, with or without certification", () => {
  for (const source of ["email_queue", "scheduled_notifications", "failed_syncs"]) {
    assertEquals(isMoodleRetryHeld("retry", source, false), false, source);
    assertEquals(isMoodleRetryHeld("retry", source, true), false, source);
  }
});

Deno.test("an empty or unknown source is not treated as a Moodle source", () => {
  assertEquals(isMoodleRetryHeld("retry", "", false), false);
  assertEquals(isMoodleRetryHeld("retry", "moodle", false), false);
  assertEquals(isMoodleRetryHeld("retry", "moodle_enrollment_sync_x", false), false);
});

// ── Scheduled sweep ────────────────────────────────────────────────────────────────────────

Deno.test("scheduled Moodle sweep is held while certification is false", () => {
  assertEquals(isMoodleSweepHeld(false), true);
});

Deno.test("scheduled Moodle sweep runs when certification is enabled", () => {
  assertEquals(isMoodleSweepHeld(true), false);
});

// ── Unauthenticated (scheduler) requests may only run the sweep ───────────────────────────

Deno.test("an unauthenticated request with no action and no id is the sweep and is allowed", () => {
  assertEquals(isUnauthenticatedRequestAllowed({}), true);
  assertEquals(isUnauthenticatedRequestAllowed({ action: "", id: "" }), true);
});

Deno.test("an unauthenticated request that names a row is refused", () => {
  assertEquals(isUnauthenticatedRequestAllowed({ id: "row-1" }), false);
});

Deno.test("an unauthenticated request that names an action is refused", () => {
  assertEquals(isUnauthenticatedRequestAllowed({ action: "retry" }), false);
  assertEquals(isUnauthenticatedRequestAllowed({ action: "resolve" }), false);
});

// ── Source contract: index.ts applies the gate before every mutation or Moodle call ─────────

const indexSrc = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function at(needle: string): number {
  const i = indexSrc.indexOf(needle);
  if (i < 0) throw new Error(`missing in index.ts: ${needle}`);
  return i;
}

Deno.test("index.ts reads certification from the function environment, not from a constant", () => {
  assertStringIncludes(indexSrc, "Deno.env.get(MOODLE_RETRY_CERTIFIED_ENV)");
  assertEquals(/moodleCertified\s*=\s*true\b/.test(indexSrc), false, "certification must not be hard-coded true");
});

Deno.test("index.ts refuses unauthenticated named requests before the sweep or any row action", () => {
  const gate = at("isUnauthenticatedRequestAllowed({ action, id })");
  assert(gate < at("sweepMoodleEnrollmentRetries(serviceDb, limit)"), "unauthenticated gate must precede the sweep");
  assert(gate < at("await applyRetry(serviceDb, source, id);"), "unauthenticated gate must precede any retry mutation");
});

Deno.test("index.ts holds the scheduled sweep before it selects rows or invokes moodle-sync", () => {
  const held = at("isMoodleSweepHeld(moodleCertified)");
  assert(held < at("sweepMoodleEnrollmentRetries(serviceDb, limit)"), "sweep hold must precede the sweep");
  const sweepTrigger = indexSrc.indexOf("/functions/v1/moodle-sync`, {", at("sweepMoodleEnrollmentRetries(serviceDb, limit)"));
  assert(held < sweepTrigger, "sweep hold must precede the sweep's moodle-sync call");
});

Deno.test("index.ts holds a direct Moodle retry before any mutation or moodle-sync invocation", () => {
  const held = at("isMoodleRetryHeld(action, source, moodleCertified)");
  assert(held < at("await applyRetry(serviceDb, source, id);"), "hold must precede applyRetry in the retry branch");
  assert(held < at("await triggerMoodleSync(SUPABASE_URL, SERVICE_KEY, id);"), "hold must precede triggerMoodleSync");
});

Deno.test("index.ts returns a locked response for a held retry, without invoking the worker", () => {
  const start = at("isMoodleRetryHeld(action, source, moodleCertified)");
  const end = indexSrc.indexOf("423);", start);
  assert(end > start, "held branch must end in a 423 response");
  const block = indexSrc.slice(start, end);
  assertStringIncludes(block, "MOODLE_RETRY_HELD_CODE");
  assertEquals(block.includes("applyRetry("), false);
  assertEquals(block.includes("triggerMoodleSync("), false);
});

Deno.test("index.ts still refuses a non-admin authenticated caller before the hold is evaluated", () => {
  assert(at("Admin access required") < at("isMoodleRetryHeld(action, source, moodleCertified)"));
});
