-- Cron: daily review check-in email (09:00 UTC)
-- Calls review-checkin edge function for applicants stuck in REVIEW for 3-7 days.
--
-- BEFORE RUNNING: replace <SERVICE_ROLE_KEY> below with your actual service role key.
-- Find it in: Supabase Dashboard → Project Settings → API → service_role (secret) key.
-- Do NOT commit the key to version control — apply this migration manually via the
-- Supabase SQL editor or supabase db push after setting it as an environment secret.

-- Only schedule the cron job if pg_cron extension is available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available; skipping review-checkin-daily schedule';
    RETURN;
  END IF;

  -- Schedule via format() to safely quote the SQL
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'review-checkin-daily',
    '0 9 * * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/review-checkin'', headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <SERVICE_ROLE_KEY>''), body := ''{}''::jsonb);'
  );
END $$;
