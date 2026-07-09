-- ============================================================
-- Email Campaign Draft / Send Workflow
-- ============================================================

-- Add payload column to email_queue if missing (used by edge function and JS clients)
ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Link email_queue rows to the campaign that triggered them (for duplicate-send prevention)
ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS campaign_id UUID;

CREATE INDEX IF NOT EXISTS idx_email_queue_campaign_id
  ON public.email_queue (campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ── email_campaigns ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,          -- internal draft name
  subject          TEXT        NOT NULL DEFAULT '',
  body_text        TEXT,                           -- plain-text body
  body_html        TEXT,                           -- rendered HTML body
  status           TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','ready','sending','sent','failed')),
  recipient_tags   TEXT[]      NOT NULL DEFAULT '{}',  -- fellowship codes / role tags
  recipient_emails TEXT[]      NOT NULL DEFAULT '{}',  -- explicit individual addresses
  recipient_count  INTEGER     DEFAULT 0,
  sent_count       INTEGER     DEFAULT 0,
  failed_count     INTEGER     DEFAULT 0,
  sent_at          TIMESTAMPTZ,
  created_by       TEXT,
  updated_by       TEXT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_campaigns IS
  'Email campaign drafts and send history. Sending always goes through email_queue → email-sender edge function → Resend. The Resend API key is never exposed to the browser.';

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status
  ON public.email_campaigns (status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_by
  ON public.email_campaigns (created_by);

DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON public.email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated_at
  BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

-- Superadmin / admin / regional_secretary: full access
DROP POLICY IF EXISTS campaigns_admin_all ON public.email_campaigns;
CREATE POLICY campaigns_admin_all ON public.email_campaigns
  FOR ALL TO authenticated
  USING  (public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary'))
  WITH CHECK (public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary'));

-- ── Atomic send-guard function ────────────────────────────────
-- Returns TRUE and sets status='sending' only when the campaign
-- is in an unsent state.  Prevents concurrent double-sends.
CREATE OR REPLACE FUNCTION public.campaign_begin_send(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.current_profile_role();
  IF v_role NOT IN ('superadmin', 'admin', 'regional_secretary') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.email_campaigns
     SET status = 'sending', updated_at = now()
   WHERE id = p_campaign_id
     AND status IN ('draft', 'ready');

  RETURN FOUND;  -- FALSE if already sending/sent/failed
END;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_begin_send(UUID) TO authenticated;

-- ── Finalize send (called after queue rows are inserted) ───────
CREATE OR REPLACE FUNCTION public.campaign_finish_send(
  p_campaign_id UUID,
  p_sent_count  INTEGER,
  p_success     BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_campaigns
     SET status       = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
         sent_count   = p_sent_count,
         recipient_count = p_sent_count,
         sent_at      = CASE WHEN p_success THEN now() ELSE NULL END,
         updated_at   = now()
   WHERE id = p_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_finish_send(UUID, INTEGER, BOOLEAN) TO authenticated;
