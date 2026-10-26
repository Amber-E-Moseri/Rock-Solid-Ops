-- Authorization and lifecycle tests for the teacher-application foundation.
-- Runs after stubs.sql, the hardened teacher-link candidate (202605191330) and the new migrations.
-- Each check is recorded in test_harness.results; run.sh fails when any check is not ok.
--
-- Actor keys (fixed UUIDs):
--   A applicant, verified, profile pending          B applicant, verified, no profile edge cases
--   U unverified account                            P pending profile applicant
--   N verified account with no profile row          T active teacher profile
--   S pastor   R principal   G subgroup_admin       K regional_secretary
--   X admin (active)        Y superadmin (active)   C admin (is_active = false)
--   D same email as A, different account            Z email collides with active roster teacher

create schema test_harness;
create table test_harness.results (
  id     serial primary key,
  name   text not null,
  ok     boolean not null,
  detail text
);

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
  v_msg   text := null;
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

-- Passes when p_sql fails with the given SQLSTATE (for example 42501 = insufficient privilege).
create or replace function test_harness.expect_state(p_name text, p_role text, p_uid uuid, p_sql text, p_state text)
returns void
language plpgsql
as $$
declare
  v_msg   text := null;
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
    perform test_harness.record(p_name, false, 'no error raised; expected sqlstate ' || p_state);
  else
    perform test_harness.record(p_name, v_state = p_state, 'sqlstate ' || v_state || ': ' || v_msg);
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

-- True when the count query, run as p_role, returns p_expected rows-as-count.
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

-- The harness helpers reset the role themselves, so the impersonated role must be able to call them.
-- This grant exists only in the throwaway test database.
grant usage on schema test_harness to public;
grant execute on all functions in schema test_harness to public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed (as postgres): actors, profiles, fellowships and one active roster teacher
-- ─────────────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001', 'Applicant.A@Example.test',   now()),
  ('00000000-0000-4000-8000-000000000002', 'applicant.b@example.test',   now()),
  ('00000000-0000-4000-8000-000000000003', 'unverified@example.test',    null),
  ('00000000-0000-4000-8000-000000000004', 'pending.p@example.test',     now()),
  ('00000000-0000-4000-8000-000000000005', 'noprofile.n@example.test',   now()),
  ('00000000-0000-4000-8000-000000000006', 'teacher.t@example.test',     now()),
  ('00000000-0000-4000-8000-000000000007', 'pastor.s@example.test',      now()),
  ('00000000-0000-4000-8000-000000000008', 'principal.r@example.test',   now()),
  ('00000000-0000-4000-8000-000000000009', 'subgroup.g@example.test',    now()),
  ('00000000-0000-4000-8000-00000000000a', 'admin.x@example.test',       now()),
  ('00000000-0000-4000-8000-00000000000b', 'superadmin.y@example.test',  now()),
  ('00000000-0000-4000-8000-00000000000c', 'inactive.c@example.test',    now()),
  ('00000000-0000-4000-8000-00000000000d', 'regional.k@example.test',    now()),
  ('00000000-0000-4000-8000-00000000000e', 'applicant.a@example.test',   now()),
  ('00000000-0000-4000-8000-00000000000f', 'Teacher.Active@Example.test', now()),
  ('00000000-0000-4000-8000-000000000010', 'york.applicant@example.test', now()),
  ('00000000-0000-4000-8000-000000000011', 'APPLICANT.B@Example.test',    now());

insert into public.profiles (user_id, email, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000000001', 'applicant.a@example.test', 'Applicant Alpha', 'pending', true),
  ('00000000-0000-4000-8000-000000000002', 'applicant.b@example.test', 'Applicant Bravo', 'pending', true),
  ('00000000-0000-4000-8000-000000000003', 'unverified@example.test',  'Unverified',      'pending', true),
  ('00000000-0000-4000-8000-000000000004', 'pending.p@example.test',   'Pending Pat',     'pending', true),
  ('00000000-0000-4000-8000-000000000006', 'teacher.t@example.test',   'Teacher Tina',    'teacher', true),
  ('00000000-0000-4000-8000-000000000007', 'pastor.s@example.test',    'Pastor Sam',      'pastor',  true),
  ('00000000-0000-4000-8000-000000000008', 'principal.r@example.test', 'Principal Ruth',  'principal', true),
  ('00000000-0000-4000-8000-000000000009', 'subgroup.g@example.test',  'Group Gene',      'subgroup_admin', true),
  ('00000000-0000-4000-8000-00000000000a', 'admin.x@example.test',     'Admin Xavier',    'admin',   true),
  ('00000000-0000-4000-8000-00000000000b', 'superadmin.y@example.test','Super Yara',      'superadmin', true),
  ('00000000-0000-4000-8000-00000000000c', 'inactive.c@example.test',  'Inactive Cal',    'admin',   false),
  ('00000000-0000-4000-8000-00000000000d', 'regional.k@example.test',  'Regional Kim',    'regional_secretary', true),
  -- Same email as applicant B, different account. Holds a pastor assignment, so the no-self-approval
  -- by normalized email rule is tested against a real scope holder.
  ('00000000-0000-4000-8000-000000000011', 'APPLICANT.B@Example.test',  'Email Twin',      'pastor',  true);
-- N (…005) and D (…00e) and Z (…00f) have no profile row. Z is the roster teacher's account.

insert into public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, active) values
  ('CMU',     'Campus Alpha', 'CE', 'CESGA', true),
  ('YORK',    'York Campus',  'CE', 'CESGB', true),
  ('STOR',    'Storefront',   'CS', 'CSGA',  true),
  ('RETIRED', 'Old Campus',   'CE', 'CESGA', false);

insert into public.teachers (teacher_id, full_name, email, fellowship_code, status, active) values
  ('TCH-ACTIVE', 'Active Teacher', 'teacher.active@example.test', 'CMU', 'ACTIVE', true);

-- The hardened teacher-link candidate under test. Loaded verbatim from main, not re-typed.
\i ../../migrations/202605191330_safe_teacher_auth_linking.sql

-- Request Access Phase 1: org_subgroups (seeded from the fellowship rows above) and scope assignments.
\i ../../migrations/202610250100_org_subgroups.sql
\i ../../migrations/202610250200_staff_scope_assignments.sql

-- The new foundation.
\i ../../migrations/202610230100_teacher_applications_foundation.sql
\i ../../migrations/202610230200_teacher_application_email_templates.sql

-- Request Access Phase 2: group and subgroup scope for this workflow.
\i ../../migrations/202610250300_teacher_applications_scope.sql

-- Subgroup assignments that the scope tests rely on. Granted through the audited management contract.
--   pastor S (…07): CE/CESGA and CE/CESGB (multi-subgroup)
--   subgroup_admin G (…09): CE/CESGA only
--   pastor-with-same-email-as-applicant-B (…11): CE/CESGA
select public.grant_staff_scope('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000007', 'CE', 'CESGA');
select public.grant_staff_scope('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000007', 'CE', 'CESGB');
select public.grant_staff_scope('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-000000000009', 'CE', 'CESGA');
select public.grant_staff_scope('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000011', 'CE', 'CESGA');

-- Test-only lookup of an applicant's application id. Definer-owned, so it works while the caller is
-- an application role that cannot read the base table.
create or replace function test_harness.app_id(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select a.id into v_id
  from public.teacher_applications a
  where a.applicant_user_id = p_user
  order by a.submitted_at desc
  limit 1;
  return v_id;
end;
$$;
grant execute on function test_harness.app_id(uuid) to public;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Privileges and RLS baseline
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('A1 RLS is enabled on teacher_applications',
  (select relrowsecurity from pg_class where oid = 'public.teacher_applications'::regclass));

select test_harness.expect_state('A2 anon cannot read applications', 'anon', null,
  'select count(*) from public.teacher_applications', '42501');

select test_harness.expect_state('A3 anon cannot insert an application', 'anon', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at)
    values ('00000000-0000-4000-8000-000000000001', 'x@example.test', 'x@example.test', 'Anon Insert', 'CMU', now())$$, '42501');

select test_harness.expect_state('A4 anon cannot call submit_teacher_application', 'anon', null,
  $$select public.submit_teacher_application('Anon Person', null, 'CMU', null, 'CE', 'CESGA')$$, '42501');

select test_harness.expect_state('A5 anon cannot call review_teacher_application', 'anon', null,
  $$select public.review_teacher_application('00000000-0000-4000-8000-0000000000ff', 'REJECT', 1, 'x')$$, '42501');

select test_harness.expect_state('A6 anon cannot call withdraw_teacher_application', 'anon', null,
  $$select public.withdraw_teacher_application('00000000-0000-4000-8000-0000000000ff', 1)$$, '42501');

select test_harness.expect_state('A7 anon cannot call the reviewer helper', 'anon', null,
  $$select public.teacher_application_reviewer()$$, '42501');

select test_harness.expect_state('A8 authenticated cannot insert directly', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at)
    values ('00000000-0000-4000-8000-000000000001', 'direct@example.test', 'direct@example.test', 'Direct Insert', 'CMU', now())$$, '42501');

select test_harness.expect_state('A9 authenticated cannot call the outbox helper', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.enqueue_teacher_application_email(null, 'teacher_application_received', 'a@example.test', 'A', 'forged:key')$$, '42501');

select test_harness.expect_state('A10 authenticated cannot read auth.users directly', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select count(*) from auth.users$$, '42501');

select test_harness.expect_state('A11 anon cannot execute the trigger helper directly', 'anon', null,
  $$select public.teacher_applications_set_updated_at()$$, '42501');

select test_harness.expect_state('A12 anon cannot execute the lifecycle contract function', 'anon', null,
  $$select public.teacher_application_transition_allowed('SUBMITTED', 'REJECTED')$$, '42501');

select test_harness.expect_state('A13 authenticated cannot execute the trigger helper directly', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.teacher_applications_set_updated_at()$$, '42501');

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Applicant identity, submission and duplicate handling
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('B1 no session cannot submit',
  test_harness.text_as('authenticated', null,
    $$select (public.submit_teacher_application('Nobody Here', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) like 'ERROR: UNAUTHENTICATED%');

select test_harness.expect_raise('B2 unverified account cannot submit', 'authenticated', '00000000-0000-4000-8000-000000000003',
  $$select public.submit_teacher_application('Unverified Person', null, 'CMU', null, 'CE', 'CESGA')$$, 'EMAIL_NOT_VERIFIED');

select test_harness.expect_raise('B3 unknown fellowship is refused', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Applicant Alpha', null, 'NOSUCH', null, 'CE', 'CESGA')$$, 'INVALID_FELLOWSHIP');

select test_harness.expect_raise('B4 retired fellowship is refused', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Applicant Alpha', null, 'RETIRED', null, 'CE', 'CESGA')$$, 'INVALID_FELLOWSHIP');

select test_harness.expect_raise('B5 one-character name is refused', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('A', null, 'CMU', null, 'CE', 'CESGA')$$, 'INVALID_FULL_NAME');

-- Applicant A is a verified account whose profile is still 'pending'.
select test_harness.record('B6 pending-profile applicant submits (outcome SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000001',
    $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'cmu', 'first notes', 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED');

select test_harness.record('B7 stored email comes from Auth, lowercased, not from the client',
  (select a.email = 'applicant.a@example.test' and a.email_normalized = 'applicant.a@example.test'
          and a.email_verified_at is not null and a.fellowship_code = 'CMU'
     from public.teacher_applications a
    where a.applicant_user_id = '00000000-0000-4000-8000-000000000001'));

-- Each check performs its write first, in its own statement, and only then reads state. A scalar
-- subquery chain in one SELECT does not guarantee evaluation order, so reads must not share a statement
-- with the call they depend on.
do $body$
declare
  v_out     text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000001',
                      $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'CMU', 'first notes', 'CE', 'CESGA'))->>'outcome'$$);
  v_version integer;
  v_audits  bigint;
  v_emails  bigint;
begin
  select a.version into v_version from public.teacher_applications a where a.applicant_user_id = '00000000-0000-4000-8000-000000000001';
  select count(*) into v_audits from public.audit_logs l where l.action = 'TEACHER_APPLICATION_SUBMITTED';
  select count(*) into v_emails from public.email_queue q where q.metadata ->> 'source' = 'teacher_application';
  perform test_harness.record('B8 identical retry is UNCHANGED: same version, no new audit, no new email',
    v_out = 'UNCHANGED' and v_version = 1 and v_audits = 1 and v_emails = 1, v_out);
end $body$;

do $body$
declare
  v_out     text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000001',
                      $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'CMU', 'edited notes', 'CE', 'CESGA'))->>'outcome'$$);
  v_version integer;
  v_emails  bigint;
begin
  select a.version into v_version from public.teacher_applications a where a.applicant_user_id = '00000000-0000-4000-8000-000000000001';
  select count(*) into v_emails from public.email_queue q where q.metadata ->> 'source' = 'teacher_application';
  perform test_harness.record('B9 a changed edit is UPDATED: version bumps, no second confirmation email',
    v_out = 'UPDATED' and v_version = 2 and v_emails = 1, v_out);
end $body$;

-- Email-level duplicate from a different account: the unique open-email index is the backstop.
select test_harness.expect_raise('B10 second open application for the same email is refused', 'authenticated', '00000000-0000-4000-8000-00000000000e',
  $$select public.submit_teacher_application('Duplicate Dee', null, 'CMU', null, 'CE', 'CESGA')$$, 'DUPLICATE_OPEN_APPLICATION');

select test_harness.record('B11 applicant B submits',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000002',
    $$select (public.submit_teacher_application('Applicant Bravo', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED');

-- Pending profile and no-profile accounts may apply, but gain nothing from it.
select test_harness.record('B12 pending profile P applies and stays pending',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000004',
    $$select (public.submit_teacher_application('Pending Pat', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED'
  and (select p.role from public.profiles p where p.user_id = '00000000-0000-4000-8000-000000000004') = 'pending');

select test_harness.record('B13 verified account with no profile row applies (outcome SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000005',
    $$select (public.submit_teacher_application('Noprofile Nina', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED'
  and not exists (select 1 from public.profiles p where p.user_id = '00000000-0000-4000-8000-000000000005'));

select test_harness.expect_raise('B14 address already on the active roster is refused', 'authenticated', '00000000-0000-4000-8000-00000000000f',
  $$select public.submit_teacher_application('Teacher Zed', null, 'CMU', null, 'CE', 'CESGA')$$, 'ALREADY_TEACHER');

-- Superadmin applies too, so the self-review test in section C has an application to target.
select test_harness.record('B15 superadmin Y submits own application',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000b',
    $$select (public.submit_teacher_application('Super Yara', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED');

-- Row visibility under RLS: each applicant sees only their own row.
select test_harness.record('B16 applicant A sees exactly their own row',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000001',
    'select count(*) from public.teacher_applications_applicant', 1));

select test_harness.record('B17 applicant B sees exactly their own row',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000002',
    'select count(*) from public.teacher_applications_applicant', 1));

select test_harness.expect_state('B18 applicant cannot update their own row directly', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$update public.teacher_applications set status = 'APPROVED', approved_teacher_id = 'TCH-ACTIVE'
     where applicant_user_id = '00000000-0000-4000-8000-000000000001'$$, '42501');

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Review authority and transitions
-- ─────────────────────────────────────────────────────────────────────────────

-- Every non-reviewer is refused before any application is read. Actor order: A, B, P, N, T, S, R, G, K, C.
do $body$
declare
  v_app uuid := test_harness.app_id('00000000-0000-4000-8000-000000000001');
  v_actor record;
begin
  for v_actor in
    select * from (values
      ('C1 applicant A cannot review their own application',    'authenticated', '00000000-0000-4000-8000-000000000001'::uuid),
      ('C2 applicant B cannot review another application',      'authenticated', '00000000-0000-4000-8000-000000000002'::uuid),
      ('C3 pending profile P cannot review',                    'authenticated', '00000000-0000-4000-8000-000000000004'::uuid),
      ('C4 no-profile account N cannot review',                 'authenticated', '00000000-0000-4000-8000-000000000005'::uuid),
      ('C5 active teacher T cannot review',                     'authenticated', '00000000-0000-4000-8000-000000000006'::uuid),
      ('C6 admin X cannot review (admin has no approval rights)', 'authenticated', '00000000-0000-4000-8000-00000000000a'::uuid),
      ('C7 principal R cannot review',                          'authenticated', '00000000-0000-4000-8000-000000000008'::uuid),
      ('C10 admin with is_active=false cannot review',          'authenticated', '00000000-0000-4000-8000-00000000000c'::uuid)
    ) as t(name, role, uid)
  loop
    perform test_harness.expect_raise(v_actor.name, v_actor.role, v_actor.uid,
      format('select public.review_teacher_application(%L::uuid, %L, 1, %L)', v_app, 'REQUEST_INFO', 'Please confirm your address'),
      'FORBIDDEN:');
  end loop;
end $body$;

select test_harness.expect_raise('C11 non-reviewer cannot approve', 'authenticated', '00000000-0000-4000-8000-000000000006',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'APPROVE', 'approve'),
  'FORBIDDEN');

select test_harness.expect_raise('C12 regional secretary request needs a message', 'authenticated', '00000000-0000-4000-8000-00000000000d',
  format('select public.review_teacher_application(%L::uuid, %L, 1, null)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'REQUEST_INFO'),
  'MESSAGE_REQUIRED');

select test_harness.expect_raise('C13 stale version is refused', 'authenticated', '00000000-0000-4000-8000-00000000000d',
  format('select public.review_teacher_application(%L::uuid, %L, 99, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'REQUEST_INFO', 'Please confirm your address'),
  'VERSION_CONFLICT');

select test_harness.expect_raise('C14 admin cannot approve (no approval rights)', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'APPROVE', 'approve'),
  'FORBIDDEN:');

select test_harness.expect_raise('C15 principal cannot approve (no approval rights)', 'authenticated', '00000000-0000-4000-8000-000000000008',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'APPROVE', 'approve'),
  'FORBIDDEN:');

select test_harness.expect_raise('C16 unknown action is refused', 'authenticated', '00000000-0000-4000-8000-00000000000d',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'DELETE', 'x'),
  'INVALID_ACTION');

select test_harness.record('C17 regional secretary requests information (SUBMITTED to INFO_REQUESTED, version 2)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000d',
    format('select (public.review_teacher_application(%L::uuid, %L, 2, %L))->>''status''',
      test_harness.app_id('00000000-0000-4000-8000-000000000001'),
      'REQUEST_INFO', 'Please confirm your fellowship leader')) = 'INFO_REQUESTED');

select test_harness.record('C18 request message is stored as applicant-visible review_message',
  (select a.review_message = 'Please confirm your fellowship leader' and a.version = 3
     from public.teacher_applications a where a.applicant_user_id = '00000000-0000-4000-8000-000000000001'));

select test_harness.expect_raise('C19 reviewer cannot decide their own application', 'authenticated', '00000000-0000-4000-8000-00000000000b',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-00000000000b'),
    'REJECT', 'self'),
  'FORBIDDEN: reviewers cannot decide their own application');

-- Applicant answers the request: INFO_REQUESTED -> SUBMITTED, reported as RESUBMITTED.
do $body$
declare
  v_out     text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000001',
                      $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'CMU', 'edited notes', 'CE', 'CESGA'))->>'outcome'$$);
  v_status  text;
  v_version integer;
begin
  select a.status, a.version into v_status, v_version from public.teacher_applications a
   where a.applicant_user_id = '00000000-0000-4000-8000-000000000001';
  perform test_harness.record('C20 applicant resubmits after a request (RESUBMITTED, version 4)',
    v_out = 'RESUBMITTED' and v_status = 'SUBMITTED' and v_version = 4, v_out);
end $body$;

select test_harness.record('C21 resubmission sends one new confirmation email for that version',
  (select count(*) = 2 from public.email_queue q
    where q.template_key = 'teacher_application_received'
      and q.metadata ->> 'application_id' = (select a.id::text from public.teacher_applications a
                                              where a.applicant_user_id = '00000000-0000-4000-8000-000000000001')));

-- Superadmin rejects the application. The reason stays internal.
select test_harness.record('C22 superadmin rejects (SUBMITTED to REJECTED, version 5)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000b',
    format('select (public.review_teacher_application(%L::uuid, %L, 4, %L))->>''status''',
      test_harness.app_id('00000000-0000-4000-8000-000000000001'),
      'REJECT', 'Internal: duplicate of an earlier registration')) = 'REJECTED');

select test_harness.record('C23 rejection reason is stored internally, with reviewer attribution',
  (select a.rejection_reason like 'Internal:%' and a.reviewed_by = '00000000-0000-4000-8000-00000000000b'
          and a.reviewed_at is not null
     from public.teacher_applications a where a.applicant_user_id = '00000000-0000-4000-8000-000000000001'));

select test_harness.record('C24 rejection email uses the generic template and carries no reviewer text',
  (select count(*) = 1
          and bool_and(q.payload::text not like '%Internal%')
          and bool_and(q.metadata ->> 'source' = 'teacher_application')
     from public.email_queue q where q.template_key = 'teacher_application_rejected'));

select test_harness.record('C25 review writes an audit row with the decision and no message text',
  (select count(*) = 1 from public.audit_logs l
    where l.action = 'TEACHER_APPLICATION_REJECTED' and l.entity_id = (
      select a.id::text from public.teacher_applications a where a.applicant_user_id = '00000000-0000-4000-8000-000000000001')
      and l.details ->> 'to_status' = 'REJECTED'
      and not (l.details::text like '%Internal%')));

select test_harness.expect_raise('C26 a rejected application cannot be moved to info-requested', 'authenticated', '00000000-0000-4000-8000-00000000000d',
  format('select public.review_teacher_application(%L::uuid, %L, 5, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'REQUEST_INFO', 'again'),
  'INVALID_TRANSITION: REJECTED to INFO_REQUESTED');

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Post-decision lifecycle, withdrawal and re-application
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_raise('D1 rejected applicant cannot re-apply until an administrator decides', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Applicant Alpha', null, 'CMU', null, 'CE', 'CESGA')$$, 'APPLICATION_NOT_ALLOWED');

select test_harness.expect_raise('D2 a non-owner cannot withdraw someone else''s application', 'authenticated', '00000000-0000-4000-8000-000000000002',
  format('select public.withdraw_teacher_application(%L::uuid, 1)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001')),
  'APPLICATION_NOT_FOUND');

select test_harness.record('D3 applicant B withdraws their own application',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000002',
    format('select (public.withdraw_teacher_application(%L::uuid, 1))->>''status''',
      test_harness.app_id('00000000-0000-4000-8000-000000000002'))) = 'WITHDRAWN');

select test_harness.expect_raise('D4 a withdrawn application cannot be withdrawn again', 'authenticated', '00000000-0000-4000-8000-000000000002',
  format('select public.withdraw_teacher_application(%L::uuid, 2)',
    test_harness.app_id('00000000-0000-4000-8000-000000000002')),
  'INVALID_TRANSITION: WITHDRAWN to WITHDRAWN');

do $body$
declare
  v_out  text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000002',
                   $$select (public.submit_teacher_application('Applicant Bravo', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$);
  v_rows bigint;
begin
  select count(*) into v_rows from public.teacher_applications a where a.applicant_user_id = '00000000-0000-4000-8000-000000000002';
  perform test_harness.record('D5 after withdrawal, applicant B applies again as a new application',
    v_out = 'SUBMITTED' and v_rows = 2, v_out);
end $body$;

select test_harness.expect_raise('D6 stale version on withdrawal is refused', 'authenticated', '00000000-0000-4000-8000-000000000004',
  format('select public.withdraw_teacher_application(%L::uuid, 99)',
    test_harness.app_id('00000000-0000-4000-8000-000000000004')),
  'VERSION_CONFLICT');

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Outbox: dedupe and template contract
-- ─────────────────────────────────────────────────────────────────────────────

do $body$
declare
  v_rows bigint;
begin
  perform public.enqueue_teacher_application_email(null, 'teacher_application_received', 'retry@example.test', 'Retry', 'test:dedupe:1');
  perform public.enqueue_teacher_application_email(null, 'teacher_application_received', 'retry@example.test', 'Retry', 'test:dedupe:1');
  select count(*) into v_rows from public.email_queue q where q.metadata ->> 'dedupe_key' = 'test:dedupe:1';
  perform test_harness.record('E1 outbox dedupe: the same key enqueued twice yields one row', v_rows = 1, v_rows::text);
end $body$;

select test_harness.record('E2 each new template key exists in notification_templates and the email_templates mirror',
  (select count(*) = 3 from public.notification_templates n
     join public.email_templates e using (template_key)
    where n.template_key in ('teacher_application_received', 'teacher_application_info_requested', 'teacher_application_rejected')
      and n.active));

select test_harness.record('E3 template bodies carry no reviewer free text placeholder',
  (select bool_and(body_html not like '%{{message}}%' and body_html not like '%{{reason}}%' and body_html not like '%{{review%')
     from public.notification_templates
    where template_key like 'teacher_application_%'));

select test_harness.record('E4 every application-sourced queue row has an existing template key',
  (select bool_and(exists (select 1 from public.email_templates e where e.template_key = q.template_key))
     from public.email_queue q where q.metadata ->> 'source' = 'teacher_application'));

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Roster isolation and the link contract
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.record('F1 application activity never created or changed a roster row',
  (select count(*) = 1 from public.teachers)
  and (select count(*) = 0 from public.teachers t
        where t.teacher_user_id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
                                    '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000b')));

select test_harness.record('F2 applicant profiles keep their non-elevated role',
  (select bool_and(p.role = 'pending') from public.profiles p
    where p.user_id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
                        '00000000-0000-4000-8000-000000000004')));

select test_harness.expect_raise('F3 applicant cannot link any account to the roster', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.link_teacher_to_auth_user('TCH-ACTIVE', '00000000-0000-4000-8000-000000000001', 'applicant', false)$$,
  'FORBIDDEN: admin role required');

select test_harness.expect_raise('F4 admin cannot link an application-only identity: no roster row exists', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  $$select public.link_teacher_to_auth_user('TCH-NONE', '00000000-0000-4000-8000-000000000002', 'admin', false)$$,
  'TEACHER_NOT_FOUND');

select test_harness.expect_raise('F5 admin cannot attach an applicant to an unrelated roster row (email must match)', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  $$select public.link_teacher_to_auth_user('TCH-ACTIVE', '00000000-0000-4000-8000-000000000002', 'admin', false)$$,
  'EMAIL_MISMATCH');

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Data-model constraints (as postgres, bypassing RLS)
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_state('G1 email_normalized must be lowercase and trimmed', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, status, group_id, subgroup_id)
    values ('00000000-0000-4000-8000-00000000000f', 'Mixed@Example.test', 'Mixed@Example.test', 'Mixed Case', 'CMU', now(), 'WITHDRAWN', 'CE', 'CESGA')$$, '23514');

select test_harness.expect_state('G2 unknown status is refused', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, status, group_id, subgroup_id)
    values ('00000000-0000-4000-8000-00000000000f', 'z@example.test', 'z@example.test', 'Zed Zero', 'CMU', now(), 'DRAFT', 'CE', 'CESGA')$$, '23514');

select test_harness.expect_state('G3 APPROVED requires a linked roster id', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, status, reviewed_at, reviewed_by, group_id, subgroup_id)
    values ('00000000-0000-4000-8000-00000000000f', 'z@example.test', 'z@example.test', 'Zed Zero', 'CMU', now(), 'APPROVED', now(), '00000000-0000-4000-8000-00000000000b', 'CE', 'CESGA')$$, '23514');

select test_harness.expect_state('G4 a second open application for one email is refused by the index', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, group_id, subgroup_id)
    values ('00000000-0000-4000-8000-00000000000f', 'applicant.b@example.test', 'applicant.b@example.test', 'Second Open', 'CMU', now(), 'CE', 'CESGA')$$, '23505');

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Read surfaces: the applicant view and the reviewer view
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_state('H1 authenticated cannot read the base table', 'authenticated', '00000000-0000-4000-8000-000000000001',
  'select count(*) from public.teacher_applications', '42501');

select test_harness.record('H2 applicant view exposes no internal columns',
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'public' and table_name = 'teacher_applications_applicant'
      and column_name in ('rejection_reason', 'reviewed_by', 'reviewed_at', 'applicant_user_id',
                          'email_normalized', 'approved_teacher_id', 'email_verified_at')));

select test_harness.record('I1 audit rows carry the actor in details, with no actor_id column present',
  (select not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_id')
      and (select count(*) >= 1 from public.audit_logs l
            where l.action like 'TEACHER_APPLICATION_%'
              and l.details ->> 'actor_id' = '00000000-0000-4000-8000-000000000001')));

select test_harness.record('H3 applicant view shows only the caller''s own row',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000001',
    'select count(*) from public.teacher_applications_applicant', 1));

select test_harness.record('H4 reviewer view returns every row to a regional secretary',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000d',
    'select count(*)::text from public.teacher_applications_review')
  = (select count(*)::text from public.teacher_applications));

select test_harness.record('H5 reviewer view is empty for a principal (no scope)',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000008',
    'select count(*) from public.teacher_applications_review', 0));

select test_harness.record('H6 reviewer view is empty for the applicant',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000001',
    'select count(*) from public.teacher_applications_review', 0));

select test_harness.record('H7 reviewer view is empty for an admin whose profile is inactive',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-00000000000c',
    'select count(*) from public.teacher_applications_review', 0));

select test_harness.record('H8 reviewer view carries the internal rejection reason for a regional secretary',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000d',
    'select rejection_reason from public.teacher_applications_review where applicant_user_id = ''00000000-0000-4000-8000-000000000001''') like 'Internal:%');

select test_harness.expect_state('H9 anon cannot read the applicant view', 'anon', null,
  'select count(*) from public.teacher_applications_applicant', '42501');

select test_harness.expect_state('H10 anon cannot read the reviewer view', 'anon', null,
  'select count(*) from public.teacher_applications_review', '42501');

-- ─────────────────────────────────────────────────────────────────────────────
-- J. Phase 2: scope-based decisions, self-approval, transitions and the APPROVE boundary
-- Actors: S pastor (…07; CE/CESGA and CE/CESGB), G subgroup_admin (…09; CE/CESGA), K regional secretary (…0d),
--         Y superadmin (…0b), X admin (…0a), R principal (…08), T teacher (…06), P pending (…04),
--         C inactive admin (…0c), N no profile (…05), E pastor with the same email as applicant B (…11),
--         York applicant (…10; CE/CESGB, submitted below).

create or replace function test_harness.can_decide(p_actor uuid, p_applicant uuid)
returns text
language sql
as $$
  select test_harness.text_as('authenticated', p_actor,
    format('select public.teacher_application_can_decide(%L::uuid)', test_harness.app_id(p_applicant)));
$$;

select test_harness.record('J0 York applicant submits to CE/CESGB (outcome SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000010',
    $$select (public.submit_teacher_application('York Yolanda', null, 'YORK', null, 'CE', 'CESGB'))->>'outcome'$$) = 'SUBMITTED');

-- Scope: multi-subgroup authority, cross-subgroup denial, organization-wide authority
select test_harness.record('J1 pastor S decides the CE/CESGB application (second subgroup of a two-subgroup grant)',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000010') = 'true');
select test_harness.record('J2 pastor S decides Pending Pat''s CE/CESGA application',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000004') = 'true');
select test_harness.record('J3 subgroup admin G decides Pending Pat''s CE/CESGA application',
  test_harness.can_decide('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000004') = 'true');
select test_harness.record('J4 subgroup admin G is denied the CE/CESGB application (cross-subgroup)',
  test_harness.can_decide('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000010') = 'false');
select test_harness.record('J5 regional secretary K decides the CE/CESGB application (organization-wide)',
  test_harness.can_decide('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-000000000010') = 'true');
select test_harness.record('J6 superadmin Y decides the CE/CESGB application (organization-wide)',
  test_harness.can_decide('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000010') = 'true');

-- No decision rights without an assignment or org-wide role
select test_harness.record('J7 principal R has no decision rights',
  test_harness.can_decide('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000004') = 'false');
select test_harness.record('J8 admin X has no decision rights',
  test_harness.can_decide('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000004') = 'false');
select test_harness.record('J9 inactive admin C has no decision rights',
  test_harness.can_decide('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-000000000004') = 'false');
select test_harness.record('J10 teacher T has no decision rights',
  test_harness.can_decide('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004') = 'false');
select test_harness.record('J11 pending applicant P cannot decide their own application',
  test_harness.can_decide('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004') = 'false');

-- No self-approval by normalized email: E holds a real CE/CESGA assignment, but shares applicant B's email
select test_harness.record('J12a a pastor whose email matches the applicant is denied (normalized email self-approval)',
  test_harness.can_decide('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002') = 'false');
select test_harness.record('J12b the same pastor is allowed on a CE/CESGA application for another person (the denial is the email rule)',
  test_harness.can_decide('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000004') = 'true');

-- No self-approval by user id, for a scoped pastor who applies for themselves
select test_harness.record('J13a pastor S submits their own application to CE/CESGA (outcome SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000007',
    $$select (public.submit_teacher_application('Pastor Sam', null, 'CMU', null, 'CE', 'CESGA'))->>'outcome'$$) = 'SUBMITTED');
select test_harness.record('J13b pastor S cannot decide their own application despite holding CE/CESGA',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007') = 'false');
select test_harness.expect_raise('J13c pastor S approving their own application is refused', 'authenticated', '00000000-0000-4000-8000-000000000007',
  format('select public.review_teacher_application(%L::uuid, %L, 1, null)',
    test_harness.app_id('00000000-0000-4000-8000-000000000007'), 'APPROVE'),
  'FORBIDDEN: reviewers cannot decide their own application');

-- Approval: recorded as APPROVAL_PENDING_PROVISIONING, with no role, roster or email side effect
do $body$
declare
  v_out     text := test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000009',
                      format('select (public.review_teacher_application(%L::uuid, %L, 1, null))->>''status''',
                        test_harness.app_id('00000000-0000-4000-8000-000000000004'), 'APPROVE'));
  v_audits  bigint;
  v_version integer;
begin
  select a.version into v_version from public.teacher_applications a
   where a.applicant_user_id = '00000000-0000-4000-8000-000000000004';
  select count(*) into v_audits from public.audit_logs l
   where l.action = 'TEACHER_APPLICATION_APPROVAL_PENDING_PROVISIONING'
     and l.details ->> 'actor_id' = '00000000-0000-4000-8000-000000000009';
  perform test_harness.record('J14 subgroup admin G approves Pending Pat (APPROVAL_PENDING_PROVISIONING, version 2)',
    v_out = 'APPROVAL_PENDING_PROVISIONING' and v_version = 2, v_out);
  perform test_harness.record('J15 the approval writes one audit row attributed to the approver',
    v_audits = 1, 'audit rows ' || v_audits);
end $body$;

do $body$
declare
  v_teachers bigint;
  v_emails   bigint;
begin
  select count(*) into v_teachers from public.teachers;
  select count(*) into v_emails from public.email_queue q
   where q.metadata ->> 'application_id' = (select a.id::text from public.teacher_applications a
                                             where a.applicant_user_id = '00000000-0000-4000-8000-000000000004')
     and q.template_key <> 'teacher_application_received';
  perform test_harness.record('J16 approval changes no role, creates no roster row and sets no approved_teacher_id',
    (select p.role from public.profiles p where p.user_id = '00000000-0000-4000-8000-000000000004') = 'pending'
    and v_teachers = 1
    and (select a.approved_teacher_id is null from public.teacher_applications a
          where a.applicant_user_id = '00000000-0000-4000-8000-000000000004'),
    'teachers ' || v_teachers);
  perform test_harness.record('J17 approval sends no applicant email (only the submission receipt exists)',
    v_emails = 0, 'non-receipt rows ' || v_emails);
end $body$;

-- Once pending, nothing moves the application except provisioning (not implemented here)
select test_harness.expect_raise('J18 a pending application cannot be rejected', 'authenticated', '00000000-0000-4000-8000-00000000000b',
  format('select public.review_teacher_application(%L::uuid, %L, 2, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000004'), 'REJECT', 'x'),
  'INVALID_TRANSITION: APPROVAL_PENDING_PROVISIONING to REJECTED');
select test_harness.expect_raise('J19 a pending application cannot be sent back for information', 'authenticated', '00000000-0000-4000-8000-00000000000d',
  format('select public.review_teacher_application(%L::uuid, %L, 2, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000004'), 'REQUEST_INFO', 'x'),
  'INVALID_TRANSITION: APPROVAL_PENDING_PROVISIONING to INFO_REQUESTED');
select test_harness.expect_raise('J20 the applicant cannot withdraw a pending application', 'authenticated', '00000000-0000-4000-8000-000000000004',
  format('select public.withdraw_teacher_application(%L::uuid, 2)',
    test_harness.app_id('00000000-0000-4000-8000-000000000004')),
  'INVALID_TRANSITION: APPROVAL_PENDING_PROVISIONING to WITHDRAWN');
select test_harness.expect_raise('J21 the applicant cannot submit a second application while one is pending', 'authenticated', '00000000-0000-4000-8000-000000000004',
  $$select public.submit_teacher_application('Pending Pat', null, 'CMU', null, 'CE', 'CESGA')$$,
  'APPLICATION_PENDING');

-- The APPROVED path stays refused, and the lifecycle contract cannot reach it from pending
select test_harness.expect_raise('J22 APPROVED is not an accepted review action', 'authenticated', '00000000-0000-4000-8000-00000000000d',
  format('select public.review_teacher_application(%L::uuid, %L, 2, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000004'), 'APPROVED', 'x'),
  'INVALID_ACTION');
select test_harness.record('J23 the lifecycle contract does not allow APPROVAL_PENDING_PROVISIONING to APPROVED',
  not public.teacher_application_transition_allowed('APPROVAL_PENDING_PROVISIONING', 'APPROVED'));

-- Scope denial at approval time, and the no-self-approval rule for an applicant
select test_harness.expect_raise('J24 subgroup admin G cannot approve the CE/CESGB application', 'authenticated', '00000000-0000-4000-8000-000000000009',
  format('select public.review_teacher_application(%L::uuid, %L, 1, null)',
    test_harness.app_id('00000000-0000-4000-8000-000000000010'), 'APPROVE'),
  'FORBIDDEN: not authorized to decide this application');
select test_harness.expect_raise('J25 York applicant cannot approve their own application', 'authenticated', '00000000-0000-4000-8000-000000000010',
  format('select public.review_teacher_application(%L::uuid, %L, 1, null)',
    test_harness.app_id('00000000-0000-4000-8000-000000000010'), 'APPROVE'),
  'FORBIDDEN: reviewers cannot decide their own application');

-- Multi-subgroup pastor approves in the second subgroup
select test_harness.record('J26 pastor S approves the CE/CESGB application (APPROVAL_PENDING_PROVISIONING)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000007',
    format('select (public.review_teacher_application(%L::uuid, %L, 1, null))->>''status''',
      test_harness.app_id('00000000-0000-4000-8000-000000000010'), 'APPROVE')) = 'APPROVAL_PENDING_PROVISIONING');

-- Revocation removes authority at once; re-granting restores it
select test_harness.record('J27a revoking S''s CE/CESGB assignment succeeds',
  (select public.revoke_staff_scope('00000000-0000-4000-8000-00000000000b',
     (select id from public.staff_scope_assignments
       where user_id = '00000000-0000-4000-8000-000000000007' and subgroup_id = 'CESGB' and active)))->>'outcome' = 'REVOKED');
select test_harness.record('J27b pastor S loses the revoked subgroup on the next call',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000010') = 'false');
select test_harness.record('J27c pastor S keeps the remaining CE/CESGA subgroup',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000005') = 'true');
select test_harness.expect_raise('J28 a revoked pastor cannot act on the revoked subgroup', 'authenticated', '00000000-0000-4000-8000-000000000007',
  format('select public.review_teacher_application(%L::uuid, %L, 2, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000010'), 'REJECT', 'x'),
  'FORBIDDEN: not authorized to decide this application');
select test_harness.record('J29 re-granting the CE/CESGB subgroup restores the right',
  (select public.grant_staff_scope('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000007', 'CE', 'CESGB'))->>'outcome' = 'GRANTED'
  and test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000010') = 'true');

-- Inactive and role-changed profiles lose authority immediately
update public.profiles set is_active = false where user_id = '00000000-0000-4000-8000-000000000009';
select test_harness.record('J30a a deactivated subgroup admin loses decision rights on the next call',
  test_harness.can_decide('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000004') = 'false');
update public.profiles set is_active = true where user_id = '00000000-0000-4000-8000-000000000009';
select test_harness.record('J30b reactivation restores the assignment-backed right',
  test_harness.can_decide('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000004') = 'true');

update public.profiles set role = 'teacher' where user_id = '00000000-0000-4000-8000-000000000007';
select test_harness.record('J31a a pastor whose role changed away loses the scope immediately',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000005') = 'false');
update public.profiles set role = 'pastor' where user_id = '00000000-0000-4000-8000-000000000007';
select test_harness.record('J31b restoring the role restores the scope',
  test_harness.can_decide('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000005') = 'true');

-- Invalid group and subgroup combinations are refused at submission (applicant D, email not yet used here)
select test_harness.expect_raise('J32a a subgroup from a different group is refused (STOR is CS/CSGA, submitted as CE)', 'authenticated', '00000000-0000-4000-8000-00000000000e',
  $$select public.submit_teacher_application('Scope Probe', null, 'STOR', null, 'CE', 'CSGA')$$, 'INVALID_SCOPE');
select test_harness.expect_raise('J32b a subgroup that is not the fellowship''s subgroup is refused', 'authenticated', '00000000-0000-4000-8000-00000000000e',
  $$select public.submit_teacher_application('Scope Probe', null, 'CMU', null, 'CE', 'CESGB')$$, 'INVALID_SCOPE');
select test_harness.expect_raise('J32c a group that does not match the fellowship is refused', 'authenticated', '00000000-0000-4000-8000-00000000000e',
  $$select public.submit_teacher_application('Scope Probe', null, 'CMU', null, 'CS', 'CESGA')$$, 'INVALID_SCOPE');
select test_harness.expect_raise('J32d an unknown subgroup is refused', 'authenticated', '00000000-0000-4000-8000-00000000000e',
  $$select public.submit_teacher_application('Scope Probe', null, 'CMU', null, 'CE', 'NOPE')$$, 'INVALID_SCOPE');
select test_harness.expect_raise('J32e a blank subgroup is refused', 'authenticated', '00000000-0000-4000-8000-00000000000e',
  $$select public.submit_teacher_application('Scope Probe', null, 'CMU', null, 'CE', '')$$, 'INVALID_SCOPE');

-- The four-argument form is revoked from application roles
select test_harness.expect_raise('J33 the four-argument submit is not callable by an applicant', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Old Form', null, 'CMU', null)$$, 'permission denied');

-- Database-level: the composite foreign key and the scope check reject bad rows regardless of the API
select test_harness.expect_raise('J34 a row pairing a subgroup with the wrong group is rejected by the foreign key', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, group_id, subgroup_id)
    values ('00000000-0000-4000-8000-00000000000f', 'cross@example.test', 'cross@example.test', 'Cross Scope', 'CMU', now(), 'CS', 'CESGA')$$,
  'insert or update on table');
select test_harness.expect_raise('J35 a row without a group and subgroup is rejected', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at)
    values ('00000000-0000-4000-8000-00000000000f', 'noscope@example.test', 'noscope@example.test', 'No Scope', 'CMU', now())$$,
  'new row for relation');

-- ─────────────────────────────────────────────────────────────────────────────
-- Summary
-- ─────────────────────────────────────────────────────────────────────────────

select name, ok, detail from test_harness.results where not ok order by id;
select count(*) as total, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed
  from test_harness.results;
