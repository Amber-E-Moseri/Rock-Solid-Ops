CREATE OR REPLACE FUNCTION public.sync_class_slot_enrolment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Decrement old slot if applicant was moved away from a class
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    IF OLD.class_option_id IS NOT NULL AND OLD.batch_id IS NOT NULL THEN
      UPDATE public.class_slots
        SET current_enrolment = GREATEST(current_enrolment - 1, 0),
            updated_at = now()
        WHERE class_option_id = OLD.class_option_id
          AND batch_id = OLD.batch_id;
    END IF;
  END IF;

  -- Increment new slot if applicant was assigned to a class
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.class_option_id IS NOT NULL AND NEW.batch_id IS NOT NULL THEN
      -- Only increment on INSERT, or on UPDATE when class_option_id actually changed
      IF TG_OP = 'INSERT' OR NEW.class_option_id IS DISTINCT FROM OLD.class_option_id THEN
        UPDATE public.class_slots
          SET current_enrolment = current_enrolment + 1,
              updated_at = now()
          WHERE class_option_id = NEW.class_option_id
            AND batch_id = NEW.batch_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applicant_enrolment_sync ON public.applicants;
CREATE TRIGGER trg_applicant_enrolment_sync
  AFTER INSERT OR UPDATE OF class_option_id OR DELETE
  ON public.applicants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_class_slot_enrolment();

COMMENT ON FUNCTION public.sync_class_slot_enrolment() IS
  'Keeps class_slots.current_enrolment in sync with actual applicant assignments. Fires on every class_option_id change to applicants.';

-- Optionally: recount all slots from scratch to fix any existing drift
UPDATE public.class_slots cs
  SET current_enrolment = (
    SELECT COUNT(*) FROM public.applicants a
    WHERE a.class_option_id = cs.class_option_id
      AND a.batch_id = cs.batch_id
      AND a.registration_status NOT IN ('WITHDRAWN', 'REJECTED')
  );
