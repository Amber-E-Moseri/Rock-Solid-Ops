-- ─────────────────────────────────────────────────────────────────────────────
-- Email sender concurrency + directory performance indexes
--
-- 1) Adds 'Processing' to the email_queue status CHECK so email-sender can
--    atomically claim a batch (UPDATE ... WHERE status='Pending' RETURNING)
--    before sending. Without a claim state, overlapping runs (cron + manual
--    POST, or a slow run overlapping the next tick) fetch the same Pending
--    rows and double-send. 'Retried' is included for forward compatibility
--    with the retry pipeline's status vocabulary.
--
-- 2) Adds covering indexes for the applicant-directory and email pipeline
--    hot paths. Guarded by column-existence checks because table shapes have
--    drifted across environments (e.g. attendance_log has no created_at).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) email_queue claim state ─────────────────────────────────────────────────
ALTER TABLE public.email_queue DROP CONSTRAINT IF EXISTS email_queue_status_check;
ALTER TABLE public.email_queue ADD CONSTRAINT email_queue_status_check
  CHECK (status IN ('Pending', 'Processing', 'Sent', 'Failed', 'Retried'));

-- 2) performance indexes ─────────────────────────────────────────────────────
-- email-sender batch fetch: WHERE status = 'Pending' ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_email_queue_status_created_at
  ON public.email_queue (status, created_at);

DO $$
BEGIN
  -- stale-claim recovery sweep: WHERE status = 'Processing' AND updated_at < cutoff
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'email_queue' AND column_name = 'updated_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_email_queue_processing_updated_at
      ON public.email_queue (updated_at)
      WHERE status = 'Processing';
  END IF;

  -- directory attendance summaries: rows looked up per applicant
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'applicant_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_attendance_records_applicant
      ON public.attendance_records (applicant_id, created_at DESC);
  END IF;

  -- directory milestone cache: WHERE completed = true, grouped by applicant
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'student_milestone_status' AND column_name = 'completed'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_student_milestone_status_applicant_completed
      ON public.student_milestone_status (applicant_id)
      WHERE completed;
  END IF;

  -- drawer notification history: WHERE applicant_id = ? ORDER BY created_at DESC
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_events' AND column_name = 'applicant_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_notification_events_applicant_created
      ON public.notification_events (applicant_id, created_at DESC);
  END IF;

  -- drawer audit history: WHERE entity_id = ? ORDER BY created_at DESC
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
      ON public.audit_logs (entity_id, created_at DESC);
  END IF;
END $$;
