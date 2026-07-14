-- Fix get_teacher_attention_flags: date-arithmetic type error + silent exception swallowing.
--
-- Bug (found in Phase A audit, docs/migration-log.md 2026-07-14): the expected_sessions
-- calculation in class_metrics did
--   extract(epoch FROM (LEAST(COALESCE(c.end_date, now()::date), now()::date) - c.start_date)) / 604800
-- but batches.start_date/end_date are `date`, and `date - date` in Postgres returns
-- `integer` (a day count), not `interval`. extract(epoch FROM <integer>) has no matching
-- overload and throws 42883 on every call. The blanket EXCEPTION WHEN OTHERS THEN RETURN
-- swallowed that error and returned zero rows for all three flag types
-- (overdue_attendance_submission, teacher_neglect, teacher_unlinked_auth) since the function
-- was created on 202605220011 (~7.5 weeks of silent staff-alert outage).
--
-- Fix: `date - date` is already an integer day count, so there's no need to round-trip
-- through extract(epoch FROM ...)/604800 at all -- divide the day count by 7 directly to get
-- weeks. (The brief's suggested `(date - date)::interval` cast does not work: Postgres has no
-- integer->interval cast. `make_interval(days => ...)` would also work but is unnecessary
-- extra machinery when a plain division reproduces the original floor(days/7)+1 semantics.)
--
-- Also narrows the failure mode: instead of silently returning zero rows on any error, the
-- exception handler now logs to audit_logs (action=ATTENTION_FLAGS_ERROR, status=FAILED) with
-- SQLSTATE/SQLERRM before returning empty, so a future regression is visible to ops instead of
-- looking identical to "no flags right now".
--
-- That logging immediately proved its worth: applying the date-arithmetic fix alone still
-- returned zero rows, and the new audit_logs entry surfaced a SECOND, previously-invisible bug
-- (SQLSTATE 42702, "column reference \"teacher_id\" is ambiguous") in the overdue/neglect
-- branches. RETURNS TABLE (..., teacher_id text, full_name text, email text, ...) makes
-- teacher_id/full_name/email PL/pgSQL OUT-parameter names, which collide with the identically
-- named columns selected bare (unqualified) from class_expectation in those two branches'
-- SELECT/GROUP BY lists. This was always broken -- masked only because the extract(epoch...)
-- type error was hit first during query analysis, before the ambiguous-reference check on
-- overdue/neglect was ever reached. Fixed by qualifying every such reference with the CTE
-- alias (c.teacher_id, c.full_name, c.email). The `unlinked` branch already qualified its
-- references (t.teacher_id etc.) and was never affected. This does not change the fact that admins still
-- see an empty flag list on error (RETURN QUERY is all-or-nothing for a single statement with
-- multiple UNION ALL branches) -- narrowing that further to per-branch isolation is a larger
-- structural change intentionally left out of this fix; see docs/migration-log.md.

begin;

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
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, status, details, created_at)
  VALUES (
    'system@attention-flags',
    'ATTENTION_FLAGS_ERROR',
    'rpc',
    'get_teacher_attention_flags',
    'FAILED',
    jsonb_build_object(
      'function', 'get_teacher_attention_flags',
      'sqlstate', SQLSTATE,
      'error', SQLERRM,
      'p_batch_id', p_batch_id
    ),
    now()
  );
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_teacher_attention_flags(text) TO authenticated;

commit;
