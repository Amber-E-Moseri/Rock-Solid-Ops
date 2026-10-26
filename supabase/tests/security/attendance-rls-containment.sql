-- =============================================================================
-- Attendance RLS containment: regression tests
-- (for supabase/migrations/20261024130000_attendance_rls_containment.sql)
-- =============================================================================
-- LOCAL ONLY. Run against a throwaway replay database built from the origin/main migration
-- lineage. Never against staging or production. Everything runs in one transaction that is
-- rolled back at the end.
--
--   psql -X -v ON_ERROR_STOP=1 -d <replay_db> -f supabase/tests/security/attendance-rls-containment.sql
--
-- Negative control: run against the lineage WITHOUT the containment migration. The cross-teacher
-- read, the pending-user insert and the pending-user delete cases must FAIL there.
--
-- KNOWN PRE-EXISTING DEFECT (not fixed here): public.count_consecutive_misses() selects the
-- non-existent column attendance_log.attended, so trg_at_risk_attendance raises
-- 'column "attended" does not exist' on every attendance_log INSERT or UPDATE. The checks below
-- therefore treat a write as "admitted by RLS" when it fails with that trigger error and not with
-- a row-level-security or permission error.
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

-- Runs p_sql as p_role (JWT sub = p_uid when set). Returns 'ROWS:<n>' or 'ERROR: <message>'.
create or replace function pg_temp.exec_as(p_role text, p_uid uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  n bigint;
  r text;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', 'authenticated')::text end,
    true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    r := 'ROWS:' || n;
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  execute 'reset role';
  return r;
end;
$$;

-- True when RLS let the statement through: it succeeded, or it failed only later in the
-- pre-existing at-risk trigger.
create or replace function pg_temp.rls_admitted(p_outcome text)
returns boolean
language sql
as $$
  select p_outcome not like '%row-level security%'
     and p_outcome not like '%permission denied%'
$$;

-- Count of rows visible to p_role in a table (RLS applies).
create or replace function pg_temp.visible(p_role text, p_uid uuid, p_table text)
returns bigint
language plpgsql
as $$
declare
  n bigint;
begin
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', 'authenticated')::text end,
    true);
  execute format('set local role %I', p_role);
  execute format('select count(*) from public.%I', p_table) into n;
  execute 'reset role';
  return n;
end;
$$;

-- ---- fixtures (owner; rolled back) ----------------------------------------------
-- Triggers are disabled for fixture inserts only, so the at-risk defect does not block setup.

set local session_replication_role = replica;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d001', 'att-teacher-a@example.test'),
  ('00000000-0000-4000-8000-00000000d002', 'att-teacher-b@example.test'),
  ('00000000-0000-4000-8000-00000000d003', 'att-pending@example.test'),
  ('00000000-0000-4000-8000-00000000d004', 'att-admin@example.test'),
  ('00000000-0000-4000-8000-00000000d005', 'att-superadmin@example.test'),
  ('00000000-0000-4000-8000-00000000d006', 'att-pastor@example.test'),
  ('00000000-0000-4000-8000-00000000d007', 'att-principal@example.test'),
  ('00000000-0000-4000-8000-00000000d008', 'att-regsec@example.test'),
  ('00000000-0000-4000-8000-00000000d009', 'att-subgroup@example.test');

-- Profiles: insert explicitly. Replica mode skips the auth-user trigger that would otherwise
-- create them, so the roles the matrix needs are set here.
insert into public.profiles (user_id, email, full_name, role, is_active) values
  ('00000000-0000-4000-8000-00000000d001', 'att-teacher-a@example.test', 'Att Teacher A', 'teacher', true),
  ('00000000-0000-4000-8000-00000000d002', 'att-teacher-b@example.test', 'Att Teacher B', 'teacher', true),
  ('00000000-0000-4000-8000-00000000d003', 'att-pending@example.test', 'Att Pending', 'pending', true),
  ('00000000-0000-4000-8000-00000000d004', 'att-admin@example.test', 'Att Admin', 'admin', true),
  ('00000000-0000-4000-8000-00000000d005', 'att-superadmin@example.test', 'Att Superadmin', 'superadmin', true),
  ('00000000-0000-4000-8000-00000000d006', 'att-pastor@example.test', 'Att Pastor', 'pastor', true),
  ('00000000-0000-4000-8000-00000000d007', 'att-principal@example.test', 'Att Principal', 'principal', true),
  ('00000000-0000-4000-8000-00000000d008', 'att-regsec@example.test', 'Att RegSec', 'regional_secretary', true),
  ('00000000-0000-4000-8000-00000000d009', 'att-subgroup@example.test', 'Att Subgroup', 'subgroup_admin', true)
on conflict (user_id) do update set role = excluded.role, is_active = excluded.is_active;

insert into public.teachers (teacher_id, full_name, email, teacher_user_id, subgroup_id)
values
  ('ATT-T-A', 'Attendance Teacher A', 'att-teacher-a@example.test', '00000000-0000-4000-8000-00000000d001', 'ATT-SG-1'),
  ('ATT-T-B', 'Attendance Teacher B', 'att-teacher-b@example.test', '00000000-0000-4000-8000-00000000d002', 'ATT-SG-2');

insert into public.batches (batch_id, batch_name, active) values ('ATT-B1', 'Attendance fixture batch', false);

insert into public.class_options (class_option_id, class_id, group_id, subgroup_id, teacher_id, fellowship_codes)
values
  ('ATT-CO-A', 'ATT-CLS-A', 'ATT-G-1', 'ATT-SG-1', 'ATT-T-A', array['ATT-FC']),
  ('ATT-CO-B', 'ATT-CLS-B', 'ATT-G-2', 'ATT-SG-2', 'ATT-T-B', array['ATT-FC']);

insert into public.students (student_id, full_name, email, group_id, subgroup_id)
values
  ('ATT-S-1', 'Attendance Student One', 'att-s1@example.test', 'ATT-G-1', 'ATT-SG-1'),
  ('ATT-S-2', 'Attendance Student Two', 'att-s2@example.test', 'ATT-G-2', 'ATT-SG-2');

insert into public.attendance_records
  (student_id, class_option_id, class_number, class_date, status, attendance_type)
values
  ('ATT-S-1', 'ATT-CO-A', 1, date '2026-10-01', 'present', 'roster'),
  ('ATT-S-2', 'ATT-CO-B', 1, date '2026-10-01', 'present', 'roster');

insert into public.attendance_log
  (student_id, group_id, subgroup_id, class_option_id, class_number, class_date, present, made_up)
values
  ('ATT-S-1', 'ATT-G-1', 'ATT-SG-1', 'ATT-CO-A', '1', date '2026-10-01', true, false),
  ('ATT-S-2', 'ATT-G-2', 'ATT-SG-2', 'ATT-CO-B', '1', date '2026-10-01', true, false);

set local session_replication_role = origin;

-- Stable identities for the matrix.
\set uidA '00000000-0000-4000-8000-00000000d001'
\set uidB '00000000-0000-4000-8000-00000000d002'
\set uidPending '00000000-0000-4000-8000-00000000d003'
\set uidAdmin '00000000-0000-4000-8000-00000000d004'
\set uidSuper '00000000-0000-4000-8000-00000000d005'
\set uidPastor '00000000-0000-4000-8000-00000000d006'
\set uidPrincipal '00000000-0000-4000-8000-00000000d007'
\set uidRegSec '00000000-0000-4000-8000-00000000d008'
\set uidSubgroup '00000000-0000-4000-8000-00000000d009'

-- ---- 0. known defect (informational) ------------------------------------------------

do $$
begin
  if exists (select 1 from pg_proc where proname = 'count_consecutive_misses'
             and prosrc like '%SELECT attended FROM attendance_log%') then
    raise notice 'KNOWN DEFECT present: count_consecutive_misses reads attendance_log.attended';
  end if;
end;
$$;

-- ---- 1. anonymous denial ----------------------------------------------------------

select pg_temp.expect('anon reads zero attendance_records rows (denied or zero)',
  pg_temp.exec_as('anon', null, 'select 1 from public.attendance_records') ~ '(ROWS:0|permission denied)');
select pg_temp.expect('anon reads zero attendance_log rows (denied or zero)',
  pg_temp.exec_as('anon', null, 'select 1 from public.attendance_log') ~ '(ROWS:0|permission denied)');
select pg_temp.expect('anon insert into attendance_log is refused by RLS',
  pg_temp.exec_as('anon', null,
    $sql$insert into public.attendance_log (student_id, group_id, subgroup_id, class_option_id, class_number, class_date)
         values ('ATT-S-1', 'ATT-G-1', 'ATT-SG-1', 'ATT-CO-A', '9', date '2026-10-02')$sql$) ~ '(row-level security|permission denied)');

-- ---- 2. ordinary authenticated users: no cross-teacher access ----------------------

select pg_temp.expect('teacher A sees only own-class attendance_records (1 of 2)',
  pg_temp.visible('authenticated', :'uidA', 'attendance_records') = 1);
select pg_temp.expect('teacher B sees only own-class attendance_records (1 of 2)',
  pg_temp.visible('authenticated', :'uidB', 'attendance_records') = 1);
select pg_temp.expect('teacher A sees only own-class attendance_log (1 of 2)',
  pg_temp.visible('authenticated', :'uidA', 'attendance_log') = 1);
select pg_temp.expect('pending user reads zero attendance_records rows',
  pg_temp.visible('authenticated', :'uidPending', 'attendance_records') = 0);
select pg_temp.expect('pending user reads zero attendance_log rows',
  pg_temp.visible('authenticated', :'uidPending', 'attendance_log') = 0);

select pg_temp.expect('pending user cannot insert attendance_records',
  pg_temp.exec_as('authenticated', :'uidPending',
    $sql$insert into public.attendance_records (student_id, class_option_id, class_number, class_date, status, attendance_type)
         values ('ATT-S-1', 'ATT-CO-A', 7, date '2026-10-03', 'present', 'roster')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('pending user cannot insert attendance_log',
  pg_temp.exec_as('authenticated', :'uidPending',
    $sql$insert into public.attendance_log (student_id, group_id, subgroup_id, class_option_id, class_number, class_date)
         values ('ATT-S-1', 'ATT-G-1', 'ATT-SG-1', 'ATT-CO-A', '7', date '2026-10-03')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('pending user updates zero attendance_records rows',
  pg_temp.exec_as('authenticated', :'uidPending',
    $sql$update public.attendance_records set notes = 'tamper'$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('pending user updates zero attendance_log rows',
  pg_temp.exec_as('authenticated', :'uidPending',
    $sql$update public.attendance_log set present = false$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('pending user deletes zero attendance_records rows',
  pg_temp.exec_as('authenticated', :'uidPending',
    $sql$delete from public.attendance_records$sql$) ~ '(ROWS:0|permission denied)');

-- ---- 3. assigned teacher: permitted access retained, other classes refused ----------

select pg_temp.expect('teacher A direct insert into attendance_records is denied (owner decision: writes are service-role only)',
  pg_temp.exec_as('authenticated', :'uidA',
    $sql$insert into public.attendance_records (student_id, class_option_id, class_number, class_date, status, attendance_type)
         values ('ATT-S-1', 'ATT-CO-A', 2, date '2026-10-08', 'present', 'roster')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('teacher A may NOT insert attendance_records for teacher B class',
  pg_temp.exec_as('authenticated', :'uidA',
    $sql$insert into public.attendance_records (student_id, class_option_id, class_number, class_date, status, attendance_type)
         values ('ATT-S-2', 'ATT-CO-B', 2, date '2026-10-08', 'present', 'roster')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('teacher A updates zero attendance_records rows of teacher B',
  pg_temp.exec_as('authenticated', :'uidA',
    $sql$update public.attendance_records set notes = 'x' where class_option_id = 'ATT-CO-B'$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('teacher A attendance_log write on own class is admitted by RLS',
  pg_temp.rls_admitted(pg_temp.exec_as('authenticated', :'uidA',
    $sql$update public.attendance_log set present = true where class_option_id = 'ATT-CO-A'$sql$)));
select pg_temp.expect('teacher A updates zero attendance_log rows of teacher B',
  pg_temp.exec_as('authenticated', :'uidA',
    $sql$update public.attendance_log set present = false where class_option_id = 'ATT-CO-B'$sql$) ~ '(ROWS:0|permission denied)');

-- ---- 4. admin / superadmin -------------------------------------------------------------

select pg_temp.expect('admin reads all attendance_records (2)',
  pg_temp.visible('authenticated', :'uidAdmin', 'attendance_records') = 2);
select pg_temp.expect('superadmin reads all attendance_records (2)',
  pg_temp.visible('authenticated', :'uidSuper', 'attendance_records') = 2);
select pg_temp.expect('admin reads all attendance_log (2)',
  pg_temp.visible('authenticated', :'uidAdmin', 'attendance_log') = 2);
select pg_temp.expect('admin direct update of attendance_records is denied (owner decision)',
  pg_temp.exec_as('authenticated', :'uidAdmin',
    $sql$update public.attendance_records set notes = 'admin note' where class_option_id = 'ATT-CO-B'$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('superadmin attendance_log write is admitted by RLS',
  pg_temp.rls_admitted(pg_temp.exec_as('authenticated', :'uidSuper',
    $sql$update public.attendance_log set made_up = false where class_option_id = 'ATT-CO-B'$sql$)));

-- ---- 5. role matrix --------------------------------------------------------------------

select pg_temp.expect('principal reads all attendance_records (2)',
  pg_temp.visible('authenticated', :'uidPrincipal', 'attendance_records') = 2);
select pg_temp.expect('regional_secretary reads all attendance_records (2)',
  pg_temp.visible('authenticated', :'uidRegSec', 'attendance_records') = 2);
select pg_temp.expect('regional_secretary cannot insert attendance_records',
  pg_temp.exec_as('authenticated', :'uidRegSec',
    $sql$insert into public.attendance_records (student_id, class_option_id, class_number, class_date, status, attendance_type)
         values ('ATT-S-1', 'ATT-CO-A', 5, date '2026-10-09', 'present', 'roster')$sql$) ~ '(row-level security|permission denied)');
-- Pastor: scope is the existing pastor_select_subgroup policy. The fixture gives the pastor no
-- teacher row, so that policy returns nothing. The containment must not widen it.
select pg_temp.expect('pastor attendance_records read is not widened (0 without subgroup link)',
  pg_temp.visible('authenticated', :'uidPastor', 'attendance_records') = 0);
-- subgroup_admin: no attendance_records read policy after containment. Owner decision pending.
select pg_temp.expect('subgroup_admin attendance_records read is 0 (owner decision pending)',
  pg_temp.visible('authenticated', :'uidSubgroup', 'attendance_records') = 0);

-- ---- 6. policy surface: exact expected set on each table -----------------------------

select pg_temp.expect('auth_read and auth_write are gone',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_records'
    and policyname in ('auth_read', 'auth_write')));

select pg_temp.expect('attendance_log_staff_select/_insert/_update are gone',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_log'
    and policyname in ('attendance_log_staff_select', 'attendance_log_staff_insert', 'attendance_log_staff_update')));

select pg_temp.expect('attendance_records policy set is exactly the expected seven',
  (select string_agg(policyname, ',' order by policyname) from pg_policies
     where schemaname = 'public' and tablename = 'attendance_records')
  = 'attendance_records_admin_all,attendance_records_pastor_select_subgroup,attendance_records_staff_select,attendance_records_teacher_insert_own,attendance_records_teacher_select_assigned,attendance_records_teacher_select_own,attendance_records_teacher_update_own');

select pg_temp.expect('attendance_log policy set is exactly the expected four',
  (select string_agg(policyname, ',' order by policyname) from pg_policies
     where schemaname = 'public' and tablename = 'attendance_log')
  = 'attendance_admin_all,attendance_log_teacher_insert_assigned,attendance_log_teacher_select_assigned,attendance_log_teacher_update_assigned');

select pg_temp.expect('attendance_forms policy untouched',
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_forms'
    and policyname = 'attendance_forms_staff_select'));

-- ---- 7. service role: not blocked by RLS; trigger inventory ----------------------------

select pg_temp.expect('service_role reads all attendance_records (2, bypasses RLS)',
  pg_temp.visible('service_role', null, 'attendance_records') = 2);
select pg_temp.expect('service_role attendance_log write is not refused by RLS (reaches the trigger)',
  pg_temp.rls_admitted(pg_temp.exec_as('service_role', null,
    $sql$insert into public.attendance_log (student_id, group_id, subgroup_id, class_option_id, class_number, class_date, present, made_up)
         values ('ATT-S-1', 'ATT-G-1', 'ATT-SG-1', 'ATT-CO-A', '3', date '2026-10-10', false, false)$sql$)));

select pg_temp.expect('attendance_log triggers remain enabled',
  (select count(*) from pg_trigger where tgrelid = 'public.attendance_log'::regclass
     and tgname in ('trg_at_risk_attendance', 'trg_attendance_graduation_reeval', 'trg_attendance_makeup_create')
     and tgenabled = 'O') = 3);
select pg_temp.expect('attendance_records_updated_at trigger remains enabled',
  exists (select 1 from pg_trigger where tgrelid = 'public.attendance_records'::regclass
    and tgname = 'attendance_records_updated_at' and tgenabled = 'O'));

rollback;
