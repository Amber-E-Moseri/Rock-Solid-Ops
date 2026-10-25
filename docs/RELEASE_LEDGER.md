# Release ledger

Central documentation record. Documentation only. Last updated 2026-10-25.

Status categories:
- **MERGED-VERIFIED:** merged, and the merge or live state was checked.
- **PUBLISHED-VERIFIED:** merged, published to production, and verified live after publication.
- **DEPLOYED — VERIFICATION PENDING:** deployed to production, but post-deployment certification is not yet complete.
- **PREPARED:** prepared or certified, but not deployed or executed.
- **AUTHORIZED-PENDING:** authorized, but execution not reported. An authorization is not proof of execution.
- **BLOCKED:** blocked pending certification or a decision.
- **UNVERIFIED:** not verified, or only partially verified.

## Published and verified

| Item | Evidence |
|---|---|
| PR #21: legacy login safe-next redirect fix | **PUBLISHED-VERIFIED.** Merged to `main` at `8510e818` (merge commit; second parent is the certified head `431c602e`). Main CI passed, including the executed 9/9 safe-next tests (run `40141619791`). Published to production as Netlify deploy `6add3ad6da6e5fd93e892bdf` (source `8510e818`). Owner decision: accepted as production deployed and verified for its approved security patch scope. Publication is locked to the new deploy. Closeout accepted by the owner at ledger commit `155f987c`; not repeated. **Remains closed.** |

Post-publication live checks for PR #21:
- Production `/foundation/auth/login.html` is byte-identical to the `8510e818` file (MD5 match).
- `/foundation/auth/safe-next.js` returns 200 and is byte-identical to the `8510e818` file (MD5 match).
- `/app/`, `/app/auth/login`, `/foundation/auth/login.html`, `/foundation/staff/admin-dashboard.html` and `/foundation/teacher/` return 200.
- SPA asset manifest unchanged: `assets/index-65HQ478R.js`, the same as before publication.
- Release holds `APPROVAL_CERTIFIED`, `MOODLE_RETRY_CERTIFIED` and `ATTENDANCE_SUBMIT_CERTIFIED` are `false` in `8510e818` source. The served bundle was not checked for them.
- Publication lock: publishing was temporarily unlocked to publish the candidate only, then re-locked. Netlify then showed "Auto Publishing Locked" for the project and "Publishing is locked to this deploy" on `6add3ad6`. No other deploy was published and no build was triggered.

## Deployed — verification pending

| Item | Evidence |
|---|---|
| PR #41: Moodle emergency containment | **DEPLOYED — VERIFICATION PENDING.** Owner-confirmed: `moodle-sync` and `retry-worker` were both successfully deployed to production Supabase project `xelpsttqhrcqmttmjory` (`foundation-school`). Deployment used `--use-api` and `--no-verify-jwt`. The checkout was clean at source SHA `f080515acbc3f099872bc1bf2cd80cf992be43c6`. The versions recorded earlier were `moodle-sync` v84 and `retry-worker` v48; the deployed version numbers have not been re-verified. **PR #41 remains unmerged (draft).** Production post-deployment certification is pending. |

Outstanding PR #41 checks:
- **CORS:** `ALLOWED_ORIGINS` was not successfully updated in the earlier attempt. CORS compatibility for both production domains remains unresolved.
- **Secret-update permission failure:** the earlier `ALLOWED_ORIGINS` secret update failed with a permission error. The secret's contents have not been checked.
- **Function versions:** confirm the deployed `moodle-sync` and `retry-worker` versions match the source at `f080515a`.
- **Authorization:** confirm the functions verify the caller's authorization in code, since they were deployed with `--no-verify-jwt`.
- **JWT configuration:** confirm the platform JWT setting on each function matches the intended configuration after deployment.

## Merged and verified

| Item | Evidence |
|---|---|
| PR #37: nine C1/C6 migration files, history-only | Merged at `6e092a74883a97fba8099cdfbbc7f85b8b1208a5`. Main CI passed (Unit, Migration gate, Security regression). Staging history 159 versions, production 160, both unchanged after merge. |
| PR #31: retry-worker fail-closed admin lookup | Merged to the integration candidate lineage at `53617310`, base `integration/consolidated-spa-release-candidate`. **Not on `main`.** |

## Prepared or certified, not deployed

| Item | Status |
|---|---|
| PR #26: consolidated NEXT-release candidate | Draft, head `35a7ba48`, base `integration/teacher-onboarding-candidate`. CI green at prior check. **Pending updated certification at this head.** Not on `main`. |
| PR #32: audit_logs privilege guard | Draft, head `9b9b7046`. Staging preflight and clone validation complete. Compatibility with both policy shapes confirmed. Not applied. |
| PR #30: emoji cleanup | Draft, head `8d2146cd`. Not merged. |

## Authorized, awaiting execution

| Item | Note |
|---|---|
| PR #32 staging apply (A1) | Authorized. **Attempted, not executed:** the first `psql` attempt failed before connecting to staging. No migration was applied and no migration history changed. Staging only. A3 remains held. |

## Blocked pending certification or decision

| Item | Blocker |
|---|---|
| PR #35: attendance RLS containment | Draft, head `d94ea44` (ledger previously listed `79baba8b`, an earlier commit). Migration `20261024130000` formally reserved for PR #35: **OWNER CONFIRMED** 2026-10-25 (number only; no execution, history repair, merge or deployment authorized). Collision check passed across checked refs. Preceded by PR #32 (`20261024120000`). Grant-inclusive containment remains draft. Application gates, the pending atomic history procedure and separate staging and production approvals are in `docs/BRANCH_HOLDS.md`. No live application, history record or merge authorized. |
| PR #29: legacy reset removal, Moodle hold cleanup | Draft, head `74d595bc`. Merge state DIRTY against the candidate. Needs rebase and reconciliation with the existing shared hold module. **Do not merge as-is**, and keep separate from the PR #41 emergency Moodle patch. |
| PR #32 A3 | Held. |
| `202610220100` staging-history discrepancy | Recorded in production, not in staging. Columns present in both. Needs a separately approved reconciliation procedure. Not to be recorded or applied without it. |
| Nexus C6 live round-trip certification | Outstanding. No live or staging round trip has been run. PR #2 open since 2026-09-25. |
| Staging security remediation | Staging evidence exists for PR #32 preflight and clone validation only. No staging remediation has been applied, and the A1 attempt did not connect. |
| Broader SPA authentication and feature-hold certification | Kept separate from PR #21. Attendance submit, availability approval and Moodle retry holds remain held. `ATTENDANCE_SUBMIT_CERTIFIED`, `APPROVAL_CERTIFIED`, `MOODLE_RETRY_CERTIFIED` are all `false`. |

## Unverified

| Item | Note |
|---|---|
| Preferred rollback for the current production SPA | Deploy `6adce108e6f2eaacb214b0f6`, per owner direction. Netlify deploy page showed it as "Published & locked" before the PR #21 publication. Pre-SPA deploy `6adb8d7d` (commit `3ab00a2`) is not the preferred rollback. |
| PR #30 authenticated visual QA | Not done. |
| Moodle retry server hold on `main` | Merged to the consolidated candidate (PR #28, `d5d6e71`), not to `main`. Equivalence to `main`'s `f2cf8c7` not checked. |
| `ALLOWED_ORIGINS` membership for production `foundation-school` | **Not updated.** The earlier secret update failed with a permission error. CORS compatibility for both production domains is unresolved. The required staff origin `https://rocksolidsuite.netlify.app` must be confirmed through a secure method before CORS can be treated as compatible. |
| Legacy login password reset on `main` | `main` still sends an unprotected reset email from the legacy page. The hold is in PR #26, and the removal is in PR #29. Neither is on `main`. |

## Active security-release blockers

1. PR #29 DIRTY against the candidate; rebase and reconcile with the shared hold module.
2. PR #32 A3 held; A1 authorized, first attempt failed before connecting, no migration applied.
3. PR #41 post-deployment verification pending: CORS for both production domains (`ALLOWED_ORIGINS` not updated, earlier secret-update permission failure), function versions, authorization in code, and JWT configuration.
4. `202610220100` staging-history discrepancy needs an approved reconciliation procedure.
5. Nexus C6 live round-trip certification outstanding.
6. Staging security remediation: no staging evidence recorded beyond PR #32 preflight.
7. Legacy login password reset: unprotected on `main` until PR #26 or PR #29 lands.
