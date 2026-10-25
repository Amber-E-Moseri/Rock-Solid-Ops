// Server-side Moodle retry hold. The SPA flag in foundation-spa/src/releaseHolds.js is a UI hint only.
// retry-worker enforces this hold itself, so no client flag, request body or cron call can start a live
// Moodle synchronization through a retry. Keep MOODLE_RETRY_CERTIFIED false until the Moodle retry contract
// is certified and recorded in docs/BRANCH_HOLDS.md.
export const MOODLE_RETRY_CERTIFIED = false;

export const MOODLE_RETRY_HELD_CODE = "MOODLE_RETRY_HELD";

// Both identifiers reach the same synchronization. retry-worker canonicalises moodle_sync to
// moodle_enrollment_sync, and the guards below accept either one.
export const MOODLE_RETRY_SOURCES: readonly string[] = ["moodle_enrollment_sync", "moodle_sync"];

export class MoodleRetryHeldError extends Error {
  readonly code = MOODLE_RETRY_HELD_CODE;
  constructor() {
    super("Moodle retry is on hold pending endpoint and authorization certification.");
    this.name = "MoodleRetryHeldError";
  }
}

export function isMoodleRetrySource(source: string): boolean {
  return MOODLE_RETRY_SOURCES.includes(String(source || "").trim());
}

export function moodleRetryHeld(source: string, certified: boolean = MOODLE_RETRY_CERTIFIED): boolean {
  return !certified && isMoodleRetrySource(source);
}

export type DirectRetryPlan = "proceed" | "refuse_held";

// Resolve and every non-Moodle retry are unaffected. Only a Moodle retry request is refused, before any write.
export function planDirectRetry(
  action: string,
  source: string,
  certified: boolean = MOODLE_RETRY_CERTIFIED,
): DirectRetryPlan {
  return action === "retry" && moodleRetryHeld(source, certified) ? "refuse_held" : "proceed";
}

export type SweepPlan = "run" | "skip_held";

// The automated sweep only handles Moodle enrollment rows. While held it marks nothing and triggers nothing.
export function planSweep(certified: boolean = MOODLE_RETRY_CERTIFIED): SweepPlan {
  return moodleRetryHeld("moodle_enrollment_sync", certified) ? "skip_held" : "run";
}

export type SyncFetch = (input: string, init: RequestInit) => Promise<Response>;

// Every retry-driven call to moodle-sync goes through here. While held it rejects before any request is made.
export function invokeMoodleRetrySync(
  fetchFn: SyncFetch,
  url: string,
  init: RequestInit,
  certified: boolean = MOODLE_RETRY_CERTIFIED,
): Promise<Response> {
  if (!certified) return Promise.reject(new MoodleRetryHeldError());
  return fetchFn(url, init);
}
