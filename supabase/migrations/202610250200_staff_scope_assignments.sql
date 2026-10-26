-- Request Access, Phase 1: staff scope assignments for the existing pastor and subgroup_admin roles.
-- Additive and idempotent.
-- Date: 2026-10-25
--
-- Model: one row links one active, trusted staff profile to one subgroup under its verified group.
-- A profile may hold several subgroups. Authority is read from active rows at call time, so a
-- revocation or a role change removes it immediately. Nothing is inferred from role or group name.
--
-- Not changed here: profiles.role values, role constraints, elevated-role triggers, account
-- creation, role elevation, teacher activation, provisioning, and any release hold.

begin;

create table if not exists public.staff_scope_assignments (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles (user_id) on delete restrict,
  role         text        not null,
  group_id     text        not null,
  subgroup_id  text        not null,
  active       boolean     not null default true,
  granted_by   uuid        not null references public.profiles (user_id) on delete restrict,
  granted_at   timestamptz not null default now(),
  revoked_by   uuid        references public.profiles (user_id) on delete restrict,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint staff_scope_assignments_role_chk
    check (role in ('pastor', 'subgroup_admin')),
  -- The subgroup must belong to the stated group. The database enforces it, not the caller.
  constraint staff_scope_assignments_group_subgroup_fk
    foreign key (subgroup_id, group_id)
    references public.org_subgroups (subgroup_id, group_id)
    on update restrict on delete restrict,
  constraint staff_scope_assignments_no_self_grant_chk
    check (granted_by <> user_id),
  constraint staff_scope_assignments_no_self_revoke_chk
    check (revoked_by is null or revoked_by <> user_id),
  constraint staff_scope_assignments_lifecycle_chk
    check (
      (active and revoked_at is null and revoked_by is null)
      or (not active and revoked_at is not null and revoked_by is not null)
    )
);

comment on table public.staff_scope_assignments is
  'Authoritative subgroup scope for existing pastor and subgroup_admin profiles. Active rows authorize approvals in their subgroup only. Revoked rows are kept as history.';

-- At most one active row per user and subgroup. Re-granting after a revocation is allowed.
create unique index if not exists staff_scope_assignments_one_active_uq
  on public.staff_scope_assignments (user_id, subgroup_id)
  where active;

create index if not exists staff_scope_assignments_subgroup_active_idx
  on public.staff_scope_assignments (subgroup_id, group_id)
  where active;

-- Guards identity and lifecycle. The row's identity is immutable. A revoked row cannot be
-- reactivated; a new row is granted instead.
create or replace function public.staff_scope_assignments_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_role   text;
  v_active boolean;
begin
  if tg_op = 'INSERT' then
    select p.role, p.is_active into v_role, v_active
    from public.profiles p
    where p.user_id = new.user_id;

    if not found or not coalesce(v_active, false) then
      raise exception 'SCOPE_TARGET_NOT_ACTIVE: target profile is missing or inactive'
        using errcode = '42501';
    end if;
    if v_role is distinct from new.role then
      raise exception 'SCOPE_ROLE_MISMATCH: assignment role must match the target profile role'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.group_id is distinct from old.group_id
     or new.subgroup_id is distinct from old.subgroup_id
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at then
    raise exception 'SCOPE_IMMUTABLE: assignment identity is immutable; revoke and grant a new row instead'
      using errcode = '42501';
  end if;
  if old.active is false and new.active is true then
    raise exception 'SCOPE_NO_REACTIVATION: a revoked assignment cannot be reactivated; grant a new row'
      using errcode = '42501';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_staff_scope_assignments_guard on public.staff_scope_assignments;
create trigger trg_staff_scope_assignments_guard
  before insert or update on public.staff_scope_assignments
  for each row execute function public.staff_scope_assignments_guard();

-- Coverage check used by approval paths. True only when the profile is active, its current role
-- matches the row, the row is active, and the subgroup is active under the stated group.
-- Request-type rules (which requests a pastor or subgroup_admin may decide) belong to Phase 3.
create or replace function public.staff_scope_covers(
  p_user_id     uuid,
  p_group_id    text,
  p_subgroup_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_scope_assignments a
    join public.profiles p on p.user_id = a.user_id
    join public.org_subgroups o
      on o.subgroup_id = a.subgroup_id and o.group_id = a.group_id
    where a.user_id = p_user_id
      and a.group_id = p_group_id
      and a.subgroup_id = p_subgroup_id
      and a.active
      and o.active
      and p.is_active
      and p.role = a.role
  );
$$;

-- Organization-wide approval authority. Holds only for an active superadmin or regional_secretary.
create or replace function public.staff_scope_org_wide(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = p_user_id
      and p.is_active
      and p.role in ('superadmin', 'regional_secretary')
  );
$$;

-- Privileged management contract. Callable only by service_role (the edge function verifies the
-- caller's JWT before calling). The actor's authority is re-checked here from stored data.
create or replace function public.grant_staff_scope(
  p_actor_id    uuid,
  p_target_id   uuid,
  p_group_id    text,
  p_subgroup_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role  text;
  v_target_role text;
  v_target_on   boolean;
  v_id          uuid;
begin
  if p_actor_id is null or p_target_id is null
     or coalesce(p_group_id, '') = '' or coalesce(p_subgroup_id, '') = '' then
    raise exception 'INVALID_INPUT: actor, target, group and subgroup are required'
      using errcode = '22023';
  end if;
  if p_actor_id = p_target_id then
    raise exception 'FORBIDDEN_SELF_ASSIGNMENT: scope cannot be granted to yourself'
      using errcode = '42501';
  end if;

  select p.role into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id and p.is_active;
  if v_actor_role is null or v_actor_role not in ('superadmin', 'regional_secretary') then
    raise exception 'FORBIDDEN: scope management requires an active superadmin or regional_secretary'
      using errcode = '42501';
  end if;

  select p.role, p.is_active into v_target_role, v_target_on
  from public.profiles p
  where p.user_id = p_target_id;
  if not found or not coalesce(v_target_on, false) then
    raise exception 'TARGET_NOT_ACTIVE: target profile is missing or inactive'
      using errcode = '42501';
  end if;
  if v_target_role not in ('pastor', 'subgroup_admin') then
    raise exception 'TARGET_ROLE_NOT_SCOPED: only pastor or subgroup_admin profiles hold subgroup scope'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.org_subgroups o
    where o.subgroup_id = p_subgroup_id and o.group_id = p_group_id and o.active
  ) then
    raise exception 'INVALID_SUBGROUP_FOR_GROUP: subgroup does not belong to the group, or is inactive'
      using errcode = '23503';
  end if;

  -- Idempotent: an existing active row for this user and subgroup is returned unchanged.
  select a.id into v_id
  from public.staff_scope_assignments a
  where a.user_id = p_target_id and a.subgroup_id = p_subgroup_id and a.active;
  if found then
    return jsonb_build_object('ok', true, 'outcome', 'UNCHANGED', 'assignment_id', v_id);
  end if;

  begin
    insert into public.staff_scope_assignments (user_id, role, group_id, subgroup_id, granted_by)
    values (p_target_id, v_target_role, p_group_id, p_subgroup_id, p_actor_id)
    returning id into v_id;
  exception when unique_violation then
    select a.id into v_id
    from public.staff_scope_assignments a
    where a.user_id = p_target_id and a.subgroup_id = p_subgroup_id and a.active;
    return jsonb_build_object('ok', true, 'outcome', 'UNCHANGED', 'assignment_id', v_id);
  end;

  insert into public.audit_logs (actor_email, action, entity_type, entity_id, status, details)
  values (
    (select p.email from public.profiles p where p.user_id = p_actor_id),
    'STAFF_SCOPE_GRANTED', 'staff_scope_assignment', v_id::text, 'SUCCESS',
    jsonb_build_object(
      'actor_id', p_actor_id, 'target_id', p_target_id, 'role', v_target_role,
      'group_id', p_group_id, 'subgroup_id', p_subgroup_id
    )
  );

  return jsonb_build_object('ok', true, 'outcome', 'GRANTED', 'assignment_id', v_id);
end;
$$;

-- Revocation sets active=false and keeps the row as history. Authority is removed as soon as the
-- transaction commits, because every check reads active rows at call time.
create or replace function public.revoke_staff_scope(
  p_actor_id      uuid,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  a            public.staff_scope_assignments%rowtype;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception 'INVALID_INPUT: actor and assignment are required'
      using errcode = '22023';
  end if;

  select p.role into v_actor_role
  from public.profiles p
  where p.user_id = p_actor_id and p.is_active;
  if v_actor_role is null or v_actor_role not in ('superadmin', 'regional_secretary') then
    raise exception 'FORBIDDEN: scope management requires an active superadmin or regional_secretary'
      using errcode = '42501';
  end if;

  select * into a
  from public.staff_scope_assignments
  where id = p_assignment_id
  for update;
  if not found then
    raise exception 'ASSIGNMENT_NOT_FOUND: no scope assignment with that id'
      using errcode = '02000';
  end if;
  if a.user_id = p_actor_id then
    raise exception 'FORBIDDEN_SELF_ASSIGNMENT: scope cannot be changed for yourself'
      using errcode = '42501';
  end if;
  if not a.active then
    return jsonb_build_object('ok', true, 'outcome', 'UNCHANGED', 'assignment_id', a.id);
  end if;

  update public.staff_scope_assignments
     set active = false,
         revoked_by = p_actor_id,
         revoked_at = now()
   where id = a.id;

  insert into public.audit_logs (actor_email, action, entity_type, entity_id, status, details)
  values (
    (select p.email from public.profiles p where p.user_id = p_actor_id),
    'STAFF_SCOPE_REVOKED', 'staff_scope_assignment', a.id::text, 'SUCCESS',
    jsonb_build_object(
      'actor_id', p_actor_id, 'target_id', a.user_id, 'role', a.role,
      'group_id', a.group_id, 'subgroup_id', a.subgroup_id
    )
  );

  return jsonb_build_object('ok', true, 'outcome', 'REVOKED', 'assignment_id', a.id);
end;
$$;

-- Privileges and RLS. Deny by default. Clients read only their own rows, or every row for an
-- organization-wide approver. Clients never write. Every write goes through the functions above.
alter table public.staff_scope_assignments enable row level security;

revoke all on public.staff_scope_assignments from public, anon, authenticated;
grant select on public.staff_scope_assignments to authenticated;
grant select, insert, update on public.staff_scope_assignments to service_role;

drop policy if exists staff_scope_assignments_select_self on public.staff_scope_assignments;
create policy staff_scope_assignments_select_self
on public.staff_scope_assignments
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists staff_scope_assignments_select_org_wide on public.staff_scope_assignments;
create policy staff_scope_assignments_select_org_wide
on public.staff_scope_assignments
for select
to authenticated
using (public.current_profile_role() in ('superadmin', 'regional_secretary'));

revoke all on function public.staff_scope_assignments_guard() from public, anon, authenticated;

revoke all on function public.staff_scope_covers(uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_scope_covers(uuid, text, text) to service_role;

revoke all on function public.staff_scope_org_wide(uuid) from public, anon, authenticated;
grant execute on function public.staff_scope_org_wide(uuid) to service_role;

revoke all on function public.grant_staff_scope(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.grant_staff_scope(uuid, uuid, text, text) to service_role;

revoke all on function public.revoke_staff_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_scope(uuid, uuid) to service_role;

commit;
