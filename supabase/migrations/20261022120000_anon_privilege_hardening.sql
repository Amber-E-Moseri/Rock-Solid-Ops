-- =============================================================================
-- 20261022120000_anon_privilege_hardening.sql
--
-- DRAFT FOR REVIEW. NOT APPLIED. Do not run against any database until the owner approves
-- (see docs/ANON_PRIVILEGE_HARDENING_2026-10-22.md, "Apply gate").
--
-- Why: Supabase grants the anon role ALL on every public table, sequence and function by default.
-- RLS limits which rows anon can read or write. It does not limit TRUNCATE (which bypasses RLS),
-- REFERENCES, TRIGGER, column visibility, or sequence use, and anon has no policy that needs them.
--
-- What anon keeps (each item is used by a live public path; see the design doc, section 3):
--   SELECT on fellowship_map, class_options, batches, batch_campus_registration_settings,
--           limited to the columns the registration form reads.
--   INSERT on teachers (public teacher self-registration; RLS restricts it to status PENDING, active false).
--   Nothing else. Registration submission goes through the registration-processor edge function,
--   which uses the service_role key, so anon needs no table or function privilege for it.
--
-- What this does NOT change:
--   * row data, RLS enablement, RLS policies (the anon policies stay in place and become inert where
--     the grant is gone);
--   * supabase_migrations.schema_migrations (no history row is added, changed or removed);
--   * privileges held by authenticated, service_role or any other role. Function EXECUTE is
--     re-granted explicitly to each such role before PUBLIC is revoked, so their effective access is
--     the same before and after.
--
-- Idempotent: REVOKE and GRANT repeat safely, and the function loop re-checks state on every run.
-- Ordering: the version 20261022120000 sorts after 202610220100 (the class_options repair), which the
-- column grants below depend on (is_online, confirmed_start_date).
-- =============================================================================

-- 1. Tables. Remove every table privilege from anon, then grant back only the narrow set in use.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Columns read by registration-form.html (filters included: PostgREST filters need column SELECT).
GRANT SELECT (fellowship_code, campus_name, group_id, subgroup_id, timezone, active)
  ON public.fellowship_map TO anon;

GRANT SELECT (class_option_id, class_id, fellowship_codes, teacher_id, teacher_name, day, class_time,
              active, enrollment_open, deleted_at, is_online, confirmed_start_date)
  ON public.class_options TO anon;

GRANT SELECT (batch_id, status, registration_open)
  ON public.batches TO anon;

-- closed_by, closed_reason, reopened_by and the timestamps are staff data. They stay unreadable to anon.
GRANT SELECT (batch_id, fellowship_code, registration_open)
  ON public.batch_campus_registration_settings TO anon;

-- Teacher self-registration (foundation/auth/teacher-register.html). The insert does not request a
-- returned row, so no SELECT on teachers is needed. RLS still applies (status PENDING, active false).
GRANT INSERT ON public.teachers TO anon;

-- 2. Sequences. No path needs anon to draw a value: teachers.teacher_id is text, and the other
--    anon-writable table uses gen_random_uuid().
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 3. Functions. anon's EXECUTE comes from the PUBLIC default, not from an explicit anon grant, so
--    REVOKE ... FROM anon alone would do nothing. Revoking PUBLIC removes EXECUTE from every role that
--    relied on that default, so for every public function first grant EXECUTE explicitly to every
--    other role in the cluster that can run it today (including roles that inherit it through
--    membership, which has_function_privilege already accounts for). Then revoke PUBLIC and anon.
--    Result: each role except anon keeps exactly the EXECUTE it had before.
DO $$
DECLARE
  f record;
  r record;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    FOR r IN
      SELECT rolname FROM pg_roles WHERE rolname <> 'anon'
    LOOP
      IF has_function_privilege(r.rolname, f.oid, 'EXECUTE') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', f.sig, r.rolname);
      END IF;
    END LOOP;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END
$$;

-- Fail closed: if any public function is still executable by anon (for example, one owned by a role
-- this migration cannot alter), abort rather than leave a partial state.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF n > 0 THEN
    RAISE EXCEPTION 'anon still has EXECUTE on % public function(s); migration aborted', n;
  END IF;
END
$$;

-- Fail closed for tables and sequences: anon must hold none of the destructive or DDL-level table
-- privileges, and must hold INSERT only on teachers.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND (
      has_table_privilege('anon', c.oid, 'TRUNCATE')
      OR has_table_privilege('anon', c.oid, 'REFERENCES')
      OR has_table_privilege('anon', c.oid, 'TRIGGER')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE')
      OR (has_table_privilege('anon', c.oid, 'INSERT') AND c.relname <> 'teachers')
    );

  IF n > 0 THEN
    RAISE EXCEPTION 'anon retains a disallowed table privilege on % relation(s); migration aborted', n;
  END IF;
END
$$;

-- 4. Default privileges. Without this, every table or sequence created later by a migration would
--    again be granted to anon. Only objects created by the postgres role are covered (the role that
--    runs migrations). Existing objects are not affected by this statement.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Not included (owner decision, see the design doc, risk R4): default privileges for FUNCTIONS.
-- Postgres grants EXECUTE on new functions to PUBLIC by default, so a function created by a future
-- migration is callable by anon until a PUBLIC revoke is added to the migration that creates it.
-- Enabling the default-privilege change below would also require every future function to be granted
-- explicitly to authenticated or service_role. Do not enable it without that review:
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
