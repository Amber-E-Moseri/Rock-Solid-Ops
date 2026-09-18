-- Moodle grade sync — runs every 6 hours to check course completion and upsert HOLY_SPIRIT milestone.
-- BEFORE RUNNING: replace <SERVICE_ROLE_KEY> with your actual service role key from
-- Project Settings → API → service_role. Apply this migration manually via the Supabase SQL
-- editor. Do NOT commit the key to version control.

-- Only schedule the cron job if pg_cron extension is available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available; skipping moodle-grade-sync schedule';
    RETURN;
  END IF;

  -- Schedule via format() to safely quote the SQL
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'moodle-grade-sync',
    '0 */6 * * *',
    'select net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/moodle-grade-sync'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{}''::jsonb)'
  );
END $$;
