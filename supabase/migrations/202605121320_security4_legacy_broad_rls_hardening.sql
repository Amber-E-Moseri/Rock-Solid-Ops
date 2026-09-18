begin;

-- SECURITY 4: legacy broad RLS policy hardening on selected tables only.
-- Keep service_role behavior unchanged (service_role bypasses RLS).

-- Ensure RLS enabled on in-scope base tables when present.
do $$
declare
  t text;
begin
  foreach t in array array[
    'teacher_availability',
    'class_options',
    'teachers',
    'moodle_sync',
    'class_roster',
    'class_slots',
    'makeup_queue',
    'sync_log',
    'fellowship_map',
    'applicants'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- audit_log may be table or legacy compatibility view; only alter if it is a table.
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_log'
      and c.relkind in ('r', 'p')
  ) then
    execute 'alter table public.audit_log enable row level security';
  end if;
end $$;

-- Remove legacy broad TRUE-based policies and related unsafe staff-wide policies.
drop policy if exists teacher_availability_staff_select on public.teacher_availability;
drop policy if exists teacher_availability_staff_insert on public.teacher_availability;
drop policy if exists teacher_availability_staff_update on public.teacher_availability;
drop policy if exists teacher_availability_anon_update on public.teacher_availability;
drop policy if exists teacher_availability_anon_all on public.teacher_availability;

drop policy if exists class_options_staff_select on public.class_options;
drop policy if exists class_options_staff_insert on public.class_options;
drop policy if exists class_options_staff_update on public.class_options;
drop policy if exists class_options_staff_delete on public.class_options;

drop policy if exists teachers_staff_select on public.teachers;
drop policy if exists teachers_staff_insert on public.teachers;
drop policy if exists teachers_staff_update on public.teachers;
drop policy if exists teachers_staff_delete on public.teachers;

drop policy if exists class_roster_staff_select on public.class_roster;
drop policy if exists class_roster_staff_insert on public.class_roster;
drop policy if exists class_roster_staff_update on public.class_roster;

drop policy if exists class_slots_staff_select on public.class_slots;
drop policy if exists class_slots_staff_insert on public.class_slots;
drop policy if exists class_slots_staff_update on public.class_slots;
drop policy if exists class_slots_staff_delete on public.class_slots;

drop policy if exists makeup_queue_staff_select on public.makeup_queue;
drop policy if exists makeup_queue_staff_insert on public.makeup_queue;
drop policy if exists makeup_queue_staff_update on public.makeup_queue;

drop policy if exists sync_log_staff_select on public.sync_log;
drop policy if exists sync_log_staff_insert on public.sync_log;

drop policy if exists fellowship_map_staff_select on public.fellowship_map;
drop policy if exists fellowship_map_staff_insert on public.fellowship_map;
drop policy if exists fellowship_map_staff_update on public.fellowship_map;
drop policy if exists fellowship_map_staff_delete on public.fellowship_map;

drop policy if exists applicants_staff_select on public.applicants;
drop policy if exists applicants_staff_update on public.applicants;
drop policy if exists applicants_staff_delete on public.applicants;

drop policy if exists moodle_sync_staff_select on public.moodle_sync;
drop policy if exists moodle_sync_staff_insert on public.moodle_sync;
drop policy if exists moodle_sync_staff_update on public.moodle_sync;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_log'
      and c.relkind in ('r', 'p')
  ) then
    execute 'drop policy if exists audit_log_staff_select on public.audit_log';
  end if;
end $$;

-- Scoped/admin-safe policies for listed tables.
drop policy if exists class_options_admin_all on public.class_options;
create policy class_options_admin_all
on public.class_options
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists class_slots_admin_all on public.class_slots;
create policy class_slots_admin_all
on public.class_slots
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists fellowship_map_admin_all on public.fellowship_map;
create policy fellowship_map_admin_all
on public.fellowship_map
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists teachers_admin_all on public.teachers;
create policy teachers_admin_all
on public.teachers
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists applicants_admin_all on public.applicants;
drop policy if exists applicants_admin_all_hardened on public.applicants;
create policy applicants_admin_all_hardened
on public.applicants
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists class_roster_admin_all on public.class_roster;
create policy class_roster_admin_all
on public.class_roster
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists teacher_availability_admin_all on public.teacher_availability;
create policy teacher_availability_admin_all
on public.teacher_availability
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists sync_log_admin_all on public.sync_log;
create policy sync_log_admin_all
on public.sync_log
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists moodle_sync_admin_all on public.moodle_sync;
create policy moodle_sync_admin_all
on public.moodle_sync
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists makeup_queue_admin_all on public.makeup_queue;
create policy makeup_queue_admin_all
on public.makeup_queue
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_log'
      and c.relkind in ('r', 'p')
  ) then
    execute 'drop policy if exists audit_log_admin_all on public.audit_log';
    execute 'create policy audit_log_admin_all on public.audit_log for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;

-- Preserve explicit safe public/teacher-scoped behavior where operationally needed.
drop policy if exists fellowship_map_anon_select on public.fellowship_map;
create policy fellowship_map_anon_select
on public.fellowship_map
for select to anon
using (coalesce(active, true) = true);

drop policy if exists class_options_anon_select on public.class_options;
create policy class_options_anon_select
on public.class_options
for select to anon
using (
  coalesce(active, false) = true
  and coalesce(enrollment_open, false) = true
  and deleted_at is null
);

drop policy if exists teachers_anon_select on public.teachers;
create policy teachers_anon_select
on public.teachers
for select to anon
using (coalesce(active, true) = true and deleted_at is null);

drop policy if exists applicants_anon_insert on public.applicants;
create policy applicants_anon_insert
on public.applicants
for insert to anon
with check (
  coalesce(trim(email), '') <> ''
  and coalesce(trim(first_name), '') <> ''
);

drop policy if exists fellowship_map_authenticated_select on public.fellowship_map;
create policy fellowship_map_authenticated_select
on public.fellowship_map
for select to authenticated
using (coalesce(active, true) = true or public.is_admin());

drop policy if exists teachers_authenticated_select_limited on public.teachers;
create policy teachers_authenticated_select_limited
on public.teachers
for select to authenticated
using (public.is_admin() or (coalesce(active, true) = true and deleted_at is null));

drop policy if exists class_options_teacher_select_assigned on public.class_options;
drop policy if exists class_options_teacher_select_assigned_hardened on public.class_options;
create policy class_options_teacher_select_assigned_hardened
on public.class_options
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.teachers t
    where t.teacher_id::text = class_options.teacher_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

drop policy if exists class_slots_teacher_select_assigned on public.class_slots;
create policy class_slots_teacher_select_assigned
on public.class_slots
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.class_options co
    join public.teachers t
      on t.teacher_id::text = co.teacher_id::text
    where co.class_option_id::text = class_slots.class_option_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

drop policy if exists class_roster_teacher_select_assigned on public.class_roster;
create policy class_roster_teacher_select_assigned
on public.class_roster
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.class_options co
    join public.teachers t
      on t.teacher_id::text = co.teacher_id::text
    where co.class_option_id::text = class_roster.class_option_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

drop policy if exists teacher_availability_teacher_select_own on public.teacher_availability;
create policy teacher_availability_teacher_select_own
on public.teacher_availability
for select to authenticated
using (
  exists (
    select 1
    from public.teachers t
    where t.teacher_id::text = teacher_availability.teacher_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

drop policy if exists teacher_availability_teacher_insert_own on public.teacher_availability;
create policy teacher_availability_teacher_insert_own
on public.teacher_availability
for insert to authenticated
with check (
  exists (
    select 1
    from public.teachers t
    where t.teacher_id::text = teacher_availability.teacher_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
  and coalesce(status, 'Tentative') in ('Tentative', 'Pending', 'Submitted')
);

drop policy if exists teacher_availability_teacher_update_own on public.teacher_availability;
create policy teacher_availability_teacher_update_own
on public.teacher_availability
for update to authenticated
using (
  exists (
    select 1
    from public.teachers t
    where t.teacher_id::text = teacher_availability.teacher_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.teachers t
    where t.teacher_id::text = teacher_availability.teacher_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
  and coalesce(status, 'Tentative') not in ('Available', 'Unavailable', 'Suspended', 'SuspendedConfirmed')
);

drop policy if exists applicants_teacher_select_assigned on public.applicants;
create policy applicants_teacher_select_assigned
on public.applicants
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.class_options co
    join public.teachers t
      on t.teacher_id::text = co.teacher_id::text
    where co.class_option_id::text = applicants.class_option_id::text
      and (
        t.teacher_user_id = auth.uid()
        or (
          t.teacher_user_id is null
          and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

commit;

