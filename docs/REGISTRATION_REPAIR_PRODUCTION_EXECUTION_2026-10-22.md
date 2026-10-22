# Registration repair: production execution plan (2026-10-22)

**Status: HOLD. Do not execute. Not approved.**
This document prepares a future production execution. It does not authorise one. It assumes PR #6 (`fix/registration-class-options-drift`, head `0ab80dee`) is reviewed and merged first, and that the owner approves the exact DDL below.

## 1. Scope (exact)

Only the DDL in `supabase/migrations/202610220100_repair_class_options_registration_columns.sql` on the approved head:

```sql
ALTER TABLE public.class_options
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_start_date DATE NULL;
```

Not in scope: `attendance_log.session_status`, waitlist triggers, audit objects, RLS, cron jobs, the nine remote-only C1 and C6 versions, or any other object in `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md`.

## 2. Evidence to date

| Item | Result | Source |
|---|---|---|
| Production columns absent | PASS (read-only, 2026-10-22) | `information_schema.columns` for `class_options` returns neither column |
| Production history row `202605190900` | PASS (recorded as applied) | `supabase_migrations.schema_migrations` |
| Production history row `202605190930` | PASS (recorded as applied; `session_status` absent) | same |
| Applied migration count | 159 | same |
| Latest recorded version | `202610030004` (remote-only, C6) | same |
| Rows in `class_options` | 13, all active and open | aggregate counts only |
| PostgreSQL version | 17.6 | `server_version` |
| Rehearsal on PostgreSQL 17 | 19 of 19 PASS, transactional (see section 7) | `docs/REGISTRATION_CLASS_OPTIONS_REPAIR_2026-10-22.md` |
| CI on PR #6 head `0ab80dee` | Migration gate PASS, Security regression PASS, Unit tests PASS, Deploy Preview PASS | PR #6 checks |
| Backup availability | **UNVERIFIED.** The CLI lists zero physical backups for `xelpsttqhrcqmttmjory`. The dashboard must confirm daily backups or PITR. See section 6. | `supabase backups list` |

## 3. Preflight (read-only; run from a directory linked to production, not from the repo)

Run each query and record the output. Stop if any result differs from the expected value.

```sql
-- P1: both columns absent. Expect 0 rows.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'class_options'
  AND column_name IN ('is_online', 'confirmed_start_date');

-- P2: the new version is not already recorded. Expect 0 rows.
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '202610220100';

-- P3: row count and checksum of existing values. Record both.
SELECT count(*) AS rows,
       md5(string_agg(class_option_id || active::text || enrollment_open::text || coalesce(deleted_at::text, '')
                      || coalesce(max_capacity::text, '') || coalesce(enrollment_closes_at::text, ''), ',' ORDER BY class_option_id)) AS checksum
FROM public.class_options;

-- P4: the registration query fails today. Expect error 42703 (column is_online does not exist).
SELECT class_option_id FROM public.class_options
WHERE active = true AND enrollment_open = true AND deleted_at IS NULL LIMIT 1;

-- P5: policies on class_options unchanged since 2026-10-22. Expect 4 (class_options_admin_all, class_options_anon_select, class_options_teacher_select_assigned, class_options_teacher_select_assigned_hardened).
SELECT count(*) AS policies FROM pg_policies WHERE tablename = 'class_options';

-- P6: PostgreSQL version supports a metadata-only ADD COLUMN with a constant default (11 or later). Expect 17.x.
SHOW server_version;
```

Expected values at 2026-10-22: P1 0 rows; P2 0 rows; P3 13 rows; P4 error 42703; P5 4; P6 17.6.

## 4. Pre-change snapshot (local, outside the repo)

`class_options` contains teacher names. Keep the snapshot private. Do not commit it, and do not paste it into logs or reports.

1. Export the table to a local file outside the repository, for example `%USERPROFILE%\secure-backups\class_options_YYYYMMDD.json`. Restrict the folder to the operator.
2. Record its SHA-256 and the row count in the change ticket.
3. Confirm the export has 13 rows (or the value recorded in P3).

## 5. Transaction (after approval only)

Run the DDL and the history row inside **one** transaction, through the approved SQL path. Do not use `supabase db push`, because production has remote-only versions.

```sql
BEGIN;

ALTER TABLE public.class_options
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_start_date DATE NULL;

-- Validation inside the transaction (any failure raises an error and the transaction is rolled back):
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'class_options'
        AND column_name IN ('is_online', 'confirmed_start_date')) <> 2 THEN
    RAISE EXCEPTION 'repair validation failed: expected 2 columns';
  END IF;
  IF (SELECT count(*) FROM public.class_options WHERE is_online IS NULL) <> 0 THEN
    RAISE EXCEPTION 'repair validation failed: NULL is_online present';
  END IF;
END $$;

COMMIT;
```

If any statement fails, the transaction is aborted. Nothing is applied. Confirm with P1 afterwards.

## 6. Recording the history row (after the transaction commits)

Do not change or delete any existing row. Record only the new version, so history matches what was applied.

```bash
# Run from a directory linked to production (NOT the repository, which is linked to staging).
supabase migration repair --status applied 202610220100 --linked
```

Verify:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version IN ('202605190900', '202605190930', '202610220100') ORDER BY version;
-- Expect three rows. Rows 202605190900 and 202605190930 must be unchanged.
```

**Backups (UNVERIFIED, blocks execution).** Before the transaction, the owner must confirm in the Supabase dashboard (project `foundation-school`, Database → Backups):
- a daily backup from within the last 24 hours exists, or
- PITR is enabled and covers the execution window.

Record the backup timestamp and the dashboard check in the change ticket. If neither is available, do not execute.

## 7. Rehearsal evidence (summary)

Full detail: `docs/REGISTRATION_CLASS_OPTIONS_REPAIR_2026-10-22.md`.

- Engine: PostgreSQL 17.5 (PGlite, in process). Production: 17.6. Same major version.
- Schema: the production column names, types, nullability and defaults for `class_options`, without the two repaired columns. RLS policies included. A synthetic migration-history table.
- Data: 13 synthetic rows with varied values. No real data.
- Transaction test: the migration and the history insert run inside `BEGIN … ROLLBACK`. Data and history checksums are identical after rollback. The registration query fails again after rollback.
- Commit test: the existing values checksum is unchanged. `is_online` is `false` and `confirmed_start_date` is NULL for every existing row. The prior history rows are unchanged, and the new version is recorded.
- Idempotency: a second run succeeds with no change.
- Result: **19 of 19 PASS.**

Limits: PGlite is not Supabase's hosted instance (no `auth` schema, no `pg_cron`, no Supabase roles). The real CI migration gate is separate evidence.

## 8. Post-change validation (read-only)

```sql
-- V1: columns present, types and defaults as expected.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'class_options'
  AND column_name IN ('is_online', 'confirmed_start_date');
-- Expect: is_online boolean NO false ; confirmed_start_date date YES (NULL default)

-- V2: no NULL is_online.           Expect 0.
SELECT count(*) FROM public.class_options WHERE is_online IS NULL;

-- V3: the checksum from P3 is unchanged (the same expression as P3). Expect the P3 values.
SELECT count(*) AS rows, md5(string_agg(class_option_id || active::text || enrollment_open::text || coalesce(deleted_at::text, '')
                      || coalesce(max_capacity::text, '') || coalesce(enrollment_closes_at::text, ''), ',' ORDER BY class_option_id)) AS checksum
FROM public.class_options;

-- V4: the registration query succeeds. Expect 13 rows (all active and open at 2026-10-22).
SELECT class_option_id, is_online, confirmed_start_date FROM public.class_options
WHERE active = true AND enrollment_open = true AND deleted_at IS NULL;

-- V5: history rows as described in section 6.
```

Functional checks (no submissions):
1. Load the public registration form unauthenticated. The class list should show the open classes (no error banner, no console error).
2. Load the admin class editor as an administrator (owner or operator with an account). Save an unchanged class. Expect success. Do not change real data.
3. Confirm the email and notification queues are running (existing monitoring).

## 9. Recovery and rollback

Use only if the repair itself causes a failure. The rollback drops both columns, so **any `is_online` or `confirmed_start_date` value written after the repair is lost.** Export those two columns first.

```sql
-- Rollback (after exporting the two columns):
BEGIN;
ALTER TABLE public.class_options
  DROP COLUMN IF EXISTS confirmed_start_date,
  DROP COLUMN IF EXISTS is_online;
COMMIT;
```

Then mark the version as reverted through the approved route:

```bash
supabase migration repair --status reverted 202610220100 --linked   # production-linked directory only
```

Effects of rollback: the registration form fails again with `42703`, and class-editor saves fail again. Both states are known and documented. Do not roll back for a registration-only symptom. Roll back only for a database error caused by the repair.

Last resort: restore from the verified backup (section 6). That restores the whole project to the chosen timestamp, so use it only for database-wide damage, and expect to lose all writes after that timestamp.

## 10. History reconciliation proposal

- **Keep** `202605190900` and `202605190930` as recorded. Do not mark them reverted, and do not delete or edit them. Editing them would falsify history.
- **Add** `202610220100` as a new version, recorded with `migration repair --status applied`. This is truthful: the repair is applied in the same change.
- **Do not** replay `000_baseline_squash` or any other older migration to fill gaps.
- **Future repairs:** each class in the drift inventory gets its own new migration version, reviewed and approved separately, recorded the same way.
- **Remote-only C1 and C6 versions:** leave recorded as applied. Their code is unmerged. Reconcile only through a separate governance decision, not through this repair.

Consequence: after the repair, production has the two registration columns that `202605190900` describes. `202605190930`'s `session_status` remains absent and stays a recorded-but-absent drift item until its own repair is approved.

## 11. Remote-only versions and `supabase db push`

Production has 9 versions recorded that are not in `main` (C1 and C6). A normal `supabase db push` from `main` will refuse or misbehave against them. Do not use `supabase db push` for this change. Use the approved SQL path, then `migration repair` for the single new version.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Public registrations start working, creating real applicant rows and emails | Owner confirms email and notification queues are healthy before the change. Monitor the first hour. |
| Class-editor saves start working (they currently fail) | Expected and intended. Check one save. |
| First teacher attendance submission writes `confirmed_start_date` | Designed behaviour. Verify with one teacher account if available. |
| Attendance reminder not scheduled | Unchanged. Scheduling it is a separate approved change. |
| Rollback loses post-repair values | Export the two columns before any rollback. |
| Backups unverified | Blocks execution until the dashboard check is recorded. |

## 13. GO / NO-GO

**Current recommendation: NO-GO for production execution.** Blockers:
1. PR #6 is not merged, and the owner has not approved this exact DDL.
2. The production backup status is UNVERIFIED (the CLI shows zero physical backups).
3. The pre-change snapshot (section 4) has not been taken.

**GO** once all three are resolved, the preflight in section 3 matches the expected values, and the owner records written approval for this exact DDL and the history row. Execute section 5, then 6, then 8. If any validation fails, follow section 9 for that failure only.
