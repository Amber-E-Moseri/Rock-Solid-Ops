begin;

-- =============================================================
-- Foundation School RLS Hardening
-- Date: 2026-05-06
-- Goal: Replace permissive client-trust policies with server-enforced
-- role and ownership checks while preserving current workflows.
-- =============================================================

-- -------------------------------------------------------------
-- 1) Helper authorization functions
-- -------------------------------------------------------------

create or replace function public.current_profile_role()
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  -- Primary role source
  if to_regclass('public.profiles') is not null then
    select p.role
      into v_role
    from public.profiles p
    where p.user_id = auth.uid()
      and coalesce(p.is_active, true) = true
    limit 1;
  end if;

  -- Fallback role source used by existing admin portal
  if v_role is null and to_regclass('public.admin_users') is not null then
    select a.role
      into v_role
    from public.admin_users a
    where a.auth_user_id = auth.uid()
    limit 1;
  end if;

  return v_role;
end;
$$;

comment on function public.current_profile_role() is
'Returns effective caller role from profiles, with admin_users fallback for legacy admin portal.';

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.current_profile_role() = 'superadmin', false)
$$;

comment on function public.is_superadmin() is
'True only when caller role resolves to superadmin.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    public.current_profile_role() in ('superadmin','admin','subgroup_admin','pastor','principal'),
    false
  )
$$;

comment on function public.is_admin() is
'True for admin-like roles used by Foundation School staff/admin portal.';

create or replace function public.current_teacher_id()
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_teacher_id text;
begin
  if to_regclass('public.teachers') is null then
    return null;
  end if;

  select t.teacher_id
    into v_teacher_id
  from public.teachers t
  join auth.users u
    on lower(coalesce(u.email, '')) = lower(coalesce(t.email, ''))
  where u.id = auth.uid()
    and coalesce(t.active, true) = true
    and t.deleted_at is null
  limit 1;

  return v_teacher_id;
end;
$$;

comment on function public.current_teacher_id() is
'Best-effort mapping of authenticated user to teacher_id via email match.';

-- -------------------------------------------------------------
-- 2) Ensure RLS is enabled on active application tables
-- -------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'admin_users',
    'profiles',
    'batches',
    'batch_moodle_courses',
    'moodle_courses',
    'class_options',
    'class_slots',
    'fellowship_map',
    'teachers',
    'teacher_availability',
    'students',
    'class_roster',
    'attendance_log',
    'session_outcomes',
    'applicants',
    'email_queue',
    'scheduled_notifications',
    'notification_events',
    'notification_rules',
    'notification_templates',
    'applicant_notification_state',
    'sync_log',
    'moodle_sync',
    'audit_log',
    'audit_logs'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------
-- 3) Drop known permissive policies that relied on authenticated=true
-- -------------------------------------------------------------

-- Legacy broad staff write policies from 003
DROP POLICY IF EXISTS teachers_staff_insert ON public.teachers;
DROP POLICY IF EXISTS teachers_staff_update ON public.teachers;
DROP POLICY IF EXISTS teachers_staff_delete ON public.teachers;

DROP POLICY IF EXISTS class_options_staff_insert ON public.class_options;
DROP POLICY IF EXISTS class_options_staff_update ON public.class_options;
DROP POLICY IF EXISTS class_options_staff_delete ON public.class_options;

DROP POLICY IF EXISTS class_slots_staff_insert ON public.class_slots;
DROP POLICY IF EXISTS class_slots_staff_update ON public.class_slots;
DROP POLICY IF EXISTS class_slots_staff_delete ON public.class_slots;

DROP POLICY IF EXISTS teacher_availability_staff_insert ON public.teacher_availability;
DROP POLICY IF EXISTS teacher_availability_staff_update ON public.teacher_availability;

DROP POLICY IF EXISTS applicants_staff_update ON public.applicants;
DROP POLICY IF EXISTS applicants_staff_delete ON public.applicants;

DROP POLICY IF EXISTS email_queue_staff_insert ON public.email_queue;
DROP POLICY IF EXISTS email_queue_staff_update ON public.email_queue;

DROP POLICY IF EXISTS batches_staff_insert ON public.batches;
DROP POLICY IF EXISTS batches_staff_update ON public.batches;
DROP POLICY IF EXISTS batches_staff_delete ON public.batches;

DROP POLICY IF EXISTS fellowship_map_staff_insert ON public.fellowship_map;
DROP POLICY IF EXISTS fellowship_map_staff_update ON public.fellowship_map;
DROP POLICY IF EXISTS fellowship_map_staff_delete ON public.fellowship_map;

DROP POLICY IF EXISTS sync_log_staff_insert ON public.sync_log;

-- Session outcomes had a blanket authenticated insert
DROP POLICY IF EXISTS session_outcomes_staff_insert ON public.session_outcomes;

-- Notification tables had blanket authenticated selects
DROP POLICY IF EXISTS "notification_events_authenticated_select" ON public.notification_events;
DROP POLICY IF EXISTS "notification_rules_authenticated_select" ON public.notification_rules;
DROP POLICY IF EXISTS "scheduled_notifications_authenticated_select" ON public.scheduled_notifications;
DROP POLICY IF EXISTS "applicant_notification_state_authenticated_select" ON public.applicant_notification_state;
DROP POLICY IF EXISTS "notification_templates_authenticated_select" ON public.notification_templates;

-- -------------------------------------------------------------
-- 4) Public / registration-safe policies
-- -------------------------------------------------------------

-- Keep public campus/class/batch reads for registration UX only.
DROP POLICY IF EXISTS fellowship_map_anon_select ON public.fellowship_map;
CREATE POLICY fellowship_map_anon_select
ON public.fellowship_map
FOR SELECT TO anon
USING (coalesce(active, true) = true);

DROP POLICY IF EXISTS class_options_anon_select ON public.class_options;
CREATE POLICY class_options_anon_select
ON public.class_options
FOR SELECT TO anon
USING (
  coalesce(active, false) = true
  AND coalesce(enrollment_open, false) = true
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS batches_anon_select ON public.batches;
CREATE POLICY batches_anon_select
ON public.batches
FOR SELECT TO anon
USING (coalesce(registration_open, false) = true AND coalesce(archived, false) = false);

-- Public registration submit is allowed; row constraints prevent blank spam rows.
DROP POLICY IF EXISTS applicants_anon_insert ON public.applicants;
CREATE POLICY applicants_anon_insert
ON public.applicants
FOR INSERT TO anon
WITH CHECK (
  coalesce(trim(email), '') <> ''
  AND coalesce(trim(first_name), '') <> ''
);

-- -------------------------------------------------------------
-- 5) Admin-only policies (sensitive writes / queues / audit)
-- -------------------------------------------------------------

-- Admin users table: read self + admins; writes restricted to admins.
DO $$
BEGIN
  IF to_regclass('public.admin_users') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS admin_users_self_or_admin_select ON public.admin_users';
    EXECUTE 'DROP POLICY IF EXISTS admin_users_admin_write ON public.admin_users';
    EXECUTE 'CREATE POLICY admin_users_self_or_admin_select ON public.admin_users FOR SELECT TO authenticated USING (auth_user_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY admin_users_admin_write ON public.admin_users FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
  END IF;
END $$;

-- Core admin-managed config tables
CREATE POLICY batches_admin_all
ON public.batches
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS class_options_admin_all ON public.class_options;
CREATE POLICY class_options_admin_all
ON public.class_options
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY class_slots_admin_all
ON public.class_slots
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY fellowship_map_admin_all
ON public.fellowship_map
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY teachers_admin_all
ON public.teachers
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS applicants_admin_all ON public.applicants;
CREATE POLICY applicants_admin_all_hardened
ON public.applicants
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS email_queue_admin_all ON public.email_queue;
CREATE POLICY email_queue_admin_all_hardened
ON public.email_queue
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY scheduled_notifications_admin_all_hardened
ON public.scheduled_notifications
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY notification_events_admin_all
ON public.notification_events
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY notification_rules_admin_all
ON public.notification_rules
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY notification_templates_admin_all
ON public.notification_templates
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY applicant_notification_state_admin_all
ON public.applicant_notification_state
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY sync_log_admin_all
ON public.sync_log
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY moodle_sync_admin_all
ON public.moodle_sync
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Support both singular and plural audit table naming in this repo.
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY audit_log_admin_all ON public.audit_log FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY audit_logs_admin_all ON public.audit_logs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
  END IF;
END $$;

-- Moodle course mappings: admin-only writes and reads by default.
DO $$
BEGIN
  IF to_regclass('public.batch_moodle_courses') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS batch_moodle_staff_select ON public.batch_moodle_courses';
    EXECUTE 'DROP POLICY IF EXISTS batch_moodle_superadmin_insert ON public.batch_moodle_courses';
    EXECUTE 'DROP POLICY IF EXISTS batch_moodle_superadmin_update ON public.batch_moodle_courses';
    EXECUTE 'DROP POLICY IF EXISTS batch_moodle_superadmin_delete ON public.batch_moodle_courses';

    EXECUTE 'CREATE POLICY batch_moodle_admin_all ON public.batch_moodle_courses FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
    EXECUTE 'DROP POLICY IF EXISTS batch_moodle_anon_select ON public.batch_moodle_courses';
    EXECUTE 'CREATE POLICY batch_moodle_anon_select ON public.batch_moodle_courses FOR SELECT TO anon USING (coalesce(active, false) = true)';
  END IF;

  IF to_regclass('public.moodle_courses') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY moodle_courses_admin_all ON public.moodle_courses FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 6) Teacher-scoped policies
-- -------------------------------------------------------------

-- Teacher availability: teachers can only create/update their own rows.
CREATE POLICY teacher_availability_admin_all
ON public.teacher_availability
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY teacher_availability_teacher_select_own
ON public.teacher_availability
FOR SELECT TO authenticated
USING (
  teacher_id = public.current_teacher_id()
);

CREATE POLICY teacher_availability_teacher_insert_own
ON public.teacher_availability
FOR INSERT TO authenticated
WITH CHECK (
  teacher_id = public.current_teacher_id()
  AND coalesce(status, 'Tentative') IN ('Tentative', 'Pending', 'Submitted')
);

CREATE POLICY teacher_availability_teacher_update_own
ON public.teacher_availability
FOR UPDATE TO authenticated
USING (
  teacher_id = public.current_teacher_id()
)
WITH CHECK (
  teacher_id = public.current_teacher_id()
  AND coalesce(status, 'Tentative') NOT IN ('Available','Unavailable','Suspended','SuspendedConfirmed')
);

-- Teachers can read their own assignment rows in class options.
DROP POLICY IF EXISTS class_options_teacher_select_assigned ON public.class_options;
CREATE POLICY class_options_teacher_select_assigned_hardened
ON public.class_options
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR teacher_id = public.current_teacher_id()
);

-- Teachers can read their own students + roster rows.
CREATE POLICY students_teacher_select_assigned
ON public.students
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR exists (
    select 1
    from public.class_options co
    where co.class_option_id = students.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

CREATE POLICY class_roster_teacher_select_assigned
ON public.class_roster
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR exists (
    select 1
    from public.class_options co
    where co.class_option_id = class_roster.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

-- Attendance log: teachers can read/write only for classes they teach.
CREATE POLICY attendance_log_teacher_select_assigned
ON public.attendance_log
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR exists (
    select 1
    from public.class_options co
    where co.class_option_id = attendance_log.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

CREATE POLICY attendance_log_teacher_insert_assigned
ON public.attendance_log
FOR INSERT TO authenticated
WITH CHECK (
  public.is_admin()
  OR exists (
    select 1
    from public.class_options co
    where co.class_option_id = attendance_log.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

CREATE POLICY attendance_log_teacher_update_assigned
ON public.attendance_log
FOR UPDATE TO authenticated
USING (
  public.is_admin()
  OR exists (
    select 1
    from public.class_options co
    where co.class_option_id = attendance_log.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
)
WITH CHECK (
  public.is_admin()
  OR exists (
    select 1
    from public.class_options co
    where co.class_option_id = attendance_log.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

-- Session outcomes: teacher-scoped by class assignment.
CREATE POLICY session_outcomes_admin_all_hardened
ON public.session_outcomes
FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY session_outcomes_teacher_select_assigned
ON public.session_outcomes
FOR SELECT TO authenticated
USING (
  exists (
    select 1
    from public.class_options co
    where co.class_option_id = session_outcomes.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

CREATE POLICY session_outcomes_teacher_insert_assigned
ON public.session_outcomes
FOR INSERT TO authenticated
WITH CHECK (
  exists (
    select 1
    from public.class_options co
    where co.class_option_id = session_outcomes.class_option_id
      and co.teacher_id = public.current_teacher_id()
  )
);

-- -------------------------------------------------------------
-- 7) Authenticated read policies to preserve current UX
-- -------------------------------------------------------------

-- Allow authenticated users to read active fellowship/campus map.
CREATE POLICY fellowship_map_authenticated_select
ON public.fellowship_map
FOR SELECT TO authenticated
USING (coalesce(active, true) = true OR public.is_admin());

-- Allow authenticated users to read active teachers for schedule autofill.
CREATE POLICY teachers_authenticated_select_limited
ON public.teachers
FOR SELECT TO authenticated
USING (public.is_admin() OR (coalesce(active, true) = true AND deleted_at IS NULL));

-- Allow authenticated users to read currently active/open batches for scheduling.
CREATE POLICY batches_authenticated_select
ON public.batches
FOR SELECT TO authenticated
USING (public.is_admin() OR coalesce(active, false) = true OR coalesce(registration_open, false) = true);

-- -------------------------------------------------------------
-- 8) Tighten profile access (self or admin)
-- -------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS profiles_self_select ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS profiles_self_update ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS profiles_self_or_admin_select ON public.profiles';
    EXECUTE 'DROP POLICY IF EXISTS profiles_self_or_admin_update ON public.profiles';
    EXECUTE 'CREATE POLICY profiles_self_or_admin_select ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY profiles_self_or_admin_update ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.is_admin()) WITH CHECK (user_id = auth.uid() OR public.is_admin())';
  END IF;
END $$;

commit;
