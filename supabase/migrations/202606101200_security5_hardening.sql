-- ============================================================
-- Security Hardening: Phase 5
-- Audit date: 2026-06-10
-- ============================================================
-- Fixes:
--   1. class_selection_tokens      — RLS was disabled; re-enable with admin policies
--   2. get_duplicate_groups_for_admin() — client-controlled role param → server-side via current_profile_role()
--   3. in_app_notifications INSERT — with check (true) → admin-only
--   4. duplicate_registration_groups RLS — raw_user_meta_data → current_profile_role()
--   5. duplicate_notifications INSERT — with check (true) → admin-only
--   6. duplicate_resolution_audit RLS — raw_user_meta_data → current_profile_role(); add INSERT
--   7. student_grades policy        — is_admin_like() (dropped) → is_admin()
--   8. report_archive               — missing write policies; add for superadmin/admin
--   9. student_engagement_config    — over-broad SELECT (any authenticated) → is_admin()
-- ============================================================


-- ============================================================
-- 1. class_selection_tokens: re-enable RLS
-- ============================================================
-- RLS was explicitly disabled in 202605180005_class_selection_tokens.sql.
-- With RLS off, any anon client can enumerate all tokens, enabling anyone to
-- construct class-selection URLs for any applicant.
-- class_selection_finalize() is SECURITY DEFINER and bypasses RLS, so the
-- public-facing flow still works without an anon SELECT policy.

ALTER TABLE public.class_selection_tokens ENABLE ROW LEVEL SECURITY;

-- Admins may view tokens (needed for support / revocation workflows)
CREATE POLICY cst_admin_select ON public.class_selection_tokens
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admins may issue new tokens (class-selection invite flow)
CREATE POLICY cst_admin_insert ON public.class_selection_tokens
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Admins may mark tokens used/expired (revocation)
CREATE POLICY cst_admin_update ON public.class_selection_tokens
  FOR UPDATE TO authenticated
  USING (public.is_admin());


-- ============================================================
-- 2. get_duplicate_groups_for_admin(): remove client-controlled role param
-- ============================================================
-- Original signature accepted admin_role_param TEXT from the caller, meaning
-- any authenticated user could pass admin_role_param='superadmin' to see all
-- duplicate data.  The replacement resolves role/scope from current_profile_role()
-- and the profiles table, then enforces scope inside the function body.

-- Drop the vulnerable overload (TEXT, TEXT, TEXT)
DROP FUNCTION IF EXISTS public.get_duplicate_groups_for_admin(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_duplicate_groups_for_admin(
  batch_id_param TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                   UUID,
  batch_id             TEXT,
  subgroup_id          TEXT,
  fellowship_code      TEXT,
  duplicate_count      INTEGER,
  primary_applicant_id UUID,
  detection_method     TEXT,
  status               TEXT,
  applicant_ids        JSONB,
  applicant_details    JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role           TEXT;
  v_user_id        UUID;
  v_subgroup_id    TEXT;
  v_fellowship     TEXT;
BEGIN
  v_user_id := auth.uid();
  v_role    := public.current_profile_role();

  IF v_role NOT IN ('superadmin', 'admin', 'regional_secretary', 'subgroup_admin', 'pastor') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Resolve scoping attributes from server-side profile data
  v_subgroup_id := ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'subgroup_id');

  SELECT t.fellowship_code
  INTO v_fellowship
  FROM public.teachers t
  WHERE t.teacher_user_id = v_user_id
  LIMIT 1;

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
    JSONB_AGG(
      JSONB_BUILD_OBJECT('id', a.id)
      ORDER BY a.email
    ) FILTER (WHERE a.id IS NOT NULL),
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id',           a.id,
        'name',         a.first_name || ' ' || a.last_name,
        'email',        a.email,
        'phone',        a.phone,
        'fellowship',   a.fellowship_code,
        'subgroup',     a.subgroup_id,
        'class_option', a.class_option_id,
        'status',       a.status,
        'is_primary',   a.id = dg.primary_applicant_id,
        'created_at',   a.created_at
      )
      ORDER BY a.email
    ) FILTER (WHERE a.id IS NOT NULL)
  FROM public.duplicate_registration_groups dg
  LEFT JOIN public.applicants a ON a.duplicate_group_id = dg.id
  WHERE dg.status = 'unresolved'
    AND (
      v_role IN ('superadmin', 'admin', 'regional_secretary')
      OR (v_role = 'subgroup_admin' AND dg.subgroup_id = v_subgroup_id)
      OR (v_role = 'pastor'         AND dg.fellowship_code = v_fellowship)
    )
    AND (batch_id_param IS NULL OR dg.batch_id = batch_id_param)
  GROUP BY dg.id
  ORDER BY dg.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_duplicate_groups_for_admin(TEXT) TO authenticated;


-- ============================================================
-- 3. in_app_notifications INSERT: admin-only
-- ============================================================
-- The original policy used WITH CHECK (true), allowing any authenticated user
-- to insert a notification targeting any recipient_id.

DROP POLICY IF EXISTS "authenticated users can insert notifications"
  ON public.in_app_notifications;

CREATE POLICY notif_admin_insert ON public.in_app_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- ============================================================
-- 4 & 5. duplicate_registration_groups + duplicate_notifications
--        Replace raw_user_meta_data with current_profile_role()
-- ============================================================
-- JWT raw_user_meta_data can be stale for the duration of a session.
-- current_profile_role() reads the profiles table directly (SECURITY DEFINER),
-- so it always reflects the authoritative role.

-- 4a. duplicate_registration_groups SELECT
DROP POLICY IF EXISTS dup_groups_select ON public.duplicate_registration_groups;

CREATE POLICY dup_groups_select ON public.duplicate_registration_groups
  FOR SELECT TO authenticated
  USING (
    public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary')
    OR (
      public.current_profile_role() = 'subgroup_admin'
      AND subgroup_id = ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'subgroup_id')
    )
    OR (
      public.current_profile_role() = 'pastor'
      AND fellowship_code = (
        SELECT t.fellowship_code
        FROM public.teachers t
        WHERE t.teacher_user_id = auth.uid()
        LIMIT 1
      )
    )
  );

-- 4b. duplicate_registration_groups UPDATE
DROP POLICY IF EXISTS dup_groups_update ON public.duplicate_registration_groups;

CREATE POLICY dup_groups_update ON public.duplicate_registration_groups
  FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary')
    OR (
      public.current_profile_role() = 'subgroup_admin'
      AND subgroup_id = ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'subgroup_id')
    )
  );

-- 5. duplicate_notifications INSERT: admin-only
-- Original was WITH CHECK (TRUE); any authenticated user could insert
-- notifications targeting any admin_id.
DROP POLICY IF EXISTS dup_notif_insert ON public.duplicate_notifications;

CREATE POLICY dup_notif_insert ON public.duplicate_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- ============================================================
-- 6. duplicate_resolution_audit: fix SELECT + add INSERT
-- ============================================================
DROP POLICY IF EXISTS dup_audit_select ON public.duplicate_resolution_audit;

CREATE POLICY dup_audit_select ON public.duplicate_resolution_audit
  FOR SELECT TO authenticated
  USING (
    public.current_profile_role() IN ('superadmin', 'admin', 'regional_secretary')
    OR (
      public.current_profile_role() = 'subgroup_admin'
      AND EXISTS (
        SELECT 1
        FROM public.duplicate_registration_groups dg
        WHERE dg.id = duplicate_group_id
          AND dg.subgroup_id = ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'subgroup_id')
      )
    )
  );

-- Admins write audit rows when resolving duplicates (resolveDuplicates() in JS)
CREATE POLICY dup_audit_insert ON public.duplicate_resolution_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());


-- ============================================================
-- 7. student_grades: replace is_admin_like() with is_admin()
-- ============================================================
-- is_admin_like() was dropped in migration 202605071955 and re-added in
-- 202605220030, but student_grades (202605201100) was created in the gap.
-- is_admin() is the canonical helper; use it consistently.

DROP POLICY IF EXISTS admin_manage_student_grades ON public.student_grades;

CREATE POLICY admin_manage_student_grades ON public.student_grades
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ============================================================
-- 8. report_archive: add write policies for admins
-- ============================================================
-- Only a SELECT policy existed.  The report-generator edge function uses the
-- service role (bypasses RLS) for writes, but superadmins/admins may also
-- need to insert/delete archive entries from the UI.

CREATE POLICY report_archive_admin_insert ON public.report_archive
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_profile_role() IN ('superadmin', 'admin')
  );

CREATE POLICY report_archive_admin_delete ON public.report_archive
  FOR DELETE TO authenticated
  USING (
    public.current_profile_role() IN ('superadmin', 'admin')
  );


-- ============================================================
-- 9. student_engagement_config: tighten SELECT to admin-only
-- ============================================================
-- Original policy: USING (auth.role() = 'authenticated') — any logged-in user,
-- including teachers, could read operational engagement config.

DROP POLICY IF EXISTS engagement_config_select
  ON public.student_engagement_config;

CREATE POLICY engagement_config_select ON public.student_engagement_config
  FOR SELECT TO authenticated
  USING (public.is_admin());
