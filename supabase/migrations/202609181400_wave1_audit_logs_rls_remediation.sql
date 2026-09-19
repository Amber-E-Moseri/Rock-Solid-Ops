-- WAVE 1 REMEDIATION: Fix audit_logs RLS authorization bypass
--
-- Issue:
--   Policy audit_log_staff_select on audit_logs has USING (true)
--   This grants SELECT access to all authenticated users (teacher, pending, etc.)
--   Should only allow admin/superadmin
--
-- Root cause:
--   Policy created in baseline for audit_log table
--   Table renamed to audit_logs; policy survived but was never hardened
--   Later DROP attempt in 202605121320 failed (wrong table name)
--
-- Remediation:
--   Remove the obsolete permissive staff_select policy
--   Ensure only admin-only policies remain
--
-- Testing:
--   Post-migration expected:
--   - Anon: DENIED (no auth context)
--   - Pending: DENIED (not in is_admin())
--   - Teacher: DENIED (not in is_admin())
--   - Admin: ALLOWED (in is_admin())
--   - Superadmin: ALLOWED (in is_admin())

BEGIN;

-- Drop the overly permissive legacy policy
DROP POLICY IF EXISTS audit_log_staff_select ON public.audit_logs;

-- Verify audit_logs_admin_all or audit_log_admin_all is present for admin-only access
-- Both policies use is_admin() which is the correct authorization gate
-- Commit completes the remediation

COMMIT;
