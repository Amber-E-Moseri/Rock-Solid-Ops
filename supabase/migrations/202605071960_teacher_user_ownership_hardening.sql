begin;

-- 1) Add canonical teacher ownership link to auth.users.
alter table if exists public.teachers
  add column if not exists teacher_user_id uuid null references auth.users(id) on delete set null;

create index if not exists idx_teachers_teacher_user_id on public.teachers(teacher_user_id);

-- 2) Backfill using fully-qualified auth.users in FROM clause.
update public.teachers t
set teacher_user_id = au.id
from auth.users au
where t.teacher_user_id is null
  and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(au.email, '')))
  and coalesce(trim(t.email), '') <> '';

comment on column public.teachers.teacher_user_id is
'Canonical teacher->auth.users link for ownership checks. Email match fallback in RLS is transitional and should be removed after all teacher rows are linked.';

-- 3/4) Rewrite teacher RLS policies: prefer teacher_user_id=auth.uid();
--      fallback to email-match only when teacher_user_id is null.

do $$
begin
  -- class_options teacher read
  execute 'drop policy if exists class_options_teacher_select_assigned on public.class_options';
  execute 'drop policy if exists class_options_teacher_select_assigned_hardened on public.class_options';
  execute $sql$
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
    )
  $sql$;

  -- students teacher read assigned
  execute 'drop policy if exists students_teacher_select_assigned on public.students';
  execute $sql$
    create policy students_teacher_select_assigned
    on public.students
    for select to authenticated
    using (
      public.is_admin()
      or exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = students.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  -- class_roster teacher read assigned
  execute 'drop policy if exists class_roster_teacher_select_assigned on public.class_roster';
  execute $sql$
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
        where co.class_option_id = class_roster.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  -- attendance_log teacher read/write assigned
  execute 'drop policy if exists attendance_teacher_rw_assigned on public.attendance_log';
  execute 'drop policy if exists attendance_log_teacher_select_assigned on public.attendance_log';
  execute 'drop policy if exists attendance_log_teacher_insert_assigned on public.attendance_log';
  execute 'drop policy if exists attendance_log_teacher_update_assigned on public.attendance_log';

  execute $sql$
    create policy attendance_log_teacher_select_assigned
    on public.attendance_log
    for select to authenticated
    using (
      public.is_admin()
      or exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = attendance_log.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  execute $sql$
    create policy attendance_log_teacher_insert_assigned
    on public.attendance_log
    for insert to authenticated
    with check (
      public.is_admin()
      or exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = attendance_log.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  execute $sql$
    create policy attendance_log_teacher_update_assigned
    on public.attendance_log
    for update to authenticated
    using (
      public.is_admin()
      or exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = attendance_log.class_option_id
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
      public.is_admin()
      or exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = attendance_log.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  -- session_outcomes teacher read/insert assigned
  execute 'drop policy if exists session_outcomes_teacher_select_assigned on public.session_outcomes';
  execute 'drop policy if exists session_outcomes_teacher_insert_assigned on public.session_outcomes';

  execute $sql$
    create policy session_outcomes_teacher_select_assigned
    on public.session_outcomes
    for select to authenticated
    using (
      exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = session_outcomes.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  execute $sql$
    create policy session_outcomes_teacher_insert_assigned
    on public.session_outcomes
    for insert to authenticated
    with check (
      exists (
        select 1
        from public.class_options co
        join public.teachers t
          on t.teacher_id::text = co.teacher_id::text
        where co.class_option_id = session_outcomes.class_option_id
          and (
            t.teacher_user_id = auth.uid()
            or (
              t.teacher_user_id is null
              and lower(trim(coalesce(t.email, ''))) = lower(trim(coalesce(auth.jwt()->>'email', '')))
            )
          )
      )
    )
  $sql$;

  -- teacher_availability own rows
  execute 'drop policy if exists teacher_availability_teacher_select_own on public.teacher_availability';
  execute 'drop policy if exists teacher_availability_teacher_insert_own on public.teacher_availability';
  execute 'drop policy if exists teacher_availability_teacher_update_own on public.teacher_availability';

  execute $sql$
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
    )
  $sql$;

  execute $sql$
    create policy teacher_availability_teacher_insert_own
    on public.teacher_availability
    for insert to authenticated
    with check (
      (
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
      and coalesce(status, 'Tentative') in ('Tentative', 'Pending', 'Submitted')
    )
  $sql$;

  execute $sql$
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
      and coalesce(status, 'Tentative') not in ('Available','Unavailable','Suspended','SuspendedConfirmed')
    )
  $sql$;

  -- applicants teacher assigned read (legacy policy name)
  execute 'drop policy if exists applicants_teacher_select_assigned on public.applicants';
  execute $sql$
    create policy applicants_teacher_select_assigned
    on public.applicants
    for select to authenticated
    using (
      exists (
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
    )
  $sql$;
end $$;

commit;
