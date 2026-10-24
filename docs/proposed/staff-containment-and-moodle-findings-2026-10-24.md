# Staff containment and Moodle security: findings and design (2026-10-24)

Status: containment changes are on `brief/staff-containment` (frontend hold and an edge-function refusal). Everything else in this document is findings and design. Nothing here is deployed, migrated, or applied to any database.

Baseline: `origin/main` 35b4953.

---

## 1. Live deployment state (read-only: `supabase functions list`)

| Function | Production `foundation-school` (`xelpsttqhrcqmttmjory`) | Staging `Rock Solid Staging` (`hblahcaozlttknkzvkib`) |
|---|---|---|
| `moodle-sync` | **ACTIVE, v84, `verify_jwt=false`, updated 2026-09-25** | Not deployed |
| `retry-worker` | **ACTIVE, v48, `verify_jwt=false`, updated 2026-10-07** | Not deployed |
| `registration-processor` | ACTIVE, v96, `verify_jwt=false` | ACTIVE, v5, `verify_jwt=false` |
| `teacher-portal-api` | ACTIVE, v67, `verify_jwt=false` | ACTIVE, v5, `verify_jwt=false` |
| `admin-api` | ACTIVE, v25, `verify_jwt=true` | ACTIVE, v7, `verify_jwt=true` |
| `moodle-grade-sync` | ACTIVE, v19, `verify_jwt=false` | Not deployed |

Limit: deployed source could not be downloaded. `supabase functions download` failed in this environment (Docker and eszip errors, with and without `--legacy-bundle`). Whether production `moodle-sync` v84 and `retry-worker` v48 match `origin/main` is therefore **unverified**. The findings below assume they do, so the owner should confirm (section 6).

Staging does not run `moodle-sync` or `retry-worker`, so Moodle behaviour cannot be exercised there. Production is the only live Moodle surface.

Production `pg_cron` definitions were not readable: `supabase db query --linked` could not resolve the project ref from the temp directory, and no database password was supplied. Scheduler authentication is therefore unverified.

## 2. Live exposures (for owner action; none changed here)

| # | Exposure | Evidence | Severity |
|---|---|---|---|
| E1 | **`moodle-sync` in production accepts unauthenticated requests.** `verify_jwt=false` and the function has no inbound check. Any caller with the URL can POST `{}` (syncs PENDING/RETRYING/FAILED enrolment rows), `{id}`, or `{action:"test"}`. The stuck-PROCESSING reset also runs before payload validation. | `moodle-sync/index.ts` on `origin/main` and candidate | **Critical** |
| E2 | **`retry-worker` in production treats any request without an `Authorization` header as a cron call.** That path runs the Moodle sweep with the service key, which triggers `moodle-sync`. On `origin/main` the sweep is enabled. | `retry-worker/index.ts` lines 407-408, 445-476 on `origin/main`. PR #28 (candidate only) closes this. | **Critical**, if production matches `main` |
| E3 | **Legacy static teacher and approval pages are published** by the Netlify allowlist (`foundation/staff/` is not excluded). They write directly to `profiles`, `teachers`, `audit_logs`, `email_queue` and `teacher_availability` from the browser, with no hold. | `netlify.toml`, `scripts/build-static-publish.mjs`; `foundation/staff/teacher-management.html`, `foundation/staff/availability-approval.html`, `foundation/js/teacher-management.js` | **High** |
| E4 | The approval RPC `approve_teacher_availability_atomic` is executable by `authenticated` callers and by PUBLIC by default. The SPA path is held, so exposure is through direct RPC calls by an admin-role session. | Migrations; `has_function_privilege` not run (no DB access) | Medium |

Recommended immediate owner actions, in order:
1. Confirm whether production `retry-worker` v48 and `moodle-sync` v84 match `origin/main`.
2. Read-only review of production history for E1/E2. Run these in the Supabase SQL editor:
   - `select created_at, action, actor_email, details from audit_logs where action like 'MOODLE_SYNC%' or action = 'RETRY_SWEEP_EXECUTED' order by created_at desc limit 200;` Look for `actor_email = 'retry-worker@system'` and for `MOODLE_SYNC_STUCK_RESET` events with no matching admin action.
   - `select sync_status, count(*) from moodle_enrollment_sync group by 1;`
3. Decide on a temporary containment for `moodle-sync` (for example, disabling the function, or a deploy that refuses all non-service-role calls). This is a deployment, so it needs your approval and is not done here.
4. Decide whether to hold or unpublish the legacy pages in E3 (section 4 covers the proposed change).

## 3. Moodle inbound authentication design (not implemented)

**Goal.** `moodle-sync` performs live Moodle writes, so it must refuse every request that is not from an authorised internal caller, before any database mutation.

**Authorised callers today** (traced in repo):
- `registration-processor/index.ts:50` posts `{id, limit:1}` with the service-role bearer.
- `retry-worker/index.ts:57` (`invokeMoodleRetrySync`) posts with the service-role bearer.
- `retry-worker/index.ts:468,496` (sweep) posts with the service-role bearer.
- `dashboards/lib/dashboard.js:288`: held in the SPA; sends the user JWT.
- `moodle-settings/lib/moodle-settings.js:76`: `action:'test'` through `supabase.functions.invoke`; user JWT.
- `system-health/lib/system-health.js:139`: `action:'test'`; **anon key**.

**Design.**
1. At the top of the handler, before the reset query and before body parsing:
   - Accept a non-test request only when `Authorization: Bearer <token>` equals `SUPABASE_SERVICE_ROLE_KEY` exactly (constant-time comparison). Do not decode the JWT.
   - Accept `action:'test'` only with a verified admin JWT (profiles lookup, `is_admin()` role set preserved), not with an anon or service key.
   - Otherwise return 401 with no reads or writes.
2. `verify_jwt` stays `false`. Turning on `verify_jwt` would still admit any valid anon-key JWT, which is public, so the in-function check is the real control.
3. Rejected callers: `system-health` (anon key) and the held dashboard path. `system-health` should show "not authorised" for this probe, not a pass. This is a visible change and needs owner sign-off.
4. Audit each accepted request with its actor (service caller or admin email). Stuck-row reset is audited only after authorisation.

**Tests to add (Deno, mock DB):** no-header refused with zero writes; anon key refused; user JWT refused for non-test; service key accepted; test action admin-only; stuck reset not run on refusal.

## 4. Legacy direct writes (E3), proposed next step

The legacy pages are not in the SPA and the SPA hold does not reach them. Options, in order of preference:
- Unpublish the two `foundation/staff` pages and the `foundation/js/teacher-management.js` entry points (requires a `netlify.toml` / build-script change, owner approval).
- Or add the same hold to the legacy `activate` and `unsuspend` paths and to the approval write.

Neither is included in this branch, because the owner scoped Part A to the SPA.

## 5. Concurrency: the unconditional PROCESSING claim

`moodle-sync/index.ts` (candidate and `main`, about line 495) selects PENDING, RETRYING and FAILED rows, then runs `patchSyncRow(... sync_status: "PROCESSING")` by id. The update has no condition on the current status. Two concurrent invocations (cron plus manual, or the E1 callers) can both select the same row and both call Moodle. This can create duplicate enrolments.

**Fix design.** Make the claim conditional and check the returned row:
```sql
update moodle_enrollment_sync set sync_status='PROCESSING', sync_attempts=sync_attempts+1, last_attempt_at=now()
where id = $1 and sync_status in ('PENDING','RETRYING','FAILED')
returning id;
```
Skip the row if no row is returned. This follows the existing atomic claim pattern from `202609240001_rocksolid_atomic_nexus_claim.sql`. A migration is not needed if the update is done through the PostgREST filter (`.eq('sync_status', current)` with `.select()`), which is what the application code can do. Owner decision: which form to use.

## 6. retry-worker cron and the email-retry question

- On `origin/main` the cron call (no `Authorization`) only runs the **Moodle sweep**. It does not run email retry. Email retry needs an explicit `source` and `id` from an admin.
- On the candidate, `SCHEDULED_SWEEP_ENABLED = false`, so the hourly call does nothing except refuse. PR #28 changes the no-header path to refuse. Net effect on the candidate: the hourly cron is inert, so this refusal removes no working email retry.
- Production also runs separate functions `email-retry` (v37) and `notification-retry-helper` (v17). Whether those handle email retry must be confirmed. I did not change them.
- Scheduler authentication (which header `schedule` in `retry-worker/config.toml` sends) is **unverified**. Read the production `cron.job` table to settle it.

## 7. PR #26 and PR #31 reuse

Not duplicated here: the unauthenticated refusal in retry-worker (PR #28), the server-side Moodle hold (`moodle-retry-hold.ts`), the profile-first admin lookup (PR #31), and `SCHEDULED_SWEEP_ENABLED`. This branch does not touch `retry-worker` or `_shared`.

**PR #29 must not be merged as-is.** It is stale (base `9db8a96`, before PR #28) and its diff against the candidate deletes PR #28's hold and authorisation files. Its activation change is client-side and not atomic.

## 8. Ownership and approvals

- Agent 1: shared privileges and migrations (the approval RPC EXECUTE revocation, column grants, the claim migration if chosen).
- Agent 2: teacher attendance. Not affected by this branch.
- Agent 4: shared files and integration branches. The `teacher-portal-api` change touches a shared function file; `types.ts` gained one error code.
- Owner: E1 containment decision, E2 verification, E3 decision, the role matrix, and any deployment.
