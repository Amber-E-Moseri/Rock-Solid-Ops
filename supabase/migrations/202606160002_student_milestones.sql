-- Ensure milestone tables exist with all required columns
-- milestone_definitions: configurable milestone steps
CREATE TABLE IF NOT EXISTS public.milestone_definitions (
  code                 text PRIMARY KEY,
  label                text NOT NULL,
  class_session_number integer,
  is_active            boolean NOT NULL DEFAULT true,
  sort_order           integer DEFAULT 0,
  updated_at           timestamptz DEFAULT now()
);

ALTER TABLE public.milestone_definitions ADD COLUMN IF NOT EXISTS class_session_number integer;
ALTER TABLE public.milestone_definitions ADD COLUMN IF NOT EXISTS sort_order           integer DEFAULT 0;
ALTER TABLE public.milestone_definitions ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now();

-- student_milestone_status: per-student, per-milestone completion
CREATE TABLE IF NOT EXISTS public.student_milestone_status (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id    text        NOT NULL,
  student_id      text,
  milestone_code  text        NOT NULL REFERENCES public.milestone_definitions(code),
  status          text        NOT NULL DEFAULT 'pending',
  completed_at    timestamptz,
  completed_by    text,
  updated_at      timestamptz DEFAULT now(),
  updated_by      text,
  UNIQUE (applicant_id, milestone_code)
);

ALTER TABLE public.student_milestone_status ADD COLUMN IF NOT EXISTS student_id   text;
ALTER TABLE public.student_milestone_status ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.student_milestone_status ADD COLUMN IF NOT EXISTS completed_by text;
ALTER TABLE public.student_milestone_status ADD COLUMN IF NOT EXISTS updated_at   timestamptz DEFAULT now();
ALTER TABLE public.student_milestone_status ADD COLUMN IF NOT EXISTS updated_by   text;

-- Enable RLS
ALTER TABLE public.milestone_definitions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_milestone_status  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'milestone_definitions' AND policyname = 'auth_all') THEN
    CREATE POLICY auth_all ON public.milestone_definitions FOR ALL USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'student_milestone_status' AND policyname = 'auth_all') THEN
    CREATE POLICY auth_all ON public.student_milestone_status FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;
