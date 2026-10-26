-- =============================================================================
-- Audit provenance guard: narrow policy and grant hardening for audit_logs
-- =============================================================================
-- Closes three findings on the lineage (verified in an isolated replay, 2026-10-22):
--   1. Both audit_logs policies (audit_logs_admin_all and audit_log_admin_all) are FOR ALL
--      on is_admin(). is_admin() includes subgroup_admin, pastor and principal, so those
--      roles, and admins, could UPDATE, DELETE and INSERT any audit row, provenance included.
--   2. anon and authenticated hold UPDATE, DELETE and TRUNCATE on audit_logs. RLS does not
--      apply to TRUNCATE, so an unauthenticated request could empty the table.
--   3. No trigger protects the TEACHER_AUTH_* provenance rows that Phase A's pastor and
--      subgroup scope depends on.
--
-- Changes:
--   * Browser roles (anon, authenticated) lose UPDATE, DELETE, TRUNCATE, REFERENCES and
--     TRIGGER. anon loses everything. authenticated keeps SELECT and INSERT, filtered by RLS.
--   * SELECT stays on is_admin(), exactly as before. It is not widened.
--   * INSERT stays on is_admin() for the generic audit writes the browser performs today
--     (applicant-directory, class-editor, admin-review, at-risk-students, admin-api and the
--     like). It now excludes the three teacher-auth provenance actions, so a browser client
--     cannot fabricate a provenance event.
--   * No UPDATE or DELETE policy exists for any browser role.
--   * BEFORE UPDATE OR DELETE (row) and BEFORE TRUNCATE (statement) triggers refuse any
--     change to a provenance row, for every role except a table owner who disables the
--     trigger (see the procedure in the rollback file header).
--
-- SECURITY DEFINER functions owned by postgres (link, unlink, the create RPCs and the
-- Phase A audit triggers) still write provenance: the owner bypasses RLS, and the table is
-- not FORCE RLS. service_role keeps its grants, so edge functions are unaffected. The
-- triggers still fire for service_role and the owner, so provenance cannot be altered by a
-- normal write path.
--
-- Not tamper-proof: a table owner can drop or disable the triggers, and replication-role
-- sessions skip triggers. The guard is a control against ordinary and accidental writes,
-- not against a database owner. See the rollback file for the audited procedure.
--
-- Idempotent: DROP POLICY IF EXISTS, CREATE OR REPLACE, REVOKE/GRANT and DROP TRIGGER IF EXISTS
-- repeat safely.
-- =============================================================================

begin;

-- 1) Remove the over-broad FOR ALL policies. Neither was the only path; both were on is_admin().
drop policy if exists audit_logs_admin_all on public.audit_logs;
drop policy if exists audit_log_admin_all on public.audit_logs;

-- 2) Operation-specific policies. The provenance action list is the single source of truth
--    for both the insert filter and the trigger below. CREATE POLICY has no IF NOT EXISTS, so
--    each one is dropped first to keep a re-run idempotent.
drop policy if exists audit_logs_select_admin on public.audit_logs;
drop policy if exists audit_logs_insert_admin_nonprovenance on public.audit_logs;

create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (public.is_admin());

create policy audit_logs_insert_admin_nonprovenance
on public.audit_logs
for insert
to authenticated
with check (
  public.is_admin()
  and action not in ('TEACHER_AUTH_LINKED', 'TEACHER_AUTH_RELINKED', 'TEACHER_AUTH_UNLINKED')
);

-- No UPDATE or DELETE policy is created for any browser role. With RLS on and no policy,
-- those statements affect zero rows for authenticated.

-- 3) Browser roles lose the table-level write privileges that RLS cannot filter.
revoke all on public.audit_logs from anon;
revoke update, delete, truncate, references, trigger on public.audit_logs from authenticated;
grant select, insert on public.audit_logs to authenticated;

-- 4) Provenance guard. One function, two triggers.
create or replace function public.audit_provenance_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'TRUNCATE' then
    if exists (
      select 1
      from public.audit_logs a
      where a.action in ('TEACHER_AUTH_LINKED', 'TEACHER_AUTH_RELINKED', 'TEACHER_AUTH_UNLINKED')
    ) then
      raise exception 'PROVENANCE_PROTECTED: TRUNCATE refused while teacher-auth provenance exists'
        using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;

  if old.action in ('TEACHER_AUTH_LINKED', 'TEACHER_AUTH_RELINKED', 'TEACHER_AUTH_UNLINKED') then
    raise exception 'PROVENANCE_PROTECTED: % refused for % row %', tg_op, old.action, old.id
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    -- A row must not be rewritten INTO a provenance action either.
    if new.action in ('TEACHER_AUTH_LINKED', 'TEACHER_AUTH_RELINKED', 'TEACHER_AUTH_UNLINKED') then
      raise exception 'PROVENANCE_PROTECTED: UPDATE refused, cannot set action to %', new.action
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  return old;
end;
$$;

revoke all on function public.audit_provenance_guard() from public, anon, authenticated;

drop trigger if exists trg_audit_provenance_row_guard on public.audit_logs;
create trigger trg_audit_provenance_row_guard
before update or delete on public.audit_logs
for each row
execute function public.audit_provenance_guard();

drop trigger if exists trg_audit_provenance_truncate_guard on public.audit_logs;
create trigger trg_audit_provenance_truncate_guard
before truncate on public.audit_logs
for each statement
execute function public.audit_provenance_guard();

commit;
