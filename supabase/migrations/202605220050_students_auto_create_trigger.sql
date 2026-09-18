CREATE OR REPLACE FUNCTION public.sync_applicant_to_students()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_teacher_id TEXT;
  v_teacher_name TEXT;
BEGIN
  -- Only fire when status changes to ASSIGNED
  IF NEW.registration_status = 'ASSIGNED'
     AND (OLD.registration_status IS NULL
          OR OLD.registration_status != 'ASSIGNED')
     AND NEW.class_option_id IS NOT NULL THEN

    -- Get teacher info from class_options
    SELECT co.teacher_id, t.full_name
    INTO v_teacher_id, v_teacher_name
    FROM public.class_options co
    LEFT JOIN public.teachers t
      ON t.teacher_id = co.teacher_id
    WHERE co.class_option_id = NEW.class_option_id
    LIMIT 1;

    -- Upsert into students
    INSERT INTO public.students (
      student_id,
      full_name,
      email,
      phone,
      group_id,
      subgroup_id,
      fellowship_code,
      batch_id,
      class_option_id,
      teacher_id,
      teacher_name,
      status,
      created_at,
      updated_at
    ) VALUES (
      NEW.id::text,
      TRIM(CONCAT(COALESCE(NEW.first_name, ''), ' ', COALESCE(NEW.last_name, ''))),
      NEW.email,
      NEW.phone,
      NEW.group_id,
      NEW.subgroup_id,
      NEW.fellowship_code,
      NEW.batch_id,
      NEW.class_option_id,
      v_teacher_id,
      v_teacher_name,
      'Active',
      now(),
      now()
    )
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      group_id = EXCLUDED.group_id,
      subgroup_id = EXCLUDED.subgroup_id,
      fellowship_code = EXCLUDED.fellowship_code,
      batch_id = EXCLUDED.batch_id,
      class_option_id = EXCLUDED.class_option_id,
      teacher_id = EXCLUDED.teacher_id,
      teacher_name = EXCLUDED.teacher_name,
      status = 'Active',
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applicant_assigned_sync_students ON public.applicants;

CREATE TRIGGER applicant_assigned_sync_students
AFTER UPDATE ON public.applicants
FOR EACH ROW
EXECUTE FUNCTION public.sync_applicant_to_students();

INSERT INTO public.students (
  student_id, full_name, email, phone, group_id,
  subgroup_id, fellowship_code, batch_id,
  class_option_id, teacher_id, teacher_name,
  status, created_at, updated_at
)
SELECT DISTINCT ON (a.email)
  a.id::text,
  TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, ''))),
  a.email,
  a.phone,
  a.group_id,
  a.subgroup_id,
  a.fellowship_code,
  a.batch_id,
  a.class_option_id,
  co.teacher_id,
  t.full_name,
  'Active',
  now(),
  now()
FROM public.applicants a
LEFT JOIN public.class_options co
  ON co.class_option_id = a.class_option_id
LEFT JOIN public.teachers t
  ON t.teacher_id = co.teacher_id
WHERE a.registration_status = 'ASSIGNED'
AND a.class_option_id IS NOT NULL
ON CONFLICT (email) DO UPDATE SET
  class_option_id = EXCLUDED.class_option_id,
  teacher_id = EXCLUDED.teacher_id,
  teacher_name = EXCLUDED.teacher_name,
  batch_id = EXCLUDED.batch_id,
  phone = EXCLUDED.phone,
  updated_at = now();
