-- ────────────────────────────────────────────────────────────────────
-- Duplicate Registration Tracking
-- ────────────────────────────────────────────────────────────────────
-- NEW: tracking for duplicate registrations with detection, notification,
-- and resolution workflow.

-- Add duplicate tracking columns to applicants table
ALTER TABLE public.applicants
  ADD COLUMN IF NOT EXISTS duplicate_group_id UUID,
  ADD COLUMN IF NOT EXISTS is_primary_duplicate BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duplicate_status TEXT DEFAULT 'UNIQUE' CHECK (duplicate_status IN ('UNIQUE', 'SUSPECTED', 'CONFIRMED', 'RESOLVED')),
  ADD COLUMN IF NOT EXISTS duplicate_resolution_note TEXT;

CREATE INDEX IF NOT EXISTS idx_applicants_duplicate_group_id ON public.applicants (duplicate_group_id);
CREATE INDEX IF NOT EXISTS idx_applicants_duplicate_status ON public.applicants (duplicate_status);

-- Table to track groups of duplicate registrations
CREATE TABLE IF NOT EXISTS public.duplicate_registration_groups (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              TEXT NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
  subgroup_id           TEXT,
  fellowship_code       TEXT,
  primary_applicant_id  UUID REFERENCES public.applicants(id) ON DELETE SET NULL,
  duplicate_count       INTEGER DEFAULT 2,
  detection_method      TEXT NOT NULL CHECK (detection_method IN ('email_match', 'phone_match', 'name_similarity', 'manual')),
  detection_score       REAL,
  status                TEXT NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved', 'false_positive')),
  resolution_note       TEXT,
  resolved_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.duplicate_registration_groups IS
  'Groups of duplicate registrations for admin review and resolution.';

CREATE INDEX IF NOT EXISTS idx_duplicate_groups_batch_id ON public.duplicate_registration_groups (batch_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_groups_subgroup_id ON public.duplicate_registration_groups (subgroup_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_groups_status ON public.duplicate_registration_groups (status);

-- Table for duplicate notifications
CREATE TABLE IF NOT EXISTS public.duplicate_notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_group_id    UUID NOT NULL REFERENCES public.duplicate_registration_groups(id) ON DELETE CASCADE,
  admin_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subgroup_id           TEXT,
  fellowship_code       TEXT,
  notification_status   TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sent', 'dismissed')),
  notified_at           TIMESTAMPTZ,
  dismissed_at          TIMESTAMPTZ,
  dismissed_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.duplicate_notifications IS
  'Tracks notifications sent to admins about duplicate registrations. Prevents repeated notifications for same duplicate group.';

CREATE INDEX IF NOT EXISTS idx_duplicate_notifications_group_id ON public.duplicate_notifications (duplicate_group_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_notifications_admin_id ON public.duplicate_notifications (admin_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_notifications_subgroup_id ON public.duplicate_notifications (subgroup_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_notifications_status ON public.duplicate_notifications (notification_status);

-- Unique constraint: only one pending notification per duplicate group per admin
CREATE UNIQUE INDEX IF NOT EXISTS uq_duplicate_notification_pending
  ON public.duplicate_notifications (duplicate_group_id, admin_id)
  WHERE notification_status = 'pending';

-- Audit trail for duplicate resolution
CREATE TABLE IF NOT EXISTS public.duplicate_resolution_audit (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_group_id    UUID NOT NULL REFERENCES public.duplicate_registration_groups(id) ON DELETE CASCADE,
  action                TEXT NOT NULL CHECK (action IN ('group_created', 'primary_selected', 'record_merged', 'resolved', 'reopened')),
  changed_by            UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  details               JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_audit_group_id ON public.duplicate_resolution_audit (duplicate_group_id);
CREATE INDEX IF NOT EXISTS idx_resolution_audit_changed_by ON public.duplicate_resolution_audit (changed_by);

-- RPC: Detect registration duplicates (batch processing)
CREATE OR REPLACE FUNCTION public.detect_registration_duplicates(batch_id_param TEXT, subgroup_id_param TEXT DEFAULT NULL, similarity_threshold REAL DEFAULT 0.85)
RETURNS TABLE (
  duplicate_group_id UUID,
  applicant_ids UUID[],
  detection_method TEXT,
  detection_score REAL
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  app RECORD;
  dup_group_id UUID;
  match_count INTEGER;
BEGIN
  -- Find duplicates by email within batch
  FOR app IN
    SELECT a.id, a.email, a.phone, a.first_name, a.last_name, a.batch_id, a.subgroup_id
    FROM public.applicants a
    WHERE a.batch_id = batch_id_param
      AND (subgroup_id_param IS NULL OR a.subgroup_id = subgroup_id_param)
      AND a.duplicate_status != 'RESOLVED'
      AND a.email IS NOT NULL AND a.email != ''
    ORDER BY a.email, a.id
  LOOP
    -- Check if this applicant already in a group
    IF NOT EXISTS (SELECT 1 FROM public.applicants WHERE id = app.id AND duplicate_group_id IS NOT NULL) THEN
      -- Find email matches
      SELECT COUNT(DISTINCT id) INTO match_count
      FROM public.applicants
      WHERE batch_id = batch_id_param
        AND LOWER(email) = LOWER(app.email)
        AND duplicate_status != 'RESOLVED';
      
      IF match_count > 1 THEN
        -- Create new duplicate group
        dup_group_id := gen_random_uuid();
        INSERT INTO public.duplicate_registration_groups
          (id, batch_id, subgroup_id, fellowship_code, duplicate_count, detection_method, detection_score)
        VALUES
          (dup_group_id, batch_id_param, app.subgroup_id, app.fellowship_code, match_count, 'email_match', 1.0);
        
        -- Link applicants to group
        UPDATE public.applicants
        SET duplicate_group_id = dup_group_id, duplicate_status = 'CONFIRMED'
        WHERE batch_id = batch_id_param
          AND LOWER(email) = LOWER(app.email)
          AND duplicate_status != 'RESOLVED';
        
        RETURN QUERY SELECT dup_group_id, ARRAY_AGG(DISTINCT id) FILTER (WHERE duplicate_status = 'CONFIRMED'), 'email_match'::TEXT, 1.0::REAL
                    FROM public.applicants WHERE duplicate_group_id = dup_group_id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- RPC: Create notification for duplicate group (one-time per admin, per group)
CREATE OR REPLACE FUNCTION public.create_duplicate_notification(duplicate_group_id_param UUID, admin_id_param UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  notification_id UUID;
BEGIN
  -- Check if notification already pending
  SELECT id INTO notification_id FROM public.duplicate_notifications
  WHERE duplicate_group_id = duplicate_group_id_param
    AND admin_id = admin_id_param
    AND notification_status = 'pending';
  
  IF notification_id IS NOT NULL THEN
    -- Notification already pending, return existing
    RETURN notification_id;
  END IF;
  
  -- Create new notification
  INSERT INTO public.duplicate_notifications
    (duplicate_group_id, admin_id, subgroup_id, fellowship_code, notification_status)
  SELECT dg.id, admin_id_param, dg.subgroup_id, dg.fellowship_code, 'pending'
  FROM public.duplicate_registration_groups dg
  WHERE dg.id = duplicate_group_id_param
  RETURNING id INTO notification_id;
  
  -- Log audit trail
  INSERT INTO public.duplicate_resolution_audit
    (duplicate_group_id, action, changed_by, details)
  VALUES
    (duplicate_group_id_param, 'group_created', admin_id_param, jsonb_build_object('notification_id', notification_id));
  
  RETURN notification_id;
END;
$$;

-- RPC: Get duplicate groups for admin
CREATE OR REPLACE FUNCTION public.get_duplicate_groups_for_admin(admin_role_param TEXT, admin_subgroup_param TEXT DEFAULT NULL, batch_id_param TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  batch_id TEXT,
  subgroup_id TEXT,
  fellowship_code TEXT,
  duplicate_count INTEGER,
  primary_applicant_id UUID,
  detection_method TEXT,
  status TEXT,
  applicant_ids JSONB,
  applicant_details JSONB
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    dg.id,
    dg.batch_id,
    dg.subgroup_id,
    dg.fellowship_code,
    dg.duplicate_count,
    dg.primary_applicant_id,
    dg.detection_method,
    dg.status,
    JSONB_AGG(JSONB_BUILD_OBJECT('id', a.id) ORDER BY a.email) FILTER (WHERE a.id IS NOT NULL),
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'id', a.id, 'name', a.first_name || ' ' || a.last_name,
      'email', a.email, 'phone', a.phone, 'fellowship', a.fellowship_code,
      'subgroup', a.subgroup_id, 'class_option', a.class_option_id, 'status', a.status,
      'is_primary', a.id = dg.primary_applicant_id, 'created_at', a.created_at
    ) ORDER BY a.email) FILTER (WHERE a.id IS NOT NULL)
  FROM public.duplicate_registration_groups dg
  LEFT JOIN public.applicants a ON a.duplicate_group_id = dg.id
  WHERE dg.status = 'unresolved'
    AND (
      admin_role_param IN ('superadmin', 'admin')
      OR (admin_role_param = 'regional_secretary')
      OR (admin_role_param = 'subgroup_admin' AND dg.subgroup_id = admin_subgroup_param)
      OR (admin_role_param = 'pastor' AND dg.fellowship_code = (SELECT fellowship_code FROM public.teachers WHERE teacher_user_id = auth.uid() LIMIT 1))
    )
    AND (batch_id_param IS NULL OR dg.batch_id = batch_id_param)
  GROUP BY dg.id
  ORDER BY dg.created_at DESC;
END;
$$;

-- Add updated_at trigger for duplicate_registration_groups
CREATE TRIGGER trg_duplicate_groups_updated_at
  BEFORE UPDATE ON public.duplicate_registration_groups
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS Policies for duplicate tables
ALTER TABLE public.duplicate_registration_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_resolution_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can view duplicate groups in their scope
-- Policy: Admins can view duplicate groups in their scope
CREATE POLICY dup_groups_select ON public.duplicate_registration_groups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
        AND (
          auth.users.raw_user_meta_data->>'role' IN ('superadmin', 'admin')
          OR (auth.users.raw_user_meta_data->>'role' = 'regional_secretary')
          OR (auth.users.raw_user_meta_data->>'role' = 'subgroup_admin'
              AND CAST(auth.users.raw_user_meta_data->>'subgroup_id' AS TEXT) = subgroup_id)
          OR (auth.users.raw_user_meta_data->>'role' = 'pastor'
              AND EXISTS (SELECT 1 FROM public.teachers WHERE teacher_user_id = auth.uid() AND fellowship_code = fellowship_code))
        )
    )
  );

-- Policy: Admins can update duplicate groups in their scope
CREATE POLICY dup_groups_update ON public.duplicate_registration_groups
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
        AND (
          auth.users.raw_user_meta_data->>'role' IN ('superadmin', 'admin', 'regional_secretary')
          OR (auth.users.raw_user_meta_data->>'role' = 'subgroup_admin' 
              AND CAST(auth.users.raw_user_meta_data->>'subgroup_id' AS TEXT) = subgroup_id)
        )
    )
  );

-- Policy: Admins can view notifications for their admin_id
CREATE POLICY dup_notif_select ON public.duplicate_notifications
  FOR SELECT USING (admin_id = auth.uid());

-- Policy: System can insert notifications
CREATE POLICY dup_notif_insert ON public.duplicate_notifications
  FOR INSERT WITH CHECK (TRUE);

-- Policy: Admins can dismiss their own notifications
CREATE POLICY dup_notif_update ON public.duplicate_notifications
  FOR UPDATE USING (admin_id = auth.uid());

-- Policy: Admins can view resolution audit in their scope
CREATE POLICY dup_audit_select ON public.duplicate_resolution_audit
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users au
      JOIN public.duplicate_registration_groups dg ON dg.id = duplicate_group_id
      WHERE au.id = auth.uid()
        AND (
          au.raw_user_meta_data->>'role' IN ('superadmin', 'admin')
          OR (au.raw_user_meta_data->>'role' = 'regional_secretary')
          OR (au.raw_user_meta_data->>'role' = 'subgroup_admin' 
              AND CAST(au.raw_user_meta_data->>'subgroup_id' AS TEXT) = dg.subgroup_id)
        )
    )
  );
