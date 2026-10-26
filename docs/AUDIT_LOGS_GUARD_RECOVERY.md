# audit_logs guard: forward state, pre-state evidence and safe recovery

Migration: `supabase/migrations/20261024120000_audit_provenance_guard.sql`
Regression test: `supabase/tests/security/audit-logs-privilege-guard.sql`

This replaces the earlier `20261022140000` rollback SQL. That file restored `FOR ALL` policies
and `GRANT ALL` to `anon` and `authenticated`, which re-opens the findings. It is removed and is
not an automatic rollback target.

## 1. Pre-state evidence (captured 2026-10-24 on a throwaway replay of origin/main @ 35b4953)

Kept as evidence of the state the forward migration removes. Do not restore it.

```
grantee       | privileges
--------------+---------------------------------------------
anon          | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
authenticated | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
postgres      | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
service_role  | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE

policy                | cmd | roles         | qual       | with_check
----------------------+-----+---------------+------------+-----------
audit_log_admin_all   | ALL | authenticated | is_admin() | is_admin()
audit_logs_admin_all  | ALL | authenticated | is_admin() | is_admin()

triggers on audit_logs : none
relrowsecurity = t, relforcerowsecurity = f
```

Also observed on the same replay: `anon` TRUNCATE on `public.audit_logs` succeeded (RLS does not
apply to TRUNCATE). `is_admin()` includes `subgroup_admin`, `pastor`, `principal` and
`regional_secretary`, so those roles could UPDATE and DELETE audit rows through the `FOR ALL` policies.

## 2. Forward state after `20261024120000`

| Role | Before | After |
|---|---|---|
| anon | all table privileges | none |
| authenticated | all table privileges | SELECT, INSERT (RLS-filtered) |
| service_role | all | unchanged |

- Policies: `audit_logs_select_admin` (SELECT, `is_admin()`) and
  `audit_logs_insert_admin_nonprovenance` (INSERT, `is_admin()` AND action not a `TEACHER_AUTH_*` value).
  No UPDATE or DELETE policy exists for any browser role.
- Triggers: `trg_audit_provenance_row_guard` (BEFORE UPDATE OR DELETE, row) and
  `trg_audit_provenance_truncate_guard` (BEFORE TRUNCATE, statement). Both refuse changes to
  `TEACHER_AUTH_LINKED`, `TEACHER_AUTH_RELINKED` and `TEACHER_AUTH_UNLINKED` rows.
- `is_admin()` and `current_profile_role()` are not changed.

Known limits: a table owner can disable the triggers, and replication-role sessions skip triggers.
The guard blocks ordinary and client-side paths. It is not tamper-proof against the database owner.

## 3. Safe recovery (owner-approved, operator-executed, never automatic)

Use these in order of preference. Each step needs owner approval recorded in `docs/migration-log.md`
with the target, time and ticket.

1. **Forward fix first.** If a legitimate browser audit write is refused, add a narrowly scoped
   forward migration (new version, additive) that adds the one missing predicate or grant.
2. **Narrow grant restore.** If one privilege is needed back, grant only that privilege to
   `authenticated` (for example `GRANT UPDATE ON public.audit_logs TO authenticated`) and record why.
   Never restore `anon` privileges, `TRUNCATE`, or the `FOR ALL` policies.
3. **Provenance row repair (rare).** Run as the table owner in one transaction:
   `alter table public.audit_logs disable trigger trg_audit_provenance_row_guard;`, the approved
   statement(s) only, then `alter table public.audit_logs enable trigger trg_audit_provenance_row_guard;`.
   Confirm `pg_trigger.tgenabled = 'O'` before commit. Record every disable in the migration log.
4. **Drift repair.** If a privilege or policy drifts from section 2, re-assert the section 2 state
   with a fail-closed script that aborts when either trigger is missing. The script must not recreate
   or drop the guard.

Rollback-by-SQL is deliberately not provided. Restoring section 1 exposes the findings again.

## 4. Verification after any recovery step

Run `supabase/tests/security/audit-logs-privilege-guard.sql` against the same database. All checks
must pass. The only accepted deviation is an approved narrow grant from step 2, which must be
listed in the migration log.

## 5. Migration-history entry and reversal consequences (added 2026-10-24)

The applied guard leaves a row `version 20261024120000, name audit_provenance_guard` in `supabase_migrations.schema_migrations`.

- **Do not delete that row to "roll back".** Removing it makes the guard look unapplied. A later `supabase db push` would then try to re-apply `20261024120000`. The file is idempotent, so it would re-apply the guard, not reverse it, but the history would be misleading. History edits need a separately approved procedure.
- **Reversing the guard is a security regression.** Restoring the pre-state re-grants `anon` and `authenticated` write privileges on `audit_logs`, restores the `FOR ALL` policies, and removes the provenance triggers. Do not do this on staging or production without a separate security decision recorded in `docs/migration-log.md`.
- **Forward fix is the default.** Any correction is a new migration with a new version (not `20261024120000`, not reused), recorded in history by the normal path. This keeps the history a true record of what ran.
- **Repair that needs the history row:** if a recovery step changes a guard object, record it as its own migration. Do not edit the `statements` text of the existing row.
- **Drift check after any recovery:** compare the current `audit_logs` state with section 2 of this document, using the read-only checks in `supabase/ops/readonly_verify_2026-10-24.sql` (checks 7–10).
