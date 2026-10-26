-- =============================================================================
-- Attendance RLS containment
-- =============================================================================
-- Closes the broad authenticated policies on attendance tables.
--
-- Confirmed on Rock Solid staging (catalog, 2026-10-24):
--   * attendance_records.auth_write (ALL, auth.role() = 'authenticated') lets any signed-in user
--     insert, update and delete every attendance_records row.
--   * attendance_records.auth_read (SELECT, same predicate) lets any signed-in user read every row.
--   * attendance_log.attendance_log_staff_select / _insert / _update (USING true / WITH CHECK true,
--     TO authenticated) let any signed-in user read, insert and update every attendance_log row.
--
-- Production (foundation-school, catalog, 2026-10-24) has auth_read and auth_write on
-- attendance_records and NO teacher-scoped or admin attendance_records policies. It has no
-- attendance_log_staff_* policies. That production shape is why this migration also adds a
-- teacher-scoped SELECT policy: without it, teachers would lose their own-class read on production.
--
-- Changes (policies only):
--   1. Drop attendance_records.auth_write and attendance_records.auth_read.
--   2. Add attendance_records_staff_select: SELECT for superadmin, admin, principal and
--      regional_secretary (the roles the role matrix gives full attendance read).
--   3. Add attendance_records_teacher_select_assigned: SELECT for a teacher on rows of their own
--      class options. Same predicate as attendance_records_teacher_select_own, under a new name,
--      so it exists on both staging and production.
--   4. Drop attendance_log_staff_select, attendance_log_staff_insert, attendance_log_staff_update.
--      On production these do not exist, so the drops are no-ops there.
--
-- Kept unchanged:
--   * attendance_records_admin_all, attendance_records_teacher_insert_own / _update_own,
--     attendance_records_teacher_select_own, attendance_records_pastor_select_subgroup (staging).
--   * attendance_admin_all, attendance_log_teacher_* policies (staging); attendance_log_read,
--     attendance_log_update, attendance_log_write, attendance_teacher_rw_assigned (production).
--   * All grants, including anon and authenticated. Service-role access is grant-based and unaffected.
--   * Table structures, indexes, constraints and triggers.
--
-- Open owner decisions (see docs/ATTENDANCE_RLS_CONTAINMENT.md): subgroup_admin has no
-- attendance_records read policy after this migration; attendance_admin_all on staging already gives
-- every is_admin() role full attendance_log access, which is unchanged.
--
-- Grant hardening (section 5): anon loses all privileges on both tables; authenticated loses direct
-- writes to attendance_records and DELETE/TRUNCATE/REFERENCES/TRIGGER on both tables. Re-running REVOKE is a no-op.
-- Idempotent: DROP POLICY IF EXISTS, drop-before-create, and REVOKE.
-- =============================================================================

begin;

-- 1) attendance_records: remove the broad authenticated policies.
drop policy if exists auth_write on public.attendance_records;
drop policy if exists auth_read on public.attendance_records;

-- 2) attendance_records: explicit staff read.
drop policy if exists attendance_records_staff_select on public.attendance_records;
create policy attendance_records_staff_select
on public.attendance_records
for select
to authenticated
using (
  coalesce(public.current_profile_role() in ('superadmin', 'admin', 'principal', 'regional_secretary'), false)
);

-- 3) attendance_records: teacher read of own class options.
drop policy if exists attendance_records_teacher_select_assigned on public.attendance_records;
create policy attendance_records_teacher_select_assigned
on public.attendance_records
for select
to authenticated
using (
  exists (
    select 1
    from public.class_options co
    where co.class_option_id = attendance_records.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

-- 4) attendance_log: remove the three broad staff policies (no-op where they do not exist).
drop policy if exists attendance_log_staff_select on public.attendance_log;
drop policy if exists attendance_log_staff_insert on public.attendance_log;
drop policy if exists attendance_log_staff_update on public.attendance_log;

-- 5) Grant hardening (minimal). RLS does not filter TRUNCATE, and REFERENCES/TRIGGER are never needed
--    by a browser role. Service-role grants are not touched.
--    anon: no privilege on either attendance table (RLS already denied every row; grants are now also closed).
revoke all on public.attendance_records from anon;
revoke all on public.attendance_log from anon;
--    authenticated: attendance_records is read-only (writes are service-role only).
revoke insert, update, delete, truncate, references, trigger on public.attendance_records from authenticated;
--    authenticated: attendance_log keeps SELECT, INSERT and UPDATE (used by RLS-governed admin and
--    assigned-teacher paths). DELETE, TRUNCATE, REFERENCES and TRIGGER are removed.
revoke delete, truncate, references, trigger on public.attendance_log from authenticated;

commit;
