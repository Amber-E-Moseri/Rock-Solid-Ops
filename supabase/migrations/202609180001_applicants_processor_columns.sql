-- Adds columns referenced by registration-processor but absent from all prior migrations.
-- These columns exist in the hosted production DB (added outside the migration chain);
-- this migration reconciles local/CI reproducibility.
-- All columns use ADD COLUMN IF NOT EXISTS for idempotency.

ALTER TABLE public.applicants
  ADD COLUMN IF NOT EXISTS full_name         TEXT,
  ADD COLUMN IF NOT EXISTS source            TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload       JSONB,
  ADD COLUMN IF NOT EXISTS needs_admin_review BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duplicate_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_note        TEXT;

-- Backfill full_name from existing first_name + last_name where not set.
UPDATE public.applicants
SET full_name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
WHERE full_name IS NULL AND (first_name IS NOT NULL OR last_name IS NOT NULL);

COMMENT ON COLUMN public.applicants.full_name IS
  'Denormalized full name (concatenation of first_name + last_name). Written by registration-processor from the submitted full_name field.';
COMMENT ON COLUMN public.applicants.source IS
  'Registration source identifier (e.g. "registration_processor").';
COMMENT ON COLUMN public.applicants.raw_payload IS
  'Raw JSON payload from the registration submission, for audit/replay.';
COMMENT ON COLUMN public.applicants.needs_admin_review IS
  'Admin review flag set by the processor on DUPLICATE or REVIEW status.';
COMMENT ON COLUMN public.applicants.duplicate_count IS
  'Count of prior applicant rows with the same email at submission time.';
COMMENT ON COLUMN public.applicants.admin_note IS
  'Free-text admin note, mirrors review_notes at submission time.';
