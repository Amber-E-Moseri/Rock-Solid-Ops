-- Report generator cron schedules — weekly + monthly regional reports and pastor digests.
-- BEFORE RUNNING: replace <SERVICE_ROLE_KEY> with your actual service role key from
-- Project Settings → API → service_role. Apply this migration manually via the Supabase SQL
-- editor or supabase db push after setting it as an environment secret.
-- Do NOT commit the key to version control.

-- Only schedule cron jobs if pg_cron extension is available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available; skipping report cron schedules';
    RETURN;
  END IF;

  -- Weekly regional report — every Monday at 8:00 AM ET (13:00 UTC)
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'report-weekly-regional',
    '0 13 * * 1',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/report-generator'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{"report_type":"weekly_regional"}''::jsonb)'
  );

  -- Monthly regional report — 1st of each month at 8:00 AM ET (13:00 UTC)
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'report-monthly-regional',
    '0 13 1 * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/report-generator'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{"report_type":"monthly_regional"}''::jsonb)'
  );

  -- Weekly pastor digest — every Monday at 8:30 AM ET (13:30 UTC)
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'report-weekly-pastor-digest',
    '30 13 * * 1',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/report-generator'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{"report_type":"pastor_digest","period":"weekly"}''::jsonb)'
  );

  -- Monthly pastor digest — 1st of each month at 8:30 AM ET (13:30 UTC)
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'report-monthly-pastor-digest',
    '30 13 1 * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/report-generator'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{"report_type":"pastor_digest","period":"monthly"}''::jsonb)'
  );
END $$;
