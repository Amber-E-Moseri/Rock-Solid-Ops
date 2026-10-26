# PR #32 atomic apply-and-record procedure (Option B). NOT EXECUTED.

Baseline: `docs/PR32_STAGING_APPLICATION_RUNBOOK.md` at `6b3e30a`.
Wrapper SQL: `supabase/ops/pr32_apply_and_record_2026-10-24.sql` (one file, one transaction).
Target: Rock Solid Staging, `hblahcaozlttknkzvkib` only. Production is out of scope.
Status: awaiting owner approval of A1 (apply), A2 (this exact SQL) and A4 (isolated guard test). No step here has been run against staging.

## 1. The migration file

`supabase/migrations/20261024120000_audit_provenance_guard.sql`, 125 lines, sha256 `a21754e404378f1258206d2db39d7f4ea94eeb8b939e768f0c1e4d3318e0042f`.

- `begin;` is line 40. `commit;` is line 125. Those are the only transaction-control lines in the file.
- Lines 41 to 124 hold the security statements: drop of the two `FOR ALL` policies, creation of the two operation-specific policies, revokes from `anon` and `authenticated`, grant of SELECT and INSERT to `authenticated`, the guard function, and the two guard triggers.
- The wrapper copies lines 41 to 124 verbatim. It removes only the file's own `begin;` and `commit;` lines, because the wrapper supplies one transaction. Verified: the executed region is byte-identical to those lines.

No intermediate `COMMIT` and no nested `BEGIN`.

## 2. Exact SQL and execution command

The wrapper is `supabase/ops/pr32_apply_and_record_2026-10-24.sql`. Its structure:

```
begin;
do $pr32_precheck$ ... raise if version 20261024120000 already recorded ... $pr32_precheck$;
-- verbatim body: lines 41-124 of the migration
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024120000', 'audit_provenance_guard', array[ <full migration text> ]);
commit;
```

Execution (owner-approved operator step; the connection string comes from the operator's secret store, not from the repository):

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/ops/pr32_apply_and_record_2026-10-24.sql
```

Do not add `-1`: the file has its own transaction boundaries. Do not use `supabase db push`.

## 3. Migration-history recording

Existing rows (read-only, 2026-10-24):

| Column | Type | Constraint |
|---|---|---|
| `version` | text | not null, primary key |
| `statements` | text[] | nullable |
| `name` | text | nullable |

No triggers on `schema_migrations`. 159 rows; latest `202610030004`.

Conventions in existing rows:
- `name` is the file slug without the version prefix, for example `claim_nexus_task_assignee_rejected_terminal`. The wrapper uses `audit_provenance_guard`.
- `statements` takes two forms. `202609231000` stores the whole file as one element (1 element). `202610030004` stores the split statements, with `begin` as the first element and `commit` as the last (7 elements). The wrapper follows the single-element form, which is the only form that is lossless for this file. The owner should confirm this choice when approving the SQL.

## 4. Duplicate-version guard

Three layers, all inside the transaction:
1. The precheck `do` block raises `PR32_PRECHECK` if version `20261024120000` is already recorded.
2. The primary key on `schema_migrations.version` rejects a second insert.
3. Before the apply, the operator runs the read-only check `select 1 from supabase_migrations.schema_migrations where version = '20261024120000'` and expects zero rows (runbook section 2).

## 5. Failure and rollback behaviour

Dry-run on a throwaway local clone of the origin/main lineage (not staging), 2026-10-24:

| Scenario | Result |
|---|---|
| Fresh clone, run wrapper | Exit 0. One history row (`20261024120000`, `audit_provenance_guard`, 1 element). Two policies present. `authenticated` privileges `INSERT,SELECT`. |
| Run again (version already recorded) | Exit 3, `PR32_PRECHECK` raised. Nothing changed; still one history row. |
| Forced error inside the body (`select 1/0` injected after the first revoke) | Exit 3, `division by zero`. No history row. The `audit_logs_select_admin` policy absent. `anon` still has SELECT, so the revoke was rolled back. |

Rule: any error stops psql (`ON_ERROR_STOP=1`). The connection then closes and the server rolls back the open transaction. A dropped connection before `commit` also rolls back. There is no state where the guard is applied without its history row, or the history row exists without the guard.

Not handled by this procedure: a failure after `commit` (none is possible inside this file). Recovery for that case is in `docs/AUDIT_LOGS_GUARD_RECOVERY.md`.

## 6. Compatibility with future Supabase tooling

- The row has the same shape as existing rows: text `version` and `name`, and a `statements` text array.
- After the apply, `supabase migration list --linked` will show `20261024120000` as applied on both sides.
- Pre-existing gaps remain. `202610220100` is local on `origin/main` and not applied. The nine C1/C6 versions are on some refs but not on this branch. A future `supabase db push` would try to apply `202610220100`. Do not run it until that migration is separately reviewed and approved.
- The wrapper's header comments mention `202610220100` and `db push` only to say they are excluded. Nothing executes them.

## 7. Confirmation: `202610220100` and unrelated migrations cannot be applied

- The wrapper executes exactly one body: the lines 41-124 of `20261024120000`. It contains no `\i`, no `include`, no reference to any other migration file, and no `DO` block or statement that reads or runs another migration.
- The only history write is one insert with version `20261024120000`.
- `202610220100` is a repository file on `origin/main`. Staging's history does not record it, and nothing in this procedure reads that file.
- The one shared-state risk is an accidental `db push`, which this procedure rules out.

## 8. Post-apply checks (read-only, operator, on live staging)

Run each as a separate read-only query (`begin transaction read only; ...; rollback;`). The CLI returns only the last statement of a multi-statement file.

1. History: `select version, name, array_length(statements,1) from supabase_migrations.schema_migrations where version = '20261024120000';` Expect one row with 1 element.
2. Count: `select count(*) from supabase_migrations.schema_migrations;` Expect 160. Max version `20261024120000`.
3. Privileges: `anon` has no privilege on `audit_logs`; `authenticated` has `INSERT,SELECT`; `service_role` unchanged.
4. Policies: exactly `audit_logs_select_admin` and `audit_logs_insert_admin_nonprovenance`. No `ALL` policy.
5. Triggers: `trg_audit_provenance_row_guard` and `trg_audit_provenance_truncate_guard`, both `tgenabled = 'O'`.
6. C1/C6 objects unchanged: re-run the nine-object and grant checks from `docs/evidence/readonly_verify_staging_2026-10-24.md`.
7. Statement digest for the new row against the file (lenient, as before).

All of these are catalog or history reads. None writes.

## 9. Isolated guard test (A4): 24 checks on a staging clone

Do not run `audit-logs-privilege-guard.sql` on the live project. It inserts `auth.users` rows, updates a profile, and attempts UPDATE, DELETE and TRUNCATE. Before the apply, its TRUNCATE check would really truncate `audit_logs` for the length of its transaction.

Procedure (owner approval needed to create the clone, because it is a platform-level mutation):
1. Owner approves creation of an isolated clone of Rock Solid Staging, from a restore or a branch, that is not the live project.
2. Operator confirms the clone's history tail is `202610030004`, then applies the wrapper to the clone only.
3. Operator runs `supabase/tests/security/audit-logs-privilege-guard.sql` on the clone with `-v ON_ERROR_STOP=1`. Expect 24 PASS, exit 0.
4. Negative control on a separate, unguarded clone: the same test must fail at the first privilege check.
5. Destroy the clone after recording the results.

Local equivalent already passed: 24/24 on the origin/main replay, and 24/24 after the wrapper's dry run.

## 10. Live Wave1 regression (A3): plan only, do not run

Source: `supabase/tests/security/wave1-regression.ts`. It runs against the live project with a service-role key, an anon key, and the four test identities.

### Precise mutations on live staging

| Step | Mutation | Table or object | Cleanup in the script |
|---|---|---|---|
| Identity setup | Creates four `auth.users` rows, emails `w1reg-<role>-<TS>@invalid.local`, roles pending, teacher, admin, superadmin | `auth.users` | `finally` deletes all four via the admin API |
| Identity setup | `UPDATE profiles SET role` for teacher, admin, superadmin | `public.profiles` | Removed when the auth user is deleted (profile cascade assumed; verify) |
| Teacher suite | `admin_create_teacher_direct` as each role; admin and superadmin may create `w1reg-teacher-<TS>@invalid.local` | `public.teachers` | Deleted by email only when the row count increases |
| Graduation suite | `INSERT batches` `w1reg-batch-<TS>`, `INSERT applicants` `w1reg-app-<TS>@invalid.local` | `batches`, `applicants` | Deleted at the end of the suite, not in `finally` |
| Graduation suite | `override_graduation_eligibility` as each role; admin and superadmin may insert a row | `graduation_eligibility` | Deleted per case when the row count increases |
| Audit suite | `INSERT audit_logs` seed `W1REG_SEED`; per role, `W1REG_INSERT_<ROLE>`, `W1REG_UPD_SEED`, `W1REG_DEL_SEED` | `audit_logs` | Each deleted by id in the script (owner-role `psql`, permitted for non-provenance rows) |

### Expected results after the apply
- Pending and teacher denied everywhere.
- Admin and superadmin: INSERT allowed; UPDATE and DELETE denied (contract change from PR #32).
- Anon denied on the graduation RPC.

### Cleanup requirements and known gaps
- The identity cleanup in `finally` runs even on error. The batch, applicant, teacher and graduation rows do not. If the suite throws mid-run, `w1reg-*` rows remain in `batches`, `applicants`, `teachers` and `graduation_eligibility`.
- Before any live run, the operator must query for leftovers by the `w1reg-` and `W1REG_` prefixes and list them. Remove them only with owner approval.
- The teacher payload's `p_email` is `w1reg-teacher-<TS>@invalid.local`. The cleanup filters by that exact email, so the admin path must not create a teacher under a different email.
- Live run needs A3 and an approved secret store for the keys. Do not paste keys into the repository.

Recommended: run Wave1 on the isolated clone from section 9 first, then on live staging only with A3 and the leftover check in place.

## 11. Ownership: owner versus operator

| Step | Owner | Operator (authorized) |
|---|---|---|
| Approve A1 (apply), A2 (this SQL, the `statements` form), A4 (clone), A3 (Wave1) | Yes | |
| Create isolated clone | Approve | Execute |
| Pre-checks (section 2 of runbook), read-only | | Yes |
| Apply the wrapper to staging | Approve | Execute, once |
| Post-apply read-only checks (section 8) | | Yes |
| Guard test on clone (section 9) | Approve | Execute |
| Wave1 (section 10) | Approve | Execute, after leftover check |
| Any history edit beyond the one row, any grant or policy change, any push, any production action | Yes, separately | No |

## 12. Residual risks

1. `statements` stores the file as one element, which differs from the split form of `202610030004`. Harmless to the apply; a future tool that reads `statements` may care.
2. Lenient content match for the nine versions (terminators only), not byte-identical proof.
3. The guard is not tamper-proof against the database owner.
4. A future `supabase db push` would try `202610220100`.
5. Wave1 can leave `w1reg-*` rows behind if it fails mid-run.
6. Production unverified.
7. The fork's `attendance_records` finding stays unverified behaviourally and is outside this PR.

## 13. Recommendation

**Conditional GO** for the apply, once A1 and A2 are approved and A4 is complete on a clone. The wrapper passed its dry runs on a throwaway clone for success, duplicate abort and forced rollback. Remaining: approvals, clone run, pre-checks and post-apply checks on the day.

**NO-GO** if: the version is already recorded; history tail is not `202610030004` with 159 rows; the `audit_logs` pre-state differs from the evidence; the clone guard test does not give 24 PASS; or any approval is missing.
