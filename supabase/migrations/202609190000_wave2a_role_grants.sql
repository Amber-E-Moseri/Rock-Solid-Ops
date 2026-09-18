-- WAVE 2A: Reproduce hosted-Supabase role grants for local development
--
-- Context:
--   On hosted Supabase, tables created by the platform are owned by supabase_admin,
--   whose default ACL grants full DML to service_role, authenticated, and anon.
--   In local development, migrations run as postgres so tables end up owned by postgres.
--   The postgres default ACL grants service_role and authenticated only TRUNCATE/REFERENCES/
--   TRIGGER — no SELECT/INSERT/UPDATE/DELETE.
--
--   After `supabase db reset --local`, any manually applied grants are lost because
--   this initialization is not reproduced by any migration. This causes PostgREST
--   queries with user JWTs or the service key to fail with 42501 (permission denied)
--   on locally-reset databases, even though identical queries work on hosted Supabase.
--
-- Grants applied:
--   service_role: full DML + sequences (service role bypasses RLS; this is by design)
--   authenticated: full DML + sequences (RLS policies then restrict per-role access)
--   anon: SELECT only (this app has no unauthenticated row access; RLS blocks rows)
--
-- Idempotent: GRANT is no-op if the privilege already exists.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;

COMMIT;
