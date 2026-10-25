# Release ledger

Central documentation record. Documentation only. Last updated 2026-10-25.

Status categories:
- **MERGED-VERIFIED:** merged, and the merge or live state was checked.
- **PREPARED:** prepared or certified, but not deployed or executed.
- **AUTHORIZED-PENDING:** authorized, but execution not reported. An authorization is not proof of execution.
- **BLOCKED:** blocked pending certification or a decision.
- **UNVERIFIED:** not verified, or only partially verified.

## Merged and verified

| Item | Evidence |
|---|---|
| PR #37: nine C1/C6 migration files, history-only | Merged at `6e092a74883a97fba8099cdfbbc7f85b8b1208a5`. Main CI passed (Unit, Migration gate, Security regression). Staging history 159 versions, production 160, both unchanged after merge. |
| PR #21: legacy login safe-next redirect fix | Merged to `main` at `8510e818`, under prior owner direction. Its CI and deploy preview passed before merge. |
| PR #31: retry-worker fail-closed admin lookup | Merged to the integration candidate lineage at `53617310`, base `integration/consolidated-spa-release-candidate`. **Not on `main`.** |

## Prepared or certified, not deployed

| Item | Status |
|---|---|
| PR #41: Moodle emergency containment | Draft, head `f080515a`. CI green at this head: Unit tests, Migration gate, Security regression, deploy preview. Not merged, not deployed. |
| PR #26: consolidated NEXT-release candidate | Draft, head `35a7ba48`, base `integration/teacher-onboarding-candidate`. CI green at prior check. **Pending updated certification at this head.** Not on `main`. |
| PR #32: audit_logs privilege guard | Draft, head `9b9b7046`. Staging preflight and clone validation complete. Compatibility with both policy shapes confirmed. Not applied. |
| PR #30: emoji cleanup | Draft, head `8d2146cd`. Not merged. |

## Authorized, awaiting execution

| Item | Note |
|---|---|
| PR #32 staging apply (A1) | Authorized. **No execution has been reported.** Staging only. A3 remains held. |

## Blocked pending certification or decision

| Item | Blocker |
|---|---|
| PR #35: attendance RLS containment | Draft, head `d94ea44` (ledger previously listed `79baba8b`, an earlier commit). Migration `20261024130000` reserved for PR #35 after a collision check on 2026-10-25; Agent 4 confirmation pending. Preceded by PR #32 (`20261024120000`). Application gates, the pending atomic history procedure and separate staging and production approvals are in `docs/BRANCH_HOLDS.md`. No live application, history record or merge authorized. |
| PR #29: legacy reset removal, Moodle hold cleanup | Draft, head `74d595bc`. Merge state DIRTY against the candidate. Needs rebase and reconciliation with the existing shared hold module. |
| PR #32 A3 | Held. |
| `202610220100` staging-history discrepancy | Recorded in production, not in staging. Columns present in both. Needs a separately approved reconciliation procedure. Not to be recorded or applied without it. |
| Nexus C6 live round-trip certification | Outstanding. No live or staging round trip has been run. PR #2 open since 2026-09-25. |
| Staging security remediation | No staging evidence recorded. |
| Attendance submit, availability approval, Moodle retry holds | Held. `ATTENDANCE_SUBMIT_CERTIFIED`, `APPROVAL_CERTIFIED`, `MOODLE_RETRY_CERTIFIED` are all `false`. |

## Unverified

| Item | Note |
|---|---|
| Production deploy `6adce108` | Locked. Owner-provided record. Not checked against live Netlify. |
| Preferred rollback for the current production SPA | Deploy `6adce108`. Pre-SPA deploy `6adb8d7d` (commit `3ab00a2`) is not the preferred rollback. Owner-provided record. |
| PR #30 authenticated visual QA | Not done. |
| Moodle retry server hold on `main` | Merged to the consolidated candidate (PR #28, `d5d6e71`), not to `main`. Equivalence to `main`'s `f2cf8c7` not checked. |
| Legacy login reset on `main` | `main` still sends an unprotected reset email from the legacy page. The hold is in PR #26, and the removal is in PR #29. Neither is on `main`. |
| Production publication of PR #21 | Merged to `main`. Production publication is not confirmed. |
