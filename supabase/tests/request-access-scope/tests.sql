-- Request Access Phase 1 tests: org_subgroups seeding, staff scope assignments, RLS, coverage
-- checks, management contracts, lifecycle, tamper guards and fail-closed provisioning.
-- Runs after stubs.sql (teacher-applications baseline) and the two Phase 1 migrations.
-- Each check is recorded in test_harness.results; run.sh fails when any check is not ok.
--
-- Actor keys (fixed UUIDs):
--   SUP superadmin, active           REG regional_secretary, active
--   PAS pastor, active               SGA subgroup_admin, active
--   TCH teacher, active              ADM admin, active
--   INA pastor, is_active = false    PND pending, active
--
-- Fixture subgroups after seeding: CESGA and CESGB under group CE; CSGA under group CS.
-- WSGA is deliberately inactive in fellowship_map and must not be seeded.

create schema test_harness;

create table test_harness.results (
  id     serial primary key,
  name   text not null,
  ok     boolean not null,
  detail text
);

create table test_harness.ids (
  key text primary key,
  id  uuid not null
);

-- Test-only: helpers run after switching role, so every role must reach the harness schema.
-- These grants exist only in the disposable test database and never in a migration.
grant usage on schema test_harness to public;
grant select on test_harness.ids to public;

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
begin
  perform test_harness.as_user(p_role, p_uid);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  perform test_harness.as_postgres();

  if v_msg is null then
    perform test_harness.record(p_name, false, 'no error raised; expected ' || p_prefix);
  else
    perform test_harness.record(p_name, left(v_msg, length(p_prefix)) = p_prefix, v_msg);
  end if;
end;
$$;

-- Runs p_sql as service_role (the only role that may call the management contracts) and checks
-- the returned outcome.
create or replace function test_harness.expect_outcome(p_name text, p_expected text, p_sql text)
returns void
language plpgsql
as $$
declare
  v_result jsonb;
  v_msg    text := null;
begin
  perform test_harness.as_user('service_role', null);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  perform test_harness.as_postgres();

  if v_msg is not null then
    perform test_harness.record(p_name, false, 'raised: ' || v_msg);
  else
    perform test_harness.record(p_name, v_result ->> 'outcome' = p_expected, v_result::text);
  end if;
end;
$$;

-- Runs p_sql as service_role and checks a boolean result.
create or replace function test_harness.expect_bool(p_name text, p_expected boolean, p_sql text)
returns void
language plpgsql
as $$
declare
  v_result boolean;
  v_msg    text := null;
begin
  perform test_harness.as_user('service_role', null);
  begin
    execute p_sql into v_result;
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  perform test_harness.as_postgres();

  if v_msg is not null then
    perform test_harness.record(p_name, false, 'raised: ' || v_msg);
  else
    perform test_harness.record(p_name, v_result = p_expected, 'got ' || coalesce(v_result::text, 'null'));
  end if;
end;
$$;

-- Counts rows visible to p_role/p_uid under RLS.
create or replace function test_harness.count_as(p_role text, p_uid uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_count bigint;
begin
  perform test_harness.as_user(p_role, p_uid);
  execute p_sql into v_count;
  perform test_harness.as_postgres();
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'sup@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'reg@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'pas@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a4', 'sga@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a5', 'tch@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a6', 'adm@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a7', 'ina@example.test', now()),
  ('00000000-0000-0000-0000-0000000000a8', 'pnd@example.test', now());

insert into public.profiles (user_id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'sup@example.test', 'Superadmin',         'superadmin',         true),
  ('00000000-0000-0000-0000-0000000000a2', 'reg@example.test', 'Regional Secretary', 'regional_secretary', true),
  ('00000000-0000-0000-0000-0000000000a3', 'pas@example.test', 'Pastor',             'pastor',             true),
  ('00000000-0000-0000-0000-0000000000a4', 'sga@example.test', 'Subgroup Admin',     'subgroup_admin',     true),
  ('00000000-0000-0000-0000-0000000000a5', 'tch@example.test', 'Teacher',            'teacher',            true),
  ('00000000-0000-0000-0000-0000000000a6', 'adm@example.test', 'Admin',              'admin',              true),
  ('00000000-0000-0000-0000-0000000000a7', 'ina@example.test', 'Inactive Pastor',    'pastor',             false),
  ('00000000-0000-0000-0000-0000000000a8', 'pnd@example.test', 'Pending',            'pending',            true);

-- Source rows for seeding. WSGA is inactive and must not be seeded.
insert into public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, active) values
  ('CMU',   'Central Main',  'CE', 'CESGA', true),
  ('YORK',  'York Campus',   'CE', 'CESGB', true),
  ('STOR',  'Storefront',    'CS', 'CSGA',  true),
  ('OLDWS', 'Retired Site',  'WS', 'WSGA',  false);

-- ---------------------------------------------------------------------------
-- A. Seeding org_subgroups from fellowship_map
-- ---------------------------------------------------------------------------

do $$
declare
  v_inserted integer;
begin
  v_inserted := public.org_subgroups_seed_from_fellowship();
  perform test_harness.record('seed inserts the three active mapped subgroups', v_inserted = 3, 'inserted ' || v_inserted);
  perform test_harness.record(
    'seed excludes inactive fellowship rows',
    not exists (select 1 from public.org_subgroups where subgroup_id = 'WSGA'),
    'WSGA present: ' || exists (select 1 from public.org_subgroups where subgroup_id = 'WSGA')
  );
  perform test_harness.record(
    'seed preserves the existing group code for each subgroup',
    exists (select 1 from public.org_subgroups where subgroup_id = 'CESGA' and group_id = 'CE')
      and exists (select 1 from public.org_subgroups where subgroup_id = 'CSGA' and group_id = 'CS'),
    ''
  );
  v_inserted := public.org_subgroups_seed_from_fellowship();
  perform test_harness.record('seed is idempotent on rerun', v_inserted = 0, 'inserted ' || v_inserted);
end;
$$;

insert into public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, active)
values ('AMBIG', 'Ambiguous', 'CS', 'CESGA', true);
select test_harness.expect_raise(
  'seed refuses a subgroup code mapped to two groups',
  'postgres', null,
  'select public.org_subgroups_seed_from_fellowship()',
  'ORG_SUBGROUP_AMBIGUOUS'
);
delete from public.fellowship_map where fellowship_code = 'AMBIG';

update public.fellowship_map set group_id = 'CS' where fellowship_code = 'YORK';
select test_harness.expect_raise(
  'seed refuses an existing row that drifted from fellowship_map',
  'postgres', null,
  'select public.org_subgroups_seed_from_fellowship()',
  'ORG_SUBGROUP_DRIFT'
);
update public.fellowship_map set group_id = 'CE' where fellowship_code = 'YORK';

-- ---------------------------------------------------------------------------
-- B. org_subgroups access
-- ---------------------------------------------------------------------------

select test_harness.expect_raise(
  'anon cannot read org_subgroups',
  'anon', null,
  'select count(*) from public.org_subgroups',
  'permission denied'
);

select test_harness.record(
  'active authenticated staff read the three active subgroups',
  test_harness.count_as('authenticated', '00000000-0000-0000-0000-0000000000a3',
    'select count(*) from public.org_subgroups') = 3,
  ''
);

select test_harness.expect_raise(
  'authenticated cannot insert org_subgroups',
  'authenticated', '00000000-0000-0000-0000-0000000000a1',
  'insert into public.org_subgroups (subgroup_id, group_id) values (''ZZZ'', ''CE'')',
  'permission denied'
);

select test_harness.expect_raise(
  'authenticated cannot update org_subgroups',
  'authenticated', '00000000-0000-0000-0000-0000000000a1',
  'update public.org_subgroups set active = false',
  'permission denied'
);

-- ---------------------------------------------------------------------------
-- C. Management contracts (grant and revoke) and their denials
-- ---------------------------------------------------------------------------

select test_harness.expect_raise(
  'authenticated cannot execute grant_staff_scope directly',
  'authenticated', '00000000-0000-0000-0000-0000000000a1',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')',
  'permission denied'
);

select test_harness.expect_outcome(
  'superadmin grants pastor the CESGA subgroup',
  'GRANTED',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')'
);

select test_harness.expect_outcome(
  'superadmin grants the same pastor a second subgroup in the same group',
  'GRANTED',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGB'')'
);

select test_harness.expect_outcome(
  're-granting an active scope is unchanged, not duplicated',
  'UNCHANGED',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')'
);

select test_harness.expect_outcome(
  'regional secretary grants subgroup admin the CESGA subgroup',
  'GRANTED',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a2'', ''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGA'')'
);

select test_harness.expect_raise(
  'admin cannot manage subgroup scope',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a6'', ''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGB'')',
  'FORBIDDEN'
);

select test_harness.expect_raise(
  'pastor cannot grant scope to another staff member',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a3'', ''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGB'')',
  'FORBIDDEN'
);

select test_harness.expect_raise(
  'no self-grant through the management contract',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a1'', ''CE'', ''CESGA'')',
  'FORBIDDEN_SELF_ASSIGNMENT'
);

select test_harness.expect_raise(
  'teacher profile cannot receive subgroup scope',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a5'', ''CE'', ''CESGA'')',
  'TARGET_ROLE_NOT_SCOPED'
);

select test_harness.expect_raise(
  'pending profile cannot receive subgroup scope',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a8'', ''CE'', ''CESGA'')',
  'TARGET_ROLE_NOT_SCOPED'
);

select test_harness.expect_raise(
  'inactive profile cannot receive subgroup scope',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a7'', ''CE'', ''CESGA'')',
  'TARGET_NOT_ACTIVE'
);

select test_harness.expect_raise(
  'cross-group subgroup is rejected by the management contract',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CS'', ''CESGA'')',
  'INVALID_SUBGROUP_FOR_GROUP'
);

select test_harness.expect_raise(
  'unknown subgroup is rejected by the management contract',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''NOPE'')',
  'INVALID_SUBGROUP_FOR_GROUP'
);

select test_harness.expect_raise(
  'empty group or subgroup input is rejected',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', '''')',
  'INVALID_INPUT'
);

-- An inactive subgroup under an active group grants nothing, even for a valid pastor.
update public.org_subgroups set active = false where subgroup_id = 'CSGA';
select test_harness.expect_raise(
  'inactive subgroup cannot receive new scope',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a4'', ''CS'', ''CSGA'')',
  'INVALID_SUBGROUP_FOR_GROUP'
);
update public.org_subgroups set active = true where subgroup_id = 'CSGA';

-- ---------------------------------------------------------------------------
-- D. Direct writes: constraints and triggers (as the database owner)
-- ---------------------------------------------------------------------------

select test_harness.expect_raise(
  'assignment cannot pair a subgroup with a different group',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a3'', ''pastor'', ''CE'', ''CSGA'', ''00000000-0000-0000-0000-0000000000a1'')',
  'insert or update on table'
);

select test_harness.expect_raise(
  'assignment cannot reference an unknown subgroup',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a3'', ''pastor'', ''CE'', ''NOPE'', ''00000000-0000-0000-0000-0000000000a1'')',
  'insert or update on table'
);

select test_harness.expect_raise(
  'assignment role must match the target profile role',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a4'', ''pastor'', ''CE'', ''CESGB'', ''00000000-0000-0000-0000-0000000000a1'')',
  'SCOPE_ROLE_MISMATCH'
);

select test_harness.expect_raise(
  'assignment cannot target an inactive profile',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a7'', ''pastor'', ''CE'', ''CESGA'', ''00000000-0000-0000-0000-0000000000a1'')',
  'SCOPE_TARGET_NOT_ACTIVE'
);

select test_harness.expect_raise(
  'assignment cannot be self-granted at the row level',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a3'', ''pastor'', ''CE'', ''CESGB'', ''00000000-0000-0000-0000-0000000000a3'')',
  'new row for relation'
);

select test_harness.expect_raise(
  'assignment role is limited to pastor or subgroup_admin',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a5'', ''teacher'', ''CE'', ''CESGA'', ''00000000-0000-0000-0000-0000000000a1'')',
  'new row for relation'
);

select test_harness.expect_raise(
  'duplicate active assignment for the same user and subgroup is rejected',
  'postgres', null,
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a3'', ''pastor'', ''CE'', ''CESGA'', ''00000000-0000-0000-0000-0000000000a1'')',
  'duplicate key value'
);

-- ---------------------------------------------------------------------------
-- E. RLS on staff_scope_assignments and org_subgroups
-- ---------------------------------------------------------------------------

select test_harness.expect_raise(
  'anon cannot read staff_scope_assignments',
  'anon', null,
  'select count(*) from public.staff_scope_assignments',
  'permission denied'
);

select test_harness.record(
  'pastor sees only its own assignments (two subgroups)',
  test_harness.count_as('authenticated', '00000000-0000-0000-0000-0000000000a3',
    'select count(*) from public.staff_scope_assignments') = 2,
  ''
);

select test_harness.record(
  'subgroup admin sees only its own assignment',
  test_harness.count_as('authenticated', '00000000-0000-0000-0000-0000000000a4',
    'select count(*) from public.staff_scope_assignments') = 1,
  ''
);

select test_harness.record(
  'regional secretary sees every assignment',
  test_harness.count_as('authenticated', '00000000-0000-0000-0000-0000000000a2',
    'select count(*) from public.staff_scope_assignments') = 3,
  ''
);

select test_harness.record(
  'teacher sees no assignments',
  test_harness.count_as('authenticated', '00000000-0000-0000-0000-0000000000a5',
    'select count(*) from public.staff_scope_assignments') = 0,
  ''
);

select test_harness.expect_raise(
  'authenticated pastor cannot insert an assignment for itself',
  'authenticated', '00000000-0000-0000-0000-0000000000a3',
  'insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by) values (''00000000-0000-0000-0000-0000000000a3'', ''pastor'', ''CE'', ''CESGB'', ''00000000-0000-0000-0000-0000000000a1'')',
  'permission denied'
);

select test_harness.expect_raise(
  'authenticated user cannot update an assignment',
  'authenticated', '00000000-0000-0000-0000-0000000000a3',
  'update public.staff_scope_assignments set active = false',
  'permission denied'
);

select test_harness.expect_raise(
  'authenticated user cannot call the coverage helper',
  'authenticated', '00000000-0000-0000-0000-0000000000a3',
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')',
  'permission denied'
);

-- ---------------------------------------------------------------------------
-- F. Coverage: multi-subgroup authority and cross-subgroup / cross-group denial
-- ---------------------------------------------------------------------------

select test_harness.expect_bool(
  'pastor covers its first subgroup',
  true,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')'
);

select test_harness.expect_bool(
  'pastor covers its second subgroup in the same group',
  true,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGB'')'
);

select test_harness.expect_bool(
  'pastor is denied a subgroup in another group',
  false,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CS'', ''CSGA'')'
);

select test_harness.expect_bool(
  'subgroup admin covers its own subgroup',
  true,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGA'')'
);

select test_harness.expect_bool(
  'subgroup admin is denied a sibling subgroup it was not assigned (cross-subgroup)',
  false,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGB'')'
);

select test_harness.expect_bool(
  'profile with no assignment covers nothing, even when its group name matches',
  false,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a5'', ''CE'', ''CESGA'')'
);

select test_harness.expect_bool(
  'superadmin is organization-wide',
  true,
  'select public.staff_scope_org_wide(''00000000-0000-0000-0000-0000000000a1'')'
);

select test_harness.expect_bool(
  'regional secretary is organization-wide',
  true,
  'select public.staff_scope_org_wide(''00000000-0000-0000-0000-0000000000a2'')'
);

select test_harness.expect_bool(
  'pastor is not organization-wide',
  false,
  'select public.staff_scope_org_wide(''00000000-0000-0000-0000-0000000000a3'')'
);

select test_harness.expect_bool(
  'admin is not organization-wide',
  false,
  'select public.staff_scope_org_wide(''00000000-0000-0000-0000-0000000000a6'')'
);

-- ---------------------------------------------------------------------------
-- G. Inactive users and role changes remove authority immediately
-- ---------------------------------------------------------------------------

update public.profiles set is_active = false where user_id = '00000000-0000-0000-0000-0000000000a3';
select test_harness.expect_bool(
  'deactivated pastor loses coverage immediately',
  false,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')'
);
update public.profiles set is_active = true where user_id = '00000000-0000-0000-0000-0000000000a3';

update public.profiles set role = 'teacher' where user_id = '00000000-0000-0000-0000-0000000000a4';
select test_harness.expect_bool(
  'subgroup admin whose role changed away loses coverage immediately',
  false,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGA'')'
);
update public.profiles set role = 'subgroup_admin' where user_id = '00000000-0000-0000-0000-0000000000a4';

update public.profiles set is_active = false where user_id = '00000000-0000-0000-0000-0000000000a2';
select test_harness.expect_raise(
  'deactivated regional secretary cannot manage scope',
  'service_role', null,
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a2'', ''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGB'')',
  'FORBIDDEN'
);
update public.profiles set is_active = true where user_id = '00000000-0000-0000-0000-0000000000a2';

-- ---------------------------------------------------------------------------
-- H. Subgroup admin with two subgroups, then revocation and re-grant
-- ---------------------------------------------------------------------------

select test_harness.expect_outcome(
  'regional secretary grants the subgroup admin a second subgroup',
  'GRANTED',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a2'', ''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGB'')'
);

select test_harness.expect_bool(
  'subgroup admin with two subgroups covers both',
  true,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a4'', ''CE'', ''CESGB'')'
);

insert into test_harness.ids
select 'pas_cesgb', id from public.staff_scope_assignments
where user_id = '00000000-0000-0000-0000-0000000000a3' and subgroup_id = 'CESGB' and active;
insert into test_harness.ids
select 'sga_cesga', id from public.staff_scope_assignments
where user_id = '00000000-0000-0000-0000-0000000000a4' and subgroup_id = 'CESGA' and active;

select test_harness.expect_raise(
  'pastor cannot revoke scope',
  'service_role', null,
  'select public.revoke_staff_scope(''00000000-0000-0000-0000-0000000000a3'', (select id from test_harness.ids where key = ''sga_cesga''))',
  'FORBIDDEN'
);

select test_harness.expect_outcome(
  'superadmin revokes one of the pastor subgroups',
  'REVOKED',
  'select public.revoke_staff_scope(''00000000-0000-0000-0000-0000000000a1'', (select id from test_harness.ids where key = ''pas_cesgb''))'
);

select test_harness.expect_bool(
  'revoked subgroup loses authority immediately',
  false,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGB'')'
);

select test_harness.expect_bool(
  'the pastor keeps authority for its remaining subgroup',
  true,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGA'')'
);

select test_harness.expect_outcome(
  'revoking an already revoked assignment is unchanged',
  'UNCHANGED',
  'select public.revoke_staff_scope(''00000000-0000-0000-0000-0000000000a1'', (select id from test_harness.ids where key = ''pas_cesgb''))'
);

select test_harness.expect_raise(
  'revoked assignment cannot be reactivated',
  'postgres', null,
  'update public.staff_scope_assignments set active = true, revoked_by = null, revoked_at = null where id = (select id from test_harness.ids where key = ''pas_cesgb'')',
  'SCOPE_NO_REACTIVATION'
);

select test_harness.expect_raise(
  'assignment identity is immutable',
  'postgres', null,
  'update public.staff_scope_assignments set subgroup_id = ''CESGA'' where id = (select id from test_harness.ids where key = ''pas_cesgb'')',
  'SCOPE_IMMUTABLE'
);

select test_harness.expect_raise(
  'an active assignment cannot be deactivated without revocation fields',
  'postgres', null,
  'update public.staff_scope_assignments set active = false where id = (select id from test_harness.ids where key = ''sga_cesga'')',
  'new row for relation'
);

select test_harness.expect_outcome(
  're-granting after revocation creates a new active row',
  'GRANTED',
  'select public.grant_staff_scope(''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGB'')'
);

select test_harness.expect_bool(
  'the re-granted subgroup is covered again',
  true,
  'select public.staff_scope_covers(''00000000-0000-0000-0000-0000000000a3'', ''CE'', ''CESGB'')'
);

-- ---------------------------------------------------------------------------
-- I. Audit trail and fail-closed provisioning
-- ---------------------------------------------------------------------------

select test_harness.record(
  'every successful grant and revoke writes one audit row with actor_id in details',
  (select count(*) from public.audit_logs where action in ('STAFF_SCOPE_GRANTED', 'STAFF_SCOPE_REVOKED')) = 6
  and (select count(*) from public.audit_logs
       where action in ('STAFF_SCOPE_GRANTED', 'STAFF_SCOPE_REVOKED') and details ? 'actor_id') = 6,
  'expected 6 audit rows: 5 granted, 1 revoked'
);

select test_harness.record(
  'denied and unchanged calls write no audit rows',
  (select count(*) from public.audit_logs where action = 'STAFF_SCOPE_REVOKED') = 1,
  ''
);

select test_harness.record(
  'granting scope does not change any profile role',
  (select role from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a3') = 'pastor'
  and (select role from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a4') = 'subgroup_admin',
  ''
);

select test_harness.record(
  'no provisioning table or function is present in phase 1',
  to_regclass('public.access_provisioning_jobs') is null
  and to_regclass('public.release_holds') is null
  and not exists (select 1 from pg_proc where proname ilike '%provision%'),
  ''
);

select test_harness.expect_raise(
  'group_admin is not an accepted profile role',
  'postgres', null,
  'update public.profiles set role = ''group_admin'' where user_id = ''00000000-0000-0000-0000-0000000000a5''',
  'new row for relation'
);
