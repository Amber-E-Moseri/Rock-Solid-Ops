-- Fixes a correctness defect in sync_class_slot_enrolment():
-- The decrement block previously fired on EVERY UPDATE OF class_option_id,
-- including no-op updates where the value did not change. This caused:
--   INSERT applicant (class_option_id=X)  → trigger +1
--   UPDATE applicant (class_option_id=X, same value) → trigger -1  ← BUG
-- Net: 0 instead of the expected +1.
--
-- Fix: add the IS DISTINCT FROM condition to the decrement guard so the counter
-- only adjusts when the class assignment *actually* changes.
--
-- After this fix the trigger is the sole authority for class_slots.current_enrolment.
-- The invariant maintained:
--   current_enrolment = COUNT(*) FROM applicants
--     WHERE class_option_id = slot.class_option_id
--       AND batch_id = slot.batch_id

CREATE OR REPLACE FUNCTION public.sync_class_slot_enrolment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- DECREMENT the old slot only when the applicant's class assignment actually changes:
  -- class_option_id cleared, class_option_id changed, batch_id changed, or row deleted.
  -- A no-op UPDATE (same class_option_id and batch_id) must not decrement.
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    IF OLD.class_option_id IS NOT NULL AND OLD.batch_id IS NOT NULL AND (
      TG_OP = 'DELETE'                                     OR
      NEW.class_option_id IS NULL                          OR
      NEW.class_option_id IS DISTINCT FROM OLD.class_option_id OR
      NEW.batch_id        IS DISTINCT FROM OLD.batch_id
    ) THEN
      UPDATE public.class_slots
        SET current_enrolment = GREATEST(current_enrolment - 1, 0),
            updated_at        = now()
        WHERE class_option_id = OLD.class_option_id
          AND batch_id        = OLD.batch_id;
    END IF;
  END IF;

  -- INCREMENT the new slot when an applicant is assigned to a class for the first time
  -- (INSERT) or when their class/batch actually changes (UPDATE with changed key).
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    IF NEW.class_option_id IS NOT NULL AND NEW.batch_id IS NOT NULL AND (
      TG_OP = 'INSERT'                                     OR
      NEW.class_option_id IS DISTINCT FROM OLD.class_option_id OR
      NEW.batch_id        IS DISTINCT FROM OLD.batch_id
    ) THEN
      UPDATE public.class_slots
        SET current_enrolment = current_enrolment + 1,
            updated_at        = now()
        WHERE class_option_id = NEW.class_option_id
          AND batch_id        = NEW.batch_id;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION public.sync_class_slot_enrolment() IS
  'Keeps class_slots.current_enrolment in sync with applicant assignments. '
  'Increments on INSERT or class/batch change; decrements only when assignment '
  'actually moves away from the old slot or on DELETE. No-op updates produce delta=0.';

-- Recalibrate all stored counters to the authoritative base-record count.
-- Corrects any drift accumulated under the previous trigger definition.
UPDATE public.class_slots cs
SET current_enrolment = (
  SELECT COUNT(*)
  FROM public.applicants a
  WHERE a.class_option_id = cs.class_option_id
    AND a.batch_id        = cs.batch_id
);
