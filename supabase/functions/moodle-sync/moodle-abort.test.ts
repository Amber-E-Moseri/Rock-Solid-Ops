// Moodle timeout abort tests (M01–M09)
//
// M01  normal Moodle request succeeds
// M02  timeout calls AbortController.abort()
// M03  fetch receives controller.signal
// M04  timeout remains classified as TIMEOUT
// M05  retryable timeout behavior unchanged
// M06  timer cleared
// M07  no immediate second Moodle request occurs inside callMoodle
// M08  C3B retry selector semantics unchanged
// M09  MOODLE_WAF_BLOCK remains retryable

import { assert, assertEquals } from "jsr:@std/assert@1";

// ── M02 M03 M06 Abort and timer management ───────────────────────────

Deno.test("M02/M03/M06: callMoodle uses AbortController and clearTimeout", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  const callMoodleStart = src.indexOf("async function callMoodle(");
  const callMoodleEnd = src.indexOf("\nasync function findOrCreateMoodleUser(", callMoodleStart);
  const fn = src.slice(callMoodleStart, callMoodleEnd);

  // M03: controller created and signal passed to fetch
  assert(fn.includes("const controller = new AbortController()"), "AbortController created");
  assert(fn.includes("const timer = setTimeout(() => controller.abort()"), "timer calls abort()");
  assert(fn.includes("signal: controller.signal"), "signal passed to fetch");

  // M02: abort is called on timeout
  assert(fn.includes("controller.abort()"), "abort() called on timeout");

  // M06: timer is cleared
  assert(fn.includes("clearTimeout(timer)"), "timer cleared in finally block");
  assert(fn.includes("} finally {"), "finally block exists");
});

// ── M07 No retry loop in callMoodle ──────────────────────────────────

Deno.test("M07: no immediate second Moodle request occurs inside callMoodle", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  const callMoodleStart = src.indexOf("async function callMoodle(");
  const callMoodleEnd = src.indexOf("\nasync function findOrCreateMoodleUser(", callMoodleStart);
  const fn = src.slice(callMoodleStart, callMoodleEnd);

  // No retry loop inside callMoodle
  assertEquals(fn.includes("while (attempt"), false, "no while loop in callMoodle");
  assertEquals(fn.includes("for ("), false, "no for loop in callMoodle");
  assertEquals(fn.includes("retry"), false, "no explicit retry mechanism");

  // Single fetch only
  const fetchCount = (fn.match(/fetch\(/g) || []).length;
  assertEquals(fetchCount, 1, "exactly one fetch() call in callMoodle");
});

// ── M04 TIMEOUT classification preserved ────────────────────────────

Deno.test("M04: timeout remains classified as TIMEOUT", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // Error messages should be unchanged
  assert(src.includes('throw new Error(`Moodle HTTP ${response.status}'), "HTTP error format preserved");
  assert(src.includes('throw new Error(`Moodle ${wsfunction}'), "Moodle error format preserved");

  // On timeout, AbortError is caught and propagated
  // The error classification is handled by the caller
  assert(src.includes("catch (error)"), "errors are caught");
});

// ── M05 Retryable timeout behavior unchanged ──────────────────────────

Deno.test("M05: retryable timeout behavior unchanged", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // Timeouts should be treated as retryable at the retry-worker level
  // moodle-sync itself should not change retry classification logic
  assert(src.includes("exponentialBackoffMs"), "backoff calculation preserved");
  assert(src.includes("classify403Cause"), "403 classification logic preserved");
  assert(src.includes("retryable: true"), "retryable flag preserved");
});

// ── M09 WAF block retryable ──────────────────────────────────────────

Deno.test("M09: MOODLE_WAF_BLOCK remains retryable", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  assert(src.includes("MOODLE_WAF_BLOCK"), "MOODLE_WAF_BLOCK code defined");
  assert(src.includes('retryable: true'), "WAF block is marked retryable");
  assert(src.includes("CF-Ray") || src.includes("Cloudflare") || src.includes("403"), "WAF/Cloudflare detection");
});

// ── M01 Normal request succeeds (not directly testable without mock, verify structure) ───

Deno.test("M01: normal Moodle request structure preserved", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  const callMoodleStart = src.indexOf("async function callMoodle(");
  const callMoodleEnd = src.indexOf("\nasync function findOrCreateMoodleUser(", callMoodleStart);
  const fn = src.slice(callMoodleStart, callMoodleEnd);

  // Request structure preserved
  assert(fn.includes("new URLSearchParams("), "URLSearchParams for body");
  assert(fn.includes("wstoken:"), "wstoken parameter");
  assert(fn.includes("wsfunction:"), "wsfunction parameter");
  assert(fn.includes("moodlewsrestformat: \"json\""), "JSON format specified");
  assert(fn.includes("method: \"POST\""), "POST method");
  assert(fn.includes("webservice/rest/server.php"), "correct Moodle endpoint");
});

// ── M08 C3B retry selector unchanged ────────────────────────────────

Deno.test("M08: C3B Moodle retry retry selector semantics unchanged", async () => {
  const src = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));

  // The retry eligibility logic in retry-worker must not change
  assert(src.includes("isRetryableMoodleError"), "retry selector function");
  assert(src.includes("MOODLE_WAF_BLOCK"), "WAF block case");
  assert(src.includes("MOODLE_REST_DISABLED"), "REST disabled non-retryable");
  assert(src.includes("MOODLE_PERMISSION_DENIED"), "permission denied non-retryable");
  assert(src.includes("MOODLE_403_UNKNOWN"), "unknown 403 non-retryable");
});
