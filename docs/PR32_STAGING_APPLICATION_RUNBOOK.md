# PR #32 staging application runbook (DRAFT, not executed)

Status: PLAN ONLY. Nothing in this document has been run.
Target: Rock Solid Staging, Supabase reference `hblahcaozlttknkzvkib`. Production is out of scope.
Migration: `supabase/migrations/20261024120000_audit_provenance_guard.sql` (single file).
Evidence: `docs/evidence/readonly_verify_staging_2026-10-24.md` (commit `2b9f9da`), local guard test 24/24 PASS (`supabase/tests/security/audit-logs-privilege-guard.sql`).

## 0. Roles

| Step | Who |
|---|---|
| Approve apply, history method, Wave1 live run, guard test on staging | **Owner** |
| Pre-state capture, duplicate-version check, apply, post-apply checks, history record once approved, Wave1 run once approved | **Authorized operator** |

No step uses `supabase db push`, `supabase db reset`, or any command that applies more than the one file.

## 1. Gate: owner approvals required before any step

Record each approval in `docs/migration-log.md` with the date, target and exact scope.

- **A1.** Single-file apply of `20261024120000_audit_provenance_guard.sql` to Rock Solid Staging.
- **A2.** History-recording method: choose Option A or Option B in section 4.
- **A3.** Live Wave1 run (section 7). It creates and deletes `W1REG_*` rows in `audit_logs` and uses test identities.
- **A4.** How the 24-check guard regression runs on staging (section 6). Preferred: on a branch or clone of staging, not the live project.

If any approval is missing, stop. Do not apply.

## 2. Pre-checks (read-only, operator)

Run each as read-only. Each returns a row or set of rows, and the results are saved as evidence.

1. **Target confirmation.** `supabase projects list`. Confirm the linked row is "Rock Solid Staging" with reference `hblahcaozlttknkzvkib`. If not, stop.
2. **Version not already recorded.** `select version, name from supabase_migrations.schema_migrations where version = '20261024120000';` Expect zero rows. Any row → stop, and investigate with the owner.
3. **History tail.** `select max(version), count(*) from supabase_migrations.schema_migrations;` Expect max `202610030004` and count `159`. A different tail means the staging history has moved since 2026-10-24 → stop and re-verify.
4. **Migration `202610220100` absent.** `select 1 from supabase_migrations.schema_migrations where version = '202610220100';` Expect zero rows. It is a repository file on `origin/main` and is not applied on staging. It must not be applied by this procedure (section 3 explains why).
5. **Pre-state.** Re-run the audit_logs pre-state checks (checks 7 to 10 in `supabase/ops/readonly_verify_2026-10-24.sql`), one check per file, in read-only transactions. Expect: anon, authenticated, postgres and service_role each hold the full set; two `ALL` policies `audit_log_admin_all` and `audit_logs_admin_all`; no triggers on `audit_logs`; RLS enabled, not forced. Any difference → stop.
6. **Local file integrity.** On the PR #32 head, `git rev-parse HEAD:supabase/migrations/20261024120000_audit_provenance_guard.sql` must equal the commit that the owner approved. Record the hash.
7. **Single candidate.** `ls supabase/migrations | grep 20261024120000` returns exactly one file.

## 3. Why not `supabase db push`

`supabase db push` applies every local migration missing from remote history. On this repository that set includes `202610220100_repair_class_options_registration_columns.sql` from `origin/main`, which has not been approved for staging. A push would also consider the nine C1/C6 versions, which are local on some refs. Do not use it.

`supabase db query --linked -f` runs a file through the Management API as `postgres`. It does not record history. It has been used read-only in this project. Its handling of the file's own `begin;` / `commit;` is not confirmed, so this runbook does not use it for the apply.

## 4. Apply method and history recording

### Apply (owner-approved operator step)

Use a direct connection string supplied through the operator's secret store. Do not write it into the repository or into any log.

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261024120000_audit_provenance_guard.sql
```

The file contains its own `begin;` and `commit;`. Do not wrap it in `-1`, because that would nest transactions. With `ON_ERROR_STOP=1`, any error stops psql. The connection then closes and the open transaction is rolled back.

### History recording: two options

**Option A (non-atomic, CLI-based).** After the apply succeeds:

```bash
supabase migration repair 20261024120000 --status applied --linked
```

This is a separate connection from the apply. If the apply succeeds and the repair fails, staging has the guard but no history row. Recovery is to re-run the repair, not to re-run the SQL. This option also does not show what `statements` value the CLI writes. Verify it with the post-apply check in section 5.

**Option B (atomic, manual insert, separately approved).** Put the apply and the history insert in one transaction. Append the insert to a copy of the migration, run it as one psql session, and let the transaction commit both or neither. The insert must match the format of existing rows, including `statements`, which must be the file's statements as the CLI splits them. This is a manual history edit and needs its own approval under the owner's rule against editing migration history.

**Recommendation:** Option B if the owner approves the exact insert text. It is the only way to get true atomicity. Otherwise use Option A and accept the window in section 8.

## 5. Post-apply verification (read-only, operator)

1. History row present: `select version, name from supabase_migrations.schema_migrations where version = '20261024120000';` Expect one row.
2. Count moved from 159 to 160 (Option A or B recorded), and the max version is now `20261024120000`. Record both values.
3. Privileges: `anon` has no privilege on `audit_logs`. `authenticated` has `SELECT,INSERT` only. `service_role` unchanged. Use the checks from `readonly_verify_2026-10-24.sql` step 7.
4. Policies: exactly `audit_logs_select_admin` and `audit_logs_insert_admin_nonprovenance`. No `ALL` policy.
5. Triggers: `trg_audit_provenance_row_guard` and `trg_audit_provenance_truncate_guard`, both `tgenabled = 'O'`.
6. Nine C1/C6 objects unchanged: re-run the statement digest and schema-effect checks used in `docs/evidence/readonly_verify_staging_2026-10-24.md`. Expect the same results.

## 6. Guard regression (24 checks) on staging: do not run on the live project as written

`supabase/tests/security/audit-logs-privilege-guard.sql` creates `auth.users` rows, updates a profile, attempts an UPDATE, DELETE and TRUNCATE, and deletes an ordinary row, all inside `begin` ... `rollback`. Those writes are rolled back, but they are still write statements against staging. The TRUNCATE check is only safe after the guard is applied, because before the apply it would truncate `audit_logs` for the length of the transaction.

Preferred: run the 24 checks on a branch or clone of staging taken after the apply. Otherwise run them on the live project only after A4 is granted, and only in the post-apply state. Expect 24 PASS and exit 0. Save the output.

## 7. Live Wave1 regression (requires A3)

- `supabase/tests/security/wave1-regression.ts` needs `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and identities for pending, teacher, admin and superadmin. Supply them from the operator's secret store.
- The suite seeds and deletes `W1REG_*` rows. Those are test writes, so they need A3.
- Expected after the apply: admin and superadmin INSERT allowed; UPDATE and DELETE denied for every browser role (the updated expectations in this PR); pending and teacher denied everywhere.
- Any failure → stop and use section 9.

## 8. Failure handling and atomicity

| Failure point | State | Action |
|---|---|---|
| Pre-check fails | Nothing changed | Stop. Report. |
| Apply fails mid-file | Transaction rolled back by psql on exit | Re-run pre-checks. Do not retry blindly. |
| Apply succeeds, history insert/repair fails (Option A) | Guard applied, no history row | Re-run the repair only. Never re-run the SQL. |
| Option B insert fails | Both rolled back together | Re-run from section 2. |
| Post-apply check fails | Guard applied | Section 9. |

Duplicate-version detection: pre-check 2 and pre-check 7. A second apply is prevented because the file's `create policy` lines are preceded by `drop policy if exists` and the rest is `CREATE OR REPLACE` / `DROP ... IF EXISTS`, so a re-run is idempotent. Idempotency was tested locally.

## 9. Safe recovery (no automatic rollback)

Follow `docs/AUDIT_LOGS_GUARD_RECOVERY.md`. In order of preference: a forward fix; a narrowly approved grant restore; an owner-approved provenance repair with the trigger disabled and re-enabled in one transaction; a drift re-assertion that aborts if the guard is missing.

The rollback SQL that restored the broad policies and `anon` grants has been removed on purpose. Do not restore the pre-state.

## 10. Compatibility with the nine C1/C6 migrations

- None of the nine files creates, alters or grants on `audit_logs`. `202609231100` and `202610030004` mention `audit_logs` only in comments.
- They touch `failed_syncs`, `scheduled_notifications`, `email_queue`, `rocksolid_task_links` and `claim_nexus_task`. The guard does not touch any of those.
- `claim_nexus_task` is `SECURITY DEFINER` and writes no audit rows. No guard interaction.
- Replay of the nine on the origin/main lineage passed (local), and staging matches the repository content, ignoring terminators (evidence `2b9f9da`).

Conclusion: no incompatibility found.

## 11. Residual risks

1. History-recording window under Option A.
2. The staging digest match ignores terminators and wrappers. It does not prove byte-identical content.
3. The guard is not tamper-proof against the database owner. Triggers can be disabled by the owner.
4. Default privileges still grant `anon` on new tables (PR #14 scope). Not changed here.
5. The dormant `audit_log_insert_redirect()` function (SECURITY INVOKER, writes `audit_logs`) is not attached to any trigger in the local replay. Not checked on staging. If it were re-attached to a browser-reachable table, its insert would be refused.
6. Production is unverified.
7. Separate from this PR: the fork reported that `attendance_records` policies may let any signed-in user read and write rows they do not own. Catalog-only evidence, not behaviour-tested. Needs its own review and is not a blocker for PR #32.
8. Repository drift: local `main` has 22 unpushed commits. Staging is not affected, but repo state is.

## 12. Recommendation

**Conditional GO** for the staging apply once A1, A2 and A4 are granted (A3 before the live Wave1 run). **NO-GO** if any pre-check in section 2 fails, or if the history method is not chosen.

Status today: pre-checks 1–7 are either done (3, 4 and 5 were effectively verified on 2026-10-24) or must be re-run on the day. No owner approval has been given for the apply.
