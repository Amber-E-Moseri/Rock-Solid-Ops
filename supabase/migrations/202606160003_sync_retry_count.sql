-- Add retry_count to moodle_enrollment_sync if it does not exist
ALTER TABLE public.moodle_enrollment_sync ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.moodle_enrollment_sync ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;
ALTER TABLE public.moodle_enrollment_sync ADD COLUMN IF NOT EXISTS dismissed_at  timestamptz;
ALTER TABLE public.moodle_enrollment_sync ADD COLUMN IF NOT EXISTS dismiss_reason text;

-- Same columns for email_queue
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS retry_count    integer NOT NULL DEFAULT 0;
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS last_retry_at  timestamptz;
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS dismissed_at   timestamptz;
ALTER TABLE public.email_queue ADD COLUMN IF NOT EXISTS dismiss_reason text;
