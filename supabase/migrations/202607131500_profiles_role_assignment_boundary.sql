begin;

-- =============================================================
-- Fix: server-side enforcement of who may ASSIGN which staff role.
-- Date: 2026-07-13
--
-- Gap (see docs/migration-log.md 2026-07-13): RLS policy
-- profiles_self_or_admin_update lets ANY is_admin() role (admin, subgroup_admin,
-- pastor, principal) UPDATE any profile's role to ANY value, including superadmin,
-- via the REST API. The self-protection trigger only blocks a non-admin editing
-- their OWN role. Net effect: a principal could escalate anyone (incl. themselves)
-- to superadmin. The admin-management UI hides this, but the UI is not the
-- enforcement point.
--
-- This mirrors the create-staff-direct edge-function boundary at the DB layer:
--   superadmin -> may assign ANY role
--   admin      -> may assign only NON-elevated roles (teacher, pending)
--   all others -> may not change roles at all
-- Only role changes made in a real user (RLS) session are gated. Service-role /
-- backend writes (auth.uid() IS NULL) are trusted: they flow through server-side
-- gated edge functions (e.g. create-staff-direct) that already enforce the boundary.
-- =============================================================

create or replace function public.profiles_enforce_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller  text;
  v_new     text := lower(coalesce(new.role, ''));
  v_old     text := lower(coalesce(old.role, ''));
  v_elevated text[] := array['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary'];
begin
  -- Only gate genuine role changes performed in a user (RLS) context.
  if tg_op = 'UPDATE' and auth.uid() is not null and v_new is distinct from v_old then
    v_caller := lower(coalesce(public.current_profile_role(), ''));

    if v_caller = 'superadmin' then
      return new;                       -- superadmin may assign any role
    elsif v_caller = 'admin' then
      if v_new = any (v_elevated) then  -- admin may not grant an elevated role
        raise exception using
          errcode = '42501',
          message = 'Only a superadmin may assign an elevated staff role.';
      end if;
      return new;                       -- admin may assign teacher / pending
    else
      raise exception using
        errcode = '42501',
        message = 'You are not permitted to change staff roles.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.profiles_enforce_role_assignment() is
  'Enforces staff role-assignment boundary at the DB layer: only superadmin may assign elevated roles; admin may assign non-elevated roles; others may not change roles. Backend (service-role) writes are exempt.';

do $$
begin
  if to_regclass('public.profiles') is not null then
    drop trigger if exists trg_profiles_enforce_role_assignment on public.profiles;
    create trigger trg_profiles_enforce_role_assignment
      before update on public.profiles
      for each row
      execute function public.profiles_enforce_role_assignment();
  end if;
end $$;

commit;
