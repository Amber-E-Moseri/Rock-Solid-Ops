-- ─────────────────────────────────────────────────────────────────────────────
-- Applicant directory server-side aggregation (audit Priority 1)
--
-- One row per applicant replaces the directory's bulk downloads of up to
-- 10,000 attendance_records rows and 20,000 student_milestone_status rows.
-- The client (foundation/js/applicant-directory.js) queries this view first
-- and falls back to the raw-table loads if it does not exist yet, so this
-- migration can ship independently of the frontend.
--
-- security_invoker makes the view honor the querying user's RLS policies —
-- the same visibility the client-side aggregation had.
--
-- Guarded by existence checks because table shapes drift across environments.
-- Casts both sides of joins to text so uuid/text key drift cannot break it.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'applicant_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'student_milestone_status' AND column_name = 'completed'
  ) THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.applicant_directory_summaries
      WITH (security_invoker = true) AS
      SELECT
        a.id::text                                        AS applicant_id,
        COALESCE(att.total_sessions, 0)                   AS total_sessions,
        COALESCE(att.attended_sessions, 0)                AS attended_sessions,
        att.last_attendance_at,
        COALESCE(ms.completed_milestones, '{}'::text[])   AS completed_milestones
      FROM public.applicants a
      LEFT JOIN (
        SELECT
          applicant_id::text AS applicant_id,
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE lower(status) = 'present')::int AS attended_sessions,
          MAX(created_at) AS last_attendance_at
        FROM public.attendance_records
        GROUP BY applicant_id::text
      ) att ON att.applicant_id = a.id::text
      LEFT JOIN (
        SELECT
          applicant_id::text AS applicant_id,
          array_agg(DISTINCT upper(milestone_code)) AS completed_milestones
        FROM public.student_milestone_status
        WHERE completed
        GROUP BY applicant_id::text
      ) ms ON ms.applicant_id = a.id::text
    $view$;

    GRANT SELECT ON public.applicant_directory_summaries TO authenticated;
  END IF;
END $$;
