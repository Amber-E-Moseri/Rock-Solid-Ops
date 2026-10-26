-- Synthetic PostgreSQL 17 rehearsal schema for supabase/migrations/20261022120000_anon_privilege_hardening.sql.
--
-- SYNTHETIC DATA ONLY. The grants and policies below were written for this test from the production
-- privilege inventory (anon: ALL on every public table; anon-facing policies named as in production).
-- Production's schema and data were NOT copied, because this harness must never read production.
--
-- The Supabase default is emulated: anon, authenticated and service_role hold ALL on every table and
-- sequence in public, and EXECUTE on functions comes from the PUBLIC default.

drop schema if exists supabase_migrations cascade;
drop table if exists public.class_options, public.batches, public.batch_campus_registration_settings,
  public.fellowship_map, public.teachers, public.applicants, public.error_submissions, public.audit_logs,
  public.moodle_enrollment_sync, public.email_queue, public.config cascade;
drop function if exists public.admin_secret(), public.is_admin();

-- Migration history: the rehearsal must prove the migration does not touch it.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text);
insert into supabase_migrations.schema_migrations values ('202605190900', 'prior_one'), ('202605190930', 'prior_two'), ('202610220100', 'repair_class_options_registration_columns');

-- ---- registration-facing tables -------------------------------------------------------------
create table public.fellowship_map (
  fellowship_code text primary key,
  campus_name     text not null,
  group_id        text not null,
  subgroup_id     text not null,
  timezone        text,
  active          boolean not null default true
);

create table public.class_options (
  class_option_id    text primary key,
  class_id           text not null,
  teacher_id         text,
  teacher_name       text,
  fellowship_codes   text[] not null default '{}',
  group_id           text not null,
  subgroup_id        text not null,
  day                text,
  class_time         time,
  active             boolean not null default false,
  enrollment_open    boolean not null default false,
  deleted_at         timestamptz,
  is_online          boolean not null default false,
  confirmed_start_date date,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.batches (
  batch_id          text primary key,
  batch_name        text,
  status            text not null default 'Draft',
  registration_open boolean not null default false,
  created_at        timestamptz not null default now()
);

create table public.batch_campus_registration_settings (
  id                uuid primary key default gen_random_uuid(),
  batch_id          text not null,
  fellowship_code   text not null,
  registration_open boolean not null default true,
  closed_reason     text,
  closed_by         text,
  closed_at         timestamptz,
  reopened_by       text,
  reopened_at       timestamptz
);

-- ---- teachers: self-registration target -----------------------------------------------------
create table public.teachers (
  teacher_id      text primary key,
  full_name       text not null,
  email           text,
  phone           text,
  fellowship_code text,
  notes           text,
  status          text not null default 'ACTIVE',
  active          boolean not null default true,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- tables that anon must NOT reach --------------------------------------------------------
create table public.applicants (
  id         uuid primary key default gen_random_uuid(),
  full_name  text,
  email      text
);

create table public.error_submissions (
  id            uuid primary key default gen_random_uuid(),
  error_message text,
  resolved      boolean not null default false
);

create table public.audit_logs (
  id     bigserial primary key,
  action text
);

create table public.moodle_enrollment_sync (
  id            uuid primary key default gen_random_uuid(),
  temp_password text
);

create table public.email_queue (
  id      uuid primary key default gen_random_uuid(),
  payload jsonb
);

create table public.config (
  key   text primary key,
  value text
);

-- ---- functions: one ordinary, one privileged -------------------------------------------------
create function public.is_admin() returns boolean language sql stable as $$ select true $$;
create function public.admin_secret() returns text language sql security definer as $$ select 'synthetic' $$;

-- ---- RLS: enabled everywhere; anon policies match production's names and shapes -------------
alter table public.fellowship_map enable row level security;
alter table public.class_options enable row level security;
alter table public.batches enable row level security;
alter table public.batch_campus_registration_settings enable row level security;
alter table public.teachers enable row level security;
alter table public.applicants enable row level security;
alter table public.error_submissions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.moodle_enrollment_sync enable row level security;
alter table public.email_queue enable row level security;
alter table public.config enable row level security;

create policy fellowship_map_anon_select on public.fellowship_map for select to anon using (active = true);
create policy class_options_anon_select on public.class_options for select to anon
  using (active = true and deleted_at is null);
create policy batches_anon_select on public.batches for select to anon using (registration_open = true);
create policy bcrs_anon_select on public.batch_campus_registration_settings for select to anon using (true);
create policy teachers_anon_select on public.teachers for select to anon
  using (active = true and deleted_at is null);
create policy "allow public teacher self registration" on public.teachers for insert to anon, authenticated
  with check (status = 'PENDING' and active = false);
create policy applicants_anon_insert on public.applicants for insert to anon with check (true);
create policy error_submissions_anon_insert on public.error_submissions for insert to anon with check (true);
create policy config_anon_select on public.config for select to anon using (true);

-- authenticated staff: full access in this rehearsal (the production policies are narrower; this
-- harness only needs authenticated to keep working, not to model staff rules).
create policy staff_all on public.fellowship_map for all to authenticated using (true) with check (true);
create policy staff_all on public.class_options for all to authenticated using (true) with check (true);
create policy staff_all on public.batches for all to authenticated using (true) with check (true);
create policy staff_all on public.batch_campus_registration_settings for all to authenticated using (true) with check (true);
create policy staff_all on public.teachers for all to authenticated using (true) with check (true);
create policy staff_all on public.applicants for all to authenticated using (true) with check (true);
create policy staff_all on public.error_submissions for all to authenticated using (true) with check (true);
create policy staff_all on public.audit_logs for all to authenticated using (true) with check (true);
create policy staff_all on public.moodle_enrollment_sync for all to authenticated using (true) with check (true);
create policy staff_all on public.email_queue for all to authenticated using (true) with check (true);
create policy staff_all on public.config for all to authenticated using (true) with check (true);

-- ---- Supabase-style default grants (the "before" state) --------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---- synthetic seed data --------------------------------------------------------------------
insert into public.fellowship_map (fellowship_code, campus_name, group_id, subgroup_id, timezone, active)
  values ('SYN-A', 'Synthetic Campus A', 'CE', 'CESGA', 'America/Winnipeg', true),
         ('SYN-B', 'Synthetic Campus B', 'CE', 'CESGB', 'America/Halifax', false);
insert into public.class_options (class_option_id, class_id, teacher_id, teacher_name, fellowship_codes, group_id, subgroup_id,
  day, class_time, active, enrollment_open, deleted_at, is_online, confirmed_start_date)
  values ('CO-SYN-1', 'CLASS-SYN-1', 'T-SYN-1', 'Synthetic Teacher', '{SYN-A}', 'CE', 'CESGA', 'Sunday', '10:00', true, true, null, false, null),
         ('CO-SYN-2', 'CLASS-SYN-2', 'T-SYN-1', 'Synthetic Teacher', '{SYN-B}', 'CE', 'CESGB', 'Sunday', '16:00', true, false, null, false, null);
insert into public.batches (batch_id, batch_name, status, registration_open) values ('B-SYN-1', 'Synthetic Batch', 'Active', true);
insert into public.batch_campus_registration_settings (batch_id, fellowship_code, registration_open, closed_reason, closed_by, closed_at)
  values ('B-SYN-1', 'SYN-B', false, 'synthetic closure', 'synthetic-staff-person', now());
insert into public.teachers (teacher_id, full_name, email, status, active) values ('T-SYN-1', 'Synthetic Teacher', 'synthetic-teacher@example.test', 'ACTIVE', true);
insert into public.applicants (full_name, email) values ('Synthetic Applicant', 'synthetic-applicant@example.test');
insert into public.error_submissions (error_message) values ('synthetic error');
insert into public.audit_logs (action) values ('synthetic action');
insert into public.moodle_enrollment_sync (temp_password) values ('synthetic-secret-value');
insert into public.email_queue (payload) values ('{"synthetic": true}');
insert into public.config (key, value) values ('synthetic_key', 'synthetic_value');
