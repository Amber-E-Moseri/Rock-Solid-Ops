-- WAVE 1 ACL CLOSURE: Remove anon EXECUTE from override_graduation_eligibility
--
-- Issue:
--   pg_proc shows proacl contains anon=X/postgres for
--   public.override_graduation_eligibility(uuid,text,boolean,text).
--   The anon role has explicit EXECUTE, allowing unauthenticated callers to
--   reach the function body (which correctly raises EXCEPTION via is_admin()
--   but should not be reachable at the DB EXECUTE boundary at all).
--
-- This migration:
--   - Revokes EXECUTE from the anon role (explicit entry)
--   - Revokes EXECUTE from PUBLIC (defense-in-depth; idempotent if already absent)
--   - Does NOT touch authenticated or service_role
--   - Does NOT modify the function body, SECURITY DEFINER, or is_admin() check
--   - Does NOT touch Teacher functions or Audit policies
--
-- Required final ACL state:
--   PUBLIC  EXECUTE = NO
--   anon    EXECUTE = NO
--   authenticated EXECUTE = YES  (unchanged)
--   service_role  EXECUTE = YES  (unchanged)

BEGIN;

REVOKE EXECUTE ON FUNCTION public.override_graduation_eligibility(uuid, text, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.override_graduation_eligibility(uuid, text, boolean, text) FROM public;

COMMIT;
