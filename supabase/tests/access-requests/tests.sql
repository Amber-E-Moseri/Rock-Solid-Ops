-- Request Access Phase 3 tests: intake, visibility, scoped review, transitions and the approval boundary.
-- Runs after stubs.sql (Supabase-shaped baseline), the Phase 1 scope migrations, PR #22's teacher
-- application foundation, the Phase 2 scope migration and the Phase 3 migration.
-- Each check is recorded in test_harness.results; run.sh fails when any check is not ok.
--
-- Actor keys (fixed UUIDs):
--   Staff   SUP superadmin  REG regional_secretary  PAS pastor (CE/CESGA, CE/CESGB)  SGA subgroup_admin (CE/CESGA)
--           ADM admin       PRI principal          TCH teacher                      INA pastor, inactive (CE/CESGA)
--           TWIN pastor (CE/CESGA) whose email equals applicant S's email           PND pending profile
--   Applicants  AP_T teacher  AP_P pastor request  AP_S subgroup_admin (CE/CESGA)  AP_S2 subgroup_admin (CE/CESGB)
--           AP_O other request  AP_U unverified  AP_D same address as AP_P, another account
-- Requests:  P = AP_P, S = AP_S, S2 = AP_S2, O = AP_O.

create schema test_harness;

create table test_harness.results (
  id     serial primary key,
  name   text not null,
  ok     boolean not null,
  detail text
);

-- Test-only: helpers switch role, so every role must reach the harness schema.
grant usage on schema test_harness to public;

create or replace function test_harness.as_user(p_role text, p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  execute format('set role %I', p_role);
end;
$$;

create or replace function test_harness.as_postgres()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

create or replace function test_harness.record(p_name text, p_ok boolean, p_detail text default '')
returns void
language plpgsql
as $$
begin
  insert into test_harness.results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
end;
$$;

-- Passes when p_sql raises an error whose message starts with p_prefix.
create or replace function test_harness.expect_raise(p_name text, p_role text, p_uid uuid, p_sql text, p_prefix text)
returns void
language plpgsql
as $$
declare
  v_msg text := null;
  v_state text := null;
begin
  perform test_harness.as_user(p_role, p_uid);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
  end;
  perform test_harness.as_postgres();
  if v_msg is null then
    perform test_harness.record(p_name, false, 'no error raised; expected ' || p_prefix);
  else
    perform test_harness.record(p_name, left(v_msg, length(p_prefix)) = p_prefix,
                                'sqlstate ' || v_state || ': ' || v_msg);
  end if;
end;
$$;

-- Runs p_sql as p_role and returns its single text result, or 'ERROR: <message>'.
create or replace function test_harness.text_as(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
  v_msg text;
begin
  perform test_harness.as_user(p_role, p_uid);
  begin
    execute p_sql into v_out;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_out := 'ERROR: ' || v_msg;
  end;
  perform test_harness.as_postgres();
  return v_out;
end;
$$;

-- Counts rows visible to p_role/p_uid under RLS and checks the expected count.
create or replace function test_harness.count_as_row(p_role text, p_uid uuid, p_sql text, p_expected bigint)
returns boolean
language plpgsql
as $$
declare
  v_n bigint;
begin
  perform test_harness.as_user(p_role, p_uid);
  begin
    execute p_sql into v_n;
  exception when others then
    v_n := -1;
  end;
  perform test_harness.as_postgres();
  return v_n = p_expected;
end;
$$;

-- Id of the most recent general request filed by an applicant (test-only lookup, definer-owned).
create or replace function test_harness.req_id(p_applicant uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select a.id into v_id
  from public.access_requests a
  where a.applicant_user_id = p_applicant
  order by a.submitted_at desc
  limit 1;
  return v_id;
end;
$$;
grant execute on function test_harness.req_id(uuid) to public;

-- What an actor sees of decision authority on an applicant's request: 'true' or 'false'.
create or replace function test_harness.can(p_actor uuid, p_applicant uuid)
returns text
language sql
as $$
  select test_harness.text_as('authenticated', p_actor,
    format('select public.access_request_can_decide(%L::uuid)', test_harness.req_id(p_applicant)));
$$;

-- Fixed actor and applicant identities.
--   SUP ...b1  REG ...b2  PAS ...b3  SGA ...b4  ADM ...b5  PRI ...b6  TCH ...b7  INA ...b8  TWIN ...b9  PND ...c1
--   AP_T ...a1  AP_P ...a2  AP_S ...a3  AP_S2 ...a4  AP_O ...a5  AP_U ...a6  AP_D ...a7

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'sup@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b2', 'reg@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b3', 'pas@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b4', 'sga@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b5', 'adm@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b6', 'pri@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b7', 'tch@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b8', 'ina@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000b9', 'Shared@Example.test',      now()),
  ('00000000-0000-4000-8000-0000000000c1', 'pnd@example.test',         now()),
  ('00000000-0000-4000-8000-0000000000a1', 'teach.app@example.test',   now()),
  ('00000000-0000-4000-8000-0000000000a2', 'pastor.app@example.test',  now()),
  ('00000000-0000-4000-8000-0000000000a3', 'shared@example.test',     now()),
  ('00000000-0000-4000-8000-0000000000a4', 'sga2.app@example.test',    now()),
  ('00000000-0000-4000-8000-0000000000a5', 'other.app@example.test',   now()),
  ('00000000-0000-4000-8000-0000000000a6', 'unverified@example.test',  null),
  ('00000000-0000-4000-8000-0000000000a7', 'pastor.app@example.test',  now());

insert into public.profiles (user_id, email, full_name, role, is_active) values
  ('00000000-0000-4000-8000-0000000000b1', 'sup@example.test',  'Superadmin',         'superadmin',         true),
  ('00000000-0000-4000-8000-0000000000b2', 'reg@example.test',  'Regional Secretary', 'regional_secretary', true),
  ('00000000-0000-4000-8000-0000000000b3', 'pas@example.test',  'Pastor Paul',        'pastor',             true),
  ('00000000-0000-4000-8000-0000000000b4', 'sga@example.test',  'Subgroup Sam',       'subgroup_admin',     true),
  ('00000000-0000-4000-8000-0000000000b5', 'adm@example.test',  'Admin Ada',          'admin',              true),
  ('00000000-0000-4000-8000-0000000000b6', 'pri@example.test',  'Principal Pri',      'principal',          true),
  ('00000000-0000-4000-8000-0000000000b7', 'tch@example.test',  'Teacher Tom',        'teacher',            true),
  ('00000000-0000-4000-8000-0000000000b8', 'ina@example.test',  'Inactive Ian',       'pastor',             true),
  ('00000000-0000-4000-8000-0000000000b9', 'Shared@Example.test','Twin Tina',         'pastor',             true),
  ('00000000-0000-4000-8000-0000000000c1', 'pnd@example.test',  'Pending Pat',        'pending',            true),
  ('00000000-0000-4000-8000-0000000000a1', 'teach.app@example.test', 'Teach Applicant', 'pending',          true),
  ('00000000-0000-4000-8000-0000000000a2', 'pastor.app@example.test', 'Pastor Applicant', 'pending',        true);

insert into public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, active) values
  ('CMU',     'Central Main',  'CE', 'CESGA', true),
  ('YORK',    'York Campus',   'CE', 'CESGB', true),
  ('STOR',    'Storefront',    'CS', 'CSGA',  true),
  ('RETIRED', 'Old Campus',    'CE', 'CESGA', false),
  ('OLDWS',   'Retired WS',    'WS', 'WSGA',  false);

-- Phase 1 scope tables. The seed runs at load time, after the fellowship rows above exist.
\i ../../migrations/202610250100_org_subgroups.sql
\i ../../migrations/202610250200_staff_scope_assignments.sql

-- PR #22 teacher application foundation (unchanged), then Phase 2 and Phase 3.
\i ../../migrations/202610230100_teacher_applications_foundation.sql
\i ../../migrations/202610230200_teacher_application_email_templates.sql
\i ../../migrations/202610250300_teacher_applications_scope.sql
\i ../../migrations/202610250400_access_request_intake_and_review.sql

-- Pastor PAS holds CESGA and CESGB; subgroup admin SGA holds CESGA only; TWIN and INA hold CESGA.
select public.grant_staff_scope('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3', 'CE', 'CESGA');
select public.grant_staff_scope('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3', 'CE', 'CESGB');
select public.grant_staff_scope('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b4', 'CE', 'CESGA');
select public.grant_staff_scope('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b9', 'CE', 'CESGA');
select public.grant_staff_scope('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b8', 'CE', 'CESGA');
-- INA is granted while active, then deactivated. Grants require an active target.
update public.profiles set is_active = false where user_id = '00000000-0000-4000-8000-0000000000b8';

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Organization options and privileges for anonymous callers
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('A1 anonymous caller reads the active organization options',
  test_harness.text_as('anon', null, 'select public.access_request_org_options()::text') like '%CESGA%');
select test_harness.record('A2 options include the second CE subgroup and the CS subgroup',
  test_harness.text_as('anon', null, 'select public.access_request_org_options()::text') like '%CESGB%'
  and test_harness.text_as('anon', null, 'select public.access_request_org_options()::text') like '%CSGA%');
select test_harness.record('A3 options exclude the inactive fellowship and the inactive subgroup',
  test_harness.text_as('anon', null, 'select public.access_request_org_options()::text') not like '%RETIRED%'
  and test_harness.text_as('anon', null, 'select public.access_request_org_options()::text') not like '%WSGA%');
select test_harness.record('A4 options contain no group_admin concept',
  test_harness.text_as('anon', null, 'select public.access_request_org_options()::text') not like '%group_admin%');
select test_harness.expect_raise('A5 anonymous caller cannot read the request table', 'anon', null,
  'select count(*) from public.access_requests', 'permission denied');
select test_harness.expect_raise('A6 anonymous caller cannot file a request', 'anon', null,
  $$select public.submit_access_request('pastor', 'Anon Person', null, 'CMU', 'CE', 'CESGA', null)$$, 'permission denied');
select test_harness.expect_raise('A7 authenticated caller cannot read the request table directly', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  'select count(*) from public.access_requests', 'permission denied');
select test_harness.expect_raise('A8 authenticated caller cannot insert a request directly', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$insert into public.access_requests (applicant_user_id, email, email_normalized, full_name, fellowship_code, group_id, subgroup_id, requested_role, email_verified_at)
    values ('00000000-0000-4000-8000-0000000000a2', 'x@example.test', 'x@example.test', 'Direct Write', 'CMU', 'CE', 'CESGA', 'pastor', now())$$,
  'permission denied');

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Intake: validity, the four roles, duplicates and staff accounts
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_raise('B1 an unverified account cannot file', 'authenticated', '00000000-0000-4000-8000-0000000000a6',
  $$select public.submit_access_request('pastor', 'Unverified Uma', null, 'CMU', 'CE', 'CESGA', null)$$, 'EMAIL_NOT_VERIFIED');
select test_harness.expect_raise('B2 teacher is not filed through the general intake', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('teacher', 'Pastor Applicant', null, 'CMU', 'CE', 'CESGA', null)$$, 'USE_TEACHER_APPLICATION');
select test_harness.expect_raise('B3 group admin is not a requestable role', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('group_admin', 'Pastor Applicant', null, 'CMU', 'CE', 'CESGA', null)$$, 'INVALID_ROLE');
select test_harness.expect_raise('B4 a subgroup from another group is refused', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('pastor', 'Pastor Applicant', null, 'CMU', 'CS', 'CSGA', null)$$, 'INVALID_SCOPE');
select test_harness.expect_raise('B5 a fellowship that belongs to another subgroup is refused', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('pastor', 'Pastor Applicant', null, 'CMU', 'CE', 'CESGB', null)$$, 'INVALID_SCOPE');
select test_harness.expect_raise('B6 an inactive fellowship is refused', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('pastor', 'Pastor Applicant', null, 'RETIRED', 'CE', 'CESGA', null)$$, 'INVALID_FELLOWSHIP');
select test_harness.expect_raise('B7 an unknown subgroup is refused', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('pastor', 'Pastor Applicant', null, 'CMU', 'CE', 'NOPE', null)$$, 'INVALID_SCOPE');
select test_harness.expect_raise('B8 a blank subgroup is refused', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('pastor', 'Pastor Applicant', null, 'CMU', 'CE', '', null)$$, 'INVALID_SCOPE');

select test_harness.record('B9 a pastor request is filed (SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a2',
    $$select (public.submit_access_request('pastor', 'Pastor Applicant', null, 'CMU', 'CE', 'CESGA', null))->>'outcome'$$) = 'SUBMITTED');
select test_harness.record('B10 a subgroup admin request is filed (CE/CESGA)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a3',
    $$select (public.submit_access_request('subgroup_admin', 'Shared Sally', null, 'CMU', 'CE', 'CESGA', 'New to the leadership team'))->>'outcome'$$) = 'SUBMITTED');
select test_harness.record('B11 a second subgroup admin request is filed (CE/CESGB)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a4',
    $$select (public.submit_access_request('subgroup_admin', 'Sga Two', '+1 555 0123', 'YORK', 'CE', 'CESGB', null))->>'outcome'$$) = 'SUBMITTED');
select test_harness.record('B12 an other request is filed (CE/CESGA)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a5',
    $$select (public.submit_access_request('other', 'Other Olive', null, 'CMU', 'CE', 'CESGA', 'Worship team'))->>'outcome'$$) = 'SUBMITTED');

select test_harness.record('B13 the stored email comes from Auth, lowercased and verified',
  (select a.email_normalized = 'pastor.app@example.test' and a.email_verified_at is not null
     from public.access_requests a where a.applicant_user_id = '00000000-0000-4000-8000-0000000000a2'));

select test_harness.record('B14 an identical retry is UNCHANGED (no new version, no new event)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a2',
    $$select (public.submit_access_request('pastor', 'Pastor Applicant', null, 'CMU', 'CE', 'CESGA', null))->>'outcome'$$) = 'UNCHANGED'
  and (select a.version from public.access_requests a where a.applicant_user_id = '00000000-0000-4000-8000-0000000000a2') = 1);

select test_harness.expect_raise('B15 a different role while a request is open is refused', 'authenticated', '00000000-0000-4000-8000-0000000000a2',
  $$select public.submit_access_request('other', 'Pastor Applicant', null, 'CMU', 'CE', 'CESGA', null)$$, 'EXISTING_REQUEST');
select test_harness.expect_raise('B16 a second account for the same address cannot open a second request', 'authenticated', '00000000-0000-4000-8000-0000000000a7',
  $$select public.submit_access_request('pastor', 'Second Account', null, 'CMU', 'CE', 'CESGA', null)$$, 'DUPLICATE_OPEN_REQUEST');

-- Two statements, not one expression: the teacher application must exist before the general request is tried.
select test_harness.record('B17a a teacher application is filed (SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    $$select (public.submit_teacher_application('Teach Applicant', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED');
select test_harness.record('B17b an open teacher application blocks a general request for the same person',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    $$select public.submit_access_request('pastor', 'Teach Applicant', null, 'CMU', 'CE', 'CESGA', null)$$) like 'ERROR: OPEN_TEACHER_APPLICATION%');

select test_harness.expect_raise('B18 a staff account cannot file a request', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  $$select public.submit_access_request('other', 'Pastor Paul', null, 'CMU', 'CE', 'CESGA', null)$$, 'ALREADY_STAFF');
select test_harness.expect_raise('B19 an inactive account cannot file a request', 'authenticated', '00000000-0000-4000-8000-0000000000b8',
  $$select public.submit_access_request('other', 'Inactive Ian', null, 'CMU', 'CE', 'CESGA', null)$$, 'ACCOUNT_INACTIVE');

select test_harness.record('B20 a pending profile can file, and remains pending with no scope',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000c1',
    $$select (public.submit_access_request('other', 'Pending Pat', null, 'CMU', 'CE', 'CESGA', null))->>'outcome'$$) = 'SUBMITTED'
  and (select p.role from public.profiles p where p.user_id = '00000000-0000-4000-8000-0000000000c1') = 'pending'
  and not exists (select 1 from public.staff_scope_assignments s where s.user_id = '00000000-0000-4000-8000-0000000000c1'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Applicant-only visibility and no enumeration
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('C1 the applicant sees exactly their own request',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000a2',
    'select count(*) from public.access_requests_applicant', 1));
select test_harness.record('C2 an applicant sees no other applicant''s request through the applicant view',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a5',
    'select string_agg(full_name, '','') from public.access_requests_applicant') = 'Other Olive');
select test_harness.record('C3 the applicant review view is empty for an applicant',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000a2',
    'select count(*) from public.access_requests_review', 0));
select test_harness.record('C4 the applicant view exposes no reviewer or identity columns',
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'public' and table_name = 'access_requests_applicant'
      and column_name in ('reviewer_note', 'reviewed_by', 'reviewed_at', 'applicant_user_id', 'email', 'email_normalized', 'email_verified_at')));
select test_harness.record('C5 an unverified applicant has no request to see',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000a6',
    'select count(*) from public.access_requests_applicant', 0));
select test_harness.expect_raise('C6 anonymous caller cannot read the applicant view', 'anon', null,
  'select count(*) from public.access_requests_applicant', 'permission denied');

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Decision authority matrix (the function, resolved from auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('D1 superadmin decides every request type organization-wide',
  test_harness.can('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2') = 'true'
  and test_harness.can('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a3') = 'true'
  and test_harness.can('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a4') = 'true'
  and test_harness.can('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a5') = 'true');
select test_harness.record('D2 regional secretary decides every request type organization-wide',
  test_harness.can('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2') = 'true'
  and test_harness.can('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a3') = 'true'
  and test_harness.can('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a4') = 'true'
  and test_harness.can('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a5') = 'true');
select test_harness.record('D3 pastor with two subgroups decides the subgroup admin request in its first subgroup',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3') = 'true');
select test_harness.record('D4 pastor with two subgroups decides the subgroup admin request in its second subgroup',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a4') = 'true');
select test_harness.record('D5 pastor is denied a pastor request (organization-wide only)',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a2') = 'false');
select test_harness.record('D6 pastor is denied an other request (organization-wide only)',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a5') = 'false');
select test_harness.record('D7 subgroup admin is denied a subgroup admin request in its own subgroup (only pastors decide those)',
  test_harness.can('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a3') = 'false');
select test_harness.record('D8 subgroup admin is denied the second subgroup (cross-subgroup)',
  test_harness.can('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a4') = 'false');
select test_harness.record('D9 subgroup admin is denied a pastor request',
  test_harness.can('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a2') = 'false');
select test_harness.record('D10 subgroup admin is denied an other request',
  test_harness.can('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a5') = 'false');
select test_harness.record('D11 admin has no decision rights on any request',
  test_harness.can('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a2') = 'false'
  and test_harness.can('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a3') = 'false'
  and test_harness.can('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a5') = 'false');
select test_harness.record('D12 principal has no decision rights on any request',
  test_harness.can('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000a3') = 'false'
  and test_harness.can('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000a5') = 'false');
select test_harness.record('D13 teacher and pending profiles have no decision rights',
  test_harness.can('00000000-0000-4000-8000-0000000000b7', '00000000-0000-4000-8000-0000000000a3') = 'false'
  and test_harness.can('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a3') = 'false');
select test_harness.record('D14 an inactive pastor has no decision rights, although it holds an assignment',
  test_harness.can('00000000-0000-4000-8000-0000000000b8', '00000000-0000-4000-8000-0000000000a3') = 'false');
select test_harness.record('D15 a pastor whose email matches the applicant is denied (self-approval by normalized email)',
  test_harness.can('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000a3') = 'false');
select test_harness.record('D16 the same pastor is denied the second subgroup, which its assignment does not cover',
  test_harness.can('00000000-0000-4000-8000-0000000000b9', '00000000-0000-4000-8000-0000000000a4') = 'false');

select test_harness.record('D17 the reviewer view lists exactly the requests the pastor may decide (two subgroup admin requests)',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b3',
    'select count(*) from public.access_requests_review', 2));
select test_harness.record('D18 the subgroup admin reviewer view is empty for general requests (teacher requests are scoped separately)',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b4',
    'select count(*) from public.access_requests_review', 0));
select test_harness.record('D19 superadmin sees every request in the reviewer view (pastor, two subgroup admin, other, pending)',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b1',
    'select count(*) from public.access_requests_review', 5));
select test_harness.record('D20 admin and principal see no request in the reviewer view',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b5',
    'select count(*) from public.access_requests_review', 0)
  and test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b6',
    'select count(*) from public.access_requests_review', 0));

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Self-decision: by user id and by normalized email
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_raise('E1 an applicant cannot approve their own request (by user id)', 'authenticated', '00000000-0000-4000-8000-0000000000a5',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'APPROVE'),
  'FORBIDDEN: reviewers cannot decide their own request');
select test_harness.expect_raise('E2 a pastor cannot approve a request filed under its own normalized email', 'authenticated', '00000000-0000-4000-8000-0000000000b9',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'APPROVE'),
  'FORBIDDEN: reviewers cannot decide their own request');
select test_harness.expect_raise('E3 a pastor who is not the applicant cannot decide a pastor request (organization-wide only)', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a2'), 'APPROVE'),
  'FORBIDDEN: not authorized to decide this request');
select test_harness.expect_raise('E4 a pastor cannot decide an other request', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 1, %L, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'REJECT', 'x'),
  'FORBIDDEN: not authorized to decide this request');
select test_harness.expect_raise('E5 admin cannot decide a subgroup admin request', 'authenticated', '00000000-0000-4000-8000-0000000000b5',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'APPROVE'),
  'FORBIDDEN: not authorized to decide this request');
select test_harness.expect_raise('E6 a subgroup admin cannot decide a request in another subgroup', 'authenticated', '00000000-0000-4000-8000-0000000000b4',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a4'), 'APPROVE'),
  'FORBIDDEN: not authorized to decide this request');

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Transitions: request information, resubmission, reject, approve (pending only), withdraw
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_raise('F1 a request-information needs a message', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'REQUEST_INFO'),
  'MESSAGE_REQUIRED');
select test_harness.record('F2 pastor requests information on the subgroup admin request in its subgroup (SUBMITTED to INFO_REQUESTED, version 2)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000b3',
    format('select (public.decide_access_request(%L::uuid, %L, 1, %L, null))->>''status''',
      test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'REQUEST_INFO', 'Please confirm your fellowship leader')) = 'INFO_REQUESTED');
select test_harness.record('F3 the applicant reads the applicant-visible message',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a3',
    'select review_message from public.access_requests_applicant') = 'Please confirm your fellowship leader');
-- One write, then reads: the resubmission runs before any state is read.
do $body$
declare
  v_out     text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a3',
                      $$select (public.submit_access_request('subgroup_admin', 'Shared Sally', null, 'CMU', 'CE', 'CESGA', 'Leader confirmed'))->>'outcome'$$);
  v_status  text;
  v_version integer;
begin
  select a.status, a.version into v_status, v_version
  from public.access_requests a where a.applicant_user_id = '00000000-0000-4000-8000-0000000000a3';
  perform test_harness.record('F4 the applicant resubmits (INFO_REQUESTED to SUBMITTED, RESUBMITTED, version 3)',
    v_out = 'RESUBMITTED' and v_status = 'SUBMITTED' and v_version = 3, v_out || ' / ' || v_status || ' v' || v_version);
end $body$;
select test_harness.expect_raise('F5 a stale version is refused', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 2, %L, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'REJECT', 'x'),
  'VERSION_CONFLICT');
-- One write, then reads.
do $body$
declare
  v_out     text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000b3',
                      format('select (public.decide_access_request(%L::uuid, %L, 3, null, %L))->>''status''',
                        test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'APPROVE', 'Ready for provisioning review'));
  v_version integer;
begin
  select a.version into v_version from public.access_requests a
   where a.applicant_user_id = '00000000-0000-4000-8000-0000000000a3';
  perform test_harness.record('F6 pastor approves the subgroup admin request in its subgroup (APPROVAL_PENDING_PROVISIONING, version 4)',
    v_out = 'APPROVAL_PENDING_PROVISIONING' and v_version = 4, v_out || ' v' || v_version);
end $body$;

-- Approval records a state and nothing else.
select test_harness.record('F7 approval changes no profile role and creates no staff scope for the applicant',
  not exists (select 1 from public.profiles p where p.user_id = '00000000-0000-4000-8000-0000000000a3')
  and not exists (select 1 from public.staff_scope_assignments s where s.user_id = '00000000-0000-4000-8000-0000000000a3'));
select test_harness.record('F8 approval creates no teacher row and sends no email',
  (select count(*) from public.teachers) = 0
  and (select count(*) from public.email_queue q where q.metadata ->> 'source' = 'access_request') = 0);
select test_harness.record('F9 approval writes one event and one audit row attributed to the approver',
  (select count(*) from public.access_request_events e join public.access_requests a on a.id = e.request_id
    where a.applicant_user_id = '00000000-0000-4000-8000-0000000000a3' and e.action = 'APPROVE'
      and e.actor_id = '00000000-0000-4000-8000-0000000000b3') = 1
  and (select count(*) from public.audit_logs l where l.action = 'ACCESS_REQUEST_APPROVAL_PENDING_PROVISIONING'
        and l.details ->> 'actor_id' = '00000000-0000-4000-8000-0000000000b3') = 1);

select test_harness.expect_raise('F10 a pending request cannot be rejected', 'authenticated', '00000000-0000-4000-8000-0000000000b1',
  format('select public.decide_access_request(%L::uuid, %L, 4, %L, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'REJECT', 'x'),
  'INVALID_TRANSITION: APPROVAL_PENDING_PROVISIONING to REJECTED');
select test_harness.expect_raise('F11 a pending request cannot be withdrawn by the applicant', 'authenticated', '00000000-0000-4000-8000-0000000000a3',
  format('select public.withdraw_access_request(%L::uuid, 4)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3')),
  'INVALID_TRANSITION: APPROVAL_PENDING_PROVISIONING to WITHDRAWN');
select test_harness.expect_raise('F12 the applicant cannot file a second request while one is pending', 'authenticated', '00000000-0000-4000-8000-0000000000a3',
  $$select public.submit_access_request('subgroup_admin', 'Shared Sally', null, 'CMU', 'CE', 'CESGA', null)$$, 'APPLICATION_PENDING');
select test_harness.expect_raise('F13 APPROVED is not a reviewable action', 'authenticated', '00000000-0000-4000-8000-0000000000b1',
  format('select public.decide_access_request(%L::uuid, %L, 1, %L, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'APPROVED', 'x'),
  'INVALID_ACTION');

-- Other requests: organization-wide decisions only.
select test_harness.expect_raise('F14 a pastor is refused the other request approval', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 1, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'APPROVE'),
  'FORBIDDEN: not authorized to decide this request');
select test_harness.record('F15 superadmin requests information on the other request (version 2)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000b1',
    format('select (public.decide_access_request(%L::uuid, %L, 1, %L, null))->>''status''',
      test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'REQUEST_INFO', 'Which team?')) = 'INFO_REQUESTED');
select test_harness.record('F16 regional secretary approves the other request after the reply (APPROVAL_PENDING_PROVISIONING)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000b2',
    format('select (public.decide_access_request(%L::uuid, %L, 2, null, null))->>''status''',
      test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'APPROVE')) = 'APPROVAL_PENDING_PROVISIONING');

-- Rejection and the refused re-application it causes.
select test_harness.record('F17 pastor rejects the second-subgroup request with a reason (REJECTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000b3',
    format('select (public.decide_access_request(%L::uuid, %L, 1, %L, null))->>''status''',
      test_harness.req_id('00000000-0000-4000-8000-0000000000a4'), 'REJECT', 'Not in that subgroup')) = 'REJECTED');
select test_harness.expect_raise('F18 a rejected request cannot be approved afterwards', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 2, null, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a4'), 'APPROVE'),
  'INVALID_TRANSITION: REJECTED to APPROVAL_PENDING_PROVISIONING');
select test_harness.expect_raise('F19 a rejected applicant cannot re-file', 'authenticated', '00000000-0000-4000-8000-0000000000a4',
  $$select public.submit_access_request('subgroup_admin', 'Sga Two', null, 'YORK', 'CE', 'CESGB', null)$$, 'APPLICATION_NOT_ALLOWED');

-- Withdrawal: only the owner, and another person's request is reported as not found.
select test_harness.expect_raise('F20 another person cannot withdraw a request', 'authenticated', '00000000-0000-4000-8000-0000000000a5',
  format('select public.withdraw_access_request(%L::uuid, 1)', test_harness.req_id('00000000-0000-4000-8000-0000000000a2')),
  'APPLICATION_NOT_FOUND');
select test_harness.record('F21 the owner withdraws an open request (WITHDRAWN)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a2',
    format('select (public.withdraw_access_request(%L::uuid, 1))->>''status''',
      test_harness.req_id('00000000-0000-4000-8000-0000000000a2'))) = 'WITHDRAWN');

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Revocation, deactivation and role change remove authority at once
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('G1 before revocation the pastor sees both subgroup admin requests in its reviewer view',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b3',
    'select count(*) from public.access_requests_review', 2));
select test_harness.record('G2 superadmin revokes the pastor assignment for CE/CESGA',
  (select public.revoke_staff_scope('00000000-0000-4000-8000-0000000000b1',
     (select id from public.staff_scope_assignments
       where user_id = '00000000-0000-4000-8000-0000000000b3' and subgroup_id = 'CESGA' and active)))->>'outcome' = 'REVOKED');
select test_harness.record('G3a the pastor loses the revoked subgroup on the next call',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3') = 'false');
select test_harness.record('G3b the pastor keeps its remaining subgroup (CE/CESGB)',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a4') = 'true');
select test_harness.record('G4 after revocation only the remaining subgroup request is in the pastor reviewer view',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b3',
    'select count(*) from public.access_requests_review', 1));
select test_harness.expect_raise('G5 a pastor whose assignment was revoked cannot decide that request', 'authenticated', '00000000-0000-4000-8000-0000000000b3',
  format('select public.decide_access_request(%L::uuid, %L, 4, %L, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a3'), 'REJECT', 'x'),
  'FORBIDDEN: not authorized to decide this request');
select test_harness.record('G6a re-granting the pastor assignment for CE/CESGA succeeds',
  (select public.grant_staff_scope('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3', 'CE', 'CESGA'))->>'outcome' = 'GRANTED');
select test_harness.record('G6b the re-granted pastor regains the right',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a3') = 'true');

update public.profiles set is_active = false where user_id = '00000000-0000-4000-8000-0000000000b3';
select test_harness.record('G7 a deactivated pastor loses decision rights on the next call',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a4') = 'false');
update public.profiles set is_active = true where user_id = '00000000-0000-4000-8000-0000000000b3';
select test_harness.record('G8 reactivation restores the pastor right',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a4') = 'true');

update public.profiles set role = 'teacher' where user_id = '00000000-0000-4000-8000-0000000000b3';
select test_harness.record('G9 a pastor whose role changed away loses the subgroup right immediately',
  test_harness.can('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a4') = 'false');
update public.profiles set role = 'pastor' where user_id = '00000000-0000-4000-8000-0000000000b3';

-- ─────────────────────────────────────────────────────────────────────────────
-- H. The teacher flow (Phase 2) is still scoped, and admin and principal see nothing in it
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('H1 the subgroup admin sees the teacher application in its subgroup',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b4',
    'select count(*) from public.teacher_applications_review', 1));
select test_harness.record('H2 admin and principal see no teacher application',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b5',
    'select count(*) from public.teacher_applications_review', 0)
  and test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-0000000000b6',
    'select count(*) from public.teacher_applications_review', 0));
select test_harness.record('H3 the teacher applicant view now includes the chosen group and subgroup',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-0000000000a1',
    'select group_id || ''/'' || subgroup_id from public.teacher_applications_applicant') = 'CE/CESGA');

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Privileges and the approval boundary
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_raise('I1 anonymous caller cannot record a decision', 'anon', null,
  format('select public.decide_access_request(%L::uuid, %L, 1, %L, null)', test_harness.req_id('00000000-0000-4000-8000-0000000000a5'), 'REJECT', 'x'),
  'permission denied');
select test_harness.expect_raise('I2 anonymous caller cannot call the authority function', 'anon', null,
  format('select public.access_request_can_decide(%L::uuid)', test_harness.req_id('00000000-0000-4000-8000-0000000000a5')),
  'permission denied');
select test_harness.record('I3 no provisioning, activation or Nexus object exists in this phase',
  to_regclass('public.access_provisioning_jobs') is null
  and not exists (select 1 from pg_proc where proname ilike '%provision%' or proname ilike '%activate%' or proname ilike '%nexus%'));
select test_harness.expect_raise('I4 group_admin is still not an accepted profile role', 'postgres', null,
  $$update public.profiles set role = 'group_admin' where user_id = '00000000-0000-4000-8000-0000000000b7'$$,
  'new row for relation');
select test_harness.record('I5 no approval changed any profile role',
  (select count(*) = 0 from public.profiles p
    where p.role not in ('superadmin','regional_secretary','pastor','subgroup_admin','admin','principal','teacher','pending')));

-- Summary
select name, ok, detail from test_harness.results where not ok order by id;
select count(*) as total, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed
  from test_harness.results;
