# Registration repair: final execution package (2026-10-22)

**Status: FINAL PREPARATION COMPLETE. NOT APPROVED. Do not execute. Stop at the database authorisation boundary.**

This package is for the owner's review. It records current state, read-only preflight results, the exact execution order, the history-recording method, and the recovery safeguards. It does not authorise a merge, a history change, a deploy or a production data change.

## 0. Execution-order record and current release gate (added 2026-10-22, after owner decision)

This section records what actually happened, so that the original order in sections 9b and 10 is preserved and not described as completed. The original text below is unchanged.

**Deviation from the approved order.**
- Step S1 and checklist step 2 required PR #9 to merge first, then PR #6 at the approved head.
- Actual order: **PR #6 was merged first.** Merge commit `6cfaf02` on `main` (2026-10-22 05:42:37 UTC; 01:42:36 -0400), from head `a3ebc4b1d`. PR #9 was still open at that time.
- The merge triggered a Netlify production build (`6cfaf021f`, published 05:42:51 UTC). The merge changed six files, all under `docs/`, `supabase/migrations/`, `supabase/ops/` or `supabase/tests/`. It changed nothing under `foundation/`, `_headers`, `netlify.toml` or `scripts/build-static-publish.mjs`. The static application is therefore unchanged.
- **Owner decision (2026-10-22):** keep the PR #6 merge on `main`. Do not revert. Merge-order discrepancy acknowledged. No production SQL is authorised by that decision.

**What this changes.** Only the order of merges. The DDL, the history-recording method, and the approval and preflight requirements are unchanged.

**Current release gate (2026-10-22).**

| Gate | Status |
|---|---|
| PR #6 merged on `main` at `a3ebc4b1d` (via `6cfaf02`) | Done. Owner decision: keep. |
| PR #9 (backup authority) merged | **Not done.** Open at `bb39c06d8`. Not yet safe to merge, see section 0a. |
| Written owner approval of the exact DDL and history method A | **Not given.** The owner has authorised preparation only. |
| Fresh encrypted public and migration-history backup (checklist step 3) | **Not taken.** |
| Preflight P1–P9 and the P3 checksum (checklist steps 4–5) | **Not run.** No production SQL is authorised. |
| Production DDL (checklist step 6) | **Completed by another agent.** Confirmed by read-only checks in section 0c. Not executed by this review. |
| History row, method A (checklist step 7) | **Recorded.** Version `202610220100` present, name `repair_class_options_registration_columns`, history count 160. Confirmed read-only in section 0c. The recording method used is not established by this review. |

## 0c. Production status reconciliation (read-only, 2026-10-22)

The owner asked for a reconciliation before any further production action. This section records read-only checks against production (project `xelpsttqhrcqmttmjory`, PostgreSQL 17.6). No write, DDL, migration repair or history change was made by this review.

| Check | Expected (this package) | Observed | Result |
|---|---|---|---|
| `class_options.is_online` present | 1 | 1 | Match |
| `class_options.confirmed_start_date` present | 1 | 1 | Match |
| Definition `is_online` | `boolean`, NOT NULL, default `false` | `boolean`, NOT NULL, default `false` | Match |
| Definition `confirmed_start_date` | `date`, nullable | `date`, nullable, no default | Match |
| `class_options` rows | 13 | 13 | Match |
| Checksum of original columns | `e5037229c4c14e479fa2fd738fe66b48` | `e5037229c4c14e479fa2fd738fe66b48` | Match |
| Migration history rows | 160 | 160 | Match |
| `202610220100` recorded | present | present | Match |
| `202605190900` and `202605190930` recorded | present | present | Match |

**Conclusion.** Production matches the state the package expects after the repair. The repair is therefore recorded as completed. The DDL and history row were applied by another agent. This review did not apply them, and the method used is not established here. The checksum covers the original columns only, so it confirms that no existing class option was changed.

**Consequences.**
- Checklist steps 6 and 7 are complete.
- Steps 8 to 12 (post-repair checks, registration check, class-editor check and queue monitoring) are not part of this review and remain to be recorded by the owner.
- Step 13 (a fresh encrypted backup of the repaired state) is still outstanding.
- The rollback in `supabase/ops/` is not to be used, unless the owner authorises it separately.

## 0a. PR #9 safety review (recorded 2026-10-22)

PR #9 is **not** documentation-only. It adds `scripts/backup/backup-prod-logical.sh`, which runs `pg_dump` against production. CI on `bb39c06d8` passed. Before PR #9 is merged, these defects must be fixed:

1. **Plaintext on disk.** The script writes the plain dump to `BACKUP_DIR` before encrypting it. With `set -e`, a failed `gpg` step exits and leaves the plaintext behind. The runbook says plaintext is never written. Encryption should be a pipe, `pg_dump | gpg`.
2. **Migration history omitted.** The script header says "plus the migration-history table", but the `pg_dump` call uses only `--schema=public`. The history export is a separate manual SQL step, so the header is inaccurate.
3. **Passphrase on disk.** `PASS_FILE` keeps the gpg passphrase in a file on disk. The owner's rule is that the passphrase is not stored with the backup. This needs an explicit decision.
4. **Temporary CLI role.** The runbook notes that the CLI creates a temporary login role that may remain in the database. Its cleanup is not described.

## 0b. Backup evidence and reconciliation (recorded 2026-10-22)

Three backups are referenced across the work. They have different snapshot times and must not be merged into one claim.

| Backup | Snapshot (UTC) | Scope | Source of evidence | Status |
|---|---|---|---|---|
| Public-schema dump (`rso_prod_20261022_051829Z.dump.gpg`) | 05:18:29 | `public` and `supabase_migrations`, with data | Verified in this session: encrypted AES-256, sha256 recorded, restored into isolated PostgreSQL 17.11 with 0 errors. Public checks identical to production, including deep checksums. | Verified. Limits: Auth excluded. |
| Auth export (`rso_prod_auth_20261022_053307Z.dump.gpg`) | 05:33:07 | `auth.users` and `auth.identities` | Verified in this session: encrypted AES-256, sha256 recorded. Restored with 0 errors. Auth checksums identical. The three missing foreign keys restored and validated. | Verified. Sessions, one-time tokens, MFA, WebAuthn, OAuth and SCIM excluded. |
| Public-schema dump plus history export (PR #9 runbook) | 04:33:51 | `public` with data, and history export of 159 rows | Reported by the separate backup agent. The restore evidence (61 of 62 items identical, the difference is 3 `audit_logs` rows written after the snapshot) is that agent's report. I have not re-verified it. | Reported, not independently verified here. Its file location is not recorded in this package. |

**Recovery consequence.** The two verified backups cover the public schema, the migration history, and the Auth users and identities. None of the three backups includes the Auth platform configuration (JWT secret, SMTP, redirect URLs, provider settings). That has to be recorded separately by the owner.

**Before the DDL.** Take a fresh encrypted backup immediately before execution (checklist step 3). The other agent's backup is older and cannot stand in for it.

## 1. Current state (final preparation, 2026-10-22)

| Item | Head | CI | Notes |
|---|---|---|---|
| `main` | `53a961c8` | — | |
| PR #6 (repair, rollback, harness, runbook) | **`a3ebc4b`** (this review's head) | Re-run on `a3ebc4b` (docs-only change; migration unchanged) | Head `5a893ce0` passed all CI. Commit `a3ebc4b` corrects the history-method target and removes the duplicate backup plan. **Owner approval must name `a3ebc4b`.** |
| PR #9 (backup script and the single authoritative backup runbook) | `bb39c06d` | All PASS | Must merge before or with PR #6. |
| PR #11 (this package) | see the PR | — | Docs only. |

Forward migration (`supabase/migrations/202610220100_repair_class_options_registration_columns.sql`): one statement, `ALTER TABLE public.class_options` with exactly two `ADD COLUMN IF NOT EXISTS` clauses (`is_online BOOLEAN NOT NULL DEFAULT false`, `confirmed_start_date DATE NULL`). No other object is created, altered or dropped.

## 2. Backup status

**Authoritative procedure:** `docs/PRODUCTION_BACKUP_AND_RECOVERY_2026-10-22.md` with `scripts/backup/backup-prod-logical.sh` (PR #9). The duplicate backup plan has been removed from PR #6.

| Item | Value |
|---|---|
| Logical backup of `public` (with data), encrypted | snapshot **2026-10-22 04:33:51 UTC** |
| Checksum | PASS |
| Readable | PASS (56 table-data entries) |
| Encrypted history export | PASS (159 rows; checksum identical to production at the snapshot) |
| Restore rehearsal (PostgreSQL 17.6, isolated) | 61 of 62 items identical; the one difference is 3 `audit_logs` rows written after the snapshot |
| Limits | `auth` excluded (3 foreign keys to `auth.users` not restored). Storage, Vault, cron and roles not included. Free plan: no platform backup or PITR. |

**A fresh encrypted backup is required immediately before execution** (step S2). The snapshot above is a fallback for the 04:33 state only.

## 3. Preflight (read-only, from a production-linked directory, 2026-10-22)

The preflight was run with `supabase db query --linked` from a directory whose link was checked to be `xelpsttqhrcqmttmjory`. It is read-only (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`).

| Check | Expected | Result |
|---|---|---|
| P1 repaired columns present | 0 | **0 (PASS)** |
| P2 target version recorded | 0 | **0 (PASS)** |
| P3 `202605190900` recorded (name) | `class_options_online_multicampus` | **PASS** |
| P3 `202605190930` recorded (name) | `attendance_late_start_status` | **PASS** |
| P4 history rows | 159 | **159 (PASS)** |
| P5 `class_options` rows | 13 | **13 (PASS)** |
| P6 original-columns checksum (harness column list and expression) | record | `e5037229c4c14e479fa2fd738fe66b48` over 13 rows (changes if any row is updated) |
| P7 policies on `class_options` | 4 | **4 (PASS)** |
| P8 server version | 17.6 | **17.6 (PASS)** |
| P9 active and open rows | 13 | **13 (PASS)** |
| Registration REST, `select=class_option_id,is_online` | error: column does not exist | **400, `column class_options.is_online does not exist` (confirmed)** |
| Registration REST, `select=class_option_id,confirmed_start_date` | error: column does not exist | **400, `column class_options.confirmed_start_date does not exist` (confirmed)** |
| Registration REST, `select=class_option_id` | success | **200 (confirmed)** |

**Conclusion of the preflight:** the state is exactly the pre-repair state described by the migration. Both columns are required by the form's select, and each one is missing on its own.

## 4. Exact execution order (for approval only)

Each step has a stop condition. If any step fails, stop and report. Do not improvise.

**S0. Approvals.** Written owner approval for (a) merging PR #6, (b) the exact forward migration `202610220100`, and (c) the history recording method in section 5. Approval for the rollback is separate and is not part of this order.

**S1. Merge PR #6 (merge commit, repository policy).** Merge only at head **`a3ebc4b`** (or the later head you approve), pinned with `--match-head-commit`. Stop if the head differs. PR #9 must be merged first or in the same change.
Note: the merge changes `main`, which triggers a Netlify production build. The static output is unchanged, because the migration, ops and test files are not published.

**S2. Fresh backup, immediately before execution.** Run `scripts/backup/backup-prod-logical.sh` (PR #9) with the production-linked CLI directory. Verify the checksum and `pg_restore --list`. Record the snapshot time. Stop if either check fails.

**S3. Preflight again.** Re-run the preflight in section 3 from the production-linked directory. Every value must match. Any difference is a stop condition. If `P6` differs but no rows were updated, stop and investigate before continuing.

**S4. Apply the forward DDL in one transaction, from the production-linked directory, through the approved SQL path.** Use the PR #6 migration text unchanged, with a validation block:

```sql
BEGIN;

ALTER TABLE public.class_options
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_start_date DATE NULL;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'class_options'
        AND column_name IN ('is_online', 'confirmed_start_date')) <> 2 THEN
    RAISE EXCEPTION 'repair validation failed: expected 2 columns';
  END IF;
  IF (SELECT count(*) FROM public.class_options WHERE is_online IS NULL) <> 0 THEN
    RAISE EXCEPTION 'repair validation failed: NULL is_online';
  END IF;
END $$;

-- S5 history row is inserted in this transaction ONLY if method B is approved (section 5).
COMMIT;
```

Stop condition: any error. The transaction rolls back. Re-check P1 afterwards.

**S5. Record the history row (method A preferred; section 5).** Only after S4 commits and S6 passes. Never before.

**S6. Validation (read-only).**

```sql
-- V1 columns, types, defaults
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'class_options' AND column_name IN ('is_online', 'confirmed_start_date');
-- expect: is_online boolean NO false ; confirmed_start_date date YES NULL

-- V2 no NULL is_online: expect 0
SELECT count(*) FROM public.class_options WHERE is_online IS NULL;

-- V3 original-columns checksum: expect the P6 value (no row changed)
-- (same column list and expression as section 3, P6)

-- V4 registration filter: expect 13
SELECT count(*) FROM public.class_options WHERE active = true AND enrollment_open = true AND deleted_at IS NULL;

-- V5 history: expect the row for 202610220100 after S5 only; 202605190900 and 202605190930 unchanged
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('202605190900','202605190930','202610220100') ORDER BY version;
```

**S7. Functional checks (no submissions, no real data changes).**
1. Registration REST, anon key: `GET /rest/v1/class_options?select=class_option_id,is_online,confirmed_start_date&active=eq.true&enrollment_open=eq.true&deleted_at=is.null` returns 200 with 13 rows.
2. Public registration form loads the class list (no error banner, no console error). Do **not** submit an application.
3. Administrator class editor: one unchanged save of an existing class. Expect success. Make no real change.
4. Monitor the email and notification queues for 60 minutes. Public registrations are now open, so confirm applicant rows and emails are processed normally.

**S8. Post-change backup.** Take a new encrypted backup. It is the recovery point for the repaired state.

## 5. Migration-history recording

Production history before: **159 rows**. Expected after execution: **160 rows**, with one new row: version `202610220100`, name `repair_class_options_registration_columns`. No other row may change.

- **Target rule (mandatory):** history commands run only from a directory whose `supabase/.temp/project-ref` is `xelpsttqhrcqmttmjory`. **Never** from the repository, which is linked to staging (`hblahcaozlttknkzvkib`).
- **Method A (preferred):** `supabase migration repair --status applied 202610220100 --linked`, from the production-linked directory, after the DDL commits and V1–V4 pass. Stop if the reported version set or the command output differs.
- **Method B (fallback only, needs its own approval):** insert the row in the same transaction as the DDL, with the same version and name, and statements equal to the file text.
- **Never:** edit, delete or re-order `202605190900` or `202605190930`. Never mark anything reverted in this repair.
- **Verify:** count is 160; the three versions `202605190900`, `202605190930` and `202610220100` are present; no other row changed.

## 6. Validation and rollback safeguards

**Stop and report, without rolling back, if:**
- any S3 preflight value differs;
- S4 fails;
- V1–V4 fail;
- the registration REST check does not return 13 rows;
- email or notification queues stop processing.

**Rollback (destructive; owner only; separate approval).** The guarded rollback in `supabase/ops/202610220100_rollback_class_options_repair.sql` (PR #6) refuses to run unless all guards pass. Before it runs:

1. **Export post-repair values** (anything with `is_online IS DISTINCT FROM false OR confirmed_start_date IS NOT NULL`). Store the CSV in the secure folder, never in a repository. Verify its row count equals the live count.
2. Set `rso.rollback_authorization`, `rso.rollback_export_confirmed` and `rso.rollback_expected_rows` in the same session.
3. Run the guarded script. It drops both columns in one transaction.
4. Remove the history row only with its own approval (the history would otherwise claim a state the database no longer has).

**Preserving values written after the migration.** Re-applying the migration after a rollback restores the columns with defaults, not the exported values. To restore values, the owner applies a **reviewed** `UPDATE` from the CSV, after re-applying, and checks row counts against the export. No automatic restore is part of this package.

**If the migration itself must be undone:** restore from the encrypted backup taken at S2, into a **new** database first, and verify. Restoring over production is a separate decision with its own approval.

## 7. Remaining operational risks

| Risk | Mitigation |
|---|---|
| Public registrations re-open. Real applicant rows, emails and notifications follow. | Confirm queues and staff capacity before S4. Monitor S7.4 for an hour. |
| The class editor starts saving again. Admin changes now reach the database. | Expected. Test one save only. |
| The first teacher attendance submission writes `confirmed_start_date`. | Designed behaviour. Check with one teacher account if available. |
| Attendance reminder is not scheduled in production. | Unchanged by this repair. Scheduling it is a separate change. |
| Waitlist notify triggers, validation triggers and other drift remain. | Out of scope. See `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md`. |
| The remote-only C1 and C6 versions remain in history. `supabase db push` will refuse to run. | Use the approved SQL path and method A only. |
| The Free plan has no platform backup or PITR. | Logical backups before and after (S2, S8). Auth users not covered. |
| The CLI login role `cli_login_postgres` was created in production by CLI access. It expires but remains in `pg_roles`. | Owner decision on removal. Not part of this package. |
| The two backup documents overlap. | Consolidate before merge (section 9). |

## 8. Recovery summary

- Before execution: S2 backup (encrypted, checksum-verified, readable).
- Restore rehearsal: PostgreSQL 17.6, 61 of 62 items identical, with the limits in section 2.
- If the repair fails: stop, roll back only with the guarded script after the export, and keep the history consistent.
- If the data must come back: restore into a new database first, then decide.

## 9. Documentation reconciliation (resolved in this preparation)

- **Backup guidance:** one authority, PR #9. The PR #6 duplicate (`PRODUCTION_LOGICAL_BACKUP_PLAN`) is removed.
- **History method target:** corrected in PR #6 section 15 (commit `a3ebc4b`) and in section 5 above. The "run from the repo" instruction is withdrawn.
- **Checksum definition:** P3 and V3 use the PR #6 harness column list. The earlier expression in PR #6 section 9 is replaced. Expected value on 2026-10-22: 13 rows, `e5037229c4c14e479fa2fd738fe66b48`.
- **Rehearsal version:** PR #6 section 14 records the original 17.11 run and the reviewer's 17.6 reproduction (30/30; backup tooling 12/12).

## 9a. Forward recovery preference

Prefer **forward recovery** over the rollback:
1. If V1–V4 fail, stop and investigate. Do not roll back for a single failed request.
2. If the columns are correct but a value is wrong, correct it forward with a reviewed `UPDATE`.
3. If the repair must be undone, use the guarded rollback in `supabase/ops/` only with owner authorisation, after the export in section 6.
4. Restore from the encrypted backup into a **new** database only if production data is lost. Never restore over production without a separate decision.

## 9b. Operator checklist and stop conditions

Print this checklist and tick each item in the approval record.

| # | Step | Stop condition |
|---|---|---|
| 0 | Written approval names PR #6 head `a3ebc4b` (or later approved head), and the DDL and history method | Approval missing, or head differs |
| 1 | Verify the CLI link for every command: `cat <prod-dir>/supabase/.temp/project-ref` = `xelpsttqhrcqmttmjory` | Any other value. **Never** proceed from the repository. |
| 2 | Merge PR #9 (if not merged), then PR #6 at the approved head with `--match-head-commit` | Head differs; CI not green |
| 3 | Fresh encrypted backup (`backup-prod-logical.sh`); verify checksum and `pg_restore --list` | Any check fails |
| 4 | Re-run preflight P1–P9 (section 3) from the production-linked directory | Any value differs from section 3 |
| 5 | Re-run the P3 checksum (13 rows, `e5037229…`) | Checksum differs (a row was updated) |
| 6 | Apply the DDL in one transaction with the validation block (S4) | Any error (transaction rolls back; stop) |
| 7 | Record the history row, method A only (section 5) | Output differs; version set differs |
| 8 | Run V1–V4 and the history verification | Any value differs |
| 9 | REST registration check (anon): 200, 13 rows | Not 13 rows, or any error |
| 10 | Registration form loads the class list (no submission) | Error banner or console error |
| 11 | Admin class-editor save of one unchanged class | Save fails |
| 12 | Monitor email and notification queues for 60 minutes | Queue stalls or failures rise |
| 13 | Fresh encrypted backup of the repaired state (S8) | Any check fails |

## 9c. Secrets and logging rules

- Connection details, database passwords and encryption passphrases stay out of logs, chat, reports and Git. The CLI supplies them at run time. Scripts assign them to variables and never print them.
- Never store a plaintext dump or export in a repository or a shared folder. Encrypted backups stay in the secure local folder, outside every repository.
- Do not paste production rows, teacher or applicant data into any tool output or report. Report counts and checksums only.
- Do not commit anything from the secure folder.

## 10. GO / NO-GO

**Ready for owner authorisation: YES, subject to the conditions below.** Execution is **NOT** authorised by this document.

Conditions before execution:
1. Written owner approval naming PR #6 head `a3ebc4b` (or a later reviewed head), the forward DDL, and the history method A.
2. PR #9 merged (or merged in the same change), so the single backup authority is on `main`.
3. Fresh encrypted backup (step 3 of the checklist) immediately before execution.
4. Preflight P1–P9 and the P3 checksum match section 3 at the moment of execution.
