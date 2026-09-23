-- Wave C3A: restore moodle-sync failure-state persistence.
--
-- moodle-sync/index.ts writes next_retry_at together with sync_status,
-- retry_count and retry_requested_at whenever a sync fails. No earlier
-- migration defined the column, so on a database built from migrations (and
-- in production) PostgreSQL rejected the whole failure UPDATE and the row was
-- left in PROCESSING with retry_count unchanged.
--
-- Additive and idempotent. No RLS, grant, or data changes.
ALTER TABLE public.moodle_enrollment_sync
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
