-- =============================================================================
-- Needs Attention RPC authorization matrix (local replay only).
--
-- Runs get_student_attention_flags(), get_teacher_attention_flags() and
-- get_system_attention_flags() directly over SQL, as each persona, without the frontend.
-- Everything runs in one transaction and is rolled back at the end.
--
-- NEVER run against staging or production. Run only on a throwaway database created from
-- the migration lineage plus scripts/attention-rpc-replay.sh. Staging needs a separate approval.
--
-- Expected results (owner policy 2026-10-23):
--   allow: superadmin, admin, regional_secretary      -> outcome OK, no body error logged
--   deny : principal, pastor, subgroup_admin, teacher, pending, inactive_admin, no_profile, anon
--          -> outcome 42501, zero rows
--
-- body_error_logged = 1 means the function body raised and the WHEN OTHERS handler
-- swallowed it. An allowed persona with body_error_logged = 1 is a failure, because the
-- zero-row result would look like "no flags" and hide the error.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE att_results (
  persona            text,
  fn                 text,
  outcome            text,
  row_count          integer,
  body_error_logged  integer,
  body_error         text,
  row_list           text
) ON COMMIT DROP;

-- ---- Fixtures: one auth user per persona. The auth trigger creates a pending profile. ----
CREATE TEMP TABLE att_personas (persona text PRIMARY KEY, uid uuid, role_name text, profile_role text, is_active boolean, has_profile boolean) ON COMMIT DROP;
INSERT INTO att_personas VALUES
  ('superadmin',         '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'superadmin',         true,  true),
  ('admin',              '00000000-0000-0000-0000-0000000000a2', 'authenticated', 'admin',              true,  true),
  ('regional_secretary', '00000000-0000-0000-0000-0000000000a3', 'authenticated', 'regional_secretary', true,  true),
  ('principal',          '00000000-0000-0000-0000-0000000000a4', 'authenticated', 'principal',          true,  true),
  ('pastor',             '00000000-0000-0000-0000-0000000000a5', 'authenticated', 'pastor',             true,  true),
  ('subgroup_admin',     '00000000-0000-0000-0000-0000000000a6', 'authenticated', 'subgroup_admin',     true,  true),
  ('teacher',            '00000000-0000-0000-0000-0000000000a7', 'authenticated', 'teacher',            true,  true),
  ('pending',            '00000000-0000-0000-0000-0000000000a8', 'authenticated', 'pending',            true,  true),
  ('inactive_admin',     '00000000-0000-0000-0000-0000000000a9', 'authenticated', 'admin',              false, true),
  ('no_profile',         '00000000-0000-0000-0000-0000000000aa', 'authenticated', NULL,                 NULL,  false),
  ('anon',               NULL,                                   'anon',          NULL,                 NULL,  false);

INSERT INTO auth.users (id, email)
SELECT uid, persona || '@attention-rpc.test' FROM att_personas WHERE uid IS NOT NULL;

UPDATE public.profiles pr
SET role = ap.profile_role, is_active = ap.is_active
FROM att_personas ap
WHERE pr.user_id = ap.uid AND ap.has_profile;

DELETE FROM public.profiles pr
USING att_personas ap
WHERE pr.user_id = ap.uid AND NOT ap.has_profile;

-- ---- Synthetic student fixtures (positive data for allowed roles) -------------------------
-- Fixed applicant ids. Each one is built to trigger exactly the flags listed in expected_rows.
INSERT INTO public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, active)
VALUES ('FC-TEST', 'Synthetic campus', 'CE', NULL, true);

INSERT INTO public.batches (batch_id, batch_name, registration_open, active, status, archived)
VALUES ('B-TEST', 'Synthetic batch', true, false, 'Draft', false);

INSERT INTO public.teachers (teacher_id, full_name, active, status)
VALUES ('T-TEST', 'Synthetic Teacher', true, 'ACTIVE');

INSERT INTO public.class_options (class_option_id, class_id, group_id, subgroup_id, fellowship_codes, active, enrollment_open, is_online, teacher_id, teacher_name, day, class_time)
VALUES ('CO-TEST', 'CL-TEST', 'CE', 'SG-TEST', '{FC-TEST}', true, true, false, 'T-TEST', 'Synthetic Teacher', 'SUNDAY', '10:00');

INSERT INTO public.class_slots (class_slot_id, class_option_id, teacher_id, teacher_name, group_id, subgroup_id, batch_id, status, current_enrolment)
VALUES ('CS-TEST', 'CO-TEST', 'T-TEST', 'Synthetic Teacher', 'CE', 'SG-TEST', 'B-TEST', 'Active', 0);

-- b1: assigned 30 days ago, no attendance                       -> inactive_no_attendance
-- b2: assigned 30 days ago, 3 consecutive absences, no milestone -> repeat_absence_3_plus, stalled_no_milestones_4_weeks
-- b3: assigned 30 days ago, Moodle SYNCED 3 days ago, no grades, no attendance -> moodle_synced_no_login, inactive_no_attendance
-- b4: waitlisted 20 days ago                                    -> waitlist_over_14_days
-- b5: assigned 2 days ago, present today                        -> no flags (control)
INSERT INTO public.applicants (id, first_name, last_name, full_name, email, status, registration_status, class_option_id, batch_id, fellowship_code, assigned_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Syn', 'One',   'Syn One',   'syn1@attention-rpc.test', 'Enrolled',   'ASSIGNED',   'CO-TEST', 'B-TEST', 'FC-TEST', now() - interval '30 days', now() - interval '30 days', now() - interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b2', 'Syn', 'Two',   'Syn Two',   'syn2@attention-rpc.test', 'Enrolled',   'ASSIGNED',   'CO-TEST', 'B-TEST', 'FC-TEST', now() - interval '30 days', now() - interval '30 days', now() - interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b3', 'Syn', 'Three', 'Syn Three', 'syn3@attention-rpc.test', 'Enrolled',   'ASSIGNED',   'CO-TEST', 'B-TEST', 'FC-TEST', now() - interval '30 days', now() - interval '30 days', now() - interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b4', 'Syn', 'Four',  'Syn Four',  'syn4@attention-rpc.test', 'Waitlisted', 'WAITLISTED', NULL,      'B-TEST', 'FC-TEST', NULL,                         now() - interval '20 days', now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000000b5', 'Syn', 'Five',  'Syn Five',  'syn5@attention-rpc.test', 'Enrolled',   'ASSIGNED',   'CO-TEST', 'B-TEST', 'FC-TEST', now() - interval '2 days',  now() - interval '2 days',  now() - interval '2 days');

-- attendance_log.student_id references students.student_id. The function matches it to applicants.id.
INSERT INTO public.students (student_id, full_name, email, group_id, subgroup_id, batch_id, class_option_id, fellowship_code, status)
VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'Syn Two',  'syn2@attention-rpc.test', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', 'FC-TEST', 'Active'),
  ('00000000-0000-0000-0000-0000000000b5', 'Syn Five', 'syn5@attention-rpc.test', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', 'FC-TEST', 'Active');

-- The attendance_log triggers in the lineage reference columns that do not exist ('attended',
-- 'session_date'), so any insert fails. Fixture rows skip user triggers for this transaction only.
-- This is a separate pre-existing defect; it is not part of this brief.
SET LOCAL session_replication_role = replica;

INSERT INTO public.attendance_log (student_id, group_id, subgroup_id, batch_id, class_option_id, class_number, class_date, present, submitted_by_teacher, missing_submission_flag, class1_no_show_flag, consecutive_miss_count, repeat_absentee_flag, logged_at, session_status)
VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', '1', current_date - 40, true,  false, false, false, 0, false, now() - interval '40 days', 'SUBMITTED'),
  ('00000000-0000-0000-0000-0000000000b2', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', '2', current_date - 27, false, false, false, false, 1, false, now() - interval '27 days', 'SUBMITTED'),
  ('00000000-0000-0000-0000-0000000000b2', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', '3', current_date - 20, false, false, false, false, 2, false, now() - interval '20 days', 'SUBMITTED'),
  ('00000000-0000-0000-0000-0000000000b2', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', '4', current_date - 13, false, false, false, false, 3, true,  now() - interval '13 days', 'SUBMITTED'),
  ('00000000-0000-0000-0000-0000000000b5', 'CE', 'SG-TEST', 'B-TEST', 'CO-TEST', '1', current_date,      true,  false, false, false, 0, false, now(), 'SUBMITTED');

INSERT INTO public.moodle_enrollment_sync (applicant_id, email, registration_status, sync_status, synced_at, payload)
VALUES ('00000000-0000-0000-0000-0000000000b3', 'syn3@attention-rpc.test', 'ASSIGNED', 'SYNCED', now() - interval '3 days', '{}');

-- ---- Case runner -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.run_att_case(p_persona text, p_fn text) RETURNS void
LANGUAGE plpgsql AS $case$
DECLARE
  v_uid       uuid;
  v_role      text;
  v_claims    text;
  v_rows      integer := 0;
  v_outcome   text := 'OK';
  v_before    integer;
  v_after     integer;
  v_err       text;
  v_list      text := '';
BEGIN
  SELECT uid, role_name INTO v_uid, v_role FROM att_personas WHERE persona = p_persona;

  v_claims := CASE WHEN v_uid IS NULL THEN '{"role":"anon"}'
                   ELSE json_build_object('sub', v_uid, 'role', v_role)::text END;
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SELECT count(*) INTO v_before FROM public.audit_logs WHERE action = 'ATTENTION_FLAGS_ERROR';

  EXECUTE format('SET LOCAL ROLE %I', v_role);
  BEGIN
    IF p_fn = 'public.get_student_attention_flags' THEN
      EXECUTE format($q$SELECT count(*), coalesce(string_agg(flag_type || '|' || applicant_id, ';' ORDER BY flag_type, applicant_id), '') FROM %s()$q$, p_fn)
        INTO v_rows, v_list;
    ELSE
      EXECUTE format('SELECT count(*) FROM %s()', p_fn) INTO v_rows;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_outcome := SQLSTATE;   -- SQLSTATE only; the message is not recorded
    v_rows := 0;
  END;
  RESET ROLE;

  SELECT count(*) INTO v_after FROM public.audit_logs WHERE action = 'ATTENTION_FLAGS_ERROR';
  IF v_after > v_before THEN
    SELECT details->>'sqlstate' || ': ' || (details->>'error') INTO v_err
    FROM public.audit_logs WHERE action = 'ATTENTION_FLAGS_ERROR' ORDER BY created_at DESC LIMIT 1;
  END IF;
  INSERT INTO att_results VALUES (p_persona, p_fn, v_outcome, v_rows, CASE WHEN v_after > v_before THEN 1 ELSE 0 END, v_err, v_list);
END
$case$;

-- ---- Matrix ---------------------------------------------------------------------------------
SELECT pg_temp.run_att_case(p.persona, f.fn)
FROM att_personas p
CROSS JOIN (VALUES
  ('public.get_student_attention_flags'),
  ('public.get_teacher_attention_flags'),
  ('public.get_system_attention_flags')
) AS f(fn)
ORDER BY p.persona, f.fn;

-- Result table (role-by-role).
-- Expected student rows for allowed roles (flag_type|applicant_id, sorted), per the fixtures above.
-- Compared as text, so a missing or extra flag fails the case.
SELECT persona, fn, outcome, row_count, body_error_logged, body_error,
       CASE
         WHEN persona IN ('superadmin','admin','regional_secretary')
           THEN CASE
                  WHEN outcome = 'OK' AND body_error_logged = 0
                       AND (fn <> 'public.get_student_attention_flags'
                            OR row_list = 'inactive_no_attendance|00000000-0000-0000-0000-0000000000b1;inactive_no_attendance|00000000-0000-0000-0000-0000000000b3;moodle_synced_no_login|00000000-0000-0000-0000-0000000000b3;repeat_absence_3_plus|00000000-0000-0000-0000-0000000000b2;stalled_no_milestones_4_weeks|00000000-0000-0000-0000-0000000000b2;waitlist_over_14_days|00000000-0000-0000-0000-0000000000b4')
                    THEN 'PASS' ELSE 'FAIL' END
         ELSE CASE WHEN outcome = '42501' AND row_count = 0 AND row_list = '' THEN 'PASS' ELSE 'FAIL' END
       END AS verdict,
       CASE WHEN fn = 'public.get_student_attention_flags' THEN row_list END AS student_rows
FROM att_results
ORDER BY persona, fn;

-- Effective EXECUTE grantees on each function (PUBLIC shown as 'PUBLIC').
SELECT p.oid::regprocedure AS function,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
WHERE p.oid = ANY (array_remove(ARRAY[
  to_regprocedure('public.get_student_attention_flags(text)'),
  to_regprocedure('public.get_teacher_attention_flags(text)'),
  to_regprocedure('public.get_system_attention_flags()'),
  to_regprocedure('public.attention_flags_caller_allowed()')], NULL))
  AND a.privilege_type = 'EXECUTE'
ORDER BY 1, 2;

-- ---- Fault injection: an unexpected SQL error must surface, not become zero rows. ----------
-- A column the body reads is renamed inside a savepoint. The call as superadmin must raise
-- SQLSTATE 42703, not return OK with no rows. The savepoint is rolled back afterwards.
SAVEPOINT att_fault;
ALTER TABLE public.class_options RENAME COLUMN teacher_name TO teacher_name_fault;
CREATE TEMP TABLE att_fault_result (outcome text) ON COMMIT DROP;
GRANT ALL ON att_fault_result TO authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $fault$
DECLARE v_outcome text := 'OK-NO-ERROR';
BEGIN
  BEGIN
    PERFORM 1 FROM public.get_student_attention_flags();
  EXCEPTION WHEN OTHERS THEN
    v_outcome := SQLSTATE;
  END;
  INSERT INTO att_fault_result VALUES (v_outcome);
END
$fault$;
RESET ROLE;
SELECT 'fault_injection_student_as_superadmin' AS check_name, outcome AS result,
       CASE WHEN outcome = '42703' THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM att_fault_result;
ROLLBACK TO SAVEPOINT att_fault;

ROLLBACK;
