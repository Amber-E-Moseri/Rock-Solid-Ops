-- =============================================================================
-- C2 failed_syncs contract — real-PostgreSQL security/schema test
--
-- Proves, against a local Supabase Postgres (no mocks):
--   * fresh migration chain creates the contract            (checks  1-3, 9)
--   * a production-shaped table (no updated_at) upgrades    (checks  4-7)
--   * updated_at trigger, backfill, idempotency             (checks  8, 29)
--   * RLS + grants role matrix, on BOTH fresh and upgraded  (checks 10-28, 30)
--
-- Everything runs inside one transaction that is ROLLED BACK. Nothing persists.
-- Never run against production. Requires a database that has already had the
-- full migration chain (including 202609231100_failed_syncs_contract.sql)
-- applied, e.g. a local `supabase start` / `supabase db reset`.
--
-- Run (container name = supabase_db_<local project dir name>):
--   docker cp supabase/migrations/202609231100_failed_syncs_contract.sql \
--             <db-container>:/tmp/c2_migration.sql
--   docker cp supabase/tests/security/failed-syncs-contract.sql \
--             <db-container>:/tmp/c2_test.sql
--   docker exec -i <db-container> psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
--             -f /tmp/c2_test.sql
-- Exit code 0 and a final "C2 TOTAL_CHECKS n" line mean every check passed.
-- =============================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
BEGIN;

CREATE SCHEMA c2_test;
GRANT USAGE ON SCHEMA c2_test TO anon, authenticated, service_role;
CREATE TABLE c2_test.results (n serial PRIMARY KEY, name text NOT NULL);

-- Record a passing check, or abort the whole run.
CREATE FUNCTION c2_test.ok(p_ok boolean, p_name text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'C2 CHECK FAILED: %', p_name;
  END IF;
  INSERT INTO c2_test.results (name) VALUES (p_name);
  RAISE NOTICE 'PASS  %', p_name;
END $$;

-- Run one statement as a database role, with a JWT subject, and report the
-- outcome as 'ok:<rowcount>' or 'err:<sqlstate>'. Uses real SET ROLE so grants
-- and RLS are enforced exactly as PostgREST would enforce them.
CREATE FUNCTION c2_test.run_as(p_role text, p_uid uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    RETURN 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN 'err:' || SQLSTATE;
  END;
END $$;

-- Principals -----------------------------------------------------------------
CREATE TABLE c2_test.principals (label text PRIMARY KEY, uid uuid NOT NULL, role text NOT NULL);
INSERT INTO c2_test.principals VALUES
  ('superadmin',        '00000000-0000-0000-0000-0000000000a1', 'superadmin'),
  ('admin',             '00000000-0000-0000-0000-0000000000a2', 'admin'),
  ('subgroup_admin',    '00000000-0000-0000-0000-0000000000a3', 'subgroup_admin'),
  ('pastor',            '00000000-0000-0000-0000-0000000000a4', 'pastor'),
  ('principal',         '00000000-0000-0000-0000-0000000000a5', 'principal'),
  ('teacher',           '00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('regional_secretary','00000000-0000-0000-0000-0000000000b2', 'regional_secretary'),
  ('pending',           '00000000-0000-0000-0000-0000000000b3', 'pending'),
  ('inactive_admin',    '00000000-0000-0000-0000-0000000000b4', 'admin');

INSERT INTO auth.users (id, aud, role, email)
SELECT uid, 'authenticated', 'authenticated', label || '@c2-test.invalid'
FROM c2_test.principals;

-- Backend-style writes (no JWT subject) are exempt from the role-assignment
-- trigger, exactly like the real service path.
INSERT INTO public.profiles (user_id, email, full_name, role, is_active)
SELECT uid, label || '@c2-test.invalid', 'C2 ' || label, role, label <> 'inactive_admin'
FROM c2_test.principals
ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;

-- Contract + matrix checks, run against whichever table is current ------------
CREATE FUNCTION c2_test.uid(p_label text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT uid FROM c2_test.principals WHERE label = p_label $$;

CREATE FUNCTION c2_test.schema_contract(p_tag text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  expected text[] := ARRAY[
    'id|uuid|NO|gen_random_uuid()',
    'sync_type|text|NO|',
    'source_table|text|YES|',
    'source_id|text|YES|',
    'payload|jsonb|YES|',
    'error_message|text|YES|',
    'status|text|NO|''FAILED''::text',
    'retry_count|integer|NO|0',
    'last_retry_at|timestamp with time zone|YES|',
    'resolved_at|timestamp with time zone|YES|',
    'created_at|timestamp with time zone|NO|now()',
    'updated_at|timestamp with time zone|NO|now()'];
  actual text[];
BEGIN
  SELECT array_agg(column_name || '|' || data_type || '|' || is_nullable || '|' ||
                   coalesce(column_default, '') ORDER BY column_name)
    INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'failed_syncs';
  PERFORM c2_test.ok(
    actual = (SELECT array_agg(e ORDER BY split_part(e, '|', 1)) FROM unnest(expected) e),
    p_tag || ': exact required column set, types, nullability, defaults');
  PERFORM c2_test.ok(
    (SELECT contype FROM pg_constraint
      WHERE conrelid = 'public.failed_syncs'::regclass AND contype = 'p') = 'p',
    p_tag || ': primary key present');
  PERFORM c2_test.ok(
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='failed_syncs'
       AND indexdef ILIKE '%(source_table, source_id)%' AND indexdef NOT ILIKE '%UNIQUE%') = 1,
    p_tag || ': non-unique (source_table, source_id) index');
  PERFORM c2_test.ok(
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='failed_syncs') = 2,
    p_tag || ': only the pkey and the source index exist');
  PERFORM c2_test.ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.failed_syncs'::regclass),
    p_tag || ': RLS enabled');
  PERFORM c2_test.ok(
    (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='failed_syncs') = 1
    AND (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='failed_syncs'
           AND policyname='failed_syncs_admin_select' AND cmd='SELECT'
           AND roles = '{authenticated}') = 1,
    p_tag || ': exactly one policy, SELECT-only, TO authenticated');
  PERFORM c2_test.ok(
    (SELECT qual FROM pg_policies WHERE tablename='failed_syncs') ILIKE '%current_profile_role%'
    AND (SELECT qual FROM pg_policies WHERE tablename='failed_syncs') NOT ILIKE '%is_admin%'
    AND (SELECT qual FROM pg_policies WHERE tablename='failed_syncs') NOT ILIKE '%regional_secretary%',
    p_tag || ': policy uses current_profile_role(), not is_admin(), no regional_secretary');
  PERFORM c2_test.ok(
    (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.failed_syncs'::regclass
       AND NOT tgisinternal AND tgname='trg_failed_syncs_updated_at') = 1,
    p_tag || ': updated_at trigger present once');
  -- Grants (table-level), per role.
  PERFORM c2_test.ok(
    NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema='public' AND table_name='failed_syncs' AND grantee='anon'),
    p_tag || ': anon has no privileges');
  PERFORM c2_test.ok(
    (SELECT array_agg(privilege_type::text ORDER BY privilege_type::text)
       FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='failed_syncs' AND grantee='authenticated')
      = ARRAY['SELECT'],
    p_tag || ': authenticated has SELECT only');
  PERFORM c2_test.ok(
    (SELECT array_agg(privilege_type::text ORDER BY privilege_type::text)
       FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='failed_syncs' AND grantee='service_role')
      = ARRAY['INSERT','SELECT','UPDATE'],
    p_tag || ': service_role has SELECT, INSERT, UPDATE only (no DELETE/TRUNCATE/REFERENCES/TRIGGER)');
END $$;

CREATE FUNCTION c2_test.role_matrix(p_tag text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r text;
  visible bigint;
  ins text := $q$INSERT INTO public.failed_syncs (sync_type) VALUES ('c2-denied')$q$;
  upd text := $q$UPDATE public.failed_syncs SET status = 'HACKED'$q$;
  del text := $q$DELETE FROM public.failed_syncs$q$;
  seeded bigint;
BEGIN
  SELECT count(*) INTO seeded FROM public.failed_syncs;
  PERFORM c2_test.ok(seeded > 0, p_tag || ': matrix has rows to protect (' || seeded || ')');

  -- anon
  PERFORM c2_test.ok(c2_test.run_as('anon', NULL, 'SELECT * FROM public.failed_syncs') = 'err:42501',
    p_tag || ': anon SELECT denied');
  PERFORM c2_test.ok(c2_test.run_as('anon', NULL, ins) = 'err:42501'
                    AND c2_test.run_as('anon', NULL, upd) = 'err:42501'
                    AND c2_test.run_as('anon', NULL, del) = 'err:42501',
    p_tag || ': anon INSERT/UPDATE/DELETE denied');

  -- denied authenticated principals: grant allows the query, RLS returns nothing
  FOREACH r IN ARRAY ARRAY['pending', 'teacher', 'regional_secretary', 'inactive_admin'] LOOP
    PERFORM c2_test.ok(
      c2_test.run_as('authenticated', c2_test.uid(r), 'SELECT * FROM public.failed_syncs') = 'ok:0',
      p_tag || ': ' || r || ' sees 0 rows');
  END LOOP;
  PERFORM c2_test.ok(
    c2_test.run_as('authenticated', gen_random_uuid(), 'SELECT * FROM public.failed_syncs') = 'ok:0',
    p_tag || ': authenticated user with no profile sees 0 rows');

  -- the five authorized roles
  FOREACH r IN ARRAY ARRAY['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal'] LOOP
    PERFORM c2_test.ok(
      c2_test.run_as('authenticated', c2_test.uid(r), 'SELECT * FROM public.failed_syncs') = 'ok:' || seeded,
      p_tag || ': ' || r || ' SELECT sees all ' || seeded || ' rows');
    PERFORM c2_test.ok(c2_test.run_as('authenticated', c2_test.uid(r), ins) = 'err:42501',
      p_tag || ': ' || r || ' browser INSERT denied');
    PERFORM c2_test.ok(c2_test.run_as('authenticated', c2_test.uid(r), upd) = 'err:42501',
      p_tag || ': ' || r || ' browser UPDATE denied');
    PERFORM c2_test.ok(c2_test.run_as('authenticated', c2_test.uid(r), del) = 'err:42501',
      p_tag || ': ' || r || ' browser DELETE denied');
  END LOOP;
  -- denied roles cannot mutate either
  PERFORM c2_test.ok(
    c2_test.run_as('authenticated', c2_test.uid('regional_secretary'), ins) = 'err:42501'
    AND c2_test.run_as('authenticated', c2_test.uid('teacher'), upd) = 'err:42501'
    AND c2_test.run_as('authenticated', c2_test.uid('pending'), del) = 'err:42501',
    p_tag || ': denied roles cannot mutate');

  -- service_role: SELECT/INSERT/UPDATE succeed, DELETE/TRUNCATE do not
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, 'SELECT * FROM public.failed_syncs') = 'ok:' || seeded,
    p_tag || ': service_role SELECT succeeds');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL,
    $q$INSERT INTO public.failed_syncs (sync_type, status) VALUES ('c2-service', 'FAILED')$q$) = 'ok:1',
    p_tag || ': service_role INSERT succeeds');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL,
    $q$UPDATE public.failed_syncs SET error_message = 'c2' WHERE sync_type = 'c2-service'$q$) = 'ok:1',
    p_tag || ': service_role UPDATE succeeds');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, del) = 'err:42501',
    p_tag || ': service_role DELETE is not granted');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, 'TRUNCATE public.failed_syncs') = 'err:42501',
    p_tag || ': service_role TRUNCATE is not granted');
  DELETE FROM public.failed_syncs WHERE sync_type = 'c2-service';

  -- exact current writer payload shapes (service_role)
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, $q$
    INSERT INTO public.failed_syncs
      (source_table, source_id, sync_type, status, error_message, retry_count,
       last_retry_at, created_at, updated_at)
    VALUES ('moodle_enrollment_sync', 'c2-src-1', 'moodle', 'RETRYING', 'Moodle HTTP 500', 1,
            now(), now(), now())$q$) = 'ok:1',
    p_tag || ': moodle-sync INSERT shape succeeds');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, $q$
    UPDATE public.failed_syncs
       SET sync_type = 'moodle', status = 'FAILED', error_message = 'x', retry_count = 2,
           last_retry_at = now(), updated_at = now()
     WHERE source_table = 'moodle_enrollment_sync' AND source_id = 'c2-src-1'$q$) = 'ok:1',
    p_tag || ': moodle-sync UPDATE shape succeeds');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, $q$
    INSERT INTO public.failed_syncs
      (source_table, source_id, sync_type, status, error_message, retry_count,
       last_retry_at, created_at, updated_at)
    VALUES ('teacher_availability', 'c2-src-2', 'class_options', 'FAILED',
            'class_options row missing after approval', 0, now(), now(), now())$q$) = 'ok:1',
    p_tag || ': approve-availability INSERT shape succeeds');
  PERFORM c2_test.ok(c2_test.run_as('service_role', NULL, $q$
    UPDATE public.failed_syncs SET status = 'PENDING', error_message = NULL, last_retry_at = now()
     WHERE source_id = 'c2-src-1'$q$) = 'ok:1'
    AND c2_test.run_as('service_role', NULL, $q$
    UPDATE public.failed_syncs SET status = 'RESOLVED', resolved_at = now()
     WHERE source_id = 'c2-src-1'$q$) = 'ok:1',
    p_tag || ': retry-worker retry/resolve UPDATE shapes succeed');
  DELETE FROM public.failed_syncs WHERE source_id IN ('c2-src-1', 'c2-src-2');

  -- privilege escalation through profile-role mutation
  PERFORM c2_test.ok(
    c2_test.run_as('authenticated', c2_test.uid('teacher'),
      $q$UPDATE public.profiles SET role = 'admin' WHERE user_id = '00000000-0000-0000-0000-0000000000b1'$q$)
      IN ('err:42501', 'ok:0')
    AND (SELECT role FROM public.profiles WHERE user_id = c2_test.uid('teacher')) = 'teacher',
    p_tag || ': teacher cannot promote self to admin');
  PERFORM c2_test.ok(
    c2_test.run_as('authenticated', c2_test.uid('pending'),
      $q$UPDATE public.profiles SET role = 'superadmin' WHERE user_id = '00000000-0000-0000-0000-0000000000b3'$q$)
      IN ('err:42501', 'ok:0')
    AND (SELECT role FROM public.profiles WHERE user_id = c2_test.uid('pending')) = 'pending',
    p_tag || ': pending user cannot promote self to superadmin');
  PERFORM c2_test.ok(
    c2_test.run_as('authenticated', c2_test.uid('admin'),
      $q$UPDATE public.profiles SET role = 'superadmin' WHERE user_id = '00000000-0000-0000-0000-0000000000a2'$q$)
      IN ('err:42501', 'ok:0')
    AND (SELECT role FROM public.profiles WHERE user_id = c2_test.uid('admin')) = 'admin',
    p_tag || ': admin cannot self-promote to superadmin');
  PERFORM c2_test.ok(
    c2_test.run_as('authenticated', c2_test.uid('teacher'), 'SELECT * FROM public.failed_syncs') = 'ok:0'
    AND c2_test.run_as('authenticated', c2_test.uid('pending'), 'SELECT * FROM public.failed_syncs') = 'ok:0',
    p_tag || ': failed_syncs still denied after escalation attempts');
END $$;

-- =============================================================================
-- PART A — FRESH DATABASE (table produced by the migration chain from zero)
-- =============================================================================
SELECT c2_test.ok(to_regclass('public.failed_syncs') IS NOT NULL,
  'A1 fresh chain created public.failed_syncs');
SELECT c2_test.schema_contract('A fresh');

INSERT INTO public.failed_syncs (sync_type, source_table, source_id, status, error_message, last_retry_at)
VALUES ('moodle', 'moodle_enrollment_sync', 'seed-fresh-1', 'FAILED', 'seed', now()),
       ('sync', 'teacher_availability', 'seed-fresh-2', 'RETRYING', 'seed', NULL);
SELECT c2_test.role_matrix('A fresh');
DELETE FROM public.failed_syncs;

-- =============================================================================
-- PART B — PRODUCTION-SHAPED UPGRADE
-- Recreate the table exactly as production has it (11 columns, no updated_at,
-- RLS on, zero policies, broad legacy grants), seed it, run the migration.
-- =============================================================================
DROP TABLE public.failed_syncs;
CREATE TABLE public.failed_syncs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type     text        NOT NULL,
  source_table  text,
  source_id     text,
  payload       jsonb,
  error_message text,
  status        text        NOT NULL DEFAULT 'FAILED',
  retry_count   integer     NOT NULL DEFAULT 0,
  last_retry_at timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.failed_syncs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.failed_syncs TO anon, authenticated, service_role;

INSERT INTO public.failed_syncs
  (id, sync_type, source_table, source_id, payload, error_message, status, retry_count,
   last_retry_at, resolved_at, created_at)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'moodle', 'moodle_enrollment_sync', 'legacy-1',
   '{"k":1}', 'boom', 'RETRYING', 3, '2026-02-02 10:00:00+00', NULL, '2026-01-01 09:00:00+00'),
  ('10000000-0000-0000-0000-000000000002', 'class_options', 'teacher_availability', 'legacy-2',
   NULL, 'missing', 'FAILED', 0, NULL, NULL, '2026-01-03 08:30:00+00'),
  ('10000000-0000-0000-0000-000000000003', 'sync', NULL, NULL,
   NULL, NULL, 'RESOLVED', 1, '2026-03-04 00:00:00+00', '2026-03-05 00:00:00+00', '2026-03-01 00:00:00+00');

CREATE TABLE c2_test.before_hash AS
SELECT id, md5(row(sync_type, source_table, source_id, payload, error_message, status,
                   retry_count, last_retry_at, resolved_at, created_at)::text) AS h
FROM public.failed_syncs;

SELECT c2_test.ok(
  NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='failed_syncs' AND column_name='updated_at'),
  'B0 production-shaped table has no updated_at before upgrade');

\i /tmp/c2_migration.sql

SELECT c2_test.ok((SELECT count(*) FROM public.failed_syncs) = 3,
  'B4 production-shaped upgrade kept all seed rows');
SELECT c2_test.ok(
  (SELECT count(*) FROM public.failed_syncs f JOIN c2_test.before_hash b USING (id)
    WHERE md5(row(f.sync_type, f.source_table, f.source_id, f.payload, f.error_message, f.status,
                  f.retry_count, f.last_retry_at, f.resolved_at, f.created_at)::text) = b.h) = 3,
  'B5 existing row contents survived the upgrade unchanged');
SELECT c2_test.ok(
  (SELECT updated_at FROM public.failed_syncs WHERE id = '10000000-0000-0000-0000-000000000001')
    = '2026-02-02 10:00:00+00'
  AND (SELECT updated_at FROM public.failed_syncs WHERE id = '10000000-0000-0000-0000-000000000003')
    = '2026-03-04 00:00:00+00',
  'B6 updated_at backfill prefers last_retry_at');
SELECT c2_test.ok(
  (SELECT updated_at FROM public.failed_syncs WHERE id = '10000000-0000-0000-0000-000000000002')
    = '2026-01-03 08:30:00+00',
  'B7 updated_at backfill falls back to created_at');
SELECT c2_test.schema_contract('B upgraded');

-- Trigger: an UPDATE that does not name updated_at advances it.
UPDATE public.failed_syncs SET error_message = 'touched'
 WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT c2_test.ok(
  (SELECT updated_at FROM public.failed_syncs WHERE id = '10000000-0000-0000-0000-000000000001') = now()
  AND now() > '2026-02-02 10:00:00+00'::timestamptz,
  'B8 updated_at trigger advances updated_at on UPDATE that does not set it');
-- Default: an INSERT that omits updated_at gets now().
INSERT INTO public.failed_syncs (sync_type) VALUES ('c2-default');
SELECT c2_test.ok(
  (SELECT updated_at FROM public.failed_syncs WHERE sync_type = 'c2-default') = now(),
  'B3 updated_at DEFAULT now() applies on INSERT');
DELETE FROM public.failed_syncs WHERE sync_type = 'c2-default';

SELECT c2_test.role_matrix('B upgraded');

-- =============================================================================
-- PART C — IDEMPOTENCY: re-running the migration is a no-op
-- =============================================================================
CREATE TABLE c2_test.pre_rerun AS
SELECT id, updated_at FROM public.failed_syncs;

\i /tmp/c2_migration.sql

SELECT c2_test.ok(
  (SELECT count(*) FROM public.failed_syncs) = 3
  AND (SELECT count(*) FROM public.failed_syncs f JOIN c2_test.pre_rerun p USING (id)
        WHERE f.updated_at = p.updated_at) = 3,
  'C1 re-running the migration keeps rows and updated_at values');
SELECT c2_test.schema_contract('C rerun');

SELECT 'C2 TOTAL_CHECKS ' || count(*) FROM c2_test.results;
ROLLBACK;
