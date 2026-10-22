-- Rollback for supabase/migrations/202610220100_repair_class_options_registration_columns.sql
--
-- DESTRUCTIVE. Drops public.class_options.is_online and public.class_options.confirmed_start_date.
--
-- This file lives in supabase/ops/, NOT supabase/migrations/, so `supabase db push` never runs it.
-- It is run by hand, by the owner, against a verified backup (see the runbook, section 6).
--
-- It refuses to run unless ALL of the following are set in the same psql session, BEFORE this file:
--
--   SET rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS';
--   SET rso.rollback_export_confirmed = 'yes';
--   SET rso.rollback_expected_rows = '<N>';   -- N = rows in the verified export (may be 0)
--
-- and it refuses unless N equals the live count of rows that hold a post-repair value
-- (is_online <> false, or confirmed_start_date not null). A mismatch means the export is stale.
--
-- Run as:
--   psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -c "SET rso.rollback_authorization = ...;" -c "..." -f supabase/ops/202610220100_rollback_class_options_repair.sql
--
-- It does NOT touch supabase_migrations.schema_migrations. Removing the history row is a
-- separate step that needs its own approval (runbook section 4).
--
-- Values written after the repair are lost once the columns are dropped. The export is the only
-- copy. Do not treat this file as a backup.

BEGIN;

-- Guard 1: explicit authorization and export confirmation.
DO $$
BEGIN
  IF coalesce(current_setting('rso.rollback_authorization', true), '') <> 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS' THEN
    RAISE EXCEPTION 'REFUSED: rso.rollback_authorization is not set. This rollback drops two columns and needs explicit authorization.';
  END IF;
  IF coalesce(current_setting('rso.rollback_export_confirmed', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'REFUSED: rso.rollback_export_confirmed is not set to ''yes''. Export the affected rows and verify the file first (runbook section 6.2).';
  END IF;
  IF coalesce(current_setting('rso.rollback_expected_rows', true), '') = '' THEN
    RAISE EXCEPTION 'REFUSED: rso.rollback_expected_rows is not set. Set it to the row count of the verified export.';
  END IF;
END
$$;

-- Guard 2: both columns must exist (otherwise the state is not the repaired state; inspect by hand).
DO $$
DECLARE
  v_present integer;
BEGIN
  SELECT count(*) INTO v_present
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'class_options'
    AND column_name IN ('is_online', 'confirmed_start_date');
  IF v_present <> 2 THEN
    RAISE EXCEPTION 'REFUSED: expected both repaired columns to exist; found %. The schema is not in the repaired state. Inspect by hand.', v_present;
  END IF;
END
$$;

-- Guard 3: the live count of rows carrying post-repair values must equal the export's row count.
DO $$
DECLARE
  v_expected integer := current_setting('rso.rollback_expected_rows', true)::integer;
  v_actual integer;
BEGIN
  SELECT count(*) INTO v_actual
  FROM public.class_options
  WHERE is_online IS DISTINCT FROM false
     OR confirmed_start_date IS NOT NULL;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'REFUSED: % rows carry post-repair values but the export lists %. Re-export and retry. Nothing was changed.', v_actual, v_expected;
  END IF;
  RAISE NOTICE 'Guards passed: % rows carry post-repair values, matching the verified export. Dropping the two columns now.', v_actual;
END
$$;

-- The destructive step. Runs only if every guard above passed.
ALTER TABLE public.class_options
  DROP COLUMN IF EXISTS is_online,
  DROP COLUMN IF EXISTS confirmed_start_date;

COMMIT;
