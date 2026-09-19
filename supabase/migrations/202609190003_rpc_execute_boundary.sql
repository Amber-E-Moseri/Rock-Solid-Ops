-- Wave 3 trust boundary: restrict insert_applicant_reserve_slot EXECUTE
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on every CREATE FUNCTION.
-- This means any anon or authenticated caller could invoke the RPC directly,
-- bypassing all registration-processor gates (campus closure, duplicate
-- detection, field validation, batch availability, admin-override guard).
--
-- The function is SECURITY DEFINER (runs as postgres) and is called exclusively
-- by the registration-processor edge function via a service_role JWT.
-- No other callers are permitted.
--
-- Wave 2A owns broad role-grant normalization for the local reset gap.
-- This migration is scoped only to the minimum Wave 3 requires:
-- removing the inadvertent PUBLIC EXECUTE on this new function.

REVOKE EXECUTE ON FUNCTION public.insert_applicant_reserve_slot(JSONB) FROM PUBLIC;
-- anon/authenticated inherit from PUBLIC; the explicit grants below are
-- belt-and-suspenders for defensive correctness.
REVOKE EXECUTE ON FUNCTION public.insert_applicant_reserve_slot(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_applicant_reserve_slot(JSONB) FROM authenticated;
-- service_role EXECUTE is retained (granted in 202609190002).
