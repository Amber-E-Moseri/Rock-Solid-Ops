// Server-side Moodle retry hold for retry-worker.
//
// The SPA's releaseHolds.js only hides and disables the UI. It is not an authorization control, and
// direct function invocation bypasses it. This module is the server's own gate. Certification
// defaults to false. Only the exact value "true" in MOODLE_RETRY_CERTIFIED lifts the hold, and that
// value must be set in the function environment, never in client code.

export const MOODLE_RETRY_CERTIFIED_ENV = "MOODLE_RETRY_CERTIFIED";

// retry-worker's retry branch invokes live Moodle synchronization for these sources. Legacy
// moodle_sync is canonicalised to moodle_enrollment_sync before the check, and both are listed so
// the gate does not depend on that ordering.
export const MOODLE_RETRY_SOURCES: readonly string[] = Object.freeze([
  "moodle_enrollment_sync",
  "moodle_sync",
]);

export const MOODLE_RETRY_HELD_CODE = "MOODLE_RETRY_HELD";

export const MOODLE_RETRY_HELD_MESSAGE =
  "Moodle retry is on hold: server-side Moodle retry certification is not enabled.";

export function isMoodleRetryCertified(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim() === "true";
}

// True when a retry request would apply a retry mutation or invoke live Moodle sync while the hold
// is in force. Resolve and every non-Moodle source are not affected.
export function isMoodleRetryHeld(action: string, source: string, certified: boolean): boolean {
  if (certified) return false;
  if (String(action || "").trim() !== "retry") return false;
  return MOODLE_RETRY_SOURCES.includes(String(source || "").trim());
}

// The scheduled sweep selects Moodle rows and invokes moodle-sync. It is held in full while the
// hold is in force, including its escalation side effects.
export function isMoodleSweepHeld(certified: boolean): boolean {
  return !certified;
}

// A request without an Authorization header is treated as the scheduler. The scheduler only runs
// the sweep, which names no row and no action. Any other unauthenticated request (a named row or an
// action) must be refused, because the admin check is skipped for it.
export function isUnauthenticatedRequestAllowed(input: { action?: string; id?: string }): boolean {
  return !String(input.action || "").trim() && !String(input.id || "").trim();
}
