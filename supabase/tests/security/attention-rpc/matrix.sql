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
  body_error         text
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
BEGIN
  SELECT uid, role_name INTO v_uid, v_role FROM att_personas WHERE persona = p_persona;

  v_claims := CASE WHEN v_uid IS NULL THEN '{"role":"anon"}'
                   ELSE json_build_object('sub', v_uid, 'role', v_role)::text END;
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SELECT count(*) INTO v_before FROM public.audit_logs WHERE action = 'ATTENTION_FLAGS_ERROR';

  EXECUTE format('SET LOCAL ROLE %I', v_role);
  BEGIN
    EXECUTE format('SELECT count(*) FROM %s()', p_fn) INTO v_rows;
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
  INSERT INTO att_results VALUES (p_persona, p_fn, v_outcome, v_rows, CASE WHEN v_after > v_before THEN 1 ELSE 0 END, v_err);
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
SELECT persona, fn, outcome, row_count, body_error_logged, body_error,
       CASE
         WHEN persona IN ('superadmin','admin','regional_secretary')
           THEN CASE WHEN outcome = 'OK' AND body_error_logged = 0 THEN 'PASS' ELSE 'FAIL' END
         ELSE CASE WHEN outcome = '42501' AND row_count = 0 THEN 'PASS' ELSE 'FAIL' END
       END AS verdict
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

ROLLBACK;
