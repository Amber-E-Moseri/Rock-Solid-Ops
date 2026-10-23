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
  ('00000000-0000-4000-8000-00000000000f', 'Teacher.Active@Example.test', now());

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
  ('00000000-0000-4000-8000-00000000000d', 'regional.k@example.test',  'Regional Kim',    'regional_secretary', true);
-- N (…005) and D (…00e) and Z (…00f) have no profile row. Z is the roster teacher's account.

insert into public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, active) values
  ('CMU',     'Campus Alpha', 'CE', 'CESGA', true),
  ('RETIRED', 'Old Campus',   'CE', 'CESGA', false);

insert into public.teachers (teacher_id, full_name, email, fellowship_code, status, active) values
  ('TCH-ACTIVE', 'Active Teacher', 'teacher.active@example.test', 'CMU', 'ACTIVE', true);

-- The hardened teacher-link candidate under test. Loaded verbatim from main, not re-typed.
\i ../../migrations/202605191330_safe_teacher_auth_linking.sql

-- The new foundation.
\i ../../migrations/202610230100_teacher_applications_foundation.sql
\i ../../migrations/202610230200_teacher_application_email_templates.sql

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
  $$select public.submit_teacher_application('Anon Person', null, 'CMU', null)$$, '42501');

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
    $$select (public.submit_teacher_application('Nobody Here', null, 'CMU', null))->>'outcome'$$) like 'ERROR: UNAUTHENTICATED%');

select test_harness.expect_raise('B2 unverified account cannot submit', 'authenticated', '00000000-0000-4000-8000-000000000003',
  $$select public.submit_teacher_application('Unverified Person', null, 'CMU', null)$$, 'EMAIL_NOT_VERIFIED');

select test_harness.expect_raise('B3 unknown fellowship is refused', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Applicant Alpha', null, 'NOSUCH', null)$$, 'INVALID_FELLOWSHIP');

select test_harness.expect_raise('B4 retired fellowship is refused', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Applicant Alpha', null, 'RETIRED', null)$$, 'INVALID_FELLOWSHIP');

select test_harness.expect_raise('B5 one-character name is refused', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('A', null, 'CMU', null)$$, 'INVALID_FULL_NAME');

-- Applicant A is a verified account whose profile is still 'pending'.
select test_harness.record('B6 pending-profile applicant submits (outcome SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000001',
    $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'cmu', 'first notes'))->>'outcome'$$) = 'SUBMITTED');

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
                      $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'CMU', 'first notes'))->>'outcome'$$);
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
                      $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'CMU', 'edited notes'))->>'outcome'$$);
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
  $$select public.submit_teacher_application('Duplicate Dee', null, 'CMU', null)$$, 'DUPLICATE_OPEN_APPLICATION');

select test_harness.record('B11 applicant B submits',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000002',
    $$select (public.submit_teacher_application('Applicant Bravo', null, 'CMU', null))->>'outcome'$$) = 'SUBMITTED');

-- Pending profile and no-profile accounts may apply, but gain nothing from it.
select test_harness.record('B12 pending profile P applies and stays pending',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000004',
    $$select (public.submit_teacher_application('Pending Pat', null, 'CMU', null))->>'outcome'$$) = 'SUBMITTED'
  and (select p.role from public.profiles p where p.user_id = '00000000-0000-4000-8000-000000000004') = 'pending');

select test_harness.record('B13 verified account with no profile row applies (outcome SUBMITTED)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-000000000005',
    $$select (public.submit_teacher_application('Noprofile Nina', null, 'CMU', null))->>'outcome'$$) = 'SUBMITTED'
  and not exists (select 1 from public.profiles p where p.user_id = '00000000-0000-4000-8000-000000000005'));

select test_harness.expect_raise('B14 address already on the active roster is refused', 'authenticated', '00000000-0000-4000-8000-00000000000f',
  $$select public.submit_teacher_application('Teacher Zed', null, 'CMU', null)$$, 'ALREADY_TEACHER');

-- Superadmin applies too, so the self-review test in section C has an application to target.
select test_harness.record('B15 superadmin Y submits own application',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000b',
    $$select (public.submit_teacher_application('Super Yara', null, 'CMU', null))->>'outcome'$$) = 'SUBMITTED');

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
      ('C6 pastor S cannot review',                             'authenticated', '00000000-0000-4000-8000-000000000007'::uuid),
      ('C7 principal R cannot review',                          'authenticated', '00000000-0000-4000-8000-000000000008'::uuid),
      ('C8 subgroup_admin G cannot review',                     'authenticated', '00000000-0000-4000-8000-000000000009'::uuid),
      ('C9 regional_secretary K cannot review',                 'authenticated', '00000000-0000-4000-8000-00000000000d'::uuid),
      ('C10 admin with is_active=false cannot review',          'authenticated', '00000000-0000-4000-8000-00000000000c'::uuid)
    ) as t(name, role, uid)
  loop
    perform test_harness.expect_raise(v_actor.name, v_actor.role, v_actor.uid,
      format('select public.review_teacher_application(%L::uuid, %L, 1, %L)', v_app, 'REQUEST_INFO', 'Please confirm your address'),
      'FORBIDDEN: administrator role required');
  end loop;
end $body$;

select test_harness.expect_raise('C11 non-reviewer cannot approve', 'authenticated', '00000000-0000-4000-8000-000000000006',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'APPROVE', 'approve'),
  'FORBIDDEN');

select test_harness.expect_raise('C12 admin request needs a message', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  format('select public.review_teacher_application(%L::uuid, %L, 1, null)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'REQUEST_INFO'),
  'MESSAGE_REQUIRED');

select test_harness.expect_raise('C13 stale version is refused', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  format('select public.review_teacher_application(%L::uuid, %L, 99, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'REQUEST_INFO', 'Please confirm your address'),
  'VERSION_CONFLICT');

select test_harness.expect_raise('C14 admin cannot approve (linking contract not yet wired)', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'APPROVE', 'approve'),
  'APPROVAL_NOT_AVAILABLE');

select test_harness.expect_raise('C15 superadmin cannot approve either', 'authenticated', '00000000-0000-4000-8000-00000000000b',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'APPROVE', 'approve'),
  'APPROVAL_NOT_AVAILABLE');

select test_harness.expect_raise('C16 unknown action is refused', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  format('select public.review_teacher_application(%L::uuid, %L, 1, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'DELETE', 'x'),
  'INVALID_ACTION');

select test_harness.record('C17 admin requests information (SUBMITTED to INFO_REQUESTED, version 2)',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000a',
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
                      $$select (public.submit_teacher_application('Applicant Alpha', '+1 555 0100', 'CMU', 'edited notes'))->>'outcome'$$);
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

select test_harness.expect_raise('C26 a rejected application cannot be moved to info-requested', 'authenticated', '00000000-0000-4000-8000-00000000000a',
  format('select public.review_teacher_application(%L::uuid, %L, 5, %L)',
    test_harness.app_id('00000000-0000-4000-8000-000000000001'),
    'REQUEST_INFO', 'again'),
  'INVALID_TRANSITION: REJECTED to INFO_REQUESTED');

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Post-decision lifecycle, withdrawal and re-application
-- ─────────────────────────────────────────────────────────────────────────────

select test_harness.expect_raise('D1 rejected applicant cannot re-apply until an administrator decides', 'authenticated', '00000000-0000-4000-8000-000000000001',
  $$select public.submit_teacher_application('Applicant Alpha', null, 'CMU', null)$$, 'APPLICATION_NOT_ALLOWED');

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
                   $$select (public.submit_teacher_application('Applicant Bravo', null, 'CMU', null))->>'outcome'$$);
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
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, status)
    values ('00000000-0000-4000-8000-00000000000f', 'Mixed@Example.test', 'Mixed@Example.test', 'Mixed Case', 'CMU', now(), 'WITHDRAWN')$$, '23514');

select test_harness.expect_state('G2 unknown status is refused', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, status)
    values ('00000000-0000-4000-8000-00000000000f', 'z@example.test', 'z@example.test', 'Zed Zero', 'CMU', now(), 'DRAFT')$$, '23514');

select test_harness.expect_state('G3 APPROVED requires a linked roster id', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at, status, reviewed_at, reviewed_by)
    values ('00000000-0000-4000-8000-00000000000f', 'z@example.test', 'z@example.test', 'Zed Zero', 'CMU', now(), 'APPROVED', now(), '00000000-0000-4000-8000-00000000000b')$$, '23514');

select test_harness.expect_state('G4 a second open application for one email is refused by the index', 'postgres', null,
  $$insert into public.teacher_applications (applicant_user_id, email, email_normalized, full_name, fellowship_code, email_verified_at)
    values ('00000000-0000-4000-8000-00000000000f', 'applicant.b@example.test', 'applicant.b@example.test', 'Second Open', 'CMU', now())$$, '23505');

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

select test_harness.record('H4 reviewer view returns every row to an active admin',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    'select count(*)::text from public.teacher_applications_review')
  = (select count(*)::text from public.teacher_applications));

select test_harness.record('H5 reviewer view is empty for a pastor (non-admin)',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000007',
    'select count(*) from public.teacher_applications_review', 0));

select test_harness.record('H6 reviewer view is empty for the applicant',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-000000000001',
    'select count(*) from public.teacher_applications_review', 0));

select test_harness.record('H7 reviewer view is empty for an admin whose profile is inactive',
  test_harness.count_as_row('authenticated', '00000000-0000-4000-8000-00000000000c',
    'select count(*) from public.teacher_applications_review', 0));

select test_harness.record('H8 reviewer view carries the internal rejection reason for an admin',
  test_harness.text_as('authenticated', '00000000-0000-4000-8000-00000000000a',
    'select rejection_reason from public.teacher_applications_review where applicant_user_id = ''00000000-0000-4000-8000-000000000001''') like 'Internal:%');

select test_harness.expect_state('H9 anon cannot read the applicant view', 'anon', null,
  'select count(*) from public.teacher_applications_applicant', '42501');

select test_harness.expect_state('H10 anon cannot read the reviewer view', 'anon', null,
  'select count(*) from public.teacher_applications_review', '42501');

-- ─────────────────────────────────────────────────────────────────────────────
-- Summary
-- ─────────────────────────────────────────────────────────────────────────────

select name, ok, detail from test_harness.results where not ok order by id;
select count(*) as total, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed
  from test_harness.results;
