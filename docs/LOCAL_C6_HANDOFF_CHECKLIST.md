# Local C6 Handoff Checklist

Purpose: make the later comparison between the **audited GitHub baseline** (`audit/edge-functions-baseline`, based on `origin/main` @ `8b9e14ed5121aa4273c06e28a1db4ffbb40a0699`) and the recovered local C6 work deterministic. This list does **not** assume what the local implementation contains.

## 0. Preservation first
- [ ] Push the local C6 working copy to a preservation branch (e.g. `preserve/local-c6-<date>`) **before** any merge. Include untracked files (`git status --short`, `git ls-files -o --exclude-standard`).
- [ ] Record local `HEAD` SHA, local branch name, and merge-base against `origin/main`.
- [ ] Compare against the existing GitHub branches (already present, **not evaluated** here): `origin/brief/c6-atomic-claim-clean` (2 commits over main: `ce730d3`, `1e8a115`), `origin/brief/c6-timeout-hardening` (94 files vs main), `origin/cleanup-review`. Determine whether they are the same work as the local copy, older, or newer.

## 1. Mechanical diff
```bash
git diff --stat origin/main..<preserve-branch>
git diff --name-status origin/main..<preserve-branch> -- supabase/ docs/ scripts/ .github/
git diff audit/edge-functions-baseline..<preserve-branch> -- supabase/functions/_shared supabase/functions/clickup-sync supabase/functions/retry-worker supabase/functions/missed-class-detector
```
Use `diff -b`/ `--ignore-space-at-eol` when judging drift (CRLF/BOM noise is documented in CLAUDE.md).

## 2. Files / domains to compare

| Domain | Files on baseline | What to check on local |
|---|---|---|
| Nexus client | none in `_shared` (inline `fetch` in `clickup-sync`, `nexus-users-search`) | any `_shared/nexus-*.ts`; timeouts (AbortController), auth header, response-contract validation, idempotency header |
| Task create / assign | `clickup-sync/index.ts` (`createNexusTaskWithBackoff`, `resolveAssignee`, hardcoded `NEXUS_LIST_ID`/`NEXUS_SPACE_ID`) | direct-user assignment preserved; **no Sprint/Team requirement introduced**; missing-mapping behaviour |
| Atomic claim | `dedupe_key` check-then-upsert (non-atomic, F-9) | claim RPC/SQL (`INSERT … ON CONFLICT`/`UPDATE … WHERE status=…  RETURNING`), claim owner/expiry columns |
| Idempotency | `rocksolid_task_links.dedupe_key unique`; sequential reuse only | same-key concurrent calls → one external task; Nexus-side idempotency key |
| TIMEOUT_UNKNOWN | absent (network error ⇒ `FAILED`) | status enum, DB check constraint, no immediate retry from UNKNOWN |
| Reconciliation | absent | lookup-by-key against Nexus, repeat-safe, race-safe, malformed/unavailable remote, already-reconciled |
| Stale claims | absent | expiry window + recovery path, who runs it (cron? retry-worker?) |
| Retry integration | `retry-worker` calls `clickup-sync` with service key | retry-worker treats UNKNOWN as non-retryable until reconciled; **must keep this branch's auth fix (9a7e512)** |
| Legacy writers | function still named `clickup-sync`; `clickup_task_id` columns kept for compat; `foundation/staff/rocksolid-management.html` | confirm retired/redirected writers; no second Nexus writer |
| Migrations | `202607101000_rocksolid_nexus_integration.sql` only | new migration numbering (`202609240001/2` on the GitHub C6 branch), additive + idempotent, RLS on any new table, `check` constraints, grants on RPCs |
| C6 tests | none on main | list local C6 test files, how they run (Deno vs local Supabase), count, whether CI invokes them |
| Env vars | `NEXUS_API_URL`, `NEXUS_API_KEY`, `ALLOWED_ORIGINS` | any new names (timeouts, claim TTL, list/space ids) → add to `.env.example` and docs |
| Docs | `docs/migration-log.md`, `INTEGRATION_CERTIFICATION.md` | stale vs current; certification reports must be re-run against the merged HEAD |

## 3. Known merge-conflict hot spots with this audit branch
These files are modified on **both** this branch and `origin/brief/c6-atomic-claim-clean`; expect textual conflicts and re-apply intent rather than overwrite:
- `supabase/functions/clickup-sync/index.ts` — this branch removes the forged-JWT-claim acceptance (6e23198); keep that behaviour.
- `supabase/functions/retry-worker/index.ts` — this branch rejects headerless requests (9a7e512); the C6 branch also edits retry-worker. Confirm the resulting handler never treats a missing/forged Authorization as cron.
- `supabase/functions/_shared/webpush.test.ts`, `supabase/config.toml` (C6 branch edits).
- C6 branch adds `_shared/auth.ts`; this branch adds `_shared/caller-auth.ts` (deliberately different name). Decide whether to unify, but keep exact-key service auth (no decoded-claim trust).

## 4. Re-verification gate after integration
- [ ] `bash scripts/test-unit.sh` (includes `caller-auth.test.ts`, `auth-regression.test.ts`).
- [ ] With Docker/local Supabase: `scripts/test-migration.sh`, `scripts/test-security.sh`, `scripts/test-registration.sh`, `scripts/test-nexus.sh` (all BLOCKED in the cloud baseline).
- [ ] C6 scenarios: happy path, same-key repeat, concurrent claims, TIMEOUT_UNKNOWN, reconciliation (exists / missing / remote down / malformed / repeated / racing / stale / already reconciled), assignment (valid user, missing, invalid, no Sprint/Team), legacy writer retired.
- [ ] Confirm deployed cron definitions for retry-worker, email-sender, notification-*, missed-class-detector, attention-flag-push-sweep send `Authorization: Bearer <service key>` before shipping the auth guards (see baseline report F-1, F-4b).
- [ ] Re-run the full Edge Function certification against the final merged commit.
