// Retry update for public.email_queue. Writes only columns the staging schema has. last_error is absent on
// purpose: email-sender records send failures in error_message alone, and staging email_queue has no
// last_error column. PostgREST rejects an UPDATE that names a missing column, so including it fails the retry.

export type EmailQueueRetryRow = { status?: unknown; retry_count?: unknown };

export function buildEmailQueueRetryUpdate(row: EmailQueueRetryRow, now: string) {
  return {
    status: "Pending",
    error_message: null,
    retry_count: Number(row.retry_count || 0) + 1,
    last_retry_at: now,
    updated_at: now,
  };
}
