# C6 + Edge Security Reconciliation — 2026-10-03

**Status: NOT PRODUCTION CERTIFIED. NOT MERGED.** Integration branch `integration/c6-edge-security`.
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

## 9. Blocked gates

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
