create schema if not exists extensions;
-- =============================================================================
-- Minimal Supabase-compatible shim for an ISOLATED, throwaway PostgreSQL database.
-- NEVER run against a Supabase project, staging or production. Used only by
-- scripts/phase-a-isolated-replay.sh on a cluster it creates and destroys.
--
-- Provides only what the migration lineage and phase-a-authz.sql need:
--   roles anon / authenticated / service_role, schemas auth and extensions,
--   auth.users (columns the trigger and link functions read), and the auth.uid(),
--   auth.jwt() and auth.role() helpers that read request.jwt.claims (the same
--   setting real Supabase uses).
-- Anything the replay still needs beyond this (storage, vault, pg_cron, pg_net) is a
-- SHIM GAP. Add it here, record it in the replay report, and do not guess.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  instance_id          uuid,
  id                   uuid primary key default gen_random_uuid(),
  aud                  text,
  role                 text,
  email                text unique,
  raw_user_meta_data   jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'role', '')
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Real Supabase projects grant these by default. Set them before any migration creates
-- a table, so the authenticated role can reach tables under RLS.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
