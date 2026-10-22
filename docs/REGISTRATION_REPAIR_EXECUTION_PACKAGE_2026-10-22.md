# Registration repair: final execution package (2026-10-22)

**Status: NOT APPROVED. Do not execute. Stop at the database authorisation boundary.**

This package is for the owner's review. It records current state, read-only preflight results, the exact execution order, the history-recording method, and the recovery safeguards. It does not authorise a merge, a history change, a deploy or a production data change.

## 1. Current state (checked 2026-10-22, about 05:06 UTC)

| Item | Value | Notes |
|---|---|---|
| `main` | `53a961c8dd17b26a16f007f314a0e954190be9a1` | PR #7 merge |
| Live production deploy | `6ad98863c94537b0c8153536` (commit `53a961c8`) | Static site; no DB change |
| PR #6 | open, **head `5a893ce0`** (was `0ab80dee` at the previous review) | Two new commits by the owner's account at 00:13 local: rollback, harness, runbook update. The forward migration file is unchanged from the reviewed version. |
| PR #6 CI on head `5a893ce0` | Migration gate, Security regression, Unit tests, Deploy Preview: all PASS | |
| PR #9 | open, head `bb39c06d` | Backup script and runbook. CI all PASS. |
| Duplicate backup documents | PR #6 adds `docs/PRODUCTION_LOGICAL_BACKUP_PLAN_2026-10-22.md`; PR #9 adds `docs/PRODUCTION_BACKUP_AND_RECOVERY_2026-10-22.md` | **Two overlapping backup documents.** Consolidate before merge (see section 9). |

## 2. Backup status

| Item | Value |
|---|---|
| Logical backup (encrypted dump of `public`, with data) | snapshot **2026-10-22 04:33:51 UTC** |
| Age at this review | about 32 minutes |
| Checksum | PASS (`sha256sum -c`) |
| Readable | PASS (`pg_restore --list`: 56 table-data entries) |
| Encrypted history export | PASS (checksum; 159 rows; identical to production history at the snapshot) |
| Restore rehearsal (PostgreSQL 17.6, isolated) | PASS with limits: 61 of 62 verification items identical (the one difference is 3 `audit_logs` rows written after the snapshot) |
| Limits | Auth schema excluded (3 foreign keys to `auth.users` not restored). Storage, Vault, cron and roles not included. Free plan: no platform backup or PITR. |

**Before execution, take a fresh backup** (section 4, step S2). The current one is a valid fallback only for the state at 04:33 UTC.

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

**S1. Merge PR #6 (merge commit, repository policy).** Pin the merge to the head you approved, with `--match-head-commit`. Stop if the head is not the approved one.
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

## 5. Migration-history recording procedure

**Correction to PR #6, section 15:** it says method A runs "from the repo against project `xelpsttqhrcqmttmjory`". The repository's CLI link is **staging** (`hblahcaozlttknkzvkib`). Running that command from the repository would change **staging**, not production. Method A must run **only** from a directory whose link was verified as `xelpsttqhrcqmttmjory`.

- **Method A (preferred):** `supabase migration repair --status applied 202610220100 --linked`, run from the production-linked directory, after S4 commits and S6 passes.
  - Verify afterwards that only the new row was added (V5). Confirm the stored name and statements match the repo file.
  - Stop if the CLI reports an error or a different version set.
- **Method B (fallback only, needs its own approval):** insert the row inside the same transaction as S4, with the same name and statement text as the repo file. Do not use it if method A works.
- **Never:** change, delete or re-order `202605190900` or `202605190930`. Never mark any version reverted as part of this repair.
- **Expected result:** 160 rows (159 plus `202610220100`). The 9 remote-only C1 and C6 versions remain as recorded.

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

## 9. Documentation to reconcile before PR #6 merges

- PR #6 `docs/PRODUCTION_LOGICAL_BACKUP_PLAN_2026-10-22.md` and PR #9 `docs/PRODUCTION_BACKUP_AND_RECOVERY_2026-10-22.md` cover the same procedure. Keep one, or cross-link both.
- PR #6 runbook section 15 method A: correct the target to the production-linked directory (section 5 above).
- PR #6 backup plan cites "PostgreSQL 17.11" for its rehearsal. The harness was reproduced here on PostgreSQL 17.6 (30 of 30 PASS; backup tooling 12 of 12 PASS). Cite the version actually run.
- The preflight checksum definitions differ between `docs/REGISTRATION_REPAIR_PRODUCTION_EXECUTION_2026-10-22.md` (PR #8) and the PR #6 harness. Use the harness definition in P6 (section 3 here).

## 10. GO / NO-GO

**NO-GO for executing production SQL now.** The package is consistent and the preflight matches, but execution requires:
1. Written owner approval for S1 and S4, and for method A in S5.
2. A fresh backup (S2) taken immediately before S4.
3. Resolution of the documentation items in section 9 (at least the method A target correction).

**GO** only after those three conditions, with the S3 preflight matching section 3 at the time of execution.
