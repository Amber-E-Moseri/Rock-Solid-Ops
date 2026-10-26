# Attendance RLS containment: production application, history and recovery runbook

Migration: supabase/migrations/20261024130000_attendance_rls_containment.sql
Status: HOLD. Nothing in this document has been executed. Each step needs owner approval.

## 1. Version and ownership
- Version 20261024130000 is referenced only by this branch (brief/attendance-rls-containment, PR #35) locally and on origin. It is not on origin/main, any other branch, any worktree, or any open PR head.
- Agent 4 confirmation: pending. This session cannot reach Agent 4. Record the confirmation in docs/BRANCH_HOLDS.md once given.

## 2. Ordering with PR #32 and other pending migrations
- PR #32 uses 20261024120000 and touches audit_logs only. PR #35 uses 20261024130000 and touches attendance tables only. The two do not share tables.
- Supabase's migration ordering is by version. If both are applied, 20261024120000 must be applied before 20261024130000. Applying #35 first would leave #32 out of order, and the CLI would refuse to apply it without --include-all. Avoid that.
- PR #32 was based on 35b4953. origin/main is now 8510e81. Rebase PR #32 before it is applied.
- Remote-recorded versions 202609231000 to 202610030004 are unchanged by this procedure. Reconciliation of those versions is a separate change (docs/MIGRATION_RECONCILIATION_2026-10-24.md on PR #32).

## 3. Production preflight (read-only, immediately before application)
Run the SELECT-only attendance pack against xelpsttqhrcqmttmjory. Abort if any of these differ from the captured state:
- attendance_records policies: exactly auth_read (SELECT, public, auth.role() = 'authenticated') and auth_write (ALL, public, same predicate).
- attendance_log policies: attendance_admin_all, attendance_log_read, attendance_log_teacher_insert_assigned, attendance_log_teacher_select_assigned, attendance_log_teacher_update_assigned, attendance_log_update, attendance_log_write, attendance_teacher_rw_assigned, with the predicates captured on 2026-10-24.
- Helper policies on class_options, teachers, profiles, students, applicants, admin_users, makeup_queue: as captured.
- Grants on attendance_records and attendance_log for anon and authenticated: as captured (full).
- Helper functions current_profile_role, current_teacher_id, is_admin, is_admin_like, get_admin_role, get_admin_subgroups: definitions as captured.
- Migration history: production's recorded list must include 202607131400 (attention_flags_rls_coverage) and 202610030004 must be the latest recorded version. Version 20261024130000 must not yet be recorded.

Save every preflight output as evidence before proceeding.

## 4. Application method (single file, single transaction)
Do not use supabase db push. Do not use supabase migration up.
1. Obtain owner approval recorded in docs/migration-log.md for exactly 20261024130000 on xelpsttqhrcqmttmjory, with the time window and the preflight evidence reference.
2. Confirm the preflight in section 3 still matches.
3. Apply the single file in one transaction, using the file as committed on the approved SHA:
   psql "<connection string from the owner's secret store>" -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261024130000_attendance_rls_containment.sql
   The file itself begins and commits its own transaction; -1 is redundant but harmless, and ON_ERROR_STOP rolls back on any error.
4. Run the post-check in section 5 immediately.
5. Record the history row only by the approved history-recording method in section 6, as a separate step with its own approval.

## 5. Post-apply verification
- Catalog: attendance_records policies are exactly attendance_records_staff_select and attendance_records_teacher_select_assigned. attendance_log policies are unchanged from preflight.
- Privileges: authenticated has SELECT only on attendance_records. anon has no privilege on either attendance table. service_role is unchanged.
- Read checks, performed with real staff and teacher sessions if the owner authorizes them: a teacher sees own-class rows; an admin reads attendance_records; a pastor or subgroup_admin sees no attendance_records rows (accepted loss, owner decision).
- Write checks: none from client sessions. Direct writes are denied by design. Service-role writes are verified only by the edge function path already in use.
- Make no data writes during verification.

## 6. History recording (approved method, not executed)
After the migration is confirmed applied:
- Method: supabase migration repair --status applied 20261024130000 --linked, run from a workdir linked to xelpsttqhrcqmttmjory, after the owner has approved this exact command and version.
- Scope: this one version only. Do not repair any other version. Do not run supabase migration up or db push.
- Evidence: capture supabase_migrations.schema_migrations rows for versions 202610030004 and 20261024130000 before and after.
- If the repair is not approved: the database and the repo disagree on 20261024130000. Record that in docs/migration-log.md.

## 7. Recovery procedure
Principle: do not restore broad privileges automatically. The rollback restores policies only and keeps the grant hardening.
- Policy rollback: the SQL in section 8. It recreates auth_read and auth_write. Because grants stay hardened, the restored policies do not re-open writes: authenticated still has no INSERT, UPDATE or DELETE on attendance_records. Read exposure returns.
- Grant rollback: a separate owner decision with its own preflight. Restore only the minimum privilege the broken path needs. Never restore anon privileges, TRUNCATE, REFERENCES or TRIGGER.
- History: if the migration was applied and then rolled back, record the rollback in docs/migration-log.md. Do not delete the history row for 20261024130000 without a separate approval.

## 8. Rollback SQL (policies only; grants untouched)
begin;
drop policy if exists attendance_records_staff_select on public.attendance_records;
drop policy if exists attendance_records_teacher_select_assigned on public.attendance_records;
create policy auth_read on public.attendance_records as permissive for select to public using ((auth.role() = 'authenticated'::text));
create policy auth_write on public.attendance_records as permissive for all to public using ((auth.role() = 'authenticated'::text));
commit;

Staging-only rollback addendum (not needed on production, where those policies never existed): recreate attendance_log_staff_select (SELECT TO authenticated USING true), attendance_log_staff_insert (INSERT TO authenticated WITH CHECK true) and attendance_log_staff_update (UPDATE TO authenticated USING true WITH CHECK true).

## 9. Verified on the production-shaped fixture (2026-10-24)
- Post-state: 44 of 44 checks pass.
- Pre-state (negative control): fails at the first cross-user check.
- Migration applied twice: exit 0 both times.
- Injected failure before commit: no partial change.
- Policy rollback (section 8): attendance policies byte-identical to pre-state; grants remain hardened (authenticated INSERT, UPDATE, TRUNCATE all false).
- Staging-lineage fixture: 37 of 37 checks pass after grant hardening; pre-state fails at the cross-teacher read.

## 10. Evidence not transferable from the fixture to production
- Live JWT and PostgREST behaviour, including which accounts can obtain authenticated sessions.
- Production data, including attendance_records rows with a null class_option_id, which are unreadable to teachers after containment.
- admin_users rows and subgroups, which drive attendance_log_read and attendance_log_update.
- Edge function deployment contents: the repository is the only evidence that writes use the service role.
- Trigger side effects on live data (the fixture covers trigger firing, not the graduation evaluation, which needs a matching applicant).
- Production grant defaults beyond the Supabase-style defaults in the shim.

## 11. Pre-existing issues, not changed by this migration
- count_consecutive_misses() on staging reads a non-existent column. Separate issue; not in this PR.
- Pastor and subgroup_admin have broad attendance_log access on production via is_admin_like(). Separate decision.
- Triggers on attendance_log run as the caller. Students and makeup_queue writes made by a non-admin caller can fail under RLS. This does not affect the service-role edge path.
