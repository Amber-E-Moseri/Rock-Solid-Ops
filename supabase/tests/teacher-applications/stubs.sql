-- Minimal Supabase-shaped schema for the teacher-application authorization tests.
-- Column shapes and helper bodies mirror the canonical definitions on main:
--   profiles            202605060900_auth_rbac + 202605071940 role check
--   teachers            000_baseline + 202605071600 status + 202605071960/202605121500 teacher_user_id
--   fellowship_map      000_baseline + 202605191130 active column
--   audit_logs          202605071800 canonical columns
--   email_queue         000_baseline + 202607090001 status + 202606101400 payload
--   current_profile_role / is_admin   202605071950 / 202605220030
-- Not a full migration replay. The CI migration gate (db reset from zero) remains the replay of record.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create schema if not exists auth;
create schema if not exists public;
grant usage on schema public, auth to anon, authenticated, service_role;

create table auth.users (
  id                  uuid primary key,
  email               text,
  email_confirmed_at  timestamptz,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
-- Deliberately no unique constraint on email: the duplicate-email test must reach the
-- application-level guard, not rely on Auth's own uniqueness.

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null check (role in
             ('pending', 'teacher', 'principal', 'admin', 'superadmin', 'subgroup_admin', 'pastor', 'regional_secretary')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fellowship_map (
  fellowship_code text primary key,
  campus_name     text,
  group_id        text,
  subgroup_id     text,
  active          boolean not null default true,
  timezone        text default 'America/Toronto',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table public.teachers (
  teacher_id       text primary key,
  full_name        text not null,
  email            text,
  phone            text,
  group_id         text,
  subgroup_id      text,
  fellowship_code  text references public.fellowship_map(fellowship_code),
  status           text not null default 'PENDING'
                   constraint teachers_status_lifecycle_chk check (status in ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE')),
  active           boolean not null default true,
  deleted_at       timestamptz,
  teacher_user_id  uuid references auth.users(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- actor_id is deliberately absent: production lacks it (drift inventory, row 7).
create table public.audit_logs (
  id          bigserial primary key,
  logged_at   timestamptz not null default now(),
  actor_email text,
  action      text not null,
  entity_type text,
  entity_id   text,
  status      text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.email_templates (
  template_key text primary key,
  subject      text,
  body_html    text,
  active       boolean not null default true
);

create table public.notification_templates (
  template_key text primary key,
  subject      text,
  body_html    text,
  active       boolean not null default true
);

create table public.email_queue (
  id              uuid primary key default gen_random_uuid(),
  template_key    text references public.email_templates(template_key) on delete set null,
  recipient_email text not null,
  recipient_name  text,
  student_id      text,
  subject         text,
  body_html       text,
  status          text not null default 'Pending'
                  check (status in ('Pending', 'Processing', 'Sent', 'Failed', 'Retried')),
  sent_at         timestamptz,
  error_message   text,
  payload         jsonb not null default '{}'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Canonical role resolver (202605071950): active profile role only.
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
  if to_regclass('public.profiles') is not null then
    select p.role
      into v_role
    from public.profiles p
    where p.user_id = auth.uid()
      and coalesce(p.is_active, true) = true
    limit 1;
  end if;
  return v_role;
end;
$$;

-- Broad staff check (202605220030). Included so the hardened link function is exercised
-- against the same gate it uses in production.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    public.current_profile_role() in ('superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary'),
    false
  )
$$;
