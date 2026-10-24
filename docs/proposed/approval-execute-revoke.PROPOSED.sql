-- PROPOSED ONLY. NOT A MIGRATION.
-- Do not move this file into supabase/migrations/ and do not apply it until Agent 1
-- (shared database privileges) approves it and the owner authorises the change.
--
-- Purpose: stop anon and authenticated callers from invoking the availability approval
-- RPC directly from a browser session. The SPA path is already held, so no intended
-- workflow calls this RPC while certification is pending.
--
-- Scope: EXECUTE only. is_admin() and the six-role contract are not changed.
--
-- Before applying, confirm in staging, read-only:
--   SELECT has_function_privilege('service_role',
--     'public.approve_teacher_availability_atomic(uuid,text,text)', 'EXECUTE');  -- expect true
--
-- Verify after applying (expect false for all three):
--   SELECT has_function_privilege('anon',
--     'public.approve_teacher_availability_atomic(uuid,text,text)', 'EXECUTE');
--   SELECT has_function_privilege('authenticated',
--     'public.approve_teacher_availability_atomic(uuid,text,text)', 'EXECUTE');
--   SELECT has_function_privilege('public',
--     'public.approve_teacher_availability_atomic(uuid,text,text)', 'EXECUTE');

BEGIN;

REVOKE EXECUTE ON FUNCTION public.approve_teacher_availability_atomic(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_teacher_availability_atomic(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_teacher_availability_atomic(uuid, text, text) FROM authenticated;

COMMIT;

-- Rollback (restores the prior grant to authenticated only, as in 202605191700):
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION public.approve_teacher_availability_atomic(uuid, text, text) TO authenticated;
-- COMMIT;
