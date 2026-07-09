-- ============================================================
-- Batch-level campus registration controls
-- ============================================================
-- Adds per-campus open/close overrides within a batch.
-- Absence of a row for a (batch_id, fellowship_code) pair means
-- registration is open (the default).

CREATE TABLE IF NOT EXISTS public.batch_campus_registration_settings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         TEXT        NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
  fellowship_code  TEXT        NOT NULL REFERENCES public.fellowship_map(fellowship_code) ON DELETE CASCADE,
  registration_open BOOLEAN    NOT NULL DEFAULT true,
  closed_reason    TEXT,
  closed_by        TEXT,
  closed_at        TIMESTAMPTZ,
  reopened_by      TEXT,
  reopened_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.batch_campus_registration_settings IS
  'Per-campus registration open/close overrides within a batch. No row = open.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_campus_reg
  ON public.batch_campus_registration_settings (batch_id, fellowship_code);

CREATE INDEX IF NOT EXISTS idx_bcrs_batch_id
  ON public.batch_campus_registration_settings (batch_id);
CREATE INDEX IF NOT EXISTS idx_bcrs_open
  ON public.batch_campus_registration_settings (registration_open)
  WHERE registration_open = false;

CREATE TRIGGER trg_bcrs_updated_at
  BEFORE UPDATE ON public.batch_campus_registration_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE public.batch_campus_registration_settings ENABLE ROW LEVEL SECURITY;

-- Superadmin, admin, regional_secretary: full access to all campuses
CREATE POLICY bcrs_senior_admin_all ON public.batch_campus_registration_settings
  FOR ALL TO authenticated
  USING  (public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary'))
  WITH CHECK (public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary'));

-- Subgroup admin: manage only campuses in their subgroup
CREATE POLICY bcrs_subgroup_admin_all ON public.batch_campus_registration_settings
  FOR ALL TO authenticated
  USING (
    public.current_profile_role() = 'subgroup_admin'
    AND fellowship_code IN (
      SELECT fm.fellowship_code
      FROM public.fellowship_map fm
      WHERE fm.subgroup_id = (
        SELECT (auth.jwt() ->> 'user_metadata')::jsonb ->> 'subgroup_id'
      )
    )
  )
  WITH CHECK (
    public.current_profile_role() = 'subgroup_admin'
    AND fellowship_code IN (
      SELECT fm.fellowship_code
      FROM public.fellowship_map fm
      WHERE fm.subgroup_id = (
        SELECT (auth.jwt() ->> 'user_metadata')::jsonb ->> 'subgroup_id'
      )
    )
  );

-- Pastor: read-only for their fellowship
CREATE POLICY bcrs_pastor_select ON public.batch_campus_registration_settings
  FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'pastor'
    AND fellowship_code IN (
      SELECT t.fellowship_code FROM public.teachers t
      WHERE t.teacher_user_id = auth.uid() LIMIT 1
    )
  );

-- Anon can read (registration form checks campus status with the anon key)
CREATE POLICY bcrs_anon_select ON public.batch_campus_registration_settings
  FOR SELECT TO anon
  USING (true);
