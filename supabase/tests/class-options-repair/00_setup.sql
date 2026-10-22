-- Synthetic PostgreSQL 17 rehearsal schema for migration 202610220100 and its rollback.
--
-- SYNTHETIC DATA ONLY. The class_options definition matches the baseline (000_baseline_squash.sql)
-- without the two columns that the repair adds. The RLS policies are REPRESENTATIVE, written for this
-- test: production's policies were not copied, because this harness must not read production.
--
-- Representative policies:
--   * anon and authenticated may read class options (the public registration form reads them as anon).
--   * authenticated may write class options only when the session sets rso.test_role = 'admin'.
--     A teacher session (rso.test_role = 'teacher') can read but cannot write.

drop table if exists public.class_options;
drop table if exists public.teachers;

create table public.teachers (
  teacher_id text primary key
);

create table public.class_options (
  class_option_id  text        primary key,
  class_id         text        not null,
  teacher_id       text        references public.teachers(teacher_id) on delete set null,
  teacher_name     text,
  fellowship_codes text[]      not null default '{}',
  group_id         text        not null,
  subgroup_id      text        not null,
  day              text,
  class_time       time,
  active           boolean     not null default false,
  enrollment_open  boolean     not null default false,
  max_capacity     integer,
  label_suffix     text,
  deleted_at       timestamptz,
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.class_options enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.class_options to anon, authenticated;
grant insert, update, delete on public.class_options to authenticated;

drop policy if exists class_options_read on public.class_options;
create policy class_options_read on public.class_options
  for select to anon, authenticated
  using (true);

drop policy if exists class_options_admin_write on public.class_options;
create policy class_options_admin_write on public.class_options
  for all to authenticated
  using (coalesce(current_setting('rso.test_role', true), '') = 'admin')
  with check (coalesce(current_setting('rso.test_role', true), '') = 'admin');

-- 13 open, active, non-deleted classes, all with the default-era values.
insert into public.class_options (
  class_option_id, class_id, teacher_name, fellowship_codes, group_id, subgroup_id,
  day, class_time, active, enrollment_open, max_capacity, label_suffix
)
select
  'CO-R' || lpad(g::text, 3, '0'),
  'CLASS-' || (g % 4 + 1),
  'Synthetic Teacher ' || g,
  case when g % 2 = 0 then '{CMU}'::text[] else '{YORK}'::text[] end,
  'GRP-1',
  'SUB-' || (g % 3 + 1),
  (array['Monday','Tuesday','Wednesday','Thursday','Friday'])[g % 5 + 1],
  make_time(7 + (g % 12), 0, 0),
  true,
  true,
  20,
  'synthetic'
from generate_series(1, 13) g;
