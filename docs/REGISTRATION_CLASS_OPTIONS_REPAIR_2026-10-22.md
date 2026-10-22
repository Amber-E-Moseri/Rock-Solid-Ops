# Registration class-list repair and production schema drift (2026-10-22)

**Status:** repair migration reviewed; a reproducible PostgreSQL 17 harness and a hardened rollback are in this PR. **Not executed on production.**
**Production SQL status: NO-GO** until the owner separately authorizes execution. Production execution also requires a verified logical backup first (sections 12 and 13). Production history recording needs its own approval (section 11).

Branch: `fix/registration-class-options-drift` (from `origin/main` `45be664`). Isolated from the Netlify hotfix (PR #3, deployed) and from the SPA and C6 branches.

## 1. Symptom

The public registration form (`foundation/registration/registration-form.html`) loads, but its class list fails. The browser request returns HTTP 400 with PostgreSQL error `42703` (`column class_options.is_online does not exist`). The same failure was reproduced with the form's public anon key (status and error code only; no data read).

## 2. Root cause

| Layer | Evidence |
|---|---|
| Code path | `registration-form.html:1715` queries `class_options` and selects `is_online` and `confirmed_start_date`. `:1731-1732` maps them. |
| Migration | `supabase/migrations/202605190900_class_options_online_multicampus.sql` adds both columns (`IF NOT EXISTS`). |
| Production history | `supabase_migrations.schema_migrations` has version `202605190900` recorded as applied. Its recorded statement text matches the repo file. |
| Production schema | `public.class_options` has **neither column**. The other 17 columns and their defaults match the repo. |
| Conclusion | The migration was recorded as applied but its DDL is not present. No branch drops these columns (`git grep` across all local and remote branches found no `DROP COLUMN` for them). The cause of the recorded-but-absent state is not established. It matches the pattern already logged on 2026-07 for the waitlist triggers in `202605191920`, whose root cause was also never determined. |

## 3. Exact production discrepancy (read-only catalog queries, 2026-10-22)

| Object | Expected by repo | Production |
|---|---|---|
| `class_options.is_online` | `BOOLEAN NOT NULL DEFAULT false` | **absent** |
| `class_options.confirmed_start_date` | `DATE NULL` | **absent** |
| All other registration-path columns (35 checked, see section 4) | present | present |
| Registration RPC `insert_applicant_reserve_slot` | present | present |
| `class_options` rows | - | 13 total, 13 active and open |
| PostgreSQL version | - | 17.6 |

## 4. Is the missing column the only mismatch?

**For the registration path: yes.** Of 35 registration-path columns checked (applicants writes from `registration-processor`, the three `fellowship_map`, `batches` and `batch_campus_registration_settings` reads, and `class_options`), only the two `class_options` columns are missing.

**For the database as a whole: no.** Every schema object created by every migration on `origin/main` was checked against the production catalog (843 objects: columns, tables, functions, indexes, policies and triggers). 202 are missing, and 142 of those belong to `000_baseline_squash`, which later migrations replaced. Excluding the baseline leaves **60 missing objects across 22 migrations**:

<details>
<summary>Migration-by-migration drift table (generated from catalog results)</summary>

| Migration | Objects checked | Missing | Missing by kind |
|---|---:|---:|---|
| 000_baseline_squash | 285 | 142 | table 10, index 30, policy 91, trigger 11 |
| 202605061400_rls_hardening | 47 | 2 | policy 2 |
| 202605071800_audit_logs_canonicalization | 8 | 3 | column 1, function 1, trigger 1 |
| 202605071960_teacher_user_ownership_hardening | 13 | 1 | index 1 |
| 202605071980_pending_onboarding_hardening | 5 | 3 | function 1, trigger 2 |
| 202605121130_security3_rls_coverage_new_tables | 21 | 8 | policy 8 |
| 202605121320_security4_legacy_broad_rls_hardening | 24 | 1 | policy 1 |
| 202605122100_batches_subgroup_id | 2 | 2 | column 1, index 1 |
| 202605150000_create_attendance_records | 11 | 10 | column 1, function 1, index 2, policy 5, trigger 1 |
| 202605180001_capacity_applicant_count_escalation_details | 2 | 1 | function 1 |
| 202605182000_email_templates_table | 2 | 1 | policy 1 |
| 202605190900_class_options_online_multicampus | 2 | 2 | column 2 |
| 202605190930_attendance_late_start_status | 3 | 3 | column 2, index 1 |
| 202605191130_fellowship_management_hardening | 11 | 3 | policy 3 |
| 202605191210_applicants_subgroup_id_backfill | 2 | 1 | index 1 |
| 202605191240_applicants_group_subgroup_backfill | 1 | 1 | index 1 |
| 202605191250_registration_regional_fellowship_support | 1 | 1 | index 1 |
| 202605191330_safe_teacher_auth_linking | 4 | 2 | function 1, index 1 |
| 202605191700_multicampus_teacher_availability_hardening | 6 | 4 | function 2, trigger 2 |
| 202605191920_waitlist_class_available_auto_notify | 5 | 4 | function 2, trigger 2 |
| 202605191930_dashboard_teacher_kpis | 2 | 1 | function 1 |
| 202605192000_batches_admin_write_superadmin_delete | 6 | 4 | function 1, policy 2, trigger 1 |
| 202607090001_email_claim_and_perf_indexes | 6 | 2 | index 2 |

Totals: 843 objects checked, 202 missing, 23 migrations with gaps. Excluding 000_baseline_squash: 60 missing across 22 migrations.

</details>

Each row needs a per-migration review before any production change. Some missing objects are intentionally superseded (for example, `trg_profiles_protect_self_role_update` from `202605071980` was replaced by `trg_profiles_enforce_role_assignment` from `202607131500`, which is present and matches the repo's current design).

### 4a. Comparison with staging (same catalog check, 2026-10-22)

The same 843-object catalog check was run against `rocksolid-staging` (Supabase project `hblahcaozlttknkzvkib`). Staging has **both `class_options` columns** and its `schema_migrations` history ends at `202610030004`, the same as production. So staging is a working reference for the repaired DDL. It is not a perfect reference: it is missing 11 objects that production has (for example, some `auth_rbac` policies).

| Comparison | Objects |
|---|---:|
| Missing in production, present in staging (production-only drift) | 140 total, of which 47 are non-baseline (19 migrations) |
| Missing in both | 62 total, of which 13 are non-baseline (5 migrations): shared gaps to review in both |
| Missing in staging, present in production | 11 |

Non-baseline production gaps are 47 + 13 = 60, matching section 4.

The repair in this PR makes production match staging for the two registration columns.

## 5. Migration dependency assessment

- **`202605190900`** (this repair): no other migration depends on it. Its two columns are read by `registration-form.html`, `class-editor.html` and `classEditor.js` (writes `is_online`), `attendance-reminder/index.ts` and `teacher-portal-api/_actions/*` (`confirmed_start_date`, with fallback when absent). Nothing in the repo drops them.
- **`202605190930`** also adds `class_options.confirmed_start_date`, plus `attendance_log.session_status` with a CHECK constraint and index. It is **not** needed for the registration page. It is recorded as applied and absent. It is intentionally left out of this repair (section 8).
- `202605190900` and `202605190930` both use `IF NOT EXISTS`, so re-applying them is idempotent.

## 6. Risk and behaviour changes (what the repair changes in production)

| Area | Before repair | After repair | Assessment |
|---|---|---|---|
| Registration form class list | Fails (42703) | Lists the 13 open classes as in-person | **Intended.** Re-enables public registrations. Real applicant rows and emails follow. Requires operational readiness (section 9). |
| Admin class editor save | Fails: it writes `is_online` on every save | Works | Intended fix. |
| Teacher first attendance submission | Uses fallback path (column missing) | Writes `confirmed_start_date` on first submission, as designed | Behaviour change to the designed path. Verify with a teacher account before or after cutover. |
| `attendance-reminder` | Not scheduled in production (no `attendance-reminder-daily` cron job) | Unchanged | Not affected. Its function selects `confirmed_start_date` and would stop erroring if invoked. |
| Existing rows | - | `is_online = false`, `confirmed_start_date = NULL` | Matches the code's meaning of "in-person by default" and "not yet confirmed". |
| Locking | - | Metadata-only change (constant default, PostgreSQL 11+). 13 rows. | Negligible lock window. |
| RLS, functions, triggers, indexes | - | Unchanged | No authorization change. |

## 7. Isolated-database test

**Test environment:** PGlite (PostgreSQL engine compiled to WebAssembly, in process), not Docker. Docker Desktop was not running, and this machine's Docker configuration was not changed. Limitations: not Supabase's Postgres 17 instance, no `auth` schema, no `pg_cron`, and a synthetic schema subset.

**Schema:** `public.class_options` with the production column names, types and defaults, minus the two repaired columns. RLS enabled with one admin-style policy (the policy count is checked unchanged).

**Data:** 12 synthetic rows (`CO-T001`…`CO-T012`, names such as "Test Teacher 1"). No real data.

| # | Check | Result |
|---|---|---|
| 1 | Seed loaded | PASS |
| 2 | Reproduce failure: registration query fails before repair | PASS (`column "is_online" does not exist`) |
| 3 | Apply repair migration | PASS |
| 4 | Registration query returns open classes (7 of 12, matching the open-filter count) | PASS |
| 5 | Existing rows: `is_online = false` | PASS |
| 6 | Existing rows: `confirmed_start_date IS NULL` | PASS |
| 7 | Existing columns and row count unchanged (checksum) | PASS |
| 8 | Second run of the migration succeeds (idempotent) | PASS |
| 9 | No data change after second run | PASS |
| 10 | Class-editor style `UPDATE` of both columns | PASS |
| 11 | Updated values persist | PASS |
| 12 | `is_online` NOT NULL enforced | PASS |
| 13 | New row without the columns gets defaults | PASS |
| 14 | RLS policies unchanged (count 1) | PASS |
| 15 | Rollback statement executes | PASS |
| 16 | After rollback, registration query fails again (pre-repair state restored) | PASS |
| 17 | Re-apply after rollback restores the query | PASS |

**Summary: 17 PASS, 0 FAIL, of 17.** The tests show the migration is correct and idempotent on the modelled schema. They do not prove behaviour on production data, because the production data was not read (only aggregate counts).

## 8. Out of scope for this repair (separate reviews required)

- `202605190930`: `attendance_log.session_status` and its constraint and index. Read with a fallback in `applicant-directory.js`, not written by any repo code path. Review separately.
- `202605191920`: waitlist `class_available` notify triggers and functions. Absent in production, so waitlisted applicants are not notified automatically. This is a registration workflow gap, to be fixed separately.
- `audit_logs.actor_id` and `audit_log_insert_redirect` trigger (`202605071800`): absent in production. CLAUDE.md lists this migration as a priority to apply. Audit canonicalization is therefore not in effect.
- `attendance_records` policies: production has `auth_read` and `auth_write` (from `202606160001` on `main`), which let any authenticated user read and write all rows. The teacher-scoped policies from `202605150000` are absent. This is a repo-level RLS weakness, not caused by drift.
- The 9 production-only migration versions (`202609231000`…`202610030004`) come from the C1 and C6 branches, which are not on `main`. C6 is not certified. These versions are recorded as applied in production and are not in the repo. See section 9, item 4.

## 9. Production rollout plan (requires separate approval)

**Preflight (read-only):**

```sql
-- P1: columns absent (expect 0 rows)
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'class_options'
  AND column_name IN ('is_online', 'confirmed_start_date');

-- P2: repair version not already recorded (expect 0 rows)
SELECT version FROM supabase_migrations.schema_migrations WHERE version = '202610220100';

-- P3: row snapshot checksum (record the value before the change)
SELECT count(*) AS rows, md5(string_agg(class_option_id || active::text || enrollment_open::text || coalesce(deleted_at::text, ''), ',' ORDER BY class_option_id)) AS checksum
FROM public.class_options;

-- P4: registration query currently fails (expect error 42703)
SELECT class_option_id FROM public.class_options WHERE active AND enrollment_open AND deleted_at IS NULL LIMIT 1;
```

**Procedure (after approval).** The authoritative operator checklist, with stop conditions, is `docs/REGISTRATION_REPAIR_EXECUTION_PACKAGE_2026-10-22.md` (PR #11). The steps below are the same, in brief.

1. **Confirm the link before any CLI command.** The CLI directory must contain `supabase/.temp/project-ref` with the value `xelpsttqhrcqmttmjory`. Stop otherwise. The repository is linked to staging and must never be used for production commands.
2. **Take a fresh encrypted backup immediately before execution** (`scripts/backup/backup-prod-logical.sh`, PR #9). Verify its checksum.
3. **Re-run P1–P4 from the production-linked directory.** P3 must equal the values recorded in the approval.
4. **Apply the migration text in one transaction.** Use the file content unchanged, between `BEGIN;` and `COMMIT;`, with the validation block in PR #11, step S4.
5. **Record the history row** (section 15), only after step 4 commits and V1–V4 pass.
6. **Run V1–V4.**
7. **Load the registration form** (unauthenticated) and confirm the class list renders. Do not submit a registration.

**P3 (checksum of the original columns; record before the change; harness definition):**

```sql
SELECT count(*) AS rows, md5(string_agg(row_to_json(x)::text, '|' ORDER BY class_option_id)) AS checksum
FROM (SELECT class_option_id, class_id, teacher_id, teacher_name, fellowship_codes, group_id, subgroup_id, day, class_time,
             active, enrollment_open, max_capacity, label_suffix, deleted_at, created_by, updated_by, created_at, updated_at
      FROM public.class_options) x;
```

Expected on 2026-10-22: 13 rows, checksum `e5037229c4c14e479fa2fd738fe66b48`. The checksum includes `updated_at`, so it changes if any row is updated; that is a stop condition.

**Validation (read-only):**

```sql
-- V1: columns present with the expected types and defaults
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'class_options' AND column_name IN ('is_online', 'confirmed_start_date');
-- expect: is_online boolean NO false ; confirmed_start_date date YES NULL

-- V2: no NULL is_online
SELECT count(*) FROM public.class_options WHERE is_online IS NULL;  -- expect 0

-- V3: the P3 checksum is unchanged (the repair must not change existing values)
-- run the P3 query above; expect 13 rows and e5037229c4c14e479fa2fd738fe66b48

-- V4: registration filter returns the open classes
SELECT count(*) FROM public.class_options WHERE active = true AND enrollment_open = true AND deleted_at IS NULL;  -- expect 13
```

**Rollback:** `supabase/ops/202610220100_rollback_class_options_repair.sql`. Read section 12 (rollback conditions and data loss) before any use. It refuses to run unless the operator sets three session settings and confirms the export row count (section 12.2). It is not part of `supabase/migrations/`, so `supabase db push` never runs it. Removing the history row is a separate step (section 11).

**Operational readiness before cutover:** the registration form will accept applications again. Confirm the notification and email queues are running, and that the admin team is ready to handle new applicant rows.

**Other prerequisites:** approval for the production SQL and for the history row. This branch's PR must be reviewed and merged to `main` first, so the repo reflects production.

## 10. GO / NO-GO

- **Production SQL: NO-GO** until the owner separately authorizes execution. It is not authorized by this PR.
- Conditions to lift the NO-GO, all required: (a) a verified logical backup and a restore rehearsal (sections 12–13); (b) the preflight queries in section 9 pass on production, read by the owner; (c) the owner approves the exact DDL `202610220100` and the history-recording method (section 11); (d) PR #6 is reviewed and merged by the owner, and no other production change is bundled with it.
- **GO** (after those conditions) for production execution of **this exact DDL only**, following section 9.
- **NO-GO** for applying the other 60 drifted objects, or the 9 remote-only C6 and C1 versions, in the same change. Each needs its own review.
- **NO-GO** for any SPA or C6 production change as part of this repair.

## 11. Evidence summary

- Production catalog reads: read-only SELECT statements through the Supabase CLI against project `xelpsttqhrcqmttmjory`, in read-only sessions. No writes.
- Isolated test (PGlite, earlier): 17 of 17 PASS (section 7). PGlite is not PostgreSQL 17; this result is superseded by the harness below.
- **Reproducible PostgreSQL 17 harness (in this PR):** `supabase/tests/class-options-repair/run.sh`. Results in section 14.
- Earlier production catalogue reads (the drift tables in sections 3 and 4) were read-only, through the CLI, in read-only sessions. They were not repeated for this PR, and they remain the reference for the drift classification.

## 12. Rollback: conditions, guards and data loss

### 12.1 When a rollback is allowed

Only when the repair itself causes a production failure and the owner decides to revert. A rollback is **not** the answer to:

- a re-run of the migration (it is idempotent);
- a history-row mismatch (resolve the history, do not drop columns);
- slow registrations or a single failed request.

### 12.2 Procedure (destructive; owner only)

1. **Export the post-repair values first.** Run in psql and store the file somewhere secure (not in the repo):

   ```sql
   \copy (SELECT class_option_id, is_online, confirmed_start_date FROM public.class_options WHERE is_online IS DISTINCT FROM false OR confirmed_start_date IS NOT NULL) TO 'class_options_post_repair_YYYYMMDD.csv' WITH (FORMAT csv, HEADER)
   ```

2. **Verify the export.** The data rows in the CSV must equal the count from `SELECT count(*) FROM public.class_options WHERE is_online IS DISTINCT FROM false OR confirmed_start_date IS NOT NULL`. Check the file is readable.
3. **Set the three session settings, in the same psql session, before the script:**

   ```sql
   SET rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS';
   SET rso.rollback_export_confirmed = 'yes';
   SET rso.rollback_expected_rows = '<N>';   -- N = verified export row count (may be 0)
   ```

4. **Run** `supabase/ops/202610220100_rollback_class_options_repair.sql` with `-f`.

The script refuses (and changes nothing) unless every guard passes:

| Guard | Refuses when |
|---|---|
| Authorization | `rso.rollback_authorization` is not exactly `DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS` |
| Export confirmation | `rso.rollback_export_confirmed` is not `yes` |
| Expected count | `rso.rollback_expected_rows` is not set |
| Repaired state | either column is missing (the state is not the repaired one) |
| Count match | the live count of rows with post-repair values differs from `rso.rollback_expected_rows` |

The drop runs in one transaction, after all guards pass. A failure rolls the whole transaction back.

### 12.3 Potential data loss

Dropping the columns deletes every post-repair value of `is_online` and `confirmed_start_date`. **The export file is the only copy.** The rollback does not keep the values in the database.

Re-applying the migration afterwards restores the columns with the defaults (`is_online = false`, `confirmed_start_date = NULL`). It does **not** restore the exported values. If they are needed, the owner must restore them from the CSV with a reviewed `UPDATE`, after the re-apply.

### 12.4 What a rollback leaves behind

- The registration form fails again with 42703 (the pre-repair state).
- `supabase_migrations.schema_migrations` still records `202610220100`. Remove that row only with separate approval (section 15), or the history will claim a state the database no longer has. That mismatch is the same pattern that caused this incident.

## 13. Backup prerequisites and Free-plan limits

- The production project `foundation-school` (`xelpsttqhrcqmttmjory`) is on the **Supabase Free plan**. The dashboard states that the Free plan does not include managed project backups, and it offers no point-in-time recovery.
- **The only recovery path for production is a logical backup that the owner takes and stores.** Supabase cannot restore production from its own backups.
- A rollback script is not a backup. It drops columns; it does not preserve data.
- Before any production SQL, the owner must have: (a) a logical backup of the relevant schema and data, (b) confirmation it is readable, and (c) a successful restore rehearsal into an isolated database. The single authoritative procedure is `docs/PRODUCTION_BACKUP_AND_RECOVERY_2026-10-22.md` with `scripts/backup/backup-prod-logical.sh` (PR #9). It must merge before, or with, this PR.
- Recovery limitation: without a verified backup, a bad repair or a bad rollback on production cannot be undone by the platform.

## 14. Test evidence: PostgreSQL 17 harness

Command (from the repository root, with PostgreSQL 17 installed):

```bash
PG_BIN="/c/Program Files/PostgreSQL/17/bin" bash supabase/tests/class-options-repair/run.sh
```

The harness creates a throwaway cluster in a temp directory on a private port, loads synthetic data only (13 open class options), replays the repo's forward migration file and rollback file, and deletes the cluster at the end. It does not read or write any real database.

**Result on 2026-10-22, PostgreSQL 17.11, Windows, synthetic data: 30 passed, 0 failed.**

Reproduced by the reviewer on 2026-10-22 at head `5a893ce0`, with PostgreSQL 17.6 binaries (`PG_BIN` set to a 17.6 bin directory): **30 passed, 0 failed**. The backup-tooling harness (`backup_rehearsal.sh`) also passed 12 of 12 with the PostgreSQL 17.6 `pg_dump`.

| Area | Checks | Result |
|---|---|---|
| Registration query fails before repair | 1 | PASS (42703) |
| Forward migration applies; registration query succeeds (anon) | 2 | PASS (13 rows) |
| Original class-option values unchanged (checksum over the original columns) | 2 | PASS |
| Defaults on existing rows (`is_online = false`, `confirmed_start_date NULL`) | 3 | PASS |
| Idempotent re-apply; values unchanged | 2 | PASS |
| Admin writes under the representative policy (update, visible read-back, insert) | 3 | PASS |
| Teacher (non-admin) write denied under the representative policy | 1 | PASS |
| `NOT NULL` on `is_online` enforced | 1 | PASS |
| Attendance read of `confirmed_start_date` | 1 | PASS |
| Rollback refused: no authorization, no export confirmation, no expected count, count mismatch | 4 | PASS |
| Refused rollback leaves the post-repair value in place | 1 | PASS |
| Authorized rollback with matching count succeeds; columns gone; values unchanged | 3 | PASS |
| Registration query fails again after rollback | 1 | PASS |
| Rollback refused when columns are already absent | 1 | PASS |
| Re-apply after rollback; registration query succeeds; values unchanged | 3 | PASS |

**Limits.**
- The RLS policies in the harness are **representative**, written for the test. They are not a copy of production policies, so production admin writes are not proven by this harness.
- The harness runs SQL directly. It does not test PostgREST, the registration form in a browser, or the Edge Functions.
- CI does not run this harness. It needs a local PostgreSQL 17 installation. Adding it to CI is a separate change.

## 15. Migration-history recording (corrected 2026-10-22)

- **Before:** 159 rows in `supabase_migrations.schema_migrations`, including `202605190900` and `202605190930`.
- **Expected after execution:** 160 rows. One new row: version `202610220100`, name `repair_class_options_registration_columns`. No other row changes.
- **Target rule (mandatory):** every history command runs from a directory whose `supabase/.temp/project-ref` equals `xelpsttqhrcqmttmjory`. **Never** run it from the repository. The repository is linked to **staging** (`hblahcaozlttknkzvkib`), so a command run there would change staging, not production. The earlier wording "run from the repo against project `xelpsttqhrcqmttmjory`" was wrong and is withdrawn.
- **Method A (preferred):** `supabase migration repair --status applied 202610220100 --linked`, from the production-linked directory, only after the DDL transaction has committed and V1–V4 pass. Stop if the command reports any other version or an error.
- **Method B (fallback only; needs its own approval):** insert the row inside the same transaction as the DDL, with the same version and name, and statements equal to the file text.
- **Never:** edit, delete or re-order `202605190900` or `202605190930`, and never mark any version reverted as part of this repair.
- **Verification after recording:** count is 160; the three versions `202605190900`, `202605190930` and `202610220100` are present; no other row changed.
- **Removing the row (rollback only):** a separate step with its own approval (section 12.4).

## 16. Scope of this PR

- The forward migration file `supabase/migrations/202610220100_repair_class_options_registration_columns.sql` is **unchanged** from the reviewed version.
- Added: the rollback (`supabase/ops/`), the harness (`supabase/tests/class-options-repair/`), a pointer to the single backup runbook (`docs/PRODUCTION_BACKUP_AND_RECOVERY_2026-10-22.md`, PR #9), and this runbook update.
- Not in this PR: any drift repair beyond the two columns, any C6, SPA or other migration change, any production action.
