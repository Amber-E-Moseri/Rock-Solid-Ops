# Release ledger

Coordination record. Documentation only. Last updated 2026-10-25.

## Closeout: PR #37 (nine C1/C6 migration files, history-only)

- Status: COMPLETE.
- Merge SHA: `6e092a74883a97fba8099cdfbbc7f85b8b1208a5`, merge commit, parents `8510e818` (main before) and `1b6458ae` (PR head).
- Scope: the nine migration files only, unchanged from `origin/integration/c6-edge-security`.
- Main CI on the merge commit: Unit tests, Migration gate, Security regression all passed.
- Database histories verified after merge (SELECT only):
  - Staging (`hblahcaozlttknkzvkib`): 159 versions, latest `202610030004`.
  - Production (`foundation-school`, `xelpsttqhrcqmttmjory`): 160 versions, latest `202610220100`.
- No migration was recorded, replayed or applied. No `supabase db push`. No Edge Function deployment. No Netlify publication.
- No further verification of these nine files unless new conflicting evidence arises.

## Unresolved history item

- `202610220100` (`repair_class_options_registration_columns`): recorded in production, not in staging. The two `class_options` columns exist in both.
- Status: UNRESOLVED. Needs a separately approved reconciliation procedure. Not to be recorded or applied without that approval.

## Other merges on record

- PR #21 (legacy login safe-next redirect): merged to `main` at `8510e818`, under prior owner direction. Its Netlify publication is a separate release action.

## Unresolved security-release gates

| Gate | State | Evidence / blocker |
|---|---|---|
| Legacy login: unprotected password-reset call on `main` | OPEN | `main` still sends `resetPasswordForEmail` from the legacy page. The hold is in PR #26 and the removal is in PR #29. Neither is on `main`. |
| `audit_logs` privilege guard (PR #32) | OPEN, not applied anywhere | Production and staging both grant anon and authenticated write and TRUNCATE. Compatibility with both policy shapes confirmed. Staging-only apply, owner approval required (A1). |
| Moodle retry server hold | NOT VERIFIED on `main` | Server-side hold merged to the consolidated candidate branch (PR #28, `d5d6e71`), not to `main`. Equivalence to `main`'s `f2cf8c7` not checked. |
| PR #29 (legacy reset removal, Moodle hold cleanup) | BLOCKED | Merge state DIRTY (conflicts with the candidate). Needs rebase and reconciliation with the existing shared hold module. |
| PR #31 (retry-worker fail-closed admin lookup) | PASS on its own CI | Fast-forward on candidate; not yet on `main`. |
| PR #26 consolidated NEXT-release candidate | DRAFT | CI green. Not integrated into `main`. |
| Staging security remediation | BLOCKED | No staging evidence recorded. |
| Nexus C6 certification | BLOCKED | Live or staging Nexus round trip not run. PR #2 open since 2026-09-25. |
| Attendance submit, availability approval, Moodle retry holds | HELD | `ATTENDANCE_SUBMIT_CERTIFIED`, `APPROVAL_CERTIFIED`, `MOODLE_RETRY_CERTIFIED` all `false`. |
| Production deploy `6adce108` and rollback candidate | LOCKED | Owner-provided records. Rollback candidate `6adb8d7d` (commit `3ab00a2`). Not independently verified against live Netlify. |
| PR #30 (emoji cleanup) | DRAFT | Pending remaining visual evidence. Not merged. |
