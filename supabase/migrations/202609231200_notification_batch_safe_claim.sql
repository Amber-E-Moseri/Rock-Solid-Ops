-- ─────────────────────────────────────────────────────────────────────────────
-- C1 Notification Batch Safety — Atomic Claim + Delivery Idempotency
--
-- Implements the certified C1 design for notification-batch-processor:
--
--   1. claimed_at column on scheduled_notifications (stale PROCESSING recovery)
--   2. source_notification_id column on email_queue (one delivery per source row)
--   3. claim_notification_batch() RPC:
--        Step 1 — stale recovery:    PROCESSING rows > 15 min → PENDING
--        Step 2 — terminal sweep:    PENDING rows with attempts >= max_attempts → FAILED
--        Step 3 — atomic claim:      FOR UPDATE SKIP LOCKED → PROCESSING
--
-- SAFE FOR EXISTING ROWS:
--   All DDL is ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--   No CHECK constraint is added to scheduled_notifications.status; existing
--   status values (PENDING, SENT, FAILED, RESOLVED, ERROR) are preserved.
--   The stale sweep and terminal sweep only fire when the RPC is invoked —
--   which requires the processor to be active, not merely after migration.
--
-- GLOBAL trace_id UNIQUENESS: NOT ADDED.
--   trace_id has mixed semantics (workflow correlation, applicant correlation,
--   report/email request id). The moodle-sync retry path proves that one
--   trace_id can legitimately appear in two email_queue rows.
--
-- Idempotency is instead enforced by source_notification_id with a partial
-- unique index scoped only to non-null values.
--
-- Invariant: ONE scheduled_notifications row → AT MOST ONE email_queue delivery.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. scheduled_notifications: claim timestamp ──────────────────────────────

ALTER TABLE public.scheduled_notifications
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL;

-- Index used by the stale PROCESSING recovery sweep in the claim RPC.
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_processing_claimed_at
  ON public.scheduled_notifications (claimed_at)
  WHERE status = 'PROCESSING';


-- ── 2. email_queue: delivery idempotency column ──────────────────────────────

ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS source_notification_id UUID
  REFERENCES public.scheduled_notifications(id) ON DELETE SET NULL;

-- One unique partial index only.
-- The UNIQUE index itself serves lookups; no redundant second index.
CREATE UNIQUE INDEX IF NOT EXISTS email_queue_source_notification_uq
  ON public.email_queue (source_notification_id)
  WHERE source_notification_id IS NOT NULL;


-- ── 3. claim_notification_batch RPC ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_notification_batch(p_limit integer DEFAULT 10)
RETURNS SETOF public.scheduled_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- STEP 1: Stale claim recovery
  -- PROCESSING rows whose claim is older than 15 minutes are reset to PENDING.
  -- attempts is NOT incremented: the worker crashed before doing real work.
  UPDATE public.scheduled_notifications
  SET
    status     = 'PENDING',
    claimed_at = NULL
  WHERE
    status     = 'PROCESSING'
    AND claimed_at < NOW() - INTERVAL '15 minutes';

  -- STEP 2: Terminal sweep
  -- PENDING rows that have exhausted all attempts are transitioned to FAILED.
  -- This prevents the infinite-PENDING liveness bug where the processor would
  -- skip exhausted rows without transitioning them.
  UPDATE public.scheduled_notifications
  SET
    status        = 'FAILED',
    error_message = 'MAX_ATTEMPTS_EXHAUSTED'
  WHERE
    status      = 'PENDING'
    AND attempts >= max_attempts;

  -- STEP 3: Atomic claim with FOR UPDATE SKIP LOCKED
  -- Only PENDING rows with scheduled_for <= now() and remaining attempts are
  -- eligible. Two concurrent workers receive non-overlapping sets.
  RETURN QUERY
  UPDATE public.scheduled_notifications
  SET
    status     = 'PROCESSING',
    claimed_at = NOW()
  WHERE id IN (
    SELECT id
    FROM public.scheduled_notifications
    WHERE
      status        = 'PENDING'
      AND scheduled_for <= NOW()
      AND attempts < max_attempts
    ORDER BY scheduled_for ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ── RPC Security ─────────────────────────────────────────────────────────────
--
-- claim_notification_batch is a privileged mutation RPC. It is called
-- exclusively by the notification-batch-processor Edge Function using the
-- service_role JWT. No browser role may invoke it.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on every CREATE FUNCTION.
-- The three explicit REVOKEs below close that gap for anon, authenticated, and
-- any future PUBLIC-inheriting role. The GRANT back to service_role ensures
-- the Edge Function path remains operative after the PUBLIC revocation.

REVOKE EXECUTE ON FUNCTION public.claim_notification_batch(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_notification_batch(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_notification_batch(integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_notification_batch(integer) TO service_role;
