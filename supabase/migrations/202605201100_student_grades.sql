-- Migration: student_grades table
-- Stores Moodle-synced course grades per student.
-- Used by the Student Profile Drawer (Moodle tab).

CREATE TABLE IF NOT EXISTS public.student_grades (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id   UUID        REFERENCES public.applicants(id) ON DELETE CASCADE,
  student_id     UUID,
  course_id      TEXT        NOT NULL,
  grade          NUMERIC(6, 2),
  grade_label    TEXT,
  grade_letter   TEXT,
  pass           BOOLEAN,
  synced_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_grades_applicant_idx ON public.student_grades (applicant_id);
CREATE INDEX IF NOT EXISTS student_grades_student_idx  ON public.student_grades (student_id);
CREATE INDEX IF NOT EXISTS student_grades_course_idx   ON public.student_grades (course_id);

ALTER TABLE public.student_grades ENABLE ROW LEVEL SECURITY;

-- Admins and above can read and write all grades
CREATE POLICY "admin_manage_student_grades"
  ON public.student_grades
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Teachers can read grades for students in their assigned classes
CREATE POLICY "teacher_read_student_grades"
  ON public.student_grades
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.class_options co
      JOIN public.applicants a ON a.class_option_id = co.class_option_id
      WHERE (a.id = student_grades.applicant_id OR a.id::TEXT = student_grades.student_id::TEXT)
        AND co.teacher_id = auth.uid()::TEXT
    )
  );
