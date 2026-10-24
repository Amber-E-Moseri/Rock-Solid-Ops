// Moodle synchronization policy. Pure functions with no imports, so the rules can be unit-tested without
// loading index.ts, which starts the server at import time.

// Staff roles that may run moodle-sync manually, including action=test. Service-role callers are accepted
// separately by the shared helper.
export const MOODLE_SYNC_STAFF_ROLES: readonly string[] = ["admin", "superadmin"];

// Only these statuses may be claimed for processing. SYNCED rows are never selected, so a repeated request
// cannot reset a synchronized student's Moodle password. PROCESSING rows belong to a live run.
// PERMANENTLY_FAILED rows have exhausted their retries.
export const SELECTABLE_SYNC_STATUSES: readonly string[] = ["PENDING", "RETRYING", "FAILED"];

export function isSelectableSyncRow(row: { sync_status?: unknown; registration_status?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const status = String(row.sync_status ?? "").trim().toUpperCase();
  const registration = String(row.registration_status ?? "").trim().toUpperCase();
  return registration === "ASSIGNED" && SELECTABLE_SYNC_STATUSES.includes(status);
}

// Moodle site URL for student-facing emails, derived from the configured MOODLE_URL and never from a
// hardcoded host. Keeps the trailing slash the credential email has always used.
export function moodleSiteUrl(configuredBase: string): string {
  const trimmed = String(configuredBase ?? "").trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}
