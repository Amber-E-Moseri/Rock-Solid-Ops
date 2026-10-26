-- =============================================================================
-- Attendance RLS containment: production-shaped regression tests
-- (for supabase/migrations/20261024130000_attendance_rls_containment.sql)
-- =============================================================================
-- LOCAL ONLY. Run against a throwaway database built from:
--   shim (supabase/tests/security/replay/00_supabase_shim.sql)
--   + 01_prod_shape_schema.sql (generated from the production catalog, read-only)
--   [+ the containment migration for the post-state]
-- Never against staging or production. Runs in one transaction; the final rollback discards
-- every fixture. Triggers are NOT reproduced by the production-shape schema; trigger behaviour
-- is not covered here.
--
--   psql -X -v ON_ERROR_STOP=1 -d <db> -f 02_attendance_rls_prodshape_test.sql
-- =============================================================================

\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.expect(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;

create or replace function pg_temp.exec_as(p_role text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', 'authenticated')::text end, true);
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
end $$;

create or replace function pg_temp.visible(p_role text, p_uid uuid, p_table text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', 'authenticated')::text end, true);
  execute format('set local role %I', p_role);
  execute format('select count(*) from public.%I', p_table) into n;
  execute 'reset role';
  return n;
end $$;

create or replace function pg_temp.scalar_as(p_role text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid::text, 'role', 'authenticated')::text end, true);
  execute format('set local role %I', p_role);
  execute p_sql into r;
  execute 'reset role';
  return r;
end $$;

-- ---- fixtures ----------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e001', 'att-teacher-a@example.test'),
  ('00000000-0000-4000-8000-00000000e002', 'att-teacher-b@example.test'),
  ('00000000-0000-4000-8000-00000000e003', 'att-pending@example.test'),
  ('00000000-0000-4000-8000-00000000e004', 'att-admin@example.test'),
  ('00000000-0000-4000-8000-00000000e005', 'att-superadmin@example.test'),
  ('00000000-0000-4000-8000-00000000e006', 'att-pastor@example.test'),
  ('00000000-0000-4000-8000-00000000e007', 'att-principal@example.test'),
  ('00000000-0000-4000-8000-00000000e008', 'att-regsec@example.test'),
  ('00000000-0000-4000-8000-00000000e009', 'att-subgroup@example.test');

insert into public.profiles (user_id, email, full_name, role, is_active) values
  ('00000000-0000-4000-8000-00000000e001', 'att-teacher-a@example.test', 'A', 'teacher', true),
  ('00000000-0000-4000-8000-00000000e002', 'att-teacher-b@example.test', 'B', 'teacher', true),
  ('00000000-0000-4000-8000-00000000e003', 'att-pending@example.test', 'P', 'pending', true),
  ('00000000-0000-4000-8000-00000000e004', 'att-admin@example.test', 'Ad', 'admin', true),
  ('00000000-0000-4000-8000-00000000e005', 'att-superadmin@example.test', 'Su', 'superadmin', true),
  ('00000000-0000-4000-8000-00000000e006', 'att-pastor@example.test', 'Pa', 'pastor', true),
  ('00000000-0000-4000-8000-00000000e007', 'att-principal@example.test', 'Pr', 'principal', true),
  ('00000000-0000-4000-8000-00000000e008', 'att-regsec@example.test', 'RS', 'regional_secretary', true),
  ('00000000-0000-4000-8000-00000000e009', 'att-subgroup@example.test', 'SG', 'subgroup_admin', true);

insert into public.teachers (teacher_id, full_name, email, active, deleted_at, teacher_user_id, group_id, subgroup_id, status)
values
  ('ATT-T-A', 'Teacher A', 'att-teacher-a@example.test', true, null, '00000000-0000-4000-8000-00000000e001', 'ATT-G-1', 'ATT-SG-1', 'ACTIVE'),
  ('ATT-T-B', 'Teacher B', 'att-teacher-b@example.test', true, null, '00000000-0000-4000-8000-00000000e002', 'ATT-G-2', 'ATT-SG-2', 'ACTIVE');

insert into public.batches (batch_id, batch_name, active) values ('ATT-B1', 'Attendance fixture batch', true);

insert into public.class_options (class_option_id, class_id, group_id, subgroup_id, teacher_id, fellowship_codes, active)
values
  ('ATT-CO-A', 'ATT-CLS-A', 'ATT-G-1', 'ATT-SG-1', 'ATT-T-A', array['ATT-FC-1'], true),
  ('ATT-CO-B', 'ATT-CLS-B', 'ATT-G-2', 'ATT-SG-2', 'ATT-T-B', array['ATT-FC-2'], true);

insert into public.students (student_id, full_name, email, group_id, subgroup_id)
values
  ('ATT-S-1', 'Student One', 'att-s1@example.test', 'ATT-G-1', 'ATT-SG-1'),
  ('ATT-S-2', 'Student Two', 'att-s2@example.test', 'ATT-G-2', 'ATT-SG-2');

insert into public.attendance_records (applicant_id, class_option_id, session_date, class_session, status)
values
  ('ATT-APP-1', 'ATT-CO-A', date '2026-10-01', 'S1', 'present'),
  ('ATT-APP-2', 'ATT-CO-B', date '2026-10-01', 'S1', 'present');

insert into public.attendance_log (student_id, group_id, subgroup_id, class_option_id, class_number, class_date, present, made_up)
values
  ('ATT-S-1', 'ATT-G-1', 'ATT-SG-1', 'ATT-CO-A', '1', date '2026-10-01', true, false),
  ('ATT-S-2', 'ATT-G-2', 'ATT-SG-2', 'ATT-CO-B', '1', date '2026-10-01', true, false);

\set uidA '00000000-0000-4000-8000-00000000e001'
\set uidB '00000000-0000-4000-8000-00000000e002'
\set uidP '00000000-0000-4000-8000-00000000e003'
\set uidAd '00000000-0000-4000-8000-00000000e004'
\set uidSu '00000000-0000-4000-8000-00000000e005'
\set uidPa '00000000-0000-4000-8000-00000000e006'
\set uidPr '00000000-0000-4000-8000-00000000e007'
\set uidRS '00000000-0000-4000-8000-00000000e008'
\set uidSG '00000000-0000-4000-8000-00000000e009'

-- ---- 1. helper resolution in production form -----------------------------------------

select pg_temp.expect('current_teacher_id() resolves teacher A by email',
  pg_temp.scalar_as('authenticated', :'uidA', 'select public.current_teacher_id()') = 'ATT-T-A');
select pg_temp.expect('current_teacher_id() is null for pending user',
  pg_temp.scalar_as('authenticated', :'uidP', 'select coalesce(public.current_teacher_id(), ''NULL'')') = 'NULL');
select pg_temp.expect('current_profile_role() resolves admin',
  pg_temp.scalar_as('authenticated', :'uidAd', 'select public.current_profile_role()') = 'admin');
select pg_temp.expect('current_profile_role() resolves pending',
  pg_temp.scalar_as('authenticated', :'uidP', 'select public.current_profile_role()') = 'pending');

-- ---- 2. anonymous --------------------------------------------------------------------

select pg_temp.expect('anon reads zero attendance_records rows (denied or zero)', pg_temp.exec_as('anon', null, 'select 1 from public.attendance_records') in ('ROWS:0') or pg_temp.exec_as('anon', null, 'select 1 from public.attendance_records') like '%permission denied%');
select pg_temp.expect('anon reads zero attendance_log rows (denied or zero)', pg_temp.exec_as('anon', null, 'select 1 from public.attendance_log') in ('ROWS:0') or pg_temp.exec_as('anon', null, 'select 1 from public.attendance_log') like '%permission denied%');
select pg_temp.expect('anon insert into attendance_records is refused by RLS',
  pg_temp.exec_as('anon', null, $sql$insert into public.attendance_records (applicant_id, session_date) values ('X', date '2026-10-02')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('anon DELETE on attendance_records affects zero rows',
  pg_temp.exec_as('anon', null, $sql$delete from public.attendance_records$sql$) ~ '(ROWS:0|permission denied)');

-- ---- 3. authenticated non-owner denial -------------------------------------------------

select pg_temp.expect('pending user reads zero attendance_records rows', pg_temp.visible('authenticated', :'uidP', 'attendance_records') = 0);
select pg_temp.expect('pending user cannot insert attendance_records',
  pg_temp.exec_as('authenticated', :'uidP', $sql$insert into public.attendance_records (applicant_id, session_date) values ('X', date '2026-10-03')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('pending user updates zero attendance_records rows',
  pg_temp.exec_as('authenticated', :'uidP', $sql$update public.attendance_records set status = 'absent'$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('pending user deletes zero attendance_records rows',
  pg_temp.exec_as('authenticated', :'uidP', $sql$delete from public.attendance_records$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('pending user reads zero attendance_log rows', pg_temp.visible('authenticated', :'uidP', 'attendance_log') = 0);
select pg_temp.expect('pending user cannot insert attendance_log',
  pg_temp.exec_as('authenticated', :'uidP', $sql$insert into public.attendance_log (student_id, group_id, subgroup_id, class_option_id, class_number, class_date) values ('ATT-S-1','ATT-G-1','ATT-SG-1','ATT-CO-A','9', date '2026-10-03')$sql$) like '%row-level security%');

-- ---- 4. assigned teacher -----------------------------------------------------------------

select pg_temp.expect('teacher A reads exactly own-class attendance_records (1 of 2)',
  pg_temp.visible('authenticated', :'uidA', 'attendance_records') = 1);
select pg_temp.expect('teacher B reads exactly own-class attendance_records (1 of 2)',
  pg_temp.visible('authenticated', :'uidB', 'attendance_records') = 1);
select pg_temp.expect('teacher A updates zero attendance_records rows of teacher B',
  pg_temp.exec_as('authenticated', :'uidA', $sql$update public.attendance_records set status = 'x' where class_option_id = 'ATT-CO-B'$sql$) ~ '(ROWS:0|permission denied)');
select pg_temp.expect('teacher A attendance_log update on own class is admitted (production policy)',
  pg_temp.exec_as('authenticated', :'uidA', $sql$update public.attendance_log set present = true where class_option_id = 'ATT-CO-A'$sql$) = 'ROWS:1');
select pg_temp.expect('teacher A attendance_log update on teacher B class affects zero rows',
  pg_temp.exec_as('authenticated', :'uidA', $sql$update public.attendance_log set present = false where class_option_id = 'ATT-CO-B'$sql$) = 'ROWS:0');
select pg_temp.expect('teacher A reads exactly own-class attendance_log (1 of 2)',
  pg_temp.visible('authenticated', :'uidA', 'attendance_log') = 1);
-- Behaviour change, owner-visible: no direct teacher write path to attendance_records after containment.
select pg_temp.expect('teacher A direct insert into attendance_records is refused (no direct write path; edge function uses service role)',
  pg_temp.exec_as('authenticated', :'uidA', $sql$insert into public.attendance_records (applicant_id, class_option_id, session_date) values ('ATT-APP-3','ATT-CO-A', date '2026-10-08')$sql$) ~ '(row-level security|permission denied)');

-- ---- 5. staff matrix -------------------------------------------------------------------

select pg_temp.expect('admin reads all attendance_records (2)', pg_temp.visible('authenticated', :'uidAd', 'attendance_records') = 2);
select pg_temp.expect('superadmin reads all attendance_records (2)', pg_temp.visible('authenticated', :'uidSu', 'attendance_records') = 2);
select pg_temp.expect('principal reads all attendance_records (2)', pg_temp.visible('authenticated', :'uidPr', 'attendance_records') = 2);
select pg_temp.expect('regional_secretary reads all attendance_records (2)', pg_temp.visible('authenticated', :'uidRS', 'attendance_records') = 2);
select pg_temp.expect('regional_secretary cannot insert attendance_records',
  pg_temp.exec_as('authenticated', :'uidRS', $sql$insert into public.attendance_records (applicant_id, session_date) values ('X', date '2026-10-09')$sql$) ~ '(row-level security|permission denied)');
select pg_temp.expect('admin direct update of attendance_records is denied (writes are service-role only)',
  pg_temp.exec_as('authenticated', :'uidAd', $sql$update public.attendance_records set status = 'excused'$sql$) ~ '(ROWS:0|permission denied)');
-- Pastor and subgroup_admin: no attendance_records read after containment. Not widened.
select pg_temp.expect('pastor reads zero attendance_records rows (not widened)', pg_temp.visible('authenticated', :'uidPa', 'attendance_records') = 0);
select pg_temp.expect('subgroup_admin reads zero attendance_records rows (not widened; owner decision)', pg_temp.visible('authenticated', :'uidSG', 'attendance_records') = 0);
-- attendance_log for pastor and subgroup_admin is pre-existing production access via is_admin_like(). Recorded, not changed.
select pg_temp.expect('pastor attendance_log read is unchanged from production (is_admin_like path)', pg_temp.visible('authenticated', :'uidPa', 'attendance_log') = 2);
select pg_temp.expect('subgroup_admin attendance_log read is unchanged from production (is_admin_like path)', pg_temp.visible('authenticated', :'uidSG', 'attendance_log') = 2);

-- ---- 6. service role -------------------------------------------------------------------

select pg_temp.exec_as('service_role', null,
  $sql$insert into public.attendance_log (student_id, group_id, subgroup_id, batch_id, class_option_id, class_number, class_date, present, made_up)
       values ('ATT-S-1', 'ATT-G-1', 'ATT-SG-1', 'ATT-B1', 'ATT-CO-A', '5', date '2026-10-11', false, false)$sql$) as svc_absence_result \gset
select pg_temp.expect('service_role absence insert into attendance_log is admitted', :'svc_absence_result' = 'ROWS:1');
select pg_temp.expect('absence insert fires the makeup trigger (+1 makeup_queue row for the student)',
  (select count(*) from public.makeup_queue where student_id = 'ATT-S-1') = 1);
select pg_temp.expect('service_role reads all attendance_records (2, bypasses RLS)',
  pg_temp.visible('service_role', null, 'attendance_records') = 2);
select pg_temp.expect('service_role insert into attendance_records is not refused by RLS',
  pg_temp.exec_as('service_role', null, $sql$insert into public.attendance_records (applicant_id, class_option_id, session_date) values ('ATT-SVC', 'ATT-CO-A', date '2026-10-10')$sql$) = 'ROWS:1');

-- ---- 7. effective privileges (grant hardening in this migration) ----------------------

select pg_temp.expect('authenticated: attendance_records is SELECT only',
  has_table_privilege('authenticated','public.attendance_records','SELECT')
  and not has_table_privilege('authenticated','public.attendance_records','INSERT')
  and not has_table_privilege('authenticated','public.attendance_records','UPDATE')
  and not has_table_privilege('authenticated','public.attendance_records','DELETE')
  and not has_table_privilege('authenticated','public.attendance_records','TRUNCATE')
  and not has_table_privilege('authenticated','public.attendance_records','REFERENCES')
  and not has_table_privilege('authenticated','public.attendance_records','TRIGGER'));
select pg_temp.expect('authenticated: attendance_log keeps SELECT/INSERT/UPDATE, loses DELETE/TRUNCATE/REFERENCES/TRIGGER',
  has_table_privilege('authenticated','public.attendance_log','SELECT')
  and has_table_privilege('authenticated','public.attendance_log','INSERT')
  and has_table_privilege('authenticated','public.attendance_log','UPDATE')
  and not has_table_privilege('authenticated','public.attendance_log','DELETE')
  and not has_table_privilege('authenticated','public.attendance_log','TRUNCATE')
  and not has_table_privilege('authenticated','public.attendance_log','REFERENCES')
  and not has_table_privilege('authenticated','public.attendance_log','TRIGGER'));
select pg_temp.expect('anon: no privilege on either attendance table',
  not (has_table_privilege('anon','public.attendance_records','SELECT') or has_table_privilege('anon','public.attendance_records','INSERT')
    or has_table_privilege('anon','public.attendance_records','UPDATE') or has_table_privilege('anon','public.attendance_records','DELETE')
    or has_table_privilege('anon','public.attendance_records','TRUNCATE') or has_table_privilege('anon','public.attendance_log','SELECT')
    or has_table_privilege('anon','public.attendance_log','INSERT') or has_table_privilege('anon','public.attendance_log','TRUNCATE')));
select pg_temp.expect('service_role keeps full privilege on both tables',
  has_table_privilege('service_role','public.attendance_records','INSERT') and has_table_privilege('service_role','public.attendance_records','TRUNCATE')
  and has_table_privilege('service_role','public.attendance_log','INSERT') and has_table_privilege('service_role','public.attendance_log','DELETE'));

-- Direct SQL TRUNCATE denial, probed inside savepoints that are rolled back.
savepoint trunc_probe_p;
select pg_temp.exec_as('authenticated', :'uidP', 'truncate public.attendance_records') as pending_truncate_result \gset
rollback to savepoint trunc_probe_p;
select pg_temp.expect('pending authenticated TRUNCATE of attendance_records is denied', :'pending_truncate_result' like '%permission denied%');
savepoint trunc_probe_a;
select pg_temp.exec_as('anon', null, 'truncate public.attendance_records') as anon_truncate_result \gset
rollback to savepoint trunc_probe_a;
select pg_temp.expect('anon TRUNCATE of attendance_records is denied', :'anon_truncate_result' like '%permission denied%');
savepoint trunc_probe_log;
select pg_temp.exec_as('authenticated', :'uidA', 'truncate public.attendance_log') as teacher_log_truncate_result \gset
rollback to savepoint trunc_probe_log;
select pg_temp.expect('teacher TRUNCATE of attendance_log is denied', :'teacher_log_truncate_result' like '%permission denied%');

-- ---- 8. policy surface -------------------------------------------------------------------

select pg_temp.expect('attendance_records has exactly the two post-containment policies',
  (select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname='public' and tablename='attendance_records')
  = 'attendance_records_staff_select,attendance_records_teacher_select_assigned');
select pg_temp.expect('no broad authenticated policy remains on attendance_records',
  not exists (select 1 from pg_policies where schemaname='public' and tablename='attendance_records'
    and (qual like '%auth.role()%' or with_check like '%auth.role()%')));

rollback;
