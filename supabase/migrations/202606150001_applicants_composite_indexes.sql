-- Composite index for the most common admin query: all applicants in a batch by status
CREATE INDEX IF NOT EXISTS idx_applicants_batch_status
  ON public.applicants (batch_id, status);

-- Composite index for subgroup-scoped views within a batch
CREATE INDEX IF NOT EXISTS idx_applicants_batch_subgroup
  ON public.applicants (batch_id, subgroup_id);

-- Composite index for duplicate detection queries (batch + email)
CREATE INDEX IF NOT EXISTS idx_applicants_batch_email
  ON public.applicants (batch_id, LOWER(email));

-- Composite index for class assignment queries
CREATE INDEX IF NOT EXISTS idx_applicants_batch_class
  ON public.applicants (batch_id, class_option_id)
  WHERE class_option_id IS NOT NULL;

COMMENT ON INDEX public.idx_applicants_batch_status IS
  'Supports admin views filtered by batch and registration status simultaneously.';
