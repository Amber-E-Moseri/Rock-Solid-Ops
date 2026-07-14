// Shared dedupe-key construction for the consolidated "class now available"
// waitlist notification (Option C consolidation, 2026-07-14).
//
// Dedupe key format: see ai/statuses.md CLASS_AVAILABLE entry. Must be
// identical in both trigger and cron. No timestamp component.
//
// The SQL producer mirror lives in
// supabase/migrations/202607141000_waitlist_consolidate_dedup.sql
// (queue_waitlisted_class_available_notifications):
//   format('class_available:%s:%s:%s', applicant_id, batch_id, class_option_id)
// The two MUST stay byte-identical for identical inputs; the parity test in
// waitlist-dedup.test.ts guards this.
//
// Component types (000_baseline_squash.sql): applicants.id is UUID (line 328,
// hex + hyphens, can never contain ':'), batches.batch_id and
// class_options.class_option_id are TEXT (lines 189, 224). Components are
// interpolated raw, so a ':' inside batch_id or class_option_id could in
// theory make two distinct tuples collide; no ID generator in this repo emits
// colons (batch ids look like '2025A'/'B3', class option ids are preserved
// Apps Script text ids), so this is a documented caveat, not a live risk.

export const CANONICAL_TEMPLATE_KEY = "classes_now_available";
export const DEDUPE_KEY_PREFIX = "class_available";

export function buildClassAvailableDedupeKey(
  applicantId: string,
  batchId: string,
  classOptionId: string,
): string {
  return `${DEDUPE_KEY_PREFIX}:${applicantId}:${batchId}:${classOptionId}`;
}
