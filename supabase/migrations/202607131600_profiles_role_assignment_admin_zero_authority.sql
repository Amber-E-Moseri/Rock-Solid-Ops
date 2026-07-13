begin;

-- =============================================================
-- Narrow the profiles role-assignment boundary: admin loses ALL
-- profiles.role UPDATE authority (not just the elevated-role subset).
-- Date: 2026-07-13
--
-- Prior state (202607131500_profiles_role_assignment_boundary.sql):
--   superadmin -> may assign any role
--   admin      -> may assign only non-elevated roles (teacher, pending)
--   all others -> may not change roles at all
--
-- Revised decision (see docs/migration-log.md 2026-07-13, "pending gap, revised"):
-- admin's only real account-lifecycle levers elsewhere in this codebase are
-- (a) create a teacher account via create-staff-direct (already teacher-only)
-- and (b) activate/deactivate an existing teacher via teachers.active/status/
-- deleted_at (a different table, not profiles.role at all). Letting admin also
-- demote/reset an existing profile's role via direct REST update was an
-- inconsistent extra lever with no corresponding UI or edge-function analog.
-- Narrowed to: admin has ZERO profiles.role UPDATE authority, full stop.
-- superadmin is unaffected: still full authority over all roles including
-- `pending`. All other caller roles remain unchanged (already blocked).
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
begin
  -- Only gate genuine role changes performed in a user (RLS) context.
  if tg_op = 'UPDATE' and auth.uid() is not null and v_new is distinct from v_old then
    v_caller := lower(coalesce(public.current_profile_role(), ''));

    if v_caller = 'superadmin' then
      return new;                       -- superadmin may assign any role
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
  'Enforces staff role-assignment boundary at the DB layer: only superadmin may change an existing profile''s role (including to pending); admin has zero profiles.role UPDATE authority; others may not change roles. Backend (service-role) writes are exempt.';

-- Trigger already exists from 202607131500_profiles_role_assignment_boundary.sql
-- and is not recreated here; only the function body changes.

commit;
