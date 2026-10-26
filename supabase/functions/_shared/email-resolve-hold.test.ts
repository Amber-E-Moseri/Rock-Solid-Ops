// Resolve for email_queue is held. Retry for email_queue and Resolve for the other sources are not affected.
// Dependency-free assertions so these run offline as well as in CI. Needs --allow-read for the wiring check.
import { EMAIL_QUEUE_RESOLVE_HELD, EMAIL_RESOLVE_HELD_CODE, planResolve } from "./email-resolve-hold.ts";

function assertEq<T>(actual: T, expected: T, message = "") {
  if (actual !== expected) {
    throw new Error(`${message} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

Deno.test("the email_queue Resolve hold is on", () => {
  assertEq(EMAIL_QUEUE_RESOLVE_HELD, true, "held");
  assertEq(EMAIL_RESOLVE_HELD_CODE, "EMAIL_RESOLVE_HELD", "code");
});

Deno.test("Resolve for email_queue is refused, including case and whitespace variants", () => {
  assertEq(planResolve("resolve", "email_queue"), "refuse_held", "plain");
  assertEq(planResolve(" RESOLVE ", " Email_Queue "), "refuse_held", "normalised");
});

Deno.test("Retry for email_queue is not affected", () => {
  assertEq(planResolve("retry", "email_queue"), "proceed", "retry");
});

Deno.test("Resolve for the other sources is not affected", () => {
  assertEq(planResolve("resolve", "scheduled_notifications"), "proceed", "scheduled_notifications");
  assertEq(planResolve("resolve", "failed_syncs"), "proceed", "failed_syncs");
  assertEq(planResolve("resolve", "moodle_enrollment_sync"), "proceed", "moodle_enrollment_sync");
  assertEq(planResolve("resolve", "moodle_sync"), "proceed", "moodle_sync");
});

Deno.test("the hold can be lifted only by its parameter, and the default is held", () => {
  assertEq(planResolve("resolve", "email_queue", false), "proceed", "explicitly not held");
  assertEq(planResolve("resolve", "email_queue", true), "refuse_held", "explicitly held");
});

Deno.test("the email Resolve guard runs before any resolve write in retry-worker", async () => {
  const src = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));
  const guard = src.indexOf("planResolve(action, source)");
  const write = src.indexOf("await applyResolve(serviceDb, source, id);");
  if (guard < 0) throw new Error("planResolve guard not found in retry-worker");
  if (write < 0) throw new Error("applyResolve call not found in retry-worker");
  if (!(guard < write)) throw new Error("the email Resolve guard must run before applyResolve");
});

Deno.test("retry-worker does not map a held Resolve to another status", async () => {
  const src = await Deno.readTextFile(new URL("../retry-worker/index.ts", import.meta.url));
  const applyResolveStart = src.indexOf("async function applyResolve(");
  const body = src.slice(applyResolveStart, src.indexOf("Deno.serve(", applyResolveStart));
  const emailBlock = body.slice(body.indexOf('source === "email_queue"'), body.indexOf('source === "scheduled_notifications"'));
  if (/status:\s*"(Sent|Retried)"/.test(emailBlock)) throw new Error("email Resolve must not map to Sent or Retried");
});
