-- Request Access, Phase 1: authoritative org_subgroups map.
-- Additive and idempotent. Seeds from fellowship_map without renaming or re-keying any code.
-- Date: 2026-10-25
--
-- Why: approval authority is scoped to a subgroup, and that subgroup must belong to a specific
-- group. fellowship_map links a campus to a group and subgroup, but it is a campus registry, not
-- an authority source. This table is the parent that composite foreign keys bind to.
--
-- Not changed here: profiles.role values, role constraints, elevated-role triggers, teacher
-- activation, account creation, and any release hold.

begin;

create table if not exists public.org_subgroups (
  subgroup_id text        primary key,
  group_id    text        not null,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint org_subgroups_subgroup_id_chk
    check (subgroup_id = btrim(subgroup_id) and subgroup_id <> ''),
  constraint org_subgroups_group_id_chk
    check (group_id = btrim(group_id) and group_id <> ''),
  -- Target of the composite foreign keys from staff_scope_assignments (and later access_requests).
  constraint org_subgroups_subgroup_group_uq unique (subgroup_id, group_id)
);

comment on table public.org_subgroups is
  'Authoritative subgroup-to-group map, seeded from fellowship_map. Codes are preserved as-is. Composite foreign keys bind staff scope to a verified parent group.';

create or replace function public.org_subgroups_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_subgroups_updated_at on public.org_subgroups;
create trigger trg_org_subgroups_updated_at
  before update on public.org_subgroups
  for each row execute function public.org_subgroups_set_updated_at();

-- Seeds missing rows from active fellowship_map pairs. It never overwrites an existing row.
-- It refuses to run when the source is ambiguous or when an existing row disagrees with it.
create or replace function public.org_subgroups_seed_from_fellowship()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ambiguous integer;
  v_drifted   integer;
  v_inserted  integer;
begin
  -- One subgroup code under two groups is ambiguous. Refuse rather than pick one.
  select count(*) into v_ambiguous
  from (
    select f.subgroup_id
    from public.fellowship_map f
    where f.active and f.group_id is not null and f.subgroup_id is not null
    group by f.subgroup_id
    having count(distinct f.group_id) > 1
  ) x;
  if v_ambiguous > 0 then
    raise exception 'ORG_SUBGROUP_AMBIGUOUS: % subgroup code(s) map to more than one group in fellowship_map', v_ambiguous
      using errcode = '23514';
  end if;

  -- An existing row whose group no longer matches fellowship_map needs a manual decision.
  select count(*) into v_drifted
  from public.org_subgroups o
  join (
    select distinct f.subgroup_id, f.group_id
    from public.fellowship_map f
    where f.active and f.group_id is not null and f.subgroup_id is not null
  ) m on m.subgroup_id = o.subgroup_id
  where o.group_id <> m.group_id;
  if v_drifted > 0 then
    raise exception 'ORG_SUBGROUP_DRIFT: % existing subgroup(s) disagree with fellowship_map; resolve manually', v_drifted
      using errcode = '23514';
  end if;

  insert into public.org_subgroups (subgroup_id, group_id)
  select distinct f.subgroup_id, f.group_id
  from public.fellowship_map f
  where f.active and f.group_id is not null and f.subgroup_id is not null
  on conflict (subgroup_id) do nothing;
  get diagnostics v_inserted = row_count;

  return v_inserted;
end;
$$;

-- Seed once at migration time. Reruns are no-ops.
select public.org_subgroups_seed_from_fellowship();

alter table public.org_subgroups enable row level security;

revoke all on public.org_subgroups from public, anon, authenticated;
grant select on public.org_subgroups to authenticated;
grant select, insert, update, delete on public.org_subgroups to service_role;

drop policy if exists org_subgroups_select_active_staff on public.org_subgroups;
create policy org_subgroups_select_active_staff
on public.org_subgroups
for select
to authenticated
using (active and public.current_profile_role() is not null);

revoke all on function public.org_subgroups_seed_from_fellowship() from public, anon, authenticated;
revoke all on function public.org_subgroups_set_updated_at() from public, anon, authenticated;

commit;
