-- Cron: daily attendance reminder sweep (09:00 UTC)
-- BEFORE RUNNING: replace <SERVICE_ROLE_KEY> with your project service role key.

-- Only manage cron jobs if pg_cron extension is available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available; skipping attendance-reminder-daily schedule';
    RETURN;
  END IF;

  -- Unschedule if it already exists
  EXECUTE 'SELECT cron.unschedule(' || quote_literal('attendance-reminder-daily') || ')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = ' || quote_literal('attendance-reminder-daily') || ')';

  -- Schedule the cron job
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'attendance-reminder-daily',
    '0 9 * * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/attendance-reminder'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{}''::jsonb)'
  );
END $$;

