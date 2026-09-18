-- Add subgroup_id to batches table.
-- Additive, idempotent — safe to run multiple times.
-- The existing `subgroup` column (text free-entry) is preserved for compatibility.
-- `subgroup_id` is a normalised FK-style reference to fellowship_map.subgroup_id.

ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS subgroup_id TEXT;

CREATE INDEX IF NOT EXISTS idx_batches_subgroup_id
  ON public.batches (subgroup_id)
  WHERE subgroup_id IS NOT NULL;

-- Back-fill subgroup_id from the existing subgroup column where possible (if column exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='batches' AND column_name='subgroup'
  ) THEN
    UPDATE public.batches
       SET subgroup_id = subgroup
     WHERE subgroup_id IS NULL
       AND subgroup IS NOT NULL
       AND trim(subgroup) <> '';
  END IF;
END $$;
