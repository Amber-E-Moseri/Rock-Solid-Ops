-- =============================================================================
-- audit_logs privilege and provenance guard: regression tests
-- (for supabase/migrations/20261024120000_audit_provenance_guard.sql)
-- =============================================================================
-- LOCAL ONLY. Run against a throwaway replay database built from the origin/main migration
-- lineage. Never against staging or production. Wrapped in a transaction and rolled back.
--
--   psql -h <host> -p <port> -U postgres -X -v ON_ERROR_STOP=1 -d <replay_db> \
--        -f supabase/tests/security/audit-logs-privilege-guard.sql
--
-- Expected: every PASS line prints and the run exits 0. Against a database WITHOUT the guard,
-- the privilege-matrix and browser-role cases must FAIL (negative control).
-- Self-contained: does not depend on the Phase A teacher-link functions.
-- =============================================================================

\set ON_ERROR_STOP 1
begin;

-- ---- helpers ------------------------------------------------------------------

create or replace function pg_temp.expect(p_label text, p_ok boolean)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'PASS: %', p_label;
end;
$$;

-- Runs p_sql as p_role with p_uid in the JWT. Returns 'OK' or 'ERROR: <message>'.
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  r text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', p_role)::text end,
    true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    r := 'OK';
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end;
$$;

-- Counts audit_logs rows visible to p_role (RLS applies).
create or replace function pg_temp.visible_count(p_role text, p_uid uuid)
returns bigint
language plpgsql
as $$
declare
  n bigint;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', p_role)::text end,
    true);
  execute format('set local role %I', p_role);
  select count(*) into n from public.audit_logs;
  execute 'reset role';
  return n;
end;
$$;

-- ---- fixtures (owner, rolled back at the end) ----------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'guard-admin@example.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'guard-noprofile@example.test');

-- auth.users inserts create a profile through handle_new_auth_user_profile(); set its role.
update public.profiles set role = 'admin', is_active = true
where user_id = '00000000-0000-4000-8000-0000000000a1';

insert into public.audit_logs (action, entity_type, entity_id, status, details)
values
  ('GUARD_TEST_ORDINARY', 'applicant', 'guard-ordinary-1', 'SUCCESS', '{}'::jsonb),
  ('TEACHER_AUTH_LINKED', 'teacher', 'guard-provenance-1', 'SUCCESS', '{}'::jsonb);

-- ---- 1. privilege matrix --------------------------------------------------------

select pg_temp.expect('anon holds no privilege on audit_logs',
  not (has_table_privilege('anon', 'public.audit_logs', 'SELECT')
    or has_table_privilege('anon', 'public.audit_logs', 'INSERT')
    or has_table_privilege('anon', 'public.audit_logs', 'UPDATE')
    or has_table_privilege('anon', 'public.audit_logs', 'DELETE')
    or has_table_privilege('anon', 'public.audit_logs', 'TRUNCATE')
    or has_table_privilege('anon', 'public.audit_logs', 'REFERENCES')
    or has_table_privilege('anon', 'public.audit_logs', 'TRIGGER')));

select pg_temp.expect('authenticated keeps SELECT and INSERT',
  has_table_privilege('authenticated', 'public.audit_logs', 'SELECT')
  and has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'));

select pg_temp.expect('authenticated lost UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
  not (has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
    or has_table_privilege('authenticated', 'public.audit_logs', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.audit_logs', 'REFERENCES')
    or has_table_privilege('authenticated', 'public.audit_logs', 'TRIGGER')));

select pg_temp.expect('service_role grants untouched (edge functions keep access)',
  has_table_privilege('service_role', 'public.audit_logs', 'SELECT')
  and has_table_privilege('service_role', 'public.audit_logs', 'INSERT')
  and has_table_privilege('service_role', 'public.audit_logs', 'UPDATE')
  and has_table_privilege('service_role', 'public.audit_logs', 'DELETE'));

-- ---- 2. policy shape ------------------------------------------------------------

select pg_temp.expect('no FOR ALL policy remains on audit_logs',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and cmd = 'ALL'));

select pg_temp.expect('no UPDATE or DELETE policy exists on audit_logs',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs'
    and cmd in ('UPDATE', 'DELETE')));

select pg_temp.expect('exactly the two operation-specific policies exist',
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_logs'
     and policyname in ('audit_logs_select_admin', 'audit_logs_insert_admin_nonprovenance')) = 2
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_logs') = 2);

-- ---- 3. guard triggers present and enabled --------------------------------------

select pg_temp.expect('row provenance guard trigger is enabled',
  exists (select 1 from pg_trigger where tgrelid = 'public.audit_logs'::regclass
    and tgname = 'trg_audit_provenance_row_guard' and tgenabled = 'O'));

select pg_temp.expect('truncate provenance guard trigger is enabled',
  exists (select 1 from pg_trigger where tgrelid = 'public.audit_logs'::regclass
    and tgname = 'trg_audit_provenance_truncate_guard' and tgenabled = 'O'));

-- ---- 4. browser roles: refusal behaviour ----------------------------------------

select pg_temp.expect('anon DELETE is refused',
  pg_temp.try_as('anon', null, 'delete from public.audit_logs') like 'ERROR:%');

select pg_temp.expect('anon TRUNCATE is refused',
  pg_temp.try_as('anon', null, 'truncate public.audit_logs') like 'ERROR:%');

select pg_temp.expect('authenticated TRUNCATE is refused',
  pg_temp.try_as('authenticated', '00000000-0000-4000-8000-0000000000a1', 'truncate public.audit_logs') like 'ERROR:%');

select pg_temp.expect('authenticated UPDATE is refused (admin, no grant)',
  pg_temp.try_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    'update public.audit_logs set notes = ''tamper'' where action = ''GUARD_TEST_ORDINARY''') like 'ERROR:%');

select pg_temp.expect('authenticated DELETE is refused (admin, no grant)',
  pg_temp.try_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    'delete from public.audit_logs where action = ''GUARD_TEST_ORDINARY''') like 'ERROR:%');

select pg_temp.expect('non-admin authenticated reads zero audit rows (RLS)',
  pg_temp.visible_count('authenticated', '00000000-0000-4000-8000-0000000000b1') = 0);

select pg_temp.expect('admin authenticated reads audit rows',
  pg_temp.visible_count('authenticated', '00000000-0000-4000-8000-0000000000a1') >= 2);

select pg_temp.expect('admin may INSERT an ordinary audit row',
  pg_temp.try_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    $sql$insert into public.audit_logs (action, entity_type, entity_id, status, details)
         values ('GUARD_TEST_ADMIN_INSERT', 'applicant', 'guard-admin-1', 'SUCCESS', '{}'::jsonb)$sql$) = 'OK');

select pg_temp.expect('admin may NOT INSERT a teacher-auth provenance row',
  pg_temp.try_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    $sql$insert into public.audit_logs (action, entity_type, entity_id, status, details)
         values ('TEACHER_AUTH_LINKED', 'teacher', 'forged', 'SUCCESS', '{}'::jsonb)$sql$) like 'ERROR:%');

select pg_temp.expect('non-admin authenticated may NOT INSERT an audit row',
  pg_temp.try_as('authenticated', '00000000-0000-4000-8000-0000000000b1',
    $sql$insert into public.audit_logs (action, entity_type, entity_id, status, details)
         values ('GUARD_TEST_NOPROFILE', 'applicant', 'x', 'SUCCESS', '{}'::jsonb)$sql$) like 'ERROR:%');

-- ---- 5. provenance rows are protected even from the owner ------------------------

do $$
declare
  refused boolean := false;
begin
  begin
    delete from public.audit_logs where action = 'TEACHER_AUTH_LINKED';
  exception when insufficient_privilege then
    refused := true;
  end;
  perform pg_temp.expect('owner DELETE of a provenance row is refused by trigger', refused);
end;
$$;

do $$
declare
  refused boolean := false;
begin
  begin
    update public.audit_logs set notes = 'tamper' where action = 'TEACHER_AUTH_LINKED';
  exception when insufficient_privilege then
    refused := true;
  end;
  perform pg_temp.expect('owner UPDATE of a provenance row is refused by trigger', refused);
end;
$$;

do $$
declare
  refused boolean := false;
begin
  begin
    update public.audit_logs set action = 'TEACHER_AUTH_UNLINKED' where action = 'GUARD_TEST_ORDINARY';
  exception when insufficient_privilege then
    refused := true;
  end;
  perform pg_temp.expect('owner UPDATE that rewrites a row INTO a provenance action is refused', refused);
end;
$$;

do $$
declare
  refused boolean := false;
begin
  begin
    truncate public.audit_logs;
  exception when insufficient_privilege then
    refused := true;
  end;
  perform pg_temp.expect('owner TRUNCATE is refused while provenance rows exist', refused);
end;
$$;

-- ---- 6. ordinary rows remain manageable by the owner (guard is narrow) -----------

do $$
declare
  n bigint;
begin
  delete from public.audit_logs where action = 'GUARD_TEST_ORDINARY';
  get diagnostics n = row_count;
  perform pg_temp.expect('owner may DELETE an ordinary row (guard is narrow)', n = 1);
end;
$$;

rollback;
