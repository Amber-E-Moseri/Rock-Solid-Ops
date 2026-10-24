// Deno tests for the server-side Moodle retry hold. Run: deno test supabase/functions/_shared/moodle-retry-hold.test.ts
import {
  MOODLE_RETRY_CERTIFIED,
  MOODLE_RETRY_HELD_CODE,
  MoodleRetryHeldError,
  invokeMoodleRetrySync,
  isMoodleRetrySource,
  moodleRetryHeld,
  planDirectRetry,
  planSweep,
} from "./moodle-retry-hold.ts";

function assertEquals<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function recordingFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  return { fn, calls };
}

const SYNC_URL = "https://project.example.test/functions/v1/moodle-sync";
const SYNC_INIT: RequestInit = { method: "POST", body: JSON.stringify({ id: "row-1", limit: 1 }) };

Deno.test("hold is closed in the shipped build", () => {
  assertEquals(MOODLE_RETRY_CERTIFIED, false, "MOODLE_RETRY_CERTIFIED");
  assertEquals(MOODLE_RETRY_HELD_CODE, "MOODLE_RETRY_HELD", "held code");
});

Deno.test("both Moodle source identifiers are recognised, and only those", () => {
  assertEquals(isMoodleRetrySource("moodle_enrollment_sync"), true, "canonical id");
  assertEquals(isMoodleRetrySource("moodle_sync"), true, "legacy alias id");
  assertEquals(isMoodleRetrySource(" moodle_sync "), true, "trimmed alias");
  assertEquals(isMoodleRetrySource("email_queue"), false, "email_queue");
  assertEquals(isMoodleRetrySource("scheduled_notifications"), false, "scheduled_notifications");
  assertEquals(isMoodleRetrySource("failed_syncs"), false, "failed_syncs");
  assertEquals(isMoodleRetrySource(""), false, "empty");
});

Deno.test("direct retry of a Moodle source is refused while held, for both identifiers", () => {
  assertEquals(planDirectRetry("retry", "moodle_enrollment_sync", false), "refuse_held", "canonical retry");
  assertEquals(planDirectRetry("retry", "moodle_sync", false), "refuse_held", "alias retry");
});

Deno.test("non-Moodle retries and every resolve remain available while held", () => {
  for (const source of ["email_queue", "scheduled_notifications", "failed_syncs"]) {
    assertEquals(planDirectRetry("retry", source, false), "proceed", `retry ${source}`);
    assertEquals(planDirectRetry("resolve", source, false), "proceed", `resolve ${source}`);
  }
  assertEquals(planDirectRetry("resolve", "moodle_enrollment_sync", false), "proceed", "resolve canonical Moodle");
  assertEquals(planDirectRetry("resolve", "moodle_sync", false), "proceed", "resolve alias Moodle");
});

Deno.test("automated sweep is skipped while held and runs when certified", () => {
  assertEquals(planSweep(false), "skip_held", "sweep while held");
  assertEquals(planSweep(true), "run", "sweep when certified");
  assertEquals(moodleRetryHeld("moodle_enrollment_sync", false), true, "sweep source held");
});

Deno.test("held guard throws before any request to moodle-sync", async () => {
  const spy = recordingFetch();
  let thrown: unknown = null;
  try {
    await invokeMoodleRetrySync(spy.fn, SYNC_URL, SYNC_INIT, false);
  } catch (err) {
    thrown = err;
  }
  assertEquals(thrown instanceof MoodleRetryHeldError, true, "throws MoodleRetryHeldError");
  assertEquals((thrown as MoodleRetryHeldError).code, MOODLE_RETRY_HELD_CODE, "error code");
  assertEquals(spy.calls.length, 0, "no live synchronization request while held");
});

Deno.test("guard performs exactly one request when certified (proves the test is not vacuous)", async () => {
  const spy = recordingFetch();
  const res = await invokeMoodleRetrySync(spy.fn, SYNC_URL, SYNC_INIT, true);
  assertEquals(res.status, 200, "response status");
  assertEquals(spy.calls.length, 1, "one request when certified");
  assertEquals(spy.calls[0].url, SYNC_URL, "request url");
});

Deno.test("positive control: certification is the only switch that releases a Moodle retry", () => {
  assertEquals(planDirectRetry("retry", "moodle_enrollment_sync", true), "proceed", "certified direct retry");
  assertEquals(planDirectRetry("retry", "moodle_sync", true), "proceed", "certified alias retry");
  assertEquals(planSweep(true), "run", "certified sweep");
});
