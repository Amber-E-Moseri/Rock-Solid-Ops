-- Wave C2: establish the failed_syncs persistence contract.
--
-- failed_syncs is an OPERATIONAL VISIBILITY MIRROR only. It is not the source
-- of truth for any sync (moodle_enrollment_sync, teacher_availability and
-- audit_logs are) and it is not a retry authority.
--
-- Before this migration the table existed only out-of-band (production) and in
-- archive/sql-exports/schema.sql, with no updated_at column, no policies and
-- table-wide grants. Server writers (moodle-sync, teacher-portal-api) send
-- updated_at, so every mirror write was rejected and silently swallowed.
--
-- Works on both:
--   A. a fresh database built only from migrations (table does not exist)
--   B. an existing production-shaped table (no updated_at)
-- Additive and idempotent. Existing rows are never deleted or rewritten
-- except to fill a NULL updated_at.

-- 1. Table (fresh databases). No-op when the table already exists.
CREATE TABLE IF NOT EXISTS public.failed_syncs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type     text        NOT NULL,
  source_table  text,
  source_id     text,
  payload       jsonb,
  error_message text,
  status        text        NOT NULL DEFAULT 'FAILED',
  retry_count   integer     NOT NULL DEFAULT 0,
  last_retry_at timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. updated_at on an existing table. Backfill only NULLs, before the
--    updated_at trigger exists, so valid timestamps are never rewritten.
ALTER TABLE public.failed_syncs ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.failed_syncs
   SET updated_at = coalesce(last_retry_at, created_at)
 WHERE updated_at IS NULL;

ALTER TABLE public.failed_syncs ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.failed_syncs ALTER COLUMN updated_at SET NOT NULL;

-- 3. Keep updated_at fresh on updates that do not set it (retry-worker
--    retry/resolve). Reuses the existing helper; does not modify it.
DROP TRIGGER IF EXISTS trg_failed_syncs_updated_at ON public.failed_syncs;
CREATE TRIGGER trg_failed_syncs_updated_at
  BEFORE UPDATE ON public.failed_syncs
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- 4. Non-unique lookup index for moodle-sync's mirror lookup
--    (WHERE source_table = ? AND source_id = ?).
CREATE INDEX IF NOT EXISTS idx_failed_syncs_source
  ON public.failed_syncs (source_table, source_id);

-- 5. RLS: browser readers are SELECT-only and limited to the five admin-tier
--    roles that can reach the Retry Center / System Health routes.
--    Deliberately not public.is_admin(): that helper also admits
--    regional_secretary, which has no workflow here.
--    No INSERT/UPDATE/DELETE policy: server writers use service_role (bypasses
--    RLS) and browser mutations go through the retry-worker edge function.
ALTER TABLE public.failed_syncs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS failed_syncs_admin_select ON public.failed_syncs;
CREATE POLICY failed_syncs_admin_select
  ON public.failed_syncs
  FOR SELECT
  TO authenticated
  USING (
    public.current_profile_role() IN (
      'superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal'
    )
  );

-- 6. Least-privilege grants. RLS is a separate layer; do not rely on it alone.
REVOKE ALL ON TABLE public.failed_syncs FROM PUBLIC;
REVOKE ALL ON TABLE public.failed_syncs FROM anon;
REVOKE ALL ON TABLE public.failed_syncs FROM authenticated;
GRANT SELECT ON TABLE public.failed_syncs TO authenticated;
REVOKE ALL ON TABLE public.failed_syncs FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.failed_syncs TO service_role;
