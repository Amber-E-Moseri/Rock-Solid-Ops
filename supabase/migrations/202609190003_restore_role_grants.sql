-- Restore Supabase-platform-level DML grants on all public-schema tables.
--
-- Why this exists: Supabase's hosted platform automatically grants these
-- privileges during project creation via internal initialization scripts.
-- A local `supabase db reset` re-applies only user-defined migrations, so
-- tables created by the baseline squash (and all subsequent migrations) end
-- up with no SELECT/INSERT/UPDATE/DELETE for anon/authenticated/service_role.
-- This breaks the entire application locally.
--
-- Safety properties:
--   • GRANT is idempotent — applying to a production DB that already has
--     these grants is a no-op.
--   • RLS policies remain the enforcement layer. This migration opens the
--     "door" (privilege check); RLS policies control which rows each role
--     can actually read or write.
--   • service_role already has BYPASSRLS; granting table-level DML simply
--     allows that bypass to take effect.
--   • anon INSERT is intentionally included: RLS policies restrict it to
--     the specific tables that allow public submission (applicants,
--     error_submissions, teachers — see pg_policies for details).
--
-- Sequences: auth.uid() inserts need USAGE + SELECT on id sequences.

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT SELECT, INSERT
  ON ALL TABLES IN SCHEMA public TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public TO anon;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Ensure default privileges carry forward for tables created by future
-- migrations (guards against the same gap after the next db reset).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
