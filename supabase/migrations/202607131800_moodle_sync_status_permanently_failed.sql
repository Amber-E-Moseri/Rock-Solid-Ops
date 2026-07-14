-- moodle-sync/index.ts writes sync_status = 'PERMANENTLY_FAILED' (retry_count
-- exceeded), but the original CHECK constraint never listed that value, so
-- those updates were plausibly rejected/dropped. Widen the constraint
-- additively; idempotent so re-running this migration is safe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'moodle_enrollment_sync'
      AND constraint_name = 'moodle_enrollment_sync_status_chk'
  ) THEN
    ALTER TABLE public.moodle_enrollment_sync
      DROP CONSTRAINT moodle_enrollment_sync_status_chk;
  END IF;
END $$;

ALTER TABLE public.moodle_enrollment_sync
  ADD CONSTRAINT moodle_enrollment_sync_status_chk
  CHECK (sync_status IN (
    'PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'RETRYING',
    'RESOLVED', 'SKIPPED', 'PERMANENTLY_FAILED'
  ));
