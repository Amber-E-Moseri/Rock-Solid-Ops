-- Ensure attendance_records table and all required columns exist
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id  text        NOT NULL,
  class_option_id text,
  batch_id      text,
  session_date  date        NOT NULL,
  class_session text,
  status        text        NOT NULL DEFAULT 'present',
  marked_by     uuid,
  teacher_id    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Add columns with IF NOT EXISTS so the migration is re-runnable
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS class_option_id text;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS batch_id        text;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS session_date    date;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS class_session   text;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'present';
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS marked_by       uuid;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS teacher_id      text;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now();
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Unique constraint for upsert (ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'attendance_records'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'attendance_records_uq'
  ) THEN
    ALTER TABLE public.attendance_records
      ADD CONSTRAINT attendance_records_uq
      UNIQUE (applicant_id, class_option_id, session_date, class_session);
  END IF;
END $$;

-- RLS: allow authenticated reads; write only with valid session
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'auth_read') THEN
    CREATE POLICY auth_read ON public.attendance_records FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'auth_write') THEN
    CREATE POLICY auth_write ON public.attendance_records FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;
