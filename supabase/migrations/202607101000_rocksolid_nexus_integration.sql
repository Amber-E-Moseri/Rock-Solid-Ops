begin;

-- Rocksolid admin to Nexus user mapping
create table if not exists public.rocksolid_admin_mappings (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  nexus_user_id uuid not null,
  group_id text not null,
  subgroup_id text null,
  nexus_user_name text null,
  nexus_user_email text null,
  active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rocksolid_admin_mappings_group on public.rocksolid_admin_mappings(group_id);
create index if not exists idx_rocksolid_admin_mappings_subgroup on public.rocksolid_admin_mappings(subgroup_id) where subgroup_id is not null;
create index if not exists idx_rocksolid_admin_mappings_active on public.rocksolid_admin_mappings(active);
create index if not exists idx_rocksolid_admin_mappings_email on public.rocksolid_admin_mappings(admin_email);
create index if not exists idx_rocksolid_admin_mappings_nexus_user on public.rocksolid_admin_mappings(nexus_user_id);

-- Task link tracking (for audit and retry management)
create table if not exists public.rocksolid_task_links (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  dedupe_key text not null unique,
  nexus_task_id text,
  status text not null default 'PENDING',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Backwards compat: keep clickup_task_id references if they exist from old migrations
  clickup_task_id text
);

create index if not exists idx_rocksolid_task_links_source on public.rocksolid_task_links(source_type, source_id);
create index if not exists idx_rocksolid_task_links_status on public.rocksolid_task_links(status);
create index if not exists idx_rocksolid_task_links_dedupe on public.rocksolid_task_links(dedupe_key);

-- Enable RLS
alter table public.rocksolid_admin_mappings enable row level security;
alter table public.rocksolid_task_links enable row level security;

-- Admin/superadmin management and read access for mapping table
drop policy if exists rocksolid_admin_mappings_admin_all on public.rocksolid_admin_mappings;
create policy rocksolid_admin_mappings_admin_all
on public.rocksolid_admin_mappings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Task link records are operational metadata; admins can view/update
drop policy if exists rocksolid_task_links_admin_select on public.rocksolid_task_links;
create policy rocksolid_task_links_admin_select
on public.rocksolid_task_links
for select
to authenticated
using (public.is_admin());

drop policy if exists rocksolid_task_links_admin_update on public.rocksolid_task_links;
create policy rocksolid_task_links_admin_update
on public.rocksolid_task_links
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists rocksolid_task_links_admin_insert on public.rocksolid_task_links;
create policy rocksolid_task_links_admin_insert
on public.rocksolid_task_links
for insert
to authenticated
with check (public.is_admin());

-- Auto-update timestamps
do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'trigger_set_updated_at'
  ) then
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_rocksolid_admin_mappings_updated_at'
    ) then
      create trigger trg_rocksolid_admin_mappings_updated_at
      before update on public.rocksolid_admin_mappings
      for each row execute function trigger_set_updated_at();
    end if;

    if not exists (
      select 1 from pg_trigger where tgname = 'trg_rocksolid_task_links_updated_at'
    ) then
      create trigger trg_rocksolid_task_links_updated_at
      before update on public.rocksolid_task_links
      for each row execute function trigger_set_updated_at();
    end if;
  end if;
end $$;

commit;
