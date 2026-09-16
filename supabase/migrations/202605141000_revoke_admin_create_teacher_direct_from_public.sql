-- 202605141000_revoke_admin_create_teacher_direct_from_public.sql
--
-- PURPOSE: Critical security fix
--
-- ISSUE: admin_create_teacher_direct() was created with SECURITY DEFINER and only
-- revoked from `anon`. However, Postgres default GRANT for EXECUTE is PUBLIC
-- (meaning: anyone, authenticated or not, can call it unless explicitly revoked).
-- This allows unauthenticated users to create teacher accounts.
--
-- FIX: Explicitly REVOKE EXECUTE on all overloads of admin_create_teacher_direct
-- from PUBLIC role. Only authenticated, admin-like users should be able to call
-- this function. Note: Edge function create-staff-direct already enforces role
-- boundary, but this DB-layer revoke adds defense-in-depth.
--
-- Two function signatures exist (different arities); both must be revoked.

BEGIN;

-- Signature 1 (7 parameters): from original migration 202605140001
REVOKE EXECUTE ON FUNCTION public.admin_create_teacher_direct(
  text, text, text, text, text, text, text
) FROM public;

-- Signature 2 (8 parameters): from migration 202605161510 (added fellowship_code)
REVOKE EXECUTE ON FUNCTION public.admin_create_teacher_direct(
  text, text, text, text, text, text, text, text
) FROM public;

-- Idempotent: if a future schema refactor removes these functions, the migration
-- will be harmless (Postgres ignores REVOKE on non-existent objects by default).

COMMIT;
