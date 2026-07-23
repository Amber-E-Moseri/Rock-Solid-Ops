-- Fix get_student_attention_flags: attendance_log has no created_at column.
--
-- Bug (found in brief/attention-flags-audit, docs/migration-log.md 2026-07-14): the
-- attendance_ordered CTE's row_number() window orders by al.created_at, but
-- attendance_log's only timestamp column is logged_at (supabase/migrations/
-- 000_baseline_squash.sql:592-621) -- created_at never existed on this table. The
-- reference throws on every call and is swallowed by the blanket
-- EXCEPTION WHEN OTHERS THEN RETURN, so this function has silently returned zero rows
-- for all five student flag types since creation (202605220011), even after the
-- student_grades.student_email fix (202607131700) removed the first bug in the same
-- function. Fix: order by al.logged_at instead, which serves the same
-- "row-creation order" tiebreak purpose.
--
-- Also narrows the failure mode to match the fix already applied to
-- get_teacher_attention_flags (202607142100): instead of silently returning zero rows
-- on any error, the exception handler now logs to audit_logs
-- (action=ATTENTION_FLAGS_ERROR, status=FAILED) with SQLSTATE/SQLERRM before returning
-- empty, so a future regression is visible to ops instead of looking identical to
-- "no flags right now".
--
-- Function body is otherwise unchanged from 202607131700_moodle_no_login_flag_threshold.sql.

begin;

CREATE OR REPLACE FUNCTION public.get_student_attention_flags(p_batch_id text DEFAULT NULL)
RETURNS TABLE (
  flag_type text,
  applicant_id text,
  full_name text,
  email text,
  fellowship_code text,
  teacher_name text,
  detail text,
  severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cls AS (
    SELECT
      co.class_option_id::text AS class_option_id,
      co.day::text AS class_day,
      co.class_time::text AS class_time,
      COALESCE(t.full_name, co.teacher_name, co.teacher_id::text, 'Unassigned')::text AS teacher_name,
      cs.batch_id::text AS batch_id
    FROM class_options co
    LEFT JOIN class_slots cs ON cs.class_option_id::text = co.class_option_id::text
    LEFT JOIN teachers t ON t.teacher_id::text = co.teacher_id::text
  ),
  assigned AS (
    SELECT
      a.id::text AS applicant_id,
      COALESCE(a.full_name, trim(concat_ws(' ', a.first_name, a.last_name)), 'Unknown Student')::text AS full_name,
      COALESCE(a.email, '')::text AS email,
      COALESCE(a.fellowship_code, '')::text AS fellowship_code,
      COALESCE(c.teacher_name, 'Unassigned')::text AS teacher_name,
      a.class_option_id::text AS class_option_id,
      COALESCE(a.assigned_at, a.updated_at, a.created_at) AS assigned_at,
      COALESCE(c.batch_id, a.batch_id::text) AS batch_id,
      c.class_day,
      c.class_time
    FROM applicants a
    LEFT JOIN cls c ON c.class_option_id = a.class_option_id::text
    WHERE COALESCE(a.registration_status, a.status) = 'ASSIGNED'
      AND (p_batch_id IS NULL OR COALESCE(c.batch_id, a.batch_id::text) = p_batch_id)
  ),
  inactive AS (
    SELECT
      'inactive_no_attendance'::text AS flag_type,
      s.applicant_id,
      s.full_name,
      s.email,
      s.fellowship_code,
      s.teacher_name,
      format('Assigned %s, class %s %s, no attendance in 2+ weeks', to_char(s.assigned_at::date, 'YYYY-MM-DD'), COALESCE(s.class_day, '-'), COALESCE(s.class_time, '-'))::text AS detail,
      'critical'::text AS severity
    FROM assigned s
    WHERE s.assigned_at < now() - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM attendance_log al
        WHERE al.student_id::text = s.applicant_id
          AND COALESCE(al.present, false) = true
      )
  ),
  attendance_ordered AS (
    SELECT
      al.student_id::text AS applicant_id,
      al.class_date,
      COALESCE(al.present, false) AS present,
      row_number() OVER (
        PARTITION BY al.student_id::text
        ORDER BY al.class_date NULLS LAST,
                 NULLIF(regexp_replace(COALESCE(al.class_number, ''), '\D', '', 'g'), '')::int NULLS LAST,
                 al.logged_at
      ) AS seq
    FROM attendance_log al
    JOIN assigned s ON s.applicant_id = al.student_id::text
  ),
  absent_runs AS (
    SELECT
      applicant_id,
      MIN(class_date) AS first_absent_date,
      MAX(class_date) AS last_absent_date,
      COUNT(*)::int AS missed_count,
      (seq - row_number() OVER (PARTITION BY applicant_id, present ORDER BY seq)) AS grp
    FROM attendance_ordered
    WHERE present = false
    GROUP BY applicant_id, grp
  ),
  repeat_absence AS (
    SELECT DISTINCT ON (r.applicant_id)
      'repeat_absence_3_plus'::text AS flag_type,
      s.applicant_id,
      s.full_name,
      s.email,
      s.fellowship_code,
      s.teacher_name,
      format('Missed %s consecutive sessions (last absent %s)', r.missed_count, to_char(r.last_absent_date, 'YYYY-MM-DD'))::text AS detail,
      'critical'::text AS severity
    FROM absent_runs r
    JOIN assigned s ON s.applicant_id = r.applicant_id
    WHERE r.missed_count >= 3
    ORDER BY r.applicant_id, r.last_absent_date DESC NULLS LAST
  ),
  moodle_no_login AS (
    SELECT
      'moodle_synced_no_login'::text AS flag_type,
      s.applicant_id,
      s.full_name,
      s.email,
      s.fellowship_code,
      s.teacher_name,
      'Moodle enrollment synced but no grade/login activity detected'::text AS detail,
      'warning'::text AS severity
    FROM assigned s
    JOIN moodle_enrollment_sync ms
      ON ms.applicant_id::text = s.applicant_id
     AND upper(COALESCE(ms.sync_status, '')) = 'SYNCED'
     AND ms.synced_at < now() - interval '48 hours'
    WHERE NOT EXISTS (
      SELECT 1 FROM student_grades sg
      WHERE sg.applicant_id::text = s.applicant_id
         OR sg.student_id::text = s.applicant_id
    )
  ),
  stalled AS (
    SELECT
      'stalled_no_milestones_4_weeks'::text AS flag_type,
      s.applicant_id,
      s.full_name,
      s.email,
      s.fellowship_code,
      s.teacher_name,
      'Attendance exists but no milestone progress after 4+ weeks'::text AS detail,
      'warning'::text AS severity
    FROM assigned s
    WHERE s.assigned_at < now() - interval '28 days'
      AND EXISTS (
        SELECT 1 FROM attendance_log al
        WHERE al.student_id::text = s.applicant_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM student_milestone_status sms
        WHERE sms.applicant_id::text = s.applicant_id
          AND (
            sms.completed = true
            OR lower(COALESCE(sms.status, '')) = 'completed'
            OR lower(COALESCE(sms.value, '')) = 'yes'
          )
      )
  ),
  waitlisted AS (
    SELECT
      'waitlist_over_14_days'::text AS flag_type,
      a.id::text AS applicant_id,
      COALESCE(a.full_name, trim(concat_ws(' ', a.first_name, a.last_name)), 'Unknown Student')::text AS full_name,
      COALESCE(a.email, '')::text AS email,
      COALESCE(a.fellowship_code, '')::text AS fellowship_code,
      COALESCE(c.teacher_name, 'Unassigned')::text AS teacher_name,
      format('Waitlisted since %s', to_char(COALESCE(a.updated_at, a.created_at)::date, 'YYYY-MM-DD'))::text AS detail,
      'warning'::text AS severity
    FROM applicants a
    LEFT JOIN cls c ON c.class_option_id = a.class_option_id::text
    WHERE COALESCE(a.registration_status, a.status) = 'WAITLISTED'
      AND COALESCE(a.updated_at, a.created_at) < now() - interval '14 days'
      AND (p_batch_id IS NULL OR COALESCE(c.batch_id, a.batch_id::text) = p_batch_id)
  )
  SELECT * FROM inactive
  UNION ALL
  SELECT * FROM repeat_absence
  UNION ALL
  SELECT * FROM moodle_no_login
  UNION ALL
  SELECT * FROM stalled
  UNION ALL
  SELECT * FROM waitlisted;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, status, details, created_at)
  VALUES (
    'system@attention-flags',
    'ATTENTION_FLAGS_ERROR',
    'rpc',
    'get_student_attention_flags',
    'FAILED',
    jsonb_build_object(
      'function', 'get_student_attention_flags',
      'sqlstate', SQLSTATE,
      'error', SQLERRM,
      'p_batch_id', p_batch_id
    ),
    now()
  );
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_attention_flags(text) TO authenticated;

commit;
