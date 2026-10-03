-- =============================================================================
-- OPERATOR SCRIPT — NOT A MIGRATION. Do not move into supabase/migrations/.
-- =============================================================================
-- Purpose
--   Re-point existing pg_cron jobs from
--       Authorization: Bearer <service-role key>
--   to the dedicated cron credential
--       x-cron-secret: <CRON_INVOKE_SECRET>
--   which is what the hardened Edge Functions (_shared/auth.ts validateCronAuth)
--   now require. Functions deliberately do NOT accept the service-role key.
--
-- Why this is a script and not a migration
--   * The repo has no established secret-store convention; legacy cron migrations
--     carry a committed "<SERVICE_ROLE_KEY>" placeholder that operators replace by
--     hand. A migration run by `supabase db push` / replay would schedule jobs with
--     a dead placeholder and would break replay where Vault is absent.
--   * The secret must never be committed. This script never contains it: each job
--     reads it from Supabase Vault AT RUN TIME, so it is also never stored in
--     cron.job.command.
--
-- Preconditions (operator, once per project)
--   1. Edge Function secrets CRON_INVOKE_SECRET and INTERNAL_INVOKE_SECRET are set
--      to two DIFFERENT random values.
--   2. The same value as CRON_INVOKE_SECRET is stored in Vault under the name
--      'cron_invoke_secret':
--          select vault.create_secret('<paste CRON_INVOKE_SECRET>', 'cron_invoke_secret');
--      (run interactively; never commit the value)
--   3. Edge Functions from this branch are deployed BEFORE or in the same window as
--      this script. Between "functions deployed" and "script run" the affected jobs
--      receive 401; after the script they authenticate. Run it immediately after
--      deploy.
--
-- Behaviour
--   * Re-points ONLY jobs that already exist (matched by jobname). It never creates a
--     job and never changes a schedule — missing jobs are reported, not invented.
--   * Idempotent: running it twice leaves the same final state.
--   * Fails loudly (EXCEPTION, nothing changed) if pg_cron, pg_net or the Vault secret
--     is missing, instead of silently leaving dead jobs behind.
--
-- Jobs NOT covered (no definition exists in this repository — verify in
-- `select * from cron.job` and re-point by hand using the same command shape):
--   retry-worker, email-sender, notification-batch-processor, missed-class-detector,
--   attention-flag-push-sweep. The final check below lists any job that still posts
--   to an Edge Function without x-cron-secret.
-- =============================================================================

DO $cutover$
DECLARE
  -- Project functions base URL. Value matches the legacy cron migrations; change it
  -- when applying to another project (e.g. staging).
  v_base    constant text := 'https://xelpsttqhrcqmttmjory.supabase.co/functions/v1';
  v_job     record;
  v_id      bigint;
  v_command text;
  v_changed int := 0;
  v_missing text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE EXCEPTION 'pg_cron is not installed; nothing to re-point';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    RAISE EXCEPTION 'pg_net is not installed; cron jobs cannot call Edge Functions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret') THEN
    RAISE EXCEPTION 'Vault secret ''cron_invoke_secret'' is missing; create it first (see header)';
  END IF;

  FOR v_job IN
    SELECT * FROM (VALUES
      -- (jobname,                       function,                    json body)
      ('review-checkin-daily',           'review-checkin',            '{}'),
      ('student-engagement-monitor',     'student-engagement-monitor','{}'),
      ('waitlist-processor',             'waitlist-processor',        '{}'),
      ('report-weekly-regional',         'report-generator',          '{"report_type":"weekly_regional"}'),
      ('report-monthly-regional',        'report-generator',          '{"report_type":"monthly_regional"}'),
      ('report-weekly-pastor-digest',    'report-generator',          '{"report_type":"pastor_digest","period":"weekly"}'),
      ('report-monthly-pastor-digest',   'report-generator',          '{"report_type":"pastor_digest","period":"monthly"}'),
      ('moodle-grade-sync',              'moodle-grade-sync',         '{}'),
      ('attendance-reminder-daily',      'attendance-reminder',       '{}'),
      ('moodle-sync',                    'moodle-sync',               '{}')
    ) AS t(jobname, fn, body)
  LOOP
    SELECT jobid INTO v_id FROM cron.job WHERE jobname = v_job.jobname;
    IF v_id IS NULL THEN
      v_missing := v_missing || v_job.jobname;
      CONTINUE;
    END IF;

    v_command := format(
      'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_invoke_secret'')), body := %L::jsonb);',
      v_base || '/' || v_job.fn,
      v_job.body
    );

    -- alter_job changes the command only; schedule, name and active flag are kept.
    PERFORM cron.alter_job(job_id := v_id, command := v_command);
    v_changed := v_changed + 1;
  END LOOP;

  RAISE NOTICE 'cron cutover: % job(s) re-pointed to x-cron-secret', v_changed;
  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE NOTICE 'cron cutover: not scheduled in this project (skipped, nothing created): %', v_missing;
  END IF;
END
$cutover$;

-- Verification: every Edge Function cron job must now send x-cron-secret and must not
-- send a bearer credential. Any row returned below still needs re-pointing.
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE command ILIKE '%/functions/v1/%'
  AND (command NOT ILIKE '%x-cron-secret%' OR command ILIKE '%bearer%');
