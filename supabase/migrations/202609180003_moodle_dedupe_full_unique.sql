-- Convert uq_moodle_enrollment_sync_dedupe from a partial unique index
-- (WHERE dedupe_key IS NOT NULL) to a full unique index so that Supabase JS
-- upsert with onConflict:"dedupe_key" resolves to a matching constraint.
-- Postgres ON CONFLICT for partial indexes requires the WHERE predicate in the
-- SQL, which the Supabase PostgREST client cannot express — causing every
-- upsert with dedupe_key to fail with "no unique constraint matching ON CONFLICT".
-- dedupe_key is always non-null in the processor flow, so this is equivalent.

DROP INDEX IF EXISTS uq_moodle_enrollment_sync_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS uq_moodle_enrollment_sync_dedupe
  ON public.moodle_enrollment_sync (dedupe_key);
