-- Expands applicants.status constraint to allow all values the registration-processor
-- can produce for the legacy status column (backward-compat with old schema).
-- The canonical field is registration_status; this column is kept for compatibility only.

ALTER TABLE public.applicants
  DROP CONSTRAINT IF EXISTS applicants_status_check;

ALTER TABLE public.applicants
  ADD CONSTRAINT applicants_status_check
    CHECK (status IN (
      'Pending', 'Approved', 'Rejected', 'Enrolled',
      'Waitlisted', 'Duplicate', 'Review', 'Inactive', 'Completed'
    ));
