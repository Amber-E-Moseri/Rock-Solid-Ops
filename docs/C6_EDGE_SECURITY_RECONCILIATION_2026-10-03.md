# C6 + Edge Security Reconciliation — 2026-10-03

**Status: NOT PRODUCTION CERTIFIED. NOT MERGED. NOT PUSHED.** Integration branch
`integration/c6-edge-security` exists locally only. Database, Supabase and deployment gates
have not been executed (see [Blocked gates](#blocked-gates)).

## 1. Reference SHAs

| Ref | SHA |
|---|---|
| `origin/main` | `8b9e14ed5121aa4273c06e28a1db4ffbb40a0699` |
| `origin/brief/c6-atomic-claim-clean` | `1e8a11508076a6d9aed3dcc7f908db241d7ae3dc` |
| `origin/brief/c6-timeout-hardening` | `85939917b7fea945707f724f52bb95ce39a140b7` |
| `origin/audit/edge-functions-baseline` | `d9b3e66f65285c086982876012640e843abeaba8` |
| `origin/cleanup-review` | `b612a82c2d77c2961fc111b1317fdf77865a51c4` |
| `integration/c6-edge-security` (base) | `85939917b7fea945707f724f52bb95ce39a140b7` (= timeout-hardening) |

## 2. Branch ancestry

```
main 8b9e14e ─┬─ ce730d3 ─ 1e8a115                       brief/c6-atomic-claim-clean   (+2 over main)
              │
              ├─ 31 commits ─ … ─ 8593991               brief/c6-timeout-hardening    (+31 over main)
              │                      └─ f0a83b9 ─ dbb799d ─ 9f0dcdc ─ c8df977 ─ ccdcf42 ─ 22a9038 ─ (docs)
              │                                                                         integration/c6-edge-security
              └─ 0be765a ─ 6e23198 ─ 9a7e512 ─ a6ee4c5 ─ 849d476 ─ f488b54 ─ aeac841 ─ d9b3e66
                                                                                      audit/edge-functions-baseline (+8)

cleanup-review b612a82   — UNRELATED HISTORY: no merge-base with main or any branch above.
```

Findings (verified with `git merge-base`, `git rev-list --left-right --count`, `git cherry`):

1. `brief/c6-atomic-claim-clean` is based on **current** `main` (merge-base = `8b9e14e`, 0 behind).
2. `brief/c6-timeout-hardening` is **not** descended from atomic-claim. Both fork directly from
   `main`. `git merge-base --is-ancestor` atomic→timeout is false.
3. Timeout-hardening does not contain atomic-claim's *commits*, but contains atomic-claim's
   *content*: of the 19 files atomic-claim changes, 15 are byte-identical in timeout-hardening,
   and the 4 that differ (`migration-log.md`, `config.toml`, `webpush.test.ts`, `retry-worker/index.ts`) do so only as described below.
4. Neither C6 branch descends from another historical C6 branch.
5. `cleanup-review` is the May 2026 history (Apps Script archive, Moodle MVP, retry-worker v1).
   It shares no ancestor with `main`. It contains **no** C6 work and is unrelated.

## 3. Authoritative C6 branch

**`brief/c6-timeout-hardening` is authoritative and supersedes `brief/c6-atomic-claim-clean`.**

Atomic-claim's own migration-log entry says it is a "PR branch" cut *from* timeout-hardening
("Source branch: `brief/c6-timeout-hardening`"). The two branches were not combined; only the one
atomic-claim change timeout-hardening lacked was brought across (§4):

| Atomic-claim commit | Disposition |
|---|---|
| `ce730d3` harden atomic Nexus task claims | **SUPERSEDED**: every source/migration/test file is identical in timeout-hardening. Its `docs/migration-log.md` C6 certification entry was **manually ported** (timeout-hardening lacked it). |
| `1e8a115` remove filesystem dependency from webpush tests | **CHERRY-PICKED** → `f0a83b9`. Timeout-hardening's `webpush.test.ts` calls `Deno.readTextFile`, which `scripts/test-unit.sh` (no `--allow-read`) forbids; baseline showed that file failing to load. |

Residual differences, all in timeout-hardening's favour: `supabase/config.toml` (+20 lines
registering functions), `retry-worker` `next_retry_at: null` (Moodle backoff reset, C3B), and a
larger migration log.

## 4. C6 preservation

Was the "local-only" C6 work already on GitHub? **Largely yes.** `brief/c6-timeout-hardening`
holds a complete C6 implementation. Whether it is *identical* to the local copy cannot be
determined from GitHub; that comparison is still owed (§8). Nothing here rebuilt C6.

Classification is from reading the implementation, not commit messages.

| Capability | Status | Source commit(s) | Final implementation | Tests | Result |
|---|---|---|---|---|---|
| Atomic Nexus task claim | **PRESENT** (DB behaviour unverified here) | `02cbbe5`, `aa0b540`, normalized `8593991` | `claim_nexus_task()` RPC, `202609240001`/`…0002`; `SELECT … FOR UPDATE`, claim_token/claimed_at, 2-min TTL; unique `dedupe_key` backs first-insert races | `nexus-tasks.test.ts` (19), `nexus-idempotency.test.ts` (8): mostly **source-inspection** + mocked client | Edge-side tests pass. SQL semantics: **BLOCKED**; prior Neon certification in log is carried forward, not re-run |
| Concurrency safety | **PRESENT (design) / UNVERIFIED (runtime)** | `5297320`/`9c653e7` (C1 SKIP LOCKED), `02cbbe5` | RPC row lock + unique key; losers get `is_owner=false` or a unique-violation → non-fatal error, no POST | `skip_locked_concurrency.test.sh` needs two live psql sessions | **BLOCKED** |
| Duplicate prevention / idempotency | **PRESENT, Nexus-side contract UNCERTAIN** | `84e61a6` | `external_unique_key = rocksolid:<dedupe_key>` sent on every POST; atomic claim before POST; reuse of stored `nexus_task_id` | `nexus-idempotency.test.ts` I01–I06 | Pass. **Whether real Nexus honours `external_unique_key` is unverified** (Nexus repo not reachable); if it does not, FAILED/stale-claim re-POSTs can duplicate |
| TIMEOUT_UNKNOWN persistence | **PRESENT** | `9957498`, `d5b5806`, normalized `8593991` | timeout (abort/"timeout" in error text) → status `TIMEOUT_UNKNOWN`; RPC returns `is_owner=false` for it unconditionally (before stale-claim logic) | ID11/ID12, NT03/NT07 | Pass (edge side); RPC branch **BLOCKED** |
| Reconciliation | **ABSENT** | — | No code resolves a `TIMEOUT_UNKNOWN` row (no lookup of Nexus by key). Only exit is a manual DB update | none | **Gap.** A timed-out task is permanently un-retried and un-linked |
| Stale claims | **PRESENT** | `02cbbe5` | RPC Case D: claim older than 2 min (non-TIMEOUT_UNKNOWN) is re-claimable | covered only by prior Neon run | **BLOCKED** |
| Nexus API contract | **PARTIAL** | `1e1b9ca` | `POST {NEXUS_API_URL}/tasks`, `Authorization: Bearer NEXUS_API_KEY`, body `{name,description,due_date,priority,assignees,list_id,space_id,external_unique_key}`; id from `response.id` | NT01–NT07 against mocks | Contract is **assumed**, not verified against Nexus |
| Nexus authentication | **PRESENT** | `1e1b9ca` | bearer API key from env; fails closed (`FAILED`, audit row) if unset | NT02 | Pass |
| Direct user assignment | **PRESENT, no Sprint/Team dependency** | `1e1b9ca` | `resolveAssignee()` → `rocksolid_admin_mappings.nexus_user_id` (subgroup, then group); fallback empty `assignees: []` | NT01 | Pass. No `sprint`/`team` reference anywhere in the Nexus path (grep-verified) |
| Separate Nexus task/user configuration | **PARTIAL** | — | `list_id`/`space_id` are hard-coded production-looking UUID defaults in `nexus-tasks.ts` (and duplicated in `clickup-sync`); not env-configurable by callers | — | Gap |
| Legacy ClickUp writer retirement | **PARTIAL** | `1e1b9ca`, `ba96aee` | `retry-worker` and `missed-class-detector` now use `ensureNexusTask`; **no in-repo caller of `clickup-sync` remains**. But `clickup-sync` is still a deployed endpoint with its own non-atomic path (select→upsert→POST, 5-attempt backoff loop, no `external_unique_key`) | NT09–NT12 are source-string checks | Gap: second, non-idempotent writer remains reachable by an admin or `x-internal-secret` caller |
| C6 tests | **PRESENT** | `d6aa240`, `ae0a30d` | see §7 | | Pass |
| C6 certification evidence | **PARTIAL** | `ce730d3` (log) | Preserved in `docs/migration-log.md` (ported). Neon PostgreSQL 17.11 7-case run + "76/76" claim | | **Carried forward, not re-executed** |

## 5. Security preservation (audit findings vs integration branch)

Key discovery: `brief/c6-timeout-hardening` already contains its own caller-auth hardening
(E1/E2: `48a9605`, `f8e5e15`, `848cfe2`, `_shared/auth.ts`) that the audit never saw, because the
audit was cut from `main` before it. The two schemes are **different contracts**:

| | Timeout-hardening (E1/E2) | Audit |
|---|---|---|
| Cron credential | `x-cron-secret` == `CRON_INVOKE_SECRET` | `Authorization: Bearer <service-role key>` |
| Internal credential | `x-internal-secret` == `INTERNAL_INVOKE_SECRET` | service-role key |
| Service-role key accepted? | **No** (explicitly tested) | Yes |
| Compare | SHA-256 + `timingSafeEqual` | byte `timingSafeEqual` |

The integration branch keeps the E1/E2 contract (it is the stricter, documented, already-tested
scheme) and does **not** also accept the service key for cron/internal paths. Cron-credential
migration is the deployment blocker in §6.

| Finding | Audit commit | Integration method | Regression test | Result |
|---|---|---|---|---|
| Shared caller-auth helper | `0be765a` | **CHERRY-PICKED** (`dbb799d`) | `caller-auth.test.ts` (8) | Pass. Used by class-selection only |
| **High** — `class-selection` `notify_waitlisted` trusts unsigned JWT `role=service_role` | `6e23198` | **MANUALLY RECONCILED** (`9f0dcdc`): class-selection hunk taken, `parseJwtClaims` deleted | `auth-regression.test.ts` | **Live gap on timeout-hardening, now fixed.** Mutation-checked: restoring the old code makes the forged-JWT test fail |
| **High** — `clickup-sync` trusts unsigned JWT claim | `6e23198` | **SUPERSEDED**: timeout-hardening already replaced it with `validateInternalAuth` and has no claim decoding. Hunk deliberately not applied | `clickup-sync/internal-auth.test.ts` (6) + regression suite | Pass |
| **Critical** — `retry-worker` treats headerless request as cron | `9a7e512` | **SUPERSEDED**: timeout-hardening requires `x-cron-secret`; no/other credentials → 401. Audit's bearer-service-key variant intentionally not applied | regression: no creds → 401, forged JWT → rejected, internal secret ≠ cron | Pass |
| **High** — `moodle-sync`, `moodle-grade-sync`, `waitlist-processor`, `student-engagement-monitor`, `attendance-reminder`, `review-checkin` unauthenticated | `a6ee4c5` | **SUPERSEDED**: all six guarded (cron secret, or verified staff session where the function also serves the UI) | regression suite (each: no creds → 401, forged JWT → rejected; cron-only: service key and wrong secret → 401) | Pass |
| **Medium** — `report-generator` cannot authenticate its own cron | `849d476` | **SUPERSEDED in code** (accepts `x-cron-secret` or admin session). See §6: the *deployed crons* still send a service key | regression suite | Pass; deployment gap in §6 |
| Handler-level auth regression suite | `f488b54`, `d9b3e66` | **CHERRY-PICKED** (`c8df977`, `ccdcf42`) then **MANUALLY RECONCILED** (`22a9038`) to the cron/internal contract; extended to email-sender, notification-batch-processor, missed-class-detector, attention-flag-push-sweep | `auth-regression.test.ts` (50) | Pass |
| Audit report + local-C6 checklist | `aeac841` | **MANUALLY RECONCILED**: report copied with a status banner; `LOCAL_C6_HANDOFF_CHECKLIST.md` **NOT APPLICABLE** (obsolete: C6 already on GitHub) | n/a | n/a |

## 6. Cron invocation (Phase 5) and the five remaining functions (Phase 6)

### Cron evidence

Repository evidence **proves** the following existing crons send `Authorization: Bearer
<SERVICE_ROLE_KEY>` and **do not** send `x-cron-secret` (`supabase/migrations/…`):

| Function | Migration | Jobs |
|---|---|---|
| review-checkin | `202605171200_cron_review_checkin.sql` | 1 |
| student-engagement-monitor | `202605170004_student_engagement_tracking.sql` | 1 |
| waitlist-processor | `202605180002_waitlist_processor.sql` | 1 |
| report-generator | `202605172100_report_crons.sql` | 4 |
| moodle-grade-sync | `202605171900_moodle_grade_sync_cron.sql` | 1 |
| attendance-reminder | `202605190950_attendance_reminder_cron.sql` | 1 |

Against the integration branch each of those would be rejected (401, or 500 if
`CRON_INVOKE_SECRET` is unset). **If the integration branch is deployed without re-creating
these pg_cron jobs, those sweeps and reports silently stop.** Re-point them; do not weaken the
guards. `supabase/functions/moodle-sync/CUTOVER_PLAN.md` documents the same migration for
`moodle-sync`; there is no equivalent plan for the six above.

`retry-worker`: **DEPLOYMENT VERIFICATION REQUIRED.** No cron definition exists in the repo
(`config.toml` `schedule = "0 * * * *"` is declarative; `docs/cron-jobs.md` says `*/20`;
CLAUDE.md says hourly). On `main` the handler treated *headerless* as cron, and a bearer service
key would have been sent to `auth.getUser()` and rejected, so the live job is most likely
headerless. It will be rejected after this change until it sends `x-cron-secret`. An in-repo
comment in `attention-flag-push-sweep` claimed retry-worker's cron used a bearer service key;
that is contradicted by `main`'s handler and was corrected (comment only).

Required change for every cron above (template; secrets come from Vault, never committed):

```sql
select cron.unschedule('<job-name>');
select cron.schedule('<job-name>', '<schedule>',
  $$select net.http_post(
      url     := 'https://<project-ref>.supabase.co/functions/v1/<function>',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-cron-secret', '<CRON_INVOKE_SECRET from Vault>'),
      body    := '{}'::jsonb)$$);
```

Also required: `CRON_INVOKE_SECRET` and `INTERNAL_INVOKE_SECRET` set (distinct values) in the
target project.

**Decision for the owner (not made here):** the audit's alternative, accepting the exact
service-role key as a cron credential, would keep the six existing crons working with no
cutover. It is a strong secret, but it contradicts the documented E1/E2 design
(`docs/security.md`, test `I5`) and widens what the service key is trusted for. Left as is.

### The five functions the audit did not guard

| Function | On integration branch | Actual caller | Classification | Before certification |
|---|---|---|---|---|
| `email-sender` | `x-cron-secret` | none in repo; `config.toml` `*/15` declarative | **AUTHENTICATED** · scheduler **UNKNOWN EXTERNAL** | confirm a pg_cron job exists and sends `x-cron-secret` |
| `notification-batch-processor` | `x-cron-secret` | none in repo; `config.toml` `0 9 * * *` declarative | **AUTHENTICATED** · scheduler **UNKNOWN EXTERNAL** | same |
| `missed-class-detector` | `x-cron-secret` | none in repo (docs: daily 02:15) | **AUTHENTICATED** · scheduler **UNKNOWN EXTERNAL** | same |
| `attention-flag-push-sweep` | `x-cron-secret` | none in repo; migration-log says "schedule on pg_cron" as a todo | **AUTHENTICATED** · scheduler **UNKNOWN EXTERNAL** (possibly **NOT ACTIVE**) | confirm whether scheduled at all |
| `notification-dispatcher` | **none**: service-role client, `verify_jwt=false`, no handler guard | none in repo; docs call it "dead machinery"; still in `scripts/deploy-functions.sh` | **UNAUTHENTICATED** and probably **LEGACY / NOT ACTIVE** | **Open (Medium).** Anyone can invoke it; it reads ≤200 `notification_events` and inserts `scheduled_notifications` (unique-keyed, so idempotent). No known caller, so a guard cannot break any caller found in the repo, but an external one is unprovable. Recommend `validateCronAuth` or removing it from the deploy list: owner's call |

## 7. Tests (Phase 10)

Environment: Deno 2.9.6 (installed via npm), Node 22. `esm.sh` is denied by the sandbox proxy
(403), so Deno ran with an **uncommitted** import map pointing
`https://esm.sh/@supabase/supabase-js@2` at `npm:@supabase/supabase-js@2`. CI has open network and
needs no map. `scripts/test-unit.sh` itself was therefore not executed end to end; its Deno
files were run directly (every `*.test.ts` under `supabase/`, per file, with env/net/read).

| Suite | Passed | Failed | Skipped | Blocked |
|---|---|---|---|---|
| Deno unit/behaviour, 32 files (incl. auth regression 50, caller-auth 8, auth 20, e2-wave1 15, e2-wave2 19, nexus-tasks 19, nexus-idempotency 8, timeout suites 16, moodle-sync 49, notification-batch-processor 24, registration 50) | **391** | 0 | 0 | |
| Deno: `nexus-users-search/nexus-upstream.test.ts` | | | | **1 file**: needs `LOCAL_INTEGRATION_TEST=true` + local Supabase |
| SPA Vitest, 22 files | **148** | 0 | 0 | |
| **Total executed** | **539** | **0** | **0** | **1 file** + the gates below |

Baseline before any change on timeout-hardening: 164 passed / 1 failed (`webpush.test.ts` load
error), the failure fixed by `f0a83b9`.

## Blocked gates

**BLOCKED — CLOUD ENVIRONMENT LIMITATION** (no Docker daemon; no Supabase CLI stack). None counted
as passes:

- fresh migration replay (`scripts/test-migration.sh`, `scripts/test-ci.sh` migration phase)
- live RLS / RPC tests (`scripts/test-security.sh`, `supabase/tests/security/*`)
- `scripts/test-nexus.sh`, `scripts/test-registration.sh`
- `skip_locked_concurrency.test.sh` (needs two concurrent psql sessions on a live DB)
- **`claim_nexus_task` RPC semantics** (Case A–D, TIMEOUT_UNKNOWN guard, EXECUTE ACL
  `service_role` only). An ad-hoc throwaway-Postgres check was attempted and was refused by the
  sandbox safety check; it was not retried by other means.
- `nexus-upstream.test.ts`

**Deployment / external verification required:**

- re-create the 9 migration-defined cron jobs (6 functions) with `x-cron-secret` (§6)
- confirm and re-point the live `retry-worker`, `email-sender`, `notification-batch-processor`,
  `missed-class-detector`, `attention-flag-push-sweep` schedules, if any
- `CRON_INVOKE_SECRET` / `INTERNAL_INVOKE_SECRET` present and distinct
- real Nexus honours `external_unique_key`; accepts `assignees` for users with their own space
  (Nexus repo/API was not reachable from this session)
- decide/guard `notification-dispatcher`

## Other open items (not caused by this work)

- No reconciliation path for `TIMEOUT_UNKNOWN` (C6 gap).
- `clickup-sync` remains a second, non-idempotent Nexus writer (C6 retirement gap).
- `phase2-processor` and `mock-nexus` compare shared secrets with `!==` (not constant-time) · Low/Medium.
- `list_id`/`space_id` hard-coded.
- Conflicting `verify_jwt` between `supabase/config.toml` and per-function `config.toml` (audit F-8) not re-examined.
- Whether the local C6 working copy differs from `brief/c6-timeout-hardening`.
