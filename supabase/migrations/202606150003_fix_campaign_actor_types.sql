-- Step 1: Null out any values that are not valid UUIDs (e.g. empty strings or legacy names)
UPDATE public.email_campaigns
  SET created_by = NULL
  WHERE created_by IS NOT NULL
    AND created_by !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE public.email_campaigns
  SET updated_by = NULL
  WHERE updated_by IS NOT NULL
    AND updated_by !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Step 2: Change column types
ALTER TABLE public.email_campaigns
  ALTER COLUMN created_by TYPE UUID USING created_by::UUID,
  ALTER COLUMN updated_by TYPE UUID USING updated_by::UUID;

-- Step 3: Add FK constraints
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT fk_campaigns_created_by
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_campaigns_updated_by
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Step 4: Drop the old text index and replace with UUID-typed one
DROP INDEX IF EXISTS idx_email_campaigns_created_by;
CREATE INDEX idx_email_campaigns_created_by
  ON public.email_campaigns (created_by)
  WHERE created_by IS NOT NULL;
