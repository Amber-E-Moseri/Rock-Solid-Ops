-- 202609190005_revoke_admin_create_teacher_direct_7param_cleanup.sql
--
-- P0 REMEDIATION: Close lingering anon/public EXECUTE on 7-param overload
--
-- After 202605141000 + 202609170000 applied, the 8-param overload was correctly
-- cleaned to {postgres,authenticated,service_role}. The 7-param overload still
-- carries both =X/postgres (PUBLIC) and anon=X/postgres. This migration
-- explicitly revokes both at the DB layer, matching the 8-param state.
--
-- The internal is_admin() gate added by 202609180000 provides defense-in-depth,
-- but the ACL-level revoke must also hold so anon cannot even invoke the RPC.
--
-- Idempotent: REVOKE is safe to run even if the grant is already absent.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_create_teacher_direct(
  text, text, text, text, text, text, text
) FROM public;

REVOKE EXECUTE ON FUNCTION public.admin_create_teacher_direct(
  text, text, text, text, text, text, text
) FROM anon;

COMMIT;
