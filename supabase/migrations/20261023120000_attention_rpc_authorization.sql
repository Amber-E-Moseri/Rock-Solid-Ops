-- Needs Attention RPC authorization (remediation candidate, forward-only).
--
-- Problem: get_student_attention_flags, get_teacher_attention_flags and
-- get_system_attention_flags are SECURITY DEFINER (they bypass RLS on the base tables),
-- had no caller check, and kept EXECUTE for PUBLIC (and therefore anon). Any authenticated
-- profile, including pending and teacher, could read student and teacher PII.
--
-- Fix:
--   1. public.attention_flags_caller_allowed(): true only for an active profile whose role
--      is superadmin, admin or regional_secretary. It reads public.profiles directly by
--      auth.uid(). It does NOT use current_profile_role() or is_admin(), because those
--      admit subgroup_admin, pastor and principal and fall back to admin_users.
--   2. Each function raises SQLSTATE 42501 before any query runs. The existing
--      WHEN OTHERS handler would otherwise swallow that error and return zero rows, so
--      an insufficient_privilege handler re-raises it first.
--   3. EXECUTE is removed from PUBLIC, anon, service_role and the helper for every
--      role except authenticated on the three RPCs. Function signatures and return
--      shapes are unchanged.
--   4. get_student_attention_flags body repair (narrow, same signature and columns):
--      - 42P20: the window function that computes the absence streak moved into its own CTE
--        (absent_streaks), so the grouped query no longer groups by an expression that
--        contains a window function.
--      - 42702: every reference inside the streak logic is qualified. The bare applicant_id
--        collided with the RETURNS TABLE column of the same name.
--      - Unexpected errors are re-raised, not converted to zero rows. The audit insert was
--        removed from this function because a raised error rolls it back anyway.
--      - 42703: the milestone check referenced sms.completed and sms.value, which do not exist.
--        The canonical completion state is status = 'completed'; those branches were dead.
--   5. get_teacher_attention_flags and get_system_attention_flags: the same re-raise handler.
--      Both used WHEN OTHERS ... RETURN, which turned unexpected errors into zero rows or zero
--      counts. The teacher handler's audit insert was removed for the same reason as the student one.
--
-- Not in this migration: subgroup or fellowship scoping, and any client-side route change.
-- Rollback is not a migration. Restoring the previous definitions reopens the exposure
-- and needs a written owner exception in docs/migration-log.md.

begin;

CREATE OR REPLACE FUNCTION public.attention_flags_caller_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('superadmin', 'admin', 'regional_secretary')
  )
$$;

REVOKE ALL ON FUNCTION public.attention_flags_caller_allowed() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.attention_flags_caller_allowed() IS
'Needs Attention caller gate. True only for an active superadmin, admin or regional_secretary profile of auth.uid(). Not for granting access elsewhere.';

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
  IF NOT public.attention_flags_caller_allowed() THEN
    RAISE EXCEPTION 'Needs Attention data is restricted to authorized staff roles'
      USING ERRCODE = '42501';
  END IF;
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
  absent_streaks AS (
    -- Window functions live here, not in the grouped query below (42P20).
    SELECT
      ao.applicant_id,
      ao.class_date,
      ao.present,
      (ao.seq - row_number() OVER (PARTITION BY ao.applicant_id, ao.present ORDER BY ao.seq)) AS grp
    FROM attendance_ordered ao
  ),
  absent_runs AS (
    -- Qualified columns only: the bare applicant_id is also a RETURNS TABLE name (42702).
    SELECT
      st.applicant_id,
      MIN(st.class_date) AS first_absent_date,
      MAX(st.class_date) AS last_absent_date,
      COUNT(*)::int AS missed_count,
      st.grp
    FROM absent_streaks st
    WHERE st.present = false
    GROUP BY st.applicant_id, st.grp
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
          -- Canonical completion state is status = 'completed' (202605071700). The former
          -- sms.completed and sms.value branches reference columns that do not exist (42703).
          AND lower(COALESCE(sms.status, '')) = 'completed'
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
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE;
  WHEN OTHERS THEN
    -- Unexpected errors surface to the caller. An empty result would look like "no flags".
    RAISE;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_teacher_attention_flags(p_batch_id text DEFAULT NULL)
RETURNS TABLE (
  flag_type text,
  teacher_id text,
  full_name text,
  email text,
  class_count integer,
  detail text,
  severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.attention_flags_caller_allowed() THEN
    RAISE EXCEPTION 'Needs Attention data is restricted to authorized staff roles'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH classes AS (
    SELECT
      co.class_option_id::text AS class_option_id,
      COALESCE(co.teacher_id::text, t.teacher_id::text) AS teacher_id,
      COALESCE(t.full_name, co.teacher_name, 'Unknown Teacher')::text AS full_name,
      COALESCE(t.email, '')::text AS email,
      COALESCE(t.teacher_user_id::text, '')::text AS teacher_user_id,
      co.day::text AS class_day,
      co.class_time::text AS class_time,
      cs.batch_id::text AS batch_id,
      b.start_date,
      b.end_date,
      COALESCE(t.active, true) AS teacher_active,
      upper(COALESCE(t.status, 'ACTIVE')) AS teacher_status
    FROM class_options co
    LEFT JOIN class_slots cs ON cs.class_option_id::text = co.class_option_id::text
    LEFT JOIN batches b ON b.batch_id::text = cs.batch_id::text
    LEFT JOIN teachers t ON t.teacher_id::text = co.teacher_id::text
    WHERE co.active = true
      AND (p_batch_id IS NULL OR cs.batch_id::text = p_batch_id)
  ),
  class_metrics AS (
    SELECT
      c.*,
      (SELECT max(al.class_date)
       FROM attendance_log al
       WHERE al.class_option_id::text = c.class_option_id
      ) AS last_submission_date,
      (SELECT count(DISTINCT al.class_date)
       FROM attendance_log al
       WHERE al.class_option_id::text = c.class_option_id
      )::int AS submitted_sessions,
      CASE
        WHEN c.start_date IS NULL THEN 0
        ELSE GREATEST(
          floor(
            (LEAST(COALESCE(c.end_date, now()::date), now()::date) - c.start_date)::numeric / 7
          )::int + 1,
          0
        )
      END AS expected_sessions
    FROM classes c
  ),
  class_expectation AS (
    SELECT
      m.*,
      (
        now()::date
        - (((extract(dow from now())::int -
          CASE upper(COALESCE(m.class_day, ''))
            WHEN 'SUNDAY' THEN 0 WHEN 'MONDAY' THEN 1 WHEN 'TUESDAY' THEN 2
            WHEN 'WEDNESDAY' THEN 3 WHEN 'THURSDAY' THEN 4 WHEN 'FRIDAY' THEN 5
            WHEN 'SATURDAY' THEN 6 ELSE extract(dow from now())::int
          END + 7) % 7))::int
      )::date AS last_expected_date
    FROM class_metrics m
  ),
  overdue AS (
    SELECT
      'overdue_attendance_submission'::text AS flag_type,
      c.teacher_id,
      c.full_name,
      c.email,
      COUNT(*)::int AS class_count,
      format('No attendance submitted for expected session (%s) in class %s', to_char(max(c.last_expected_date), 'YYYY-MM-DD'), max(c.class_option_id))::text AS detail,
      'critical'::text AS severity
    FROM class_expectation c
    WHERE c.teacher_id IS NOT NULL
      AND c.last_expected_date < now()::date - 2
      AND NOT EXISTS (
        SELECT 1 FROM attendance_log al
        WHERE al.class_option_id::text = c.class_option_id
          AND al.class_date >= c.last_expected_date - interval '1 day'
      )
    GROUP BY c.teacher_id, c.full_name, c.email
  ),
  neglect AS (
    SELECT
      'teacher_neglect'::text AS flag_type,
      c.teacher_id,
      c.full_name,
      c.email,
      COUNT(*)::int AS class_count,
      format(
        'Attendance gap >= 3 weeks or submission rate below 50%% (rate %s%%)',
        ROUND(
          CASE WHEN SUM(c.expected_sessions) > 0
               THEN (SUM(c.submitted_sessions)::numeric / SUM(c.expected_sessions)::numeric) * 100
               ELSE 0 END, 1
        )
      )::text AS detail,
      'warning'::text AS severity
    FROM class_expectation c
    WHERE c.teacher_id IS NOT NULL
    GROUP BY c.teacher_id, c.full_name, c.email
    HAVING (
      max(COALESCE(last_submission_date, date '1900-01-01')) < now()::date - 21
      OR (
        SUM(expected_sessions) > 0
        AND (SUM(submitted_sessions)::numeric / SUM(expected_sessions)::numeric) < 0.5
      )
    )
  ),
  unlinked AS (
    SELECT
      'teacher_unlinked_auth'::text AS flag_type,
      t.teacher_id::text,
      COALESCE(t.full_name, 'Unknown Teacher')::text,
      COALESCE(t.email, '')::text,
      (
        SELECT count(*)::int FROM class_options co
        WHERE co.teacher_id::text = t.teacher_id::text AND co.active = true
      ) AS class_count,
      'Active teacher has no linked auth user (teacher_user_id is NULL)'::text AS detail,
      'critical'::text AS severity
    FROM teachers t
    WHERE (COALESCE(t.active, true) = true OR upper(COALESCE(t.status, 'ACTIVE')) = 'ACTIVE')
      AND t.teacher_user_id IS NULL
  )
  SELECT * FROM overdue
  UNION ALL
  SELECT * FROM neglect
  UNION ALL
  SELECT * FROM unlinked;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE;
  WHEN OTHERS THEN
    -- Unexpected errors surface to the caller; an empty result would look like "no flags".
    RAISE;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_system_attention_flags()
RETURNS TABLE (
  flag_type text,
  count bigint,
  detail text,
  severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.attention_flags_caller_allowed() THEN
    RAISE EXCEPTION 'Needs Attention data is restricted to authorized staff roles'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    'stuck_moodle_sync_processing'::text,
    COUNT(*)::bigint,
    'Moodle sync rows stuck in PROCESSING for over 30 minutes'::text,
    'critical'::text
  FROM moodle_enrollment_sync
  WHERE upper(COALESCE(sync_status, '')) = 'PROCESSING'
    AND COALESCE(updated_at, created_at) < now() - interval '30 minutes'

  UNION ALL

  SELECT
    'failed_email_queue_24h'::text,
    COUNT(*)::bigint,
    'Email queue failures in the last 24 hours'::text,
    'warning'::text
  FROM email_queue
  WHERE upper(COALESCE(status, '')) = 'FAILED'
    AND created_at > now() - interval '24 hours'

  UNION ALL

  SELECT
    'stale_reviews_48h'::text,
    COUNT(*)::bigint,
    'Applicants in REVIEW for over 48 hours'::text,
    'critical'::text
  FROM applicants
  WHERE COALESCE(registration_status, status) = 'REVIEW'
    AND COALESCE(updated_at, created_at) < now() - interval '48 hours';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE;
  WHEN OTHERS THEN
    -- Unexpected errors surface to the caller; an empty count would look like "no flags".
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_attention_flags(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_attention_flags(text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_teacher_attention_flags(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_attention_flags(text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_system_attention_flags() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_system_attention_flags() TO authenticated;

-- Fail closed: PUBLIC, anon and service_role must not hold EXECUTE on any of these four functions,
-- and the caller gate must not be executable by authenticated.
DO $check$
DECLARE
  fn regprocedure;
  bad text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_student_attention_flags(text)'::regprocedure,
    'public.get_teacher_attention_flags(text)'::regprocedure,
    'public.get_system_attention_flags()'::regprocedure,
    'public.attention_flags_caller_allowed()'::regprocedure
  ] LOOP
    SELECT string_agg(
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, ','
           ) INTO bad
    FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = fn
      AND a.privilege_type = 'EXECUTE'
      AND (
        a.grantee = 0
        OR a.grantee IN ('anon'::regrole, 'service_role'::regrole)
        OR (a.grantee = 'authenticated'::regrole AND fn::text LIKE '%attention_flags_caller_allowed%')
      );
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'attention RPC EXECUTE grant check failed for %: %', fn, bad;
    END IF;
  END LOOP;
END
$check$;

commit;
