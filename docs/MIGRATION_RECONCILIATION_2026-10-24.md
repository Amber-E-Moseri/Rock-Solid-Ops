# Migration reconciliation: nine remote-recorded versions and PR #32 apply path

Status: PLAN ONLY. No SQL was applied to any database. No migration history was changed.
Owner gate: PR #32 stays DRAFT / HOLD for staging application and merge.

## 1. The nine versions

Source: `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md` section 8 (recorded as applied in production; staging history also ends at `202610030004`).

| Version | Repo file | Introduced by | Where the file exists (refs checked) |
|---|---|---|---|
| 202609231000 | `202609231000_moodle_sync_next_retry_at.sql` | `4bc6c0e` (Moodle sync) | local `main`, `origin/integration/c6-edge-security`, several briefs. NOT `origin/main` |
| 202609231100 | `202609231100_failed_syncs_contract.sql` | `31f7391` | local `main`, `origin/integration/c6-edge-security`. NOT `origin/main` |
| 202609231200 | `202609231200_notification_batch_safe_claim.sql` | `5297320` (C1) | local `main`, `origin/integration/c6-edge-security`. NOT `origin/main` |
| 202609240001 | `202609240001_rocksolid_atomic_nexus_claim.sql` | `ce730d3` (C6) | `origin/integration/c6-edge-security` only |
| 202609240002 | `202609240002_atomic_claim_hardening.sql` | `ce730d3` (C6) | `origin/integration/c6-edge-security` only |
| 202610030001 | `202610030001_nexus_task_reconciliation.sql` | `8312718` (C6) | `origin/integration/c6-edge-security` only |
| 202610030002 | `202610030002_claim_nexus_task_conflict_safe.sql` | `70849be` (C6) | `origin/integration/c6-edge-security` only |
| 202610030003 | `202610030003_rocksolid_task_links_created_requires_id.sql` | `e68c22a` (C6) | `origin/integration/c6-edge-security` only |
| 202610030004 | `202610030004_claim_nexus_task_assignee_rejected_terminal.sql` | `59d16cb` (C6) | `origin/integration/c6-edge-security` only |

Findings:
- Local `main` is 22 commits ahead of `origin/main` and 73 behind it. Local `main` carries the first three versions. `origin/main` carries none of the nine. The 22 local-only commits are unpushed.
- Blob content matches across refs for the files that were compared. `ce730d3` and `origin/integration/c6-edge-security` have identical content for `202609240001` and `202609240002`, although the branch's last-touch commit for those files is a different hash (`02cbbe5`, `8593991`).
- Schema replay: all nine files apply cleanly, in version order, on a throwaway copy of the `origin/main` migration lineage (local Postgres 18, shim as in `supabase/tests/security/replay/`). This shows they are compatible with the lineage. It does not prove they match what production or staging ran.

## 2. Checksums and deployed state: what can and cannot be verified

Not verifiable from this session:
- No DB access to staging or production from here. No credentials were used or requested.
- The repository stores no file checksums for applied migrations. `docs/migration-log.md` and the drift inventory contain no checksum values.
- Supabase's `supabase_migrations.schema_migrations` records version and name. Depending on CLI version it may also keep a `statements` column. Whether the stored statements match a file must be checked by the owner or an authorized operator with a read-only query.

Verifiable by read-only queries (to be run by an authorized operator, not by an agent):
1. Version list: `select version, name from supabase_migrations.schema_migrations where version >= '202609231000' order by version;` Expect the nine versions and nothing after `202610030004` other than what the owner knows about.
2. Statement digest, if the column exists: `select version, md5(array_to_string(statements, E'\n')) from supabase_migrations.schema_migrations where version in (...);` Compare with the same digest computed over the file text, normalised for line endings and the CLI's statement split. Any mismatch blocks reconciliation for that version.
3. Schema effects (catalog only, read-only): existence of `public.failed_syncs` and its `updated_at` column; `public.claim_nexus_task(text,text,text,uuid)` and its EXECUTE grants (no PUBLIC, no anon, no authenticated, service_role yes); `public.claim_notification_batch(integer)`; `public.rocksolid_task_links` columns and indexes named in files 1 and 6; `email_queue_source_notification_uq`.

Run the same queries on staging and production and keep the output as evidence. Do not copy production data.

## 3. Reconciliation method (no replay, no rollback, no history edit)

Principle: the nine versions are already recorded as applied. Reconciliation means making the repository match the recorded history, not re-running the SQL.

Proposed steps (each needs owner approval before execution):
1. Confirm content. Use the section 2 digest check. If a version's stored statements do not match the file, stop for that version and get a decision. Do not edit the file to fit.
2. Land the nine files verbatim, unchanged, with their existing version names, on a dedicated history-only branch off `origin/main`. Source the content from `origin/integration/c6-edge-security` and local `main` only where the bytes match (section 1). Do not rename, merge or edit.
3. Add a `docs/migration-log.md` entry marking each version "recorded applied, repo file added, not re-executed".
4. Do not run `supabase db push`. With the nine files present, the CLI should see them as known, but confirm with `supabase migration list` in a throwaway clone first, and only after the owner has approved that check.
5. Decide separately what happens to the C1 and C6 code those files support. That work stays out of this PR and out of this reconciliation.

Why not replay: several files use `CREATE OR REPLACE FUNCTION` and `REVOKE/GRANT`. Re-running them could change live grants or function bodies that have since moved on. Why not roll back: the rollback would remove objects that the production C1 and C6 paths may depend on.

## 4. Applying only PR #32's guard

PR #32 adds exactly one migration, `20261024120000_audit_provenance_guard.sql`. Do not use `supabase db push`. Its version is newer than all remote versions, so a push would also consider anything local and missing, including the nine files until reconciliation.

Owner-authorized apply procedure (not to be executed now):
1. Preconditions:
   - Section 2 checks done on the target. Remote list ends at `202610030004`.
   - Target is the single database named in the owner's authorization. No other target.
   - Pre-state captured: ACL, policies, and triggers on `public.audit_logs` (the query set in `docs/AUDIT_LOGS_GUARD_RECOVERY.md` section 1). Save the output.
   - PR #14 (`20261022120000`) is not applied to the target, or the owner explicitly approves that ordering. Order does not conflict, but the owner should know.
   - Replay test passes against a fresh clone of the target's schema, if one is available.
2. Apply only the file, in one transaction: `psql -X -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261024120000_audit_provenance_guard.sql` against the approved target.
3. Run `supabase/tests/security/audit-logs-privilege-guard.sql` against the same target inside a rolled-back transaction. Expect 24 PASS.
4. Record the version in migration history only under a separate, approved procedure. Until then, the repository and remote history will disagree on this version. Record that in the migration log.
5. Post-apply capture: same queries as the pre-state.

Recovery: `docs/AUDIT_LOGS_GUARD_RECOVERY.md`. No automatic rollback.

## 5. Blockers

| # | Blocker | Owner |
|---|---|---|
| B1 | Stored checksum or statement digests for the nine versions not yet checked against the files | Operator with read-only access |
| B2 | Local `main` has 22 unpushed commits, including three of the nine files | Release owner |
| B3 | Six C6 files exist only on `origin/integration/c6-edge-security`, which is not certified | Release owner |
| B4 | Decision on whether reconciliation is a history-only PR, and whether it is merged before PR #32 | Owner |
| B5 | Migration-history record method for `20261024120000` | Owner, separate approval |
| B6 | `wave1-regression.ts` not run against a live project | Operator |
| B7 | Dormant `audit_log_insert_redirect()` (SECURITY INVOKER writer on `audit_logs`) to be removed in a later cleanup | Owner |

## 6. Next owner decision

Authorize one read-only verification pass on staging and production, limited to the section 2 queries, run by an authorized operator. Results come back here and decide whether step 3 of section 3 can go ahead.
