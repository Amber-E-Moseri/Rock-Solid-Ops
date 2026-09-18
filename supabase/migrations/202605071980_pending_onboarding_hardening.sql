begin;

-- Phase 2 hardening: pending onboarding, self-update protection, and teacher status audit.

-- 1) Enforce pending as a valid profile role and keep it non-elevated.
do $$
declare
  v_profiles regclass;
  v_role_attnum int2;
  rec record;
begin
  v_profiles := to_regclass('public.profiles');
  if v_profiles is null then
    raise notice 'public.profiles not found; skipping pending profile hardening';
    return;
  end if;

  select a.attnum
    into v_role_attnum
  from pg_attribute a
  where a.attrelid = v_profiles
    and a.attname = 'role'
    and a.attisdropped = false
  limit 1;

  if v_role_attnum is null then
    raise notice 'public.profiles.role not found; skipping pending profile hardening';
    return;
  end if;

  for rec in
    select c.conname
    from pg_constraint c
    where c.conrelid = v_profiles
      and c.contype = 'c'
      and array_position(c.conkey, v_role_attnum) is not null
  loop
    execute format('alter table public.profiles drop constraint if exists %I', rec.conname);
  end loop;

  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('pending', 'teacher', 'principal', 'admin', 'superadmin', 'subgroup_admin', 'pastor'));
end $$;

comment on column public.profiles.role is
  'Canonical profile role. Allowed values: pending, teacher, principal, subgroup_admin, pastor, admin, superadmin. pending is non-elevated until admin approval.';

-- 2) New auth users should default to pending.
create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'pending'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_auth_user_profile() is
  'Creates a profile row for new auth users with role=pending by default. pending users receive no elevated access.';

-- 3) Prevent profile owners from self-promoting or self-deactivating.
create or replace function public.profiles_protect_self_role_and_activation_updates()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.user_id = auth.uid() and not public.is_admin() then
      if coalesce(new.role, '') <> coalesce(old.role, '')
        or coalesce(new.is_active, true) <> coalesce(old.is_active, true)
        or coalesce(new.active, true) <> coalesce(old.active, true)
      then
        raise insufficient_privilege using message = 'Profile owners cannot change role or activation state. Contact an administrator.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_self_role_update on public.profiles;
create trigger trg_profiles_protect_self_role_update
  before update on public.profiles
  for each row
  execute function public.profiles_protect_self_role_and_activation_updates();

comment on function public.profiles_protect_self_role_and_activation_updates() is
  'Prevents authenticated profile owners from changing their own role or activation flags. Only admins may promote or deactivate profiles.';

-- 4) Audit teacher status lifecycle changes at the database level.
create or replace function public.log_teacher_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor_email text;
  v_details jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if coalesce(old.status, '') = coalesce(new.status, '')
    and coalesce(old.active, false) = coalesce(new.active, false)
  then
    return new;
  end if;

  v_actor_email := auth.jwt() ->> 'email';
  v_details := jsonb_build_object(
    'teacher_id', new.teacher_id,
    'from_status', old.status,
    'to_status', new.status,
    'from_active', old.active,
    'to_active', new.active,
    'rejected_reason', new.rejected_reason,
    'suspended_reason', new.suspended_reason
  );

  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      logged_at,
      actor_email,
      actor_id,
      action,
      entity_type,
      entity_id,
      status,
      details,
      created_at
    ) values (
      now(),
      v_actor_email,
      auth.uid()::text,
      'TEACHER_STATUS_CHANGE',
      'teacher',
      new.teacher_id,
      'SUCCESS',
      v_details,
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_teacher_status_audit on public.teachers;
create trigger trg_teacher_status_audit
  after update on public.teachers
  for each row
  when (coalesce(old.status, '') <> coalesce(new.status, '') OR coalesce(old.active, false) <> coalesce(new.active, false))
  execute function public.log_teacher_status_change();

comment on function public.log_teacher_status_change() is
  'Adds audit entries when teacher status or active state changes. Ensures approval/rejection decisions are recorded in audit_logs.';

commit;
