# Edge Function Baseline Audit — 2026-10-03

GitHub baseline audit performed in Claude Code Cloud. **This is not a production certification.** Local-only C6 work has not been recovered or compared.

## Repository State

```text
BASE_MAIN_SHA   = 8b9e14ed5121aa4273c06e28a1db4ffbb40a0699  (origin/main at session start, re-fetched)
AUDIT_BRANCH    = audit/edge-functions-baseline
FINAL_HEAD_SHA  = see `git rev-parse audit/edge-functions-baseline` (last commit: docs report)
Working tree    = clean after final commit (deno.lock artifacts removed)
```

**Notable GitHub fact:** `origin` also has unmerged branches `brief/c6-atomic-claim-clean` (2 commits on top of main: `ce730d3`, `1e8a115`, 2026-09-24) and `brief/c6-timeout-hardening` (94-file diff vs main), plus `cleanup-review`. They contain `_shared/nexus-tasks.ts`, migrations `202609240001/2_*atomic*`, timeout tests, etc. They were **not** merged, built upon, or tested here; see `docs/LOCAL_C6_HANDOFF_CHECKLIST.md`.

## Method & Environment Limits

| Item | Status |
|---|---|
| Deno | Not preinstalled; installed via `npm i deno` (2.9.6) in scratch dir. `esm.sh`/`deno.land` are blocked by the cloud proxy, so tests ran with a scratch import map `https://esm.sh/@supabase/supabase-js@2 → npm:@supabase/supabase-js@2` (outside the repo). CI (open network) needs no map. |
| Docker / local Supabase | **BLOCKED — CLOUD ENVIRONMENT LIMITATION** (no Docker daemon). No migration replay, no RLS/RPC SQL tests, no live-DB edge tests. |
| Production/staging | Not contacted. All handler tests used an unroutable `SUPABASE_URL` (127.0.0.1:9). |

## Inventory (26 deployable functions; `_shared` excluded)

Auth column = what the code enforces in the handler (not just the gateway). `verify_jwt` per `supabase/config.toml` and per-function `config.toml` (they conflict for `retry-worker`, `clickup-sync`, `admin-api`; see F-8). "After" = post-fix on this branch.

| # | Function | Class | Caller / trigger | Auth (after) | Authorization | DB client | External | Idempotent | Tests |
|---|---|---|---|---|---|---|---|---|---|
| 1 | admin-api | ACTIVE | SPA `invoke` | user JWT (`auth.getUser`) | profile role set; per-action role matrix | service | – | n/a | unit (role matrix, create-staff) |
| 2 | attendance-reminder | INTERNAL/CRON | pg_cron (`Bearer` service key, in migration) | **service key or staff session (fixed)** | role set | service | email queue | sweep | auth-regression |
| 3 | attention-flag-push-sweep | INTERNAL/CRON | pg_cron (not in repo) | gateway JWT only — **no handler auth** (F-4) | none | service | Web Push | yes (`push_notified_at`) | push-notify unit |
| 4 | class-selection | PUBLIC + INTERNAL | applicant token page; `notify_waitlisted` operator | public actions token-based; `notify_waitlisted` **exact service key (fixed)** | token ownership | service | email queue | token-based | auth-regression |
| 5 | clickup-sync | ACTIVE (Nexus task writer; legacy name) | missed-class-detector, retry-worker (service key) | **service key or admin session; forged-claim path removed** | admin role set | service | Nexus | **dedupe_key check-then-upsert, non-atomic (F-9)** | auth-regression + validation |
| 6 | email-retry | LEGACY (tombstone, 410) | none | none (static 410) | – | – | – | n/a | – |
| 7 | email-sender | INTERNAL/CRON | pg_cron (not in repo) | **none** (F-4) | none | service | Resend | claims rows (migration `202607090001`) | – |
| 8 | messaging-api | ACTIVE | SPA | user JWT | staff roles + jurisdiction | service | – | n/a | – |
| 9 | missed-class-detector | INTERNAL/CRON | pg_cron (not in repo) | **none** (F-4) | none | service | → clickup-sync | dedupe via clickup-sync | – |
| 10 | mock-nexus | LEGACY/STAGING-ONLY | staging cert only | shared secret `MOCK_NEXUS_KEY` (non-constant-time `!==`) | – | service | – | n/a | – |
| 11 | moodle-grade-sync | ACTIVE + CRON | pg_cron; SPA button | **service key or staff session (fixed)** | role set | service | Moodle | upsert | auth-regression |
| 12 | moodle-sync | ACTIVE | registration-processor, retry-worker, SPA, cron | **service key or staff session (fixed)** | role set | service | Moodle | ASSIGNED-only guard | unit (4) + auth-regression |
| 13 | nexus-users-search | ACTIVE | SPA (Nexus mapping page) | user JWT | admin/superadmin from profiles | service | Nexus | read-only | cors unit; upstream test **BLOCKED** (needs local Supabase) |
| 14 | notification-batch-processor | INTERNAL/CRON | cron (not in repo) | **none** (F-4) | none | service | Moodle (lookup) | dedupe keys | – |
| 15 | notification-dispatcher | INTERNAL/CRON | cron (not in repo) | **none** (F-4) | none | service | – | dedupe keys | – |
| 16 | notification-retry-helper | LEGACY (tombstone, 410) | none | none | – | – | – | n/a | – |
| 17 | phase2-processor | WEBHOOK | DB webhook | shared secret `x-webhook-secret` (non-constant-time `!==`) | – | service | – | n/a | – |
| 18 | registration-processor | PUBLIC (+ admin overrides) | public registration form, SPA | public for new registrations; override fields require admin profile (403 otherwise) | admin role set for overrides | service | Moodle (via moodle-sync) | upsert/dup status | unit (registration-processor.test) + live CI gate (BLOCKED here) |
| 19 | reminder-processor | LEGACY (tombstone, 410, ACAO `*`) | none | none | – | – | – | n/a | – |
| 20 | report-generator | INTERNAL/CRON + ACTIVE | pg_cron (4 jobs), SPA | **admin session OR service key (fixed — crons previously 401)** | admin/superadmin/regional_secretary | service | Resend | archive writes | auth-regression |
| 21 | retry-worker | ACTIVE + CRON | SPA Retry Center; cron (schedule not in repo) | **service key or admin session; headerless = 401 (fixed)** | admin role set (profiles + legacy admin_users) | service | Moodle, Resend, clickup-sync | claims | auth-regression + validation |
| 22 | review-checkin | INTERNAL/CRON | pg_cron (service key, in migration) | **service key or staff session (fixed)** | role set | service | email queue | dedupe (skipped_already_sent) | auth-regression |
| 23 | send-push | ACTIVE (manual/test) | admin | user JWT | ADMIN_ROLES | service | Web Push | n/a | push-notify/webpush unit |
| 24 | student-engagement-monitor | INTERNAL/CRON | pg_cron (service key, in migration) | **service key or staff session (fixed)** | role set | service | – | flags dedupe | auth-regression |
| 25 | teacher-portal-api | ACTIVE | SPA | user JWT (`resolveAuthContext`) | teacher mapping + class ownership per action | service | – | per action | unit (ownership, auth) |
| 26 | waitlist-processor | ACTIVE + CRON | pg_cron (service key); SPA | **service key or staff session (fixed)** | role set | service | – | `CANONICAL_TEMPLATE_KEY` dedupe | unit (dedup) + auth-regression |

### Classification counts

| Class | Count | Functions |
|---|---|---|
| ACTIVE (user/SPA/internal callers) | 8 | admin-api, messaging-api, nexus-users-search, moodle-sync, moodle-grade-sync, send-push, teacher-portal-api, clickup-sync |
| INTERNAL / CRON | 11 | attendance-reminder, attention-flag-push-sweep, email-sender, missed-class-detector, notification-batch-processor, notification-dispatcher, report-generator, retry-worker, review-checkin, student-engagement-monitor, waitlist-processor (report-generator, retry-worker, waitlist-processor, moodle-sync/moodle-grade-sync are also SPA-callable) |
| WEBHOOK | 1 | phase2-processor |
| PUBLIC | 2 | registration-processor, class-selection |
| LEGACY | 4 | email-retry, notification-retry-helper, reminder-processor (410 tombstones); mock-nexus (staging-only) |
| UNKNOWN | 0 | — (cron schedules for 6 internal functions are not in the repo; deployment state UNVERIFIED) |

(Counts are by primary role: 8+11+1+2+4 = 26.) **Nothing was deleted.**

## Shared Infrastructure & Blast Radius

| Module | Used by | Notes |
|---|---|---|
| `_shared/http.ts` (CORS, `jsonResponse`, `classifyError`, `safeLogAudit`, `withTimeout`) | attention sweep, class-selection, waitlist-processor, student-engagement-monitor, moodle-grade-sync, moodle-sync, others | `corsHeaders` is shared; changing it affects all importers |
| `_shared/push-notify.ts`, `webpush.ts` | send-push, attention sweep, waitlist-processor, missed-class paths | VAPID/RFC 8291; unit-tested |
| `_shared/supabase.ts`, `response.ts`, `audit.ts`, `lib/assign-applicant.ts` | registration-processor / admin-api | assign-applicant tested |
| **`_shared/caller-auth.ts` (new, this branch)** | retry-worker, moodle-sync, moodle-grade-sync, waitlist-processor, student-engagement-monitor, attendance-reminder, review-checkin, report-generator, class-selection | Name chosen to avoid colliding with `_shared/auth.ts` on `brief/c6-atomic-claim-clean` |
| `teacher-portal-api/_lib/*`, `admin-api/_actions/*` | respective function only | |

No Nexus/Moodle/email client exists in `_shared` on main; each function inlines its own `fetch` (the C6 branch adds `_shared/nexus-tasks.ts`).

## Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| F-1 | **CRITICAL** | `retry-worker` treated any request **without** an Authorization header as a trusted cron call (`isCronCall = !authHeader.startsWith("Bearer ")`) on a `verify_jwt=false` endpoint → unauthenticated retry/resolve of any failed email/moodle/notification record. | **FIXED** (commit 9a7e512). ⚠ Deployment action required — see Release Status. |
| F-2 | **HIGH** | `class-selection` `notify_waitlisted` trusted an **unverified** decoded JWT `role=service_role` claim → anonymous forged token could queue "class available" emails to up to 5000 waitlisted applicants. | **FIXED** (6e23198) |
| F-3 | **HIGH** | `clickup-sync` accepted a forged `role=service_role` JWT payload → anonymous creation of Nexus tasks (and audit/linkage writes). | **FIXED** (6e23198) |
| F-4a | **HIGH** | `moodle-sync`, `moodle-grade-sync`, `waitlist-processor`, `student-engagement-monitor`, `attendance-reminder`, `review-checkin`: service-role handlers with `verify_jwt=false` and no caller auth. `moodle-sync` additionally allowed `{id}` force-sync of a chosen row and a `{action:"test"}` Moodle probe disclosing the site name/URL. | **FIXED** (a6ee4c5). In-repo crons already send `Bearer <service key>`; SPA callers send staff JWTs. |
| F-4b | **MEDIUM** | `email-sender`, `notification-dispatcher`, `notification-batch-processor`, `missed-class-detector`, `attention-flag-push-sweep`: same pattern (no handler auth; public trigger of service-role sweeps; no caller-controlled targets, so abuse = forced early run / quota burn). Cron definitions are **not in the repo**, so adding a guard blindly could stop email delivery. | **OPEN — NOT FIXED** deliberately; apply `authorizeCaller` once deployed cron headers are confirmed. |
| F-5 | MEDIUM | `report-generator` only accepted user sessions, but its 4 crons send the service key → every scheduled report returned 401 (functionality defect). | **FIXED** (849d476) |
| F-6 | LOW | `phase2-processor` and `mock-nexus` compare secrets with `!==` (timing). Low practical risk; helper `timingSafeEqual` now exists. | OPEN |
| F-7 | LOW | Error responses echo `String(err)` / `error.message` (waitlist-processor, student-engagement-monitor, attention sweep) — may leak DB error text. No stack traces observed. | OPEN |
| F-8 | LOW | `verify_jwt` conflicts: `supabase/config.toml` says `true` for `retry-worker`, `clickup-sync`, `admin-api` while per-function `config.toml` says `false` for the first two; `deploy-functions.sh` deploys with `--no-verify-jwt`. Effective deployed setting unverifiable offline. Code-level auth added above makes the outcome safe either way. | OPEN (document) |
| F-9 | MEDIUM | `clickup-sync` idempotency: check-then-upsert on `rocksolid_task_links.dedupe_key` is not an atomic claim; concurrent identical requests can both reach Nexus. No idempotency key is sent to Nexus; 5xx/429 are retried in-process (up to 5×) and a network exception after delivery is recorded `FAILED` (no unknown-outcome state / reconciliation). | **POSSIBLE LOCAL-ONLY C6 WORK — VERIFY AFTER HANDOFF** (branch `brief/c6-atomic-claim-clean` appears to address; not verified) |
| F-10 | LOW | Wildcard/optional CORS: attendance-reminder, messaging-api, admin-api, reminder-processor emit `Access-Control-Allow-Origin: *`; all authenticate by `Authorization` header (no cookies), so CSRF exposure is minimal. Not changed. clickup-sync mutates a module-level headers object per request (benign race). | INFO |
| F-11 | INFO | `scripts/test-unit.sh` excludes `moodle-sync.test.ts` claiming it cannot import; it actually passes (4/4) when run directly. | INFO |
| F-12 | INFO | No hardcoded credentials found (regex scan for JWTs, `sk_live`, Resend keys, service-role literals); migrations use a `<SERVICE_ROLE_KEY>` placeholder; no secret-bearing `console.*` logging found. `NEXUS_LIST_ID`/`NEXUS_SPACE_ID` are hardcoded UUIDs in clickup-sync (non-secret config; should be env). | INFO |

## Authentication / Authorization Summary

* Gateway JWT is **not** relied upon for service-role functions (deployed `--no-verify-jwt`).
* Service-role identity is now only recognised by constant-time equality with `SUPABASE_SERVICE_ROLE_KEY`. Decoding a JWT payload for trust decisions has been removed everywhere (grep: none remain except an unused `parseJwtClaims` helper in `class-selection`).
* Service-role (RLS-bypass) functions: all except none use the service client; authorization is therefore enforced in handlers (role sets above). Per-action ownership checks exist in `teacher-portal-api` (class-ownership tests) and `admin-api` (role matrix tests). `messaging-api` applies jurisdiction filtering in code.
* RLS policies themselves were **not executed** (no local Postgres) → BLOCKED.

## Validation / HTTP Contract

Handler-level checks executed (service-key caller): `clickup-sync` empty body, malformed JSON, invalid `type` → 400 JSON, no stack; non-POST → 405; `retry-worker` invalid `action` → 400 `INVALID_ACTION`. Other functions' deeper validation (UUID/enum/oversize) was **not exercised** — requires DB mocks/local stack.

CORS: allow-list via `ALLOWED_ORIGINS`/`CORS_ALLOWED_ORIGINS` for retry-worker, clickup-sync, missed-class-detector, notification-*, phase2-processor, nexus-users-search, registration-processor; `*` for the four noted in F-10. `nexus-cors.test.ts` passes (exact-match allow-list, null origin, preflight).

## External Integrations

| Integration | Functions | Findings (code review; failure-matrix tests not executed except where noted) |
|---|---|---|
| Nexus | clickup-sync, nexus-users-search | Retry on 429/≥500 with exp backoff (max 5, cap 10 s) in clickup-sync; 4xx not retried; non-fatal responses (HTTP 200 `ok:false`) persisted as `FAILED` on `rocksolid_task_links` with `error_message` + audit row. Network exception/timeout: no unknown-outcome state (F-9). Assignment: direct `assignees:[nexus_user_id]` from `rocksolid_admin_mappings` (subgroup → group → none); **no Sprint/Team is required or referenced**; missing mapping ⇒ task created unassigned (silent) — LOW. Container ids `list_id`/`space_id` are hardcoded constants. |
| Moodle | moodle-sync, moodle-grade-sync, notification-batch-processor | 403/WAF classified non-retryable (`classify403Cause`); ASSIGNED-only guard unit-tested; stuck PROCESSING reset after 30 min. |
| Resend | email-sender (report-generator enqueues) | claim-based queue; rate-limit counted. Not exercised. |
| Web Push | send-push, attention sweep, waitlist-processor | 410 ⇒ subscription expired; 201 counted; VAPID unset ⇒ skip. Unit-tested. |
| Mailchimp | — | no remnants found in functions. |

## Testing (exact commands, this branch)

Deno invoked as `PATH=<scratch>/node_modules/.bin:$PATH deno test --import-map=<scratch>/im.json …` (import map only because of proxy block).

| # | Command | Result | Pass | Fail | Skip | Blocked |
|---|---|---|---|---|---|---|
| 1 | `deno test --allow-env --no-prompt --no-check --node-modules-dir=auto` on the 10 files in `scripts/test-unit.sh` (baseline, pre-fix) | PASS | 101 | 0 | 0 | – |
| 2 | `deno test … supabase/functions/moodle-sync/moodle-sync.test.ts` | PASS | 4 | 0 | 0 | – |
| 3 | `deno test --no-check --allow-env supabase/functions/_shared/caller-auth.test.ts` | PASS | 8 | 0 | 0 | – |
| 4 | `deno test … --allow-env --allow-net --allow-read supabase/functions/_shared/auth-regression.test.ts` | PASS | 23 | 0 | 0 | – |
| 4b | same suite against **pre-fix** handlers (stash of fixes) | **15 FAILED / 5 passed** (proves tests are real regressions) | 5 | 15 | 0 | – |
| 5 | `cd foundation-spa && npm run test` (Vitest) | PASS | 148 (22 files) | 0 | 0 | – |
| 6 | `scripts/test-security.sh` / `wave1-regression.ts` (needs local Supabase) | **BLOCKED** (no Docker) | – | – | – | all |
| 7 | `scripts/test-migration.sh` (fresh replay) | **BLOCKED** | – | – | – | all |
| 8 | `scripts/test-registration.sh` / `supabase/tests/registration/live-registration.ts` | **BLOCKED** | – | – | – | all |
| 9 | `scripts/test-nexus.sh` (`nexus-upstream.test.ts`, needs `LOCAL_INTEGRATION_TEST` + local stack) | **BLOCKED** | – | – | – | all |

Totals this branch (executed): **Deno 136 passed + SPA 148 passed = 284 passed, 0 failed**, plus 15 expected failures against pre-fix code. **BLOCKED: 4 suites.**

## C6 Baseline

**VERIFIED ON GITHUB (main @ 8b9e14e):**
* Task creation via `POST {NEXUS_API_URL}/tasks` with Bearer `NEXUS_API_KEY`; response `id` persisted to `rocksolid_task_links.nexus_task_id`, `status=CREATED`; source row `clickup_task_id` back-filled for escalations; audit rows `NEXUS_TASK_CREATED/FAILED`.
* Dedupe key per source (`missed_class:…`, `escalation:…`); already-linked key returns `reused:true` without calling Nexus (sequential idempotency OK).
* Direct assignment to an existing Nexus user via mapping table; Sprint/Team **not** required.
* Auth on `clickup-sync` (now) — service key or admin session; RLS on `rocksolid_*` tables (admin only) exists in migration `202607101000` (not executed here).
* Backoff retry policy for 429/5xx; 4xx terminal.

**DEFECT ON GITHUB:** F-3 (forged service role) — fixed.

**POSSIBLE LOCAL-ONLY C6 WORK — VERIFY AFTER HANDOFF:** atomic claim, concurrent-claim safety, `TIMEOUT_UNKNOWN`, reconciliation (repeat/race/stale), stale-claim recovery, Nexus idempotency key, legacy-writer retirement, `_shared/nexus-tasks.ts`. None exist on `main`. Candidate branches already on GitHub are listed in the handoff checklist.

## Release Status (baseline only — NOT a production certification)

**BASELINE BLOCKERS**
1. **Deployment dependency of F-1/F-4a fixes:** the deployed `retry-worker` cron (schedule not in repo) must send `Authorization: Bearer <service role key>`. Previously it likely sent none and relied on the bypass. Verify before deploying this branch or retries will 401.
2. F-4b (five unauthenticated service-role sweeps) is not closed.
3. DB/RLS/migration/security-regression suites could not run (BLOCKED) — rerun in CI/local before any certification.
4. C6 reconciliation/atomic-claim state unknown until local/branch work is compared (F-9).

**NON-BLOCKING FOLLOW-UP:** F-6, F-7, F-8, F-10, F-11, F-12; remove unused `parseJwtClaims`; env-ify Nexus list/space ids; surface "no assignee mapping" in the audit row.

## Environment Variable Inventory (names only)

| Variable | Functions | Secret | Missing behaviour |
|---|---|---|---|
| SUPABASE_URL | all | no | 500 "Missing Supabase env" (most) |
| SUPABASE_SERVICE_ROLE_KEY | all service-role fns | **yes** | 500 / auth always fails (empty key never matches — `isServiceRoleToken` rejects empty) |
| SUPABASE_ANON_KEY | report-generator, registration-processor, teacher-portal-api, nexus-users-search; admin-api/messaging-api/send-push via `_shared/supabase.ts` | semi-public | auth.getUser fails → 401 |
| ALLOWED_ORIGINS | retry-worker, clickup-sync, missed-class-detector, notification-*, phase2-processor | no | ACAO omitted |
| CORS_ALLOWED_ORIGINS, LOCAL_INTEGRATION_TEST | nexus-users-search | no | built-in production/dev fallback |
| NEXUS_API_URL, NEXUS_API_KEY | clickup-sync, nexus-users-search | key = **yes** | clickup-sync: row `FAILED`, non-fatal 200 |
| MOODLE_URL, MOODLE_TOKEN | moodle-sync, moodle-grade-sync, notification-batch-processor | token = **yes** | moodle-grade-sync 500; moodle-sync `MOODLE_NOT_CONFIGURED` |
| RESEND_API_KEY | email-sender (read with single-quoted `Deno.env.get`) | **yes** | module-load `!` assertion; per-send error "RESEND_API_KEY is not configured" → row failed/retried |
| PHASE2_WEBHOOK_SECRET | phase2-processor | **yes** | 401 always |
| MOCK_NEXUS_KEY | mock-nexus | **yes** | 401 always |
| VAPID_* (via `vapidKeysFromEnv`) | send-push, attention sweep, waitlist-processor | private key **yes** | skipped |
| ATTENDANCE_ADMIN_EMAIL, ADMIN_EMAIL, TEACHER_PORTAL_URL | attendance-reminder | no | hard-coded defaults |

_Env inventory note: produced by grep of `Deno.env.get(...)` (both quote styles) plus shared modules; variables read indirectly in `_shared/*` may be incomplete._
