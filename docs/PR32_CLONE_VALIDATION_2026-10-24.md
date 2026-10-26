# PR #32 isolated clone validation, 2026-10-24

Scope: validation on a disposable local clone only. No live staging or production writes. No migration-history edits on any live project. Staging was read with SELECT-only queries (history rows, migration text) and a schema-free check. No student data was copied.

## 1. Clone construction and its limits

- Local Postgres 18, database `clone_pr32`. Built from the origin/main migration lineage plus the nine C1/C6 migrations (replay), then the 159 staging history rows were seeded. Seeded rows are migration text and metadata only.
- **Not a byte copy of staging.** `supabase db dump` needs Docker, which is unreachable here. The clone's public schema is the repository's replayed schema. Known staging drift from the 2026-10-22 inventory is not reproduced, so the clone is a close approximation, not a replica.
- The audit_logs pre-state on the clone matches the staging pre-state read on 2026-10-24: `anon`, `authenticated`, `postgres` and `service_role` hold the full privilege set; policies `audit_log_admin_all` and `audit_logs_admin_all`; no triggers.
- PostgREST and GoTrue are not available locally, so HTTP status codes and JWT verification are not exercised.

## 2. History-format compatibility

- Seeded history matches staging: 159 rows, max `202610030004`.
- Wrapper result: one row `20261024120000 | audit_provenance_guard | 1 element`.
- The `statements` element is the full migration file as one text value, which is the single-element form already used by `202609231000`. The split form used by `202610030004` is equally valid for this CLI's table shape. The choice is recorded as a residual risk.
- Future listing: `supabase migration list --linked` compares local files with remote history by version. Version `20261024120000` will be listed as applied on both sides once the row exists. The CLI's own parser of `statements` was not exercised (no CLI run against the clone).
- Pre-existing gaps are unchanged: `202610220100` is local-only and must not be applied; `supabase db push` would attempt it. The procedure does not use `db push`.

## 3. Concurrency, duplicate protection, rollback

| Scenario | Result (clone) |
|---|---|
| Apply wrapper once | exit 0; policies `audit_logs_insert_admin_nonprovenance` and `audit_logs_select_admin`; `authenticated` = `INSERT,SELECT`; both triggers `O`; history 160 |
| Apply again | exit 3, `PR32_PRECHECK` raised; history still 160 |
| Forced error mid-body (local dry run, earlier) | no history row, no new policy, `anon` SELECT intact |
| Concurrent second session | not tested. Protection rests on the primary key on `version` and the precheck. Two sessions racing would serialize on the insert: the second blocks, then fails the key. Not separately demonstrated. |

Transactional rollback: any error stops psql with `ON_ERROR_STOP=1`. The server rolls back the open transaction when the connection ends. A dropped connection before `commit` also rolls back.

## 4. Guard regression (24 checks), clone

- `supabase/tests/security/audit-logs-privilege-guard.sql` on `clone_pr32` (after the wrapper): **24 PASS, exit 0**. History count unchanged at 160 after the run (the test rolls back).
- Earlier negative control on an unguarded clone: fails at the first privilege check.

## 5. Wave1 on the clone

- **Full Wave1 not run.** It needs PostgREST, GoTrue and the service and anon keys. None is available locally.
- **Partial: Wave1 Suite 4 (audit RLS) emulated in SQL**, as the `authenticated` role with a synthetic JWT subject, inside a rolled-back transaction:

| Check | pending | teacher | admin | superadmin |
|---|---|---|---|---|
| SELECT rows visible | 0 | 0 | 3 | 3 |
| INSERT | denied (RLS) | denied (RLS) | allowed | allowed |
| UPDATE | denied (no grant) | denied | denied | denied |
| DELETE | denied (no grant) | denied | denied | denied |

These match the post-PR #32 contract that `wave1-regression.ts` now expects. Suites 1 to 3 (ACL state, teacher RPC, graduation RPC) were not emulated. The RPCs `admin_create_teacher_direct` is absent on the clone; `override_graduation_eligibility` is present.
- Residue after the emulation: none (rolled back). Clone residue check for `w1reg-`, `w1emu-` and `W1REG` returned zero everywhere.

## 6. Wave1 cleanup assessment (live staging, not run)

Findings from `supabase/tests/security/wave1-regression.ts`:

1. **Identity cleanup is in `finally`** and deletes the four auth users. Profiles cascade on delete (verified on the clone: `profiles.user_id` references `auth.users(id) ON DELETE CASCADE`).
2. **Teacher rows are cleaned only on the happy path**, and only when the row count increased, by exact email `w1reg-teacher-<TS>@invalid.local`. A throw between the RPC and the cleanup leaves the row.
3. **Graduation fixtures are cleaned at the end of the suite, not in `finally`**: `batches` `w1reg-batch-<TS>`, `applicants` `w1reg-app-<TS>@invalid.local`, and `graduation_eligibility` rows, which are deleted per case only when the count increased.
4. **Audit seed `W1REG_SEED` is deleted at the end of the suite**, not in `finally`. Per-role `W1REG_INSERT_*`, `W1REG_UPD_SEED` and `W1REG_DEL_SEED` rows are removed in the loop.
5. **No pre-run sweep.** A previous failed run's residue is not detected before a new run.

## 7. Disposable test-data strategy (proposed, not implemented here)

- Run Wave1 only against a disposable clone or branch of staging, never against live staging.
- Put every fixture under one run tag (`TS`) and make cleanup a single owner-session sweep in `finally`, keyed by prefix: `auth.users` where `email like 'w1reg-%@invalid.local'`; `public.teachers`, `public.applicants` where `email like 'w1reg-%'`; `public.batches` where `batch_id like 'w1reg-%'`; `public.graduation_eligibility` where `batch_id like 'w1reg-%'`; `public.audit_logs` where `action like 'W1REG%'`.
- Before the run: the same sweep in dry-run mode, counting matches. Expect zero. Any non-zero count stops the run.
- After the run: the sweep, and a residue report. Non-zero stops the run and is reported.

## 8. Final pre-application checklist

| Item | Status |
|---|---|
| Wrapper dry run on clone (success, duplicate abort, forced rollback) | Done |
| Guard regression 24/24 on clone | Done |
| Wave1 full run | Not possible locally |
| Wave1 Suite 4 emulation | Done, matches contract |
| Wave1 cleanup corrected and tested | Proposed; not implemented |
| Production audit_logs pre-state read (peer report) | Read by another session: one policy, 62,268 rows. The migration drops both names with `IF EXISTS`, so it is compatible |
| Owner: A1 (live apply) | **Not authorized** |
| Owner: A2 (exact atomic SQL) | Conditionally accepted; history compatibility reviewed here |
| Owner: A3 (live Wave1) | **Not authorized** |
| Staging history tail = `202610030004`, 159 rows | Verified 2026-10-24; re-check on apply day |
| Reserved version 20261024120000 | Reserved for PR #32 |

## 9. Recommendation

- **A1 (live apply): NO-GO for now.** Owner approval absent. Blocked on the items below.
- **A2 (atomic SQL): GO on the design.** Dry runs pass. Approval of the exact SQL remains the owner's.
- **Blockers for a later GO:** owner A1 approval; A3 decision with the corrected cleanup in place; re-check of the staging history tail on apply day; decision on the `statements` form; confirmation that `202610220100` stays out of scope.

## 10. Residual risks

- Clone is an approximation of staging, not a replica (no Docker, so no `pg_dump`).
- Wave1 suites 1 to 3 and the HTTP and JWT layer are unverified.
- The `statements` single-element form differs from the split form of `202610030004`.
- A future `supabase db push` would attempt `202610220100`.
- Production has not been changed and its audit_logs state was read by another session, not this one.
