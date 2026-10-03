# C6 + Edge Security Reconciliation — 2026-10-03

**Status: NOT PRODUCTION CERTIFIED. NOT MERGED. See §14 FINAL INFRASTRUCTURE CERTIFICATION (third pass), which supersedes the "blocked" statements in §9 and §11 wherever they conflict.** Integration branch `integration/c6-edge-security`.
Database, Supabase and deployment gates have not been executed (see [Blocked gates](#9-blocked-gates)).
Updated 2026-10-03 (second pass: cron cutover, TIMEOUT_UNKNOWN reconciliation, legacy writer
retirement). Sections 1-3 are unchanged from the first pass.

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

## 4. Second pass: what changed and why

Starting point `35669f6`. Eight commits since:

| Commit | Subject |
|---|---|
| `3f058a1` | fix(cron): operator script to migrate scheduled functions to cron-secret auth |
| `c250ac5` | test(cron): lock scheduled invocation auth contract |
| `8312718` | feat(c6): reconciliation state and atomic RPCs (migration `202610030001`) |
| `4167a44` | feat(c6): reconcile unknown Nexus outcomes; align client with the real task-api |
| `c3b4397` | test(c6): reconciliation, concurrency and assignment suites |
| `7985a16` | chore(edge): retire `clickup-sync` (410 tombstone) |
| `80f37e3` | chore(edge): retire `notification-dispatcher` (410 tombstone) |
| `abd89fa` | ci: run every offline Deno suite in `test-unit.sh` |

### 4.1 Finding that changed the plan: the C6 client matched neither Nexus task endpoint

Reconciliation can only be built on the real Nexus API, so the contract was verified against the
Nexus source (`Amber-E-Moseri/Nexus` @ `0611a28`, read-only clone). Three task-creating
functions exist there:

| Nexus function | Auth | Body | Idempotency | Lookup |
|---|---|---|---|---|
| `tasks` (what `${NEXUS_API_URL}/tasks` resolves to) | `Authorization: Bearer <NEXUS_API_KEY>` | `title` + `space_id` required | **none** (`external_unique_key` ignored) | none |
| `rocksolid-sync` | Bearer shared secret | `{type, payload}` | none | none |
| **`task-api`** | **`x-api-key`** (hashed, scoped, `tasks:write`/`tasks:read`, 60 req/min) | `title`, `urgent\|high\|medium\|low`, `YYYY-MM-DD`, single `assignee_id`, `external_unique_key` | **yes**: unique index + find-or-create, `201 {task}` / `200 {duplicate:true,task}` | `GET /tasks` (newest ≤200, **no key filter**) |

The C6 client sent `Authorization: Bearer`, `name`, numeric `priority`, epoch-ms `due_date`,
`assignees[]`, `list_id`, `space_id`, and read `created.id`. That is a ClickUp-shaped body that
`tasks` rejects (400, no `title`) and `task-api` rejects (401, no `x-api-key`). The only endpoint
that can satisfy "converge without duplicates" is `task-api`, so the client was aligned to it.
Existing tests that pinned the old shape were rewritten to assert the verified one. The earlier
claim that Nexus-side idempotency was "PROVEN" rested on source-string tests and a mock that has no
`/tasks` route; it was never exercised against a real Nexus endpoint.

**Decision to confirm:** this commits the integration to `task-api` with its own key
(`NEXUS_TASK_API_KEY`, `NEXUS_TASK_API_URL`; no fallback to `NEXUS_API_KEY`). It is a deployment
change (see §8).

### 4.2 A real bug fixed on the way

`_logAudit` chained `.catch()` on the Supabase query builder, which has no `.catch()`
(`TypeError: b.catch is not a function`, reproduced against the real client). Every audit write threw,
so `ensureNexusTask` threw after a successful POST, after a failure record, and on malformed input.
No existing test could see it (they inspect source text). The same pattern remains once in
`moodle-grade-sync/index.ts:312` (pre-existing on `main`, rare error branch, outside C6, not changed).

### 4.3 CI was not running most of the suites

`scripts/test-unit.sh` (what CI runs) listed 16 of 37 `*.test.ts` files. Twenty suites never ran in
CI, including every C6 suite and the E2 cron/mixed-auth suites. 19 were added (the 20th,
`nexus-upstream`, needs a local Supabase stack).

## 5. Cron cutover

Inventory (all jobs found in migrations, archives, docs, workflows and function code):

| Job | Function | Schedule | Old auth | New auth | Defined |
|---|---|---|---|---|---|
| `review-checkin-daily` | review-checkin | `0 9 * * *` | Bearer service key | `x-cron-secret` | `202605171200` |
| `student-engagement-monitor` | student-engagement-monitor | `0 7 * * *` | Bearer | `x-cron-secret` | `202605170004` |
| `waitlist-processor` | waitlist-processor | `*/15 * * * *` | Bearer | `x-cron-secret` | `202605180002` |
| `report-weekly-regional` | report-generator | `0 13 * * 1` | Bearer | `x-cron-secret` | `202605172100` |
| `report-monthly-regional` | report-generator | `0 13 1 * *` | Bearer | `x-cron-secret` | `202605172100` |
| `report-weekly-pastor-digest` | report-generator | `30 13 * * 1` | Bearer | `x-cron-secret` | `202605172100` |
| `report-monthly-pastor-digest` | report-generator | `30 13 1 * *` | Bearer | `x-cron-secret` | `202605172100` |
| `moodle-grade-sync` | moodle-grade-sync | `0 */6 * * *` | Bearer | `x-cron-secret` | `202605171900` |
| `attendance-reminder-daily` | attendance-reminder | `0 9 * * *` | Bearer | `x-cron-secret` | `202605190950` |
| `moodle-sync` | moodle-sync | `*/5 * * * *` | Bearer | `x-cron-secret` | `moodle-sync/CUTOVER_PLAN.md` only (no migration) |

**Jobs discovered: 10 (9 in migrations + `moodle-sync`). Re-pointed by the new operator script: 10 (code-level; applied by an operator, not by this branch).**

Mechanism (`supabase/ops/cron-cutover-x-cron-secret.sql`, **not a migration**):

- Reads the secret from Supabase **Vault at job run time** (`vault.decrypted_secrets`, name
  `cron_invoke_secret`), so it is never in git and never stored in `cron.job.command`.
- Re-points only jobs that already exist (`cron.alter_job`, command only). It never creates a job and
  never changes a schedule; absent jobs are reported, not invented. Idempotent. Raises (changing
  nothing) if pg_cron, pg_net or the Vault secret is missing.
- Why not a migration: the repo has no secret-store convention (Vault is not used anywhere); legacy
  cron migrations carry a hand-edited `<SERVICE_ROLE_KEY>` placeholder. A migration would schedule dead
  jobs on `db push`/replay, and a Vault-guarded one could break replay where Vault is absent.
- **Verification**: static only. Grammar parsed (libpg-query: SQL and the PL/pgSQL body). Not executed:
  no pg_cron/Vault here. Tests: `cron-contract.test.ts` (8) proves parity with every legacy job (function and
  body), `x-cron-secret` from Vault, no Authorization/bearer in the command, no secret or hand-edit
  placeholder, no `cron.schedule`/schedule change, loud failure on missing prerequisites, and that every
  targeted function calls `validateCronAuth`. `auth-regression.test.ts` proves all 12 cron-called handlers
  **accept** the correct secret (mutation-checked: a wrong secret fails all 12) and reject no
  credentials, a wrong secret, the service-role key, and a forged `{"role":"service_role"}` JWT.
- **Deployment requirement:** `CRON_INVOKE_SECRET` and `INTERNAL_INVOKE_SECRET` set (distinct); the same value
  stored in Vault as `cron_invoke_secret`; deploy the functions and run the script in the same window (between
  the two, the jobs get 401).

## 6. TIMEOUT_UNKNOWN reconciliation

**Invariant: a `TIMEOUT_UNKNOWN` row converges to a known state without creating a duplicate Nexus task.**

State machine (transitions are SQL, `resolve_nexus_reconciliation`, under a claim token):

```
create timeout / unconfirmed 2xx
        |
        v
  TIMEOUT_UNKNOWN  (next_reconcile_at = +5 min; producers never re-POST it)
        |  reconciler leases due rows (claim_nexus_reconciliations: FOR UPDATE SKIP LOCKED + token)
        |  one GET /tasks?source=api&limit=200 per batch, indexed by external_unique_key
        +-- found ------------------> CREATED            remote id persisted; NO POST
        +-- read ok, key not present -> FAILED            "RECONCILED_ABSENT": producer re-claims and POSTs
        |                                                  the SAME external_unique_key
        +-- unreachable / timeout / non-200 / malformed -> stays TIMEOUT_UNKNOWN
                                                          attempts+1, backoff 10m..6h; nothing POSTed
                                       after 24 inconclusive attempts -> RECONCILE_FAILED (terminal)
```

- **Lookup mechanism.** Nexus has no lookup-by-key endpoint. `GET /tasks` can prove a task *exists*; for a
  missing key it can only say "not in the newest 200". So "absent" is deliberately **not** treated as proof:
  the verdict releases the row, and the next POST reuses the same key, which Nexus guarantees cannot create a
  second task (unique index + find-or-create; a task outside the window comes back `200 duplicate:true`
  and its id is persisted). Duplicate-safety rests on the server-side key, not on the scan being exhaustive
  (RC13). A failed or malformed read is never "absent".
- **Retry rule.** Definite rejections (4xx/5xx/429/network) are `FAILED`, not unknown. Only a timeout or a 2xx
  that does not confirm a task id is `TIMEOUT_UNKNOWN`. `RECONCILE_FAILED` and `TIMEOUT_UNKNOWN` are never
  reclaimed by `claim_nexus_task`, however old.
- **Concurrency protection.** SQL: row locks + `SKIP LOCKED` + claim token + lease expiry; resolution
  applies only for the current lease holder of a still-unresolved row (replays and lost leases are no-ops).
  Edge: persisting writes after a POST are `claim_token`-guarded so a stale worker cannot overwrite the new owner.
- **Where it runs.** `retry-worker` (existing hourly cron), as a distinct phase **before** the sweep that can
  reach `ensureNexusTask`, plus an explicit `reconcile_nexus` action. A reconcile failure never breaks the sweep.
  The reconciler module cannot POST (asserted by RC19). Reconciliation therefore only runs when the
  `retry-worker` schedule is active (§8).
- **Tests.** `nexus-reconcile.test.ts` (30) + `nexus-assignment.test.ts` (10). Cases: exists remotely; absent;
  Nexus unreachable / timeout / 500 / 401 / bad JSON / bad shape / bad item (7); backoff; repeated; concurrent
  on one row; disjoint batches; lost lease; resolved rows ignored; stale-claim semantics; terminal state;
  not-configured; 200-row window; unconfirmed 2xx; definite rejections; escalation source linking; stale writer;
  audit regression; migration static checks. Mutation-checked (re-adding `.catch`, treating inconclusive as absent,
  dropping the token guard, dropping the assignee each fail the right tests).
- **Limit of these tests.** They run the edge logic against a JS mirror of the SQL and of Nexus. They do **not**
  prove the SQL (locking, SKIP LOCKED, ACLs): that is blocked (§9). The migration is grammar-validated only.
- Residual Nexus-side race: `task-api` does check-then-insert; two simultaneous first POSTs of one key could
  hit the unique index and return 500. That is handled as `FAILED` (re-claimable); the next POST returns
  `duplicate:true`. No duplicate can result.

## 7. Legacy writers and C6 capability status

| Capability | Status after second pass | Evidence |
|---|---|---|
| Atomic claim | **PRESENT** (SQL runtime **BLOCKED**) | `claim_nexus_task` + RC10 edge semantics |
| Idempotency | **PRESENT in code, against the verified `task-api` contract**; live Nexus **not exercised** | stable `external_unique_key`; Nexus unique index (source-verified) |
| TIMEOUT_UNKNOWN | **PRESENT** | classification tests; RC01-RC15 |
| Reconciliation | **PRESENT (new)**; SQL **BLOCKED** | §6 |
| Concurrency | **PRESENT (design, edge-level tested)**; DB runtime **BLOCKED** | RC06-RC08, RC18 |
| Stale claims | **PRESENT** (2-min lease); DB runtime **BLOCKED** | RC10 |
| Assignment | **PRESENT**: mapped user, subgroup>group, none, invalid, retry/reconcile-preserving | NA01-NA07 |
| Sprint dependency | **NONE** | NA08/NA09 (no `sprint`/`team`/`space_id`/`list_id` in client or reconciler; request keys allow-listed) |
| Team dependency | **NONE** | same |
| Legacy writer retirement | **DONE in code**; external callers unverifiable | below |

- **`clickup-sync` → `RETIRED` (410 tombstone).** Evidence: no frontend/SQL/cron/workflow/function caller (history shows
  only the replaced retry-worker/missed-class-detector callers); canonical path supersedes it; its own writer was non-atomic
  with a 5-attempt retry loop and no idempotency key. Directory/config kept (existing tombstone convention). Test:
  every credential/method (none, internal secret, service key, forged service_role JWT) → 410, zero outbound requests, no
  writer code (mutation-checked against the old file). **Deployment check:** confirm no external caller still posts to it
  (function logs); it will now get 410.
- **`notification-dispatcher` → `RETIRED` (410 tombstone).** Evidence: unreferenced (only OPTIONS health probes and the
  deploy list); both audits call the rules/dispatcher path dead; it was the one privileged endpoint with no caller auth; and
  if run it would write `scheduled_notifications` under a different dedupe key than the canonical waitlist path (double-send
  risk). Kept in `deploy-functions.sh` so deploying replaces any live unauthenticated copy. Same test shape. The health pages
  probe it with `OPTIONS`, which the stub answers 200.

## 8. Unknown external schedulers

Handlers for all five are guarded by `validateCronAuth` and covered by the regression suite. What cannot be known from the repo is
whether and how they are scheduled.

| Function | Code auth | Caller | Status |
|---|---|---|---|
| `retry-worker` | `x-cron-secret` (admin session for manual) | no cron definition in repo (`config.toml` `0 * * * *`, `docs/cron-jobs.md` `*/20`, CLAUDE.md hourly) | **AUTH VERIFIED · DEPLOYMENT VERIFICATION REQUIRED**. Also gates reconciliation |
| `email-sender` | `x-cron-secret` | none in repo (`config.toml` `*/15` declarative) | **AUTH VERIFIED · DEPLOYMENT VERIFICATION REQUIRED** |
| `notification-batch-processor` | `x-cron-secret` | none in repo (`config.toml` `0 9 * * *` declarative) | **AUTH VERIFIED · DEPLOYMENT VERIFICATION REQUIRED** |
| `missed-class-detector` | `x-cron-secret` | none in repo (docs claim daily 02:15) | **AUTH VERIFIED · DEPLOYMENT VERIFICATION REQUIRED** (possibly not active) |
| `attention-flag-push-sweep` | `x-cron-secret` | none in repo; migration-log lists scheduling as a todo | **AUTH VERIFIED · DEPLOYMENT VERIFICATION REQUIRED** (possibly not active) |

For each: `select jobid, jobname, schedule, active, command from cron.job where command ilike '%/functions/v1/<fn>%';`. If a job exists
it must send `x-cron-secret` (the script's final query lists any job still posting without it). Authentication was **not** weakened for any
of them.

## 9. Blocked gates (second pass; most were executed in the third pass, see §14)

**BLOCKED, CLOUD ENVIRONMENT LIMITATION** (no Docker daemon, no Supabase stack; re-checked this pass). None counted as passes:

- fresh migration replay, including `202610030001`
- RLS integration tests; live RPC tests (`scripts/test-security.sh`, `supabase/tests/security/*`)
- **atomic-claim database semantics** (`claim_nexus_task` Cases A-D, TIMEOUT_UNKNOWN / RECONCILE_FAILED guard, ACLs)
- **reconciliation RPC semantics** (`claim_nexus_reconciliations`, `resolve_nexus_reconciliation`): grammar-validated only
- `skip_locked_concurrency.test.sh` (needs two live psql sessions)
- `scripts/test-nexus.sh`, `scripts/test-registration.sh`, `nexus-upstream.test.ts`
- **live Nexus**: the `task-api` contract is source-verified, never exercised; end-to-end visibility of an assigned task to an admin
  with their own Nexus space is unverified
- the cron operator script (no pg_cron/Vault)

**Deployment / external verification required:**

1. Nexus: a `task-api` key with `tasks:write` **and** `tasks:read`; prefer no sprint scope (a sprint-scoped key places tasks in that
   sprint). Set `NEXUS_TASK_API_KEY` (+ `NEXUS_TASK_API_URL` if not `${NEXUS_API_URL}/task-api`). Without them task creation and
   reconciliation fail closed.
2. `CRON_INVOKE_SECRET`, `INTERNAL_INVOKE_SECRET`, Vault `cron_invoke_secret`; run the cron script; re-point the five unknown schedules.
3. Apply `202610030001` and run the blocked DB gates where Docker exists.
4. Confirm no external caller of `clickup-sync` / `notification-dispatcher`.
5. Confirm the `retry-worker` schedule is active (reconciliation depends on it).
6. Compare the local C6 working copy with `brief/c6-timeout-hardening` (not comparable from GitHub).

## 10. Tests

Deno 2.9.6 (installed via npm), Node 22. `esm.sh` is denied by the sandbox proxy, so Deno ran with an **uncommitted** import map
(`https://esm.sh/@supabase/supabase-js@2` → `npm:`); CI needs no map. The exact invocations `scripts/test-unit.sh` makes were run with
only that map added.

| Suite | Passed | Failed | Skipped | Blocked |
|---|---|---|---|---|
| Deno, invocation 1 (13 files, `--allow-env`) | 171 | 0 | 0 | |
| Deno, invocation 2 (23 files, env/net/read) | 276 | 0 | 0 | |
| **Deno total (36 files)** | **447** | **0** | **0** | |
| `nexus-users-search/nexus-upstream.test.ts` | | | | **1 file** (needs local Supabase) |
| SPA Vitest (22 files) | **148** | 0 | 0 | |
| **Executed total** | **595** | **0** | **0** | **1 file** + §9 |

Subsets: C6 (nexus-tasks 20, idempotency 8, reconcile 30, assignment 10, missed-class/retry-worker Nexus 10, timeout suites 16, webpush 7)
= 101; auth regression 57 (12 cron-acceptance); cron contract 8; retired tombstones 6.
First pass was 539 (391 Deno + 148 SPA).

## 11. Remaining work

| Class | Item |
|---|---|
| **CODE BLOCKER** | none known |
| **DEPLOYMENT VERIFICATION** | §9 items 1, 2, 4, 5; five unknown schedules (§8); confirm `task-api` key and its scope |
| **DATABASE CERTIFICATION** | §9 blocked gates, in particular the claim and reconciliation RPCs and migration replay |
| **NON-BLOCKING FOLLOW-UP** | `moodle-grade-sync` `.catch` on a query builder (pre-existing); `phase2-processor` / `mock-nexus` non-constant-time secret compare; drop the retired functions from the health-page probe lists; consider a `GET /tasks?external_unique_key=` filter in Nexus (would make "absent" a proof); retire the legacy `clickup_task_id` column names; decide cron credential scheme if the owner prefers also accepting the service key |

## 12. Appendix A: C6 preservation matrix (current state)

Classification is from reading the implementation, not commit messages. "2nd pass" marks rows that changed.

| Capability | Status | Source commit(s) | Final implementation | Tests | Result |
|---|---|---|---|---|---|
| Atomic Nexus task claim | **PRESENT** (DB runtime unverified) | `02cbbe5`, `aa0b540`, `8593991`; 2nd pass `8312718` | `claim_nexus_task()` (`202609240001/2`, replaced in `202610030001`): `FOR UPDATE`, claim token, 2-min lease, unique `dedupe_key` for first-insert races | nexus-tasks 20, idempotency 8, reconcile RC10 | Edge pass. SQL **BLOCKED**; prior Neon certification carried forward, not re-run |
| Concurrency safety | **PRESENT (design) / edge-tested; DB runtime UNVERIFIED** | `5297320`, `9c653e7`, `02cbbe5`; 2nd pass `8312718` | row lock + unique key; reconciler uses `SKIP LOCKED` + token + lease | RC06-RC08, RC18 (JS mirror); `skip_locked_concurrency.test.sh` needs live psql | **BLOCKED** for SQL |
| Duplicate prevention / idempotency | **PRESENT** against the verified `task-api` contract; live Nexus not exercised | `84e61a6`; 2nd pass `4167a44` | stable `rocksolid:<dedupe_key>` on every POST; Nexus unique index + find-or-create; strict response parse (`201`/`200 duplicate`) | I01-I06, NT04/NT04b, RC02/RC13/RC15 | Pass |
| TIMEOUT_UNKNOWN persistence | **PRESENT** | `9957498`, `d5b5806`, `8593991`; 2nd pass `4167a44` | timeout or unconfirmed 2xx -> `TIMEOUT_UNKNOWN` (+ first reconcile in 5 min); definite rejections are `FAILED`; never reclaimed by `claim_nexus_task` | ID11/ID12, RC01, RC10, RC14, RC15 | Pass; RPC branch **BLOCKED** |
| **Reconciliation** (2nd pass) | **PRESENT (new)** | `8312718`, `4167a44` | §6 | nexus-reconcile 30 | Edge pass; SQL **BLOCKED** |
| Stale claims | **PRESENT** | `02cbbe5` | lease > 2 min re-claimable (not for `TIMEOUT_UNKNOWN`/`RECONCILE_FAILED`); stale writer guarded by claim token | RC10, RC18 | Edge pass; SQL **BLOCKED** |
| Nexus API contract (2nd pass) | **ALIGNED to `task-api` (source-verified)**; live not exercised | `1e1b9ca`, `4167a44` | `POST {base}/tasks` + `x-api-key`; body `title/priority/due_date/assignee_id/source_*/external_unique_key`; id from `task.id` | NT01-NT07, NT04b | Pass |
| Nexus authentication (2nd pass) | **PRESENT** | `4167a44` | `x-api-key` from `NEXUS_TASK_API_KEY`; fails closed if unset; no fallback to the users-API secret | NT02, NA01 | Pass |
| Direct user assignment | **PRESENT, no Sprint/Team dependency** | `1e1b9ca`; 2nd pass `4167a44` | `resolveAssignee()` -> `rocksolid_admin_mappings.nexus_user_id` (subgroup, then group) -> single `assignee_id`; none -> unassigned (audited); non-UUID -> `INVALID_ASSIGNEE_MAPPING`, no POST | NA01-NA10 | Pass |
| Separate Nexus task/user configuration (2nd pass) | **DONE** | `4167a44` | `NEXUS_TASK_API_URL/KEY` for tasks; `NEXUS_API_URL/KEY` only for `users`; hard-coded `list_id`/`space_id` removed | NA10, M7/R7 | Pass |
| Legacy ClickUp writer retirement (2nd pass) | **DONE in code** | `7985a16` | `clickup-sync` is a 410 tombstone | `clickup-sync/retired.test.ts` | Pass; external callers unverifiable |
| C6 tests | **PRESENT, now in CI** | `d6aa240`, `ae0a30d`, `c3b4397`, `abd89fa` | see §10 | | Pass |
| C6 certification evidence | **PARTIAL** | `ce730d3` (log) | preserved in `docs/migration-log.md`; Neon 17.11 7-case run and "76/76" claim | | **Carried forward, not re-executed** |

## 13. Appendix B: security preservation (audit findings vs integration branch)

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
migration is covered in §5.

| Finding | Audit commit | Integration method | Regression test | Result |
|---|---|---|---|---|
| Shared caller-auth helper | `0be765a` | **CHERRY-PICKED** (`dbb799d`) | `caller-auth.test.ts` (8) | Pass. Used by class-selection only |
| **High** — `class-selection` `notify_waitlisted` trusts unsigned JWT `role=service_role` | `6e23198` | **MANUALLY RECONCILED** (`9f0dcdc`): class-selection hunk taken, `parseJwtClaims` deleted | `auth-regression.test.ts` | **Live gap on timeout-hardening, now fixed.** Mutation-checked: restoring the old code makes the forged-JWT test fail |
| **High** — `clickup-sync` trusts unsigned JWT claim | `6e23198` | **SUPERSEDED**: timeout-hardening already replaced it with `validateInternalAuth` and has no claim decoding. Hunk deliberately not applied | `clickup-sync/retired.test.ts` (3): since retired as a 410 tombstone (§7) | Pass |
| **Critical** — `retry-worker` treats headerless request as cron | `9a7e512` | **SUPERSEDED**: timeout-hardening requires `x-cron-secret`; no/other credentials → 401. Audit's bearer-service-key variant intentionally not applied | regression: no creds → 401, forged JWT → rejected, internal secret ≠ cron | Pass |
| **High** — `moodle-sync`, `moodle-grade-sync`, `waitlist-processor`, `student-engagement-monitor`, `attendance-reminder`, `review-checkin` unauthenticated | `a6ee4c5` | **SUPERSEDED**: all six guarded (cron secret, or verified staff session where the function also serves the UI) | regression suite (each: no creds → 401, forged JWT → rejected; cron-only: service key and wrong secret → 401) | Pass |
| **Medium** — `report-generator` cannot authenticate its own cron | `849d476` | **SUPERSEDED in code** (accepts `x-cron-secret` or admin session). See §5: the *deployed crons* sent a service key; the operator script re-points them | regression suite | Pass; deployment gap in §6 |
| Handler-level auth regression suite | `f488b54`, `d9b3e66` | **CHERRY-PICKED** (`c8df977`, `ccdcf42`) then **MANUALLY RECONCILED** (`22a9038`) to the cron/internal contract; extended to email-sender, notification-batch-processor, missed-class-detector, attention-flag-push-sweep | `auth-regression.test.ts` (57 now; adds 12 cron-acceptance cases) | Pass |
| Audit report + local-C6 checklist | `aeac841` | **MANUALLY RECONCILED**: report copied with a status banner; `LOCAL_C6_HANDOFF_CHECKLIST.md` **NOT APPLICABLE** (obsolete: C6 already on GitHub) | n/a | n/a |
| **Medium** — `notification-dispatcher` has no caller authentication | not in the audit (found in first-pass review) | **Second pass: retired as a 410 tombstone** (§7) rather than guarded: unreferenced and documented dead | `notification-dispatcher/retired.test.ts` (3) | Closed in code; confirm no external caller |

## 14. FINAL INFRASTRUCTURE CERTIFICATION (third pass)

Branch `integration/c6-edge-security`, started at `b13b7e5`. Nothing here touched production, merged or pushed to `main`.
Classification per gate: **PASS / FAIL / BLOCKED / DEPLOYMENT ACTION REQUIRED**. BLOCKED is never counted as PASS.

### 14.1 What the environment actually provided

| Component | Reality |
|---|---|
| Docker | The `dockerd` binary was present but not running. It started (`dockerd`) and works. |
| Official Supabase CLI stack (`supabase start`) | **BLOCKED — ENVIRONMENT LIMITATION.** Its images come from `public.ecr.aws`; the egress policy returns 403 for that registry's blob host. Not bypassed. |
| Substitute used | The **real Supabase Postgres image** `supabase/postgres:17.6.1.054` (Docker Hub, the same image the CLI stack uses for its database), the **real GoTrue** `v2.188.1`, the **real PostgREST**, and a ~20-line gateway mapping `/auth/v1` and `/rest/v1`. Real roles (`anon`/`authenticated`/`service_role`), `pg_cron 1.6.4`, `pg_net 0.19.5`, `supabase_vault 0.3.1`. |
| Caveat | This is not the CLI's full stack (no Kong/Storage/Realtime). Everything below that needs only Postgres + auth + REST is real; CI's `supabase start` will re-run the same suites on the official stack. |
| Environment-only fixes (not repo defects) | The bare image lacks GoTrue's `auth.jwt()`; GoTrue was started first and a fresh replay done. GoTrue needs `GOTRUE_JWT_AUD`/`GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated` or tokens carry `role:""` (an early all-401 run was invalid for that reason and discarded). |

### 14.2 Gate results

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Fresh migration replay from zero | **PASS** | 156 files, first `000_baseline_squash.sql`, last `202610030001_nexus_task_reconciliation.sql`, **0 failures**, 5 warnings (intentional template-placeholder notices in `202605161200`). Re-applying `202610030001` is a no-op (idempotent). |
| 2 | `scripts/test-migration.sh` invariants | **PASS** | 6/6 (its `supabase db reset` line replaced by the replay above). |
| 3 | Schema verification | **PASS, with findings** | PK + `UNIQUE(dedupe_key)`; reconcile/claim/retry/timestamp columns present; RLS enabled, admin-only policies; `updated_at` trigger. **Finding:** no `status` CHECK, so the database itself does not prevent an invalid status or `CREATED` without a Nexus id (enforced by RPCs/edge only). Real states are `PENDING, CLAIMING, CREATED, FAILED, TIMEOUT_UNKNOWN, RECONCILE_FAILED` (there is no `CLAIMED`). NON-BLOCKING: consider a `NOT VALID` CHECK. |
| 4 | RPC certification (real RPCs, as `service_role`) | **PASS** | `supabase/tests/c6/rpc-certification.sql`: 37/37 (each case records input, starting state, returned value, resulting state). |
| 5 | Atomic claim | **PASS** | 24 workers x 40 keys = 960 simultaneous attempts: exactly one owner per key, one row per key, owner token matches. Losers get `23505` (first-insert race, ~90% of attempts) rather than a graceful `is_owner=false`: safe, noisy, NON-BLOCKING. |
| 6 | Claim-token fencing | **PASS** | Every loser's finalize updated 0 rows; a stale writer cannot overwrite the new owner (F01); wrong lease token cannot resolve (V03). |
| 7 | SKIP LOCKED concurrency | **PASS** | 400 due rows, 16 workers: 400 leased, 400 distinct, 0 double-leased, all 16 workers got rows, 0 deadlocks. Concurrent claim+resolve: 400/400 applied, final state consistent. Key-pool contention (24 workers, 12 keys): one owner per key. C1's own `skip_locked_concurrency.test.sh` SC01/SC02 PASS. **Mutation-proven:** with `SKIP LOCKED` removed, 393 rows were double-leased and S4/S5 failed. |
| 8 | Stale-claim recovery | **PASS** | Real boundary: 119 s held, 121 s recoverable; 24 workers racing for one expired claim: exactly one owner; fresh claim never stolen. |
| 9 | TIMEOUT_UNKNOWN (DB) | **PASS** | Never reclaimable (30 days old, also `RECONCILE_FAILED`); FOUND -> CREATED + id; ABSENT -> FAILED then claimable; UNKNOWN -> attempts+1, 10 min backoff; **terminal `RECONCILE_FAILED` exactly on the 24th inconclusive attempt, not before**; terminal row refused by both claim paths. |
| 10 | Concurrent reconciliation | **PASS** | Disjoint leases; leased rows not handed to a second worker; abandoned lease reclaimable after expiry. |
| 11 | RLS / RPC authorization (real HTTP, real JWTs) | **PASS** | Wave 1 regression 33/33; C6 suite 56/56 (anon, pending, teacher as wrong user, admin, superadmin, service_role on `rocksolid_task_links`, `rocksolid_admin_mappings` and the three RPCs, with DB state verified after every request: the RPCs return 401/403 `42501` and create nothing for everyone but `service_role`); C2 `failed_syncs` contract 126 checks; `nexus-upstream` isolation PASS (previously BLOCKED). **Note:** by policy any `is_admin()` role (admin, superadmin, pastor, principal, regional_secretary, ...) can insert/update task links and re-point assignee mappings; table-level DML grants to `anon`/`authenticated` exist and RLS is the only barrier. Intended design, documented. |
| 12 | Nexus task-api scopes | **PASS (source + live)** | `POST` requires `tasks:write`, `GET` requires `tasks:read` (real 403s observed). Reconciliation therefore needs **both**; a write-only key makes lookups return 403, which Rock Solid treats as *unknown*, never absent (E6c). |
| 13 | Key scope without Sprint | **PASS, with a requirement** | `api_keys_scope_check` requires `department_id IS NOT NULL OR sprint_id IS NOT NULL` (live: a key with neither is rejected). A **department-scoped key with no sprint works** (tasks land with `sprint_id` NULL, `task_type=space`). Rock Solid needs no Sprint/Team. The key's department must have active task-status definitions or every create is a 500 (status resolution trigger). |
| 14 | Real Nexus round-trip | **BLOCKED (live/staging); PASS (real code, local)** | No staging/production Nexus endpoint or key exists here and production was not touched. The authoritative `task-api` source (unmodified copy of `Nexus@0611a28`) was run against a real Nexus Postgres built from Nexus's own migrations. `supabase/tests/c6/nexus-e2e.ts`: 21 PASS, 0 FAIL, 1 UNVERIFIED, reproducible on two consecutive runs. |
| 15 | Nexus idempotency | **PASS (real code); live BLOCKED** | Same `external_unique_key` posted again (with the Rock Solid link present, with it deleted, and by the raw client): `201 {duplicate:false}` then `200 {duplicate:true}`, **actual Nexus tasks = 1**. |
| 16 | Real assignment | **PASS (real code)** | `rocksolid_admin_mappings.nexus_user_id` -> `tasks.assignee_id` (also after unknown -> reconcile -> retry). **Sprint required = NO. Team required = NO** (task-api has no team concept). A non-user id is a real 400 -> `FAILED`, nothing created. |
| 17 | Assignee can see the task in Nexus | **UNVERIFIED** | The replayed Nexus schema raises `infinite recursion detected in policy for relation "group_space_members"` for *any* `authenticated` read of `tasks` (reproduced independently). Either a Nexus fresh-install RLS defect or production differs; cannot be determined here. |
| 18 | Unknown-outcome safety (real) | **PASS** | Timeout after Nexus created the task: `TIMEOUT_UNKNOWN`, producer rerun made **0** further POSTs, reconcile found it by key (real `GET /tasks`), no POST. Timeout before Nexus saw it: reconcile -> absent -> released; re-POST of the same key created exactly one task. Lookup unavailable (503) or key lacking `tasks:read` (403): stays unknown, attempt counted, no POST. Real 401 / 403 / 400 -> definite `FAILED`. |
| 19 | Cron pre-flight | **PASS on a test target; production = DEPLOYMENT ACTION REQUIRED** | See §14.3. |
| 20 | Cron cutover | **PASS on the test target; NOT executed in production -> DEPLOYMENT ACTION REQUIRED** | See §14.3. |
| 21 | Cron function smoke | **PASS** | `supabase/tests/c6/cron-smoke.ts`: 12 handlers x 5 credentials = 60/60 (no auth, wrong secret, service-role bearer, forged `service_role` JWT all 401; correct `x-cron-secret` passes and runs against the test DB with Resend/Moodle/Nexus unset; `email_queue` stayed empty). `moodle-grade-sync` returns 500 after passing auth because `MOODLE_URL` is unset, as designed. |
| 22 | Retired functions | **PASS (behaviour); external callers UNKNOWN -> DEPLOYMENT ACTION REQUIRED** | `clickup-sync` and `notification-dispatcher`: 410 for every credential/method (including a real service-role bearer and a forged JWT), **0 outbound requests**, row counts on `rocksolid_task_links`, `scheduled_notifications`, `notification_events`, `email_queue`, `audit_logs`, `moodle_enrollment_sync` unchanged (a seeded `notification_events` row the old dispatcher would have processed stayed untouched). No `cron.job` references either. No repo caller exists; production callers cannot be ruled out from here. |
| 23 | `moodle-grade-sync` `.catch` bug | **FIXED** | Reproduced first (`...insert(...).catch is not a function` leaked into the response and aborted the student's grade sync; the `grade_sync_available` update was never sent). Fixed minimally (await in try/catch); `builder-catch.test.ts` fails before, passes after; Moodle suites 55/55. The other `.catch` sites in the tree chain real Promises. |
| 24 | Health probes | **FIXED** | `notification-dispatcher` removed from all three probe lists (`clickup-sync` was never probed); guard test mutation-checked. |

### 14.3 Cron cutover detail

Target: this local database (explicitly safe). Production's `cron.job` could not be inspected, so **the real deployed status of the five unknown
schedules is UNKNOWN** (`retry-worker`, `email-sender`, `notification-batch-processor`, `missed-class-detector`, `attention-flag-push-sweep`); in this DB
they are ABSENT because the repo defines none. That is a statement about the repo, not about production.

1. Replayed DB had only `supabase_vault`; `pg_cron`/`pg_net` were available but not created, which is why the legacy cron migrations skip scheduling. Both
   were created, then a production-shaped state built: the six legacy cron `DO` blocks (dummy key; host rewritten to a local listener so nothing could reach
   production), `moodle-sync` per `CUTOVER_PLAN.md`, and an unrelated decoy job. **10 jobs on `Authorization: Bearer`.**
2. Script run **before** the Vault secret existed: refused (`Vault secret 'cron_invoke_secret' is missing`), nothing changed (checked twice).
3. Script run after: `10 job(s) re-pointed`; names, schedules and active flags **byte-identical** to before; decoy untouched; the secret is a Vault lookup and
   appears in **no** stored command; verification query returns 0; second run is a no-op.
4. The stored command of every re-pointed job was fired through pg_net at a listener that applies the repo's real `validateCronAuth`: **10/10 sent
   `x-cron-secret`, 0 sent `Authorization`, 10/10 accepted**, bodies preserved (the four `report-generator` jobs keep their `report_type`/`period`).
5. Final inventory in the test DB: **jobs using old auth 0, jobs using `x-cron-secret` 10, decoy 1.**

Production operator procedure is unchanged (header of `supabase/ops/cron-cutover-x-cron-secret.sql`). Do not merge-and-deploy functions before the cutover window
is scheduled: between function deploy and script run the affected jobs receive 401.

### 14.4 Nexus-side findings (outside this repository; not changed here)

1. **`task-api` depends on `check_and_increment_rate_limit(uuid,int)` (called on every request), which exists only in `supabase/migrations/.bak_20260626000000_rate_limits.sql`, a file
   the CLI ignores.** Nexus's active chain defines `public.rate_limits` as an IP/email anti-abuse table, which is incompatible with that function. On a fresh Nexus install
   every `task-api` call returns **503**. Production may differ depending on apply history. **Verify in the production Nexus before relying on `task-api`.** For this
   certification the RPC was stubbed (`allowed:true`) in the *local* Nexus only, so the real 60 req/min limit is untested (a 429 is handled as a definite `FAILED`, RC15).
2. A newly created Nexus department has no task-status definitions (only departments existing at backfill time do); seed them or every create is a 500 (`status_id NOT NULL`).
3. `infinite recursion detected in policy for relation "group_space_members"` for any `authenticated` read in the replayed schema (gate 17).
4. Nexus's migration chain does not replay cleanly without its Storage service (8 files fail on `storage.buckets`), unrelated to `task-api`.

### 14.5 Totals

| Suite | Passed | Failed | Skipped | Blocked / unverified |
|---|---|---|---|---|
| Deno (38 files, exact `test-unit.sh` invocations) | **452** | 0 | 0 | |
| SPA Vitest (22 files) | **148** | 0 | 0 | |
| Database: RPC cert 37 · concurrency 13 · C6 RLS-HTTP 56 · Wave 1 33 · C2 contract 126 · C1 SKIP LOCKED 2 · migration invariants 6 · `nexus-upstream` 1 file | **all PASS (274 checks + 1 file)** | 0 | 0 | official `supabase start` stack BLOCKED |
| Nexus (real code, local): e2e | **21** | 0 | 0 | 1 UNVERIFIED; live/staging BLOCKED |
| Cron: contract 8 · function smoke 60 · cutover script on test target | **PASS** | 0 | 0 | production inventory UNKNOWN |

### 14.6 Release classification

**CODE-READY / DEPLOYMENT ACTION REQUIRED. Not "READY FOR MERGE AUTHORIZATION".** A live or staging Nexus round-trip has not run, so that required gate is BLOCKED, and the
Nexus-side `task-api` rate-limit prerequisite (§14.4 item 1) could make the integration non-functional in production regardless of this branch.

| Class | Items |
|---|---|
| **CODE** | none known |
| **DATABASE** | official `supabase start` run of `scripts/test-c6-db.sh` (wired into CI's security job); optional `NOT VALID` status CHECK |
| **NEXUS** | confirm production `check_and_increment_rate_limit` and `rate_limits` shape; issue a department-scoped, sprint-less `tasks:write`+`tasks:read` key for a department that has status definitions; confirm the `group_space_members` RLS behaviour; one live/staging round-trip with `supabase/tests/c6/nexus-e2e.ts` |
| **DEPLOYMENT** | set `NEXUS_TASK_API_KEY`/`NEXUS_TASK_API_URL`, `CRON_INVOKE_SECRET`, `INTERNAL_INVOKE_SECRET`, Vault `cron_invoke_secret`; run the cron script in the deploy window; inspect production `cron.job` and re-point the five unknown schedules; confirm no external caller of the retired functions |
| **NON-BLOCKING** | `23505` first-insert losers are noisy (`ON CONFLICT DO NOTHING` + re-select would return a clean `is_owner=false`); broad default DML grants to `anon`/`authenticated` rely on RLS alone |
