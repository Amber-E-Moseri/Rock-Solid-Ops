-- WAVE 1 SECURITY & DATABASE CLOSURE
-- 2026-09-17
--
-- Purpose: Fix identified P0/P1 security gaps from architecture audit
--
-- Changes:
-- 1. Explicitly REVOKE PUBLIC execute from admin_create_teacher_direct (all signatures)
--    [Previous migration 202605141000 had ordering bug: tried to revoke before function existed]
-- 2. Explicitly ENABLE ROW LEVEL SECURITY on audit_logs
--    [RLS setting ambiguous after table rename; re-enable to ensure enforcement]
-- 3. Add internal authorization check to override_graduation_eligibility
--    [Was callable by any authenticated user; restrict to admin/superadmin]
--
-- All changes are idempotent and safely replayable.

BEGIN;

-- ========== 1. Fix admin_create_teacher_direct grants ==========
-- Ensure both signatures (7-param from 202605140001, 8-param from 202605161510)
-- have PUBLIC execute revoked and are restricted to authenticated role only.

DO $$
BEGIN
  -- 7-parameter signature
  IF to_regprocedure('public.admin_create_teacher_direct(text,text,text,text,text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.admin_create_teacher_direct(text,text,text,text,text,text,text) FROM public;
    GRANT EXECUTE ON FUNCTION public.admin_create_teacher_direct(text,text,text,text,text,text,text) TO authenticated;
  END IF;

  -- 8-parameter signature
  IF to_regprocedure('public.admin_create_teacher_direct(text,text,text,text,text,text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.admin_create_teacher_direct(text,text,text,text,text,text,text,text) FROM public;
    GRANT EXECUTE ON FUNCTION public.admin_create_teacher_direct(text,text,text,text,text,text,text,text) TO authenticated;
  END IF;
END $$;

-- ========== 2. Explicitly enable RLS on audit_logs ==========
-- RLS was inherited from table rename (audit_log → audit_logs) but was never
-- explicitly re-enabled in post-rename migrations. Re-enable to ensure enforcement.

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Verify policy exists for audit_logs (created in 202605061400)
-- If policy is missing, create it now.
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    -- Policy created in 202605061400, but re-create if missing
    DROP POLICY IF EXISTS audit_logs_admin_all ON public.audit_logs;
    CREATE POLICY audit_logs_admin_all ON public.audit_logs
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ========== 3. Add authorization check to override_graduation_eligibility ==========
-- Function was callable by any authenticated user (no internal role check).
-- Replace function to require is_admin() before allowing override.

CREATE OR REPLACE FUNCTION public.override_graduation_eligibility(
  p_applicant_id UUID,
  p_batch_id     TEXT,
  p_eligible     BOOLEAN,
  p_reason       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS
$$
DECLARE
  v_actor TEXT;
BEGIN
  -- Authorization: only admin/superadmin can override graduation eligibility
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient permission: only admins can override graduation eligibility';
  END IF;

  SELECT p.email INTO v_actor
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  INSERT INTO public.graduation_eligibility (
    applicant_id, batch_id,
    gate1_attendance, gate2_moodle_complete, gate3_milestones_met, gate4_exam_passed,
    override_eligible, override_reason, overridden_by, overridden_at, updated_at
  )
  VALUES (
    p_applicant_id, p_batch_id,
    false, false, false, false,
    p_eligible, p_reason, v_actor, now(), now()
  )
  ON CONFLICT (applicant_id, batch_id) DO UPDATE SET
    override_eligible = excluded.override_eligible,
    override_reason   = excluded.override_reason,
    overridden_by     = excluded.overridden_by,
    overridden_at     = now(),
    updated_at        = now();
END;
$$;

COMMENT ON FUNCTION public.override_graduation_eligibility IS
'Sets or clears a manual eligibility override for a single applicant. Pass p_eligible = NULL to clear. Restricted to admin/superadmin roles.';

-- Ensure grant is correct (admin-only)
REVOKE EXECUTE ON FUNCTION public.override_graduation_eligibility FROM public;
REVOKE EXECUTE ON FUNCTION public.override_graduation_eligibility FROM authenticated;
GRANT EXECUTE ON FUNCTION public.override_graduation_eligibility TO authenticated;

-- Inner check will verify is_admin() at runtime, so grant to authenticated is safe

COMMIT;
