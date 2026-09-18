-- Student engagement tracking tables
-- Tracks re-engagement actions taken per student per batch scenario.
-- BEFORE RUNNING: This migration is safe to apply directly — no service role key required.

-- ─── student_engagement_log ──────────────────────────────────────────────────
create table if not exists public.student_engagement_log (
  id               uuid        primary key default gen_random_uuid(),
  student_email    text        not null,
  batch_id         text        references public.batches(batch_id) on delete set null,
  scenario         text        not null
                               check (scenario in ('never_started','dropped_off','moodle_no_login','final_notice')),
  action_taken     text        not null
                               check (action_taken in ('email_queued','clickup_created','status_updated','skipped')),
  email_sent_at    timestamptz,
  clickup_task_id  text,
  notes            text,
  created_at       timestamptz not null default now()
);

-- One log entry per scenario per student per batch (prevents duplicate emails)
create unique index if not exists student_engagement_log_dedup_idx
  on public.student_engagement_log (student_email, batch_id, scenario);

-- ─── student_engagement_config ───────────────────────────────────────────────
create table if not exists public.student_engagement_config (
  key         text primary key,
  value       text not null,
  description text
);

insert into public.student_engagement_config (key, value, description) values
  ('never_started_days',      '7',  'Days after batch start before flagging never-started students'),
  ('dropoff_days',            '14', 'Days since last attendance before flagging as dropped off'),
  ('final_notice_days',       '21', 'Days before sending final notice and creating ClickUp task'),
  ('max_emails_per_scenario', '2',  'Maximum re-engagement emails per scenario per student per batch')
on conflict (key) do nothing;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.student_engagement_log    enable row level security;
alter table public.student_engagement_config enable row level security;

-- Admins/pastors can read engagement log
create policy "engagement_log_select" on public.student_engagement_log
  for select using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.profiles
      where user_id = auth.uid()
        and role in ('admin','superadmin','pastor','principal','subgroup_admin')
    )
  );

-- Config readable by authenticated staff
create policy "engagement_config_select" on public.student_engagement_config
  for select using (auth.role() = 'authenticated');

-- ─── Cron (nightly 2 am Toronto = 7 am UTC) ──────────────────────────────────
-- BEFORE RUNNING: replace <SERVICE_ROLE_KEY> with your actual service role key
-- from Project Settings → API → service_role.
-- Apply this migration manually via the Supabase SQL editor after setting the key.
-- DO NOT commit the key to version control.

-- Only schedule the cron job if pg_cron extension is available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available; skipping student engagement monitor schedule';
    RETURN;
  END IF;

  -- Schedule via format() to safely quote the SQL
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'student-engagement-monitor',
    '0 7 * * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/student-engagement-monitor'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{}''::jsonb)'
  );
END $$;
