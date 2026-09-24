-- Tighten RPC privileges for claim_nexus_task
--
-- The RPC is invoked ONLY by server-side Edge Functions (missed-class-detector,
-- retry-worker) using SERVICE_ROLE keys. It is never invoked directly by
-- authenticated users or browsers.
--
-- Remove the overly-broad authenticated EXECUTE grant.

revoke execute on function public.claim_nexus_task(text, text, text, uuid) from authenticated;

-- service_role and PUBLIC already have the correct state:
-- - PUBLIC: revoked
-- - service_role: allowed
