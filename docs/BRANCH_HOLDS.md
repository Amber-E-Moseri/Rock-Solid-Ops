# Branch Holds

Durable branch-level merge holds that must be visible without reading the full migration log.

## Active Holds

### `brief/waitlist-dedup-consolidation`

Status: work complete, deliberately NOT merged (2026-07-14, per operator's Phase B brief).

This brief lands on its branch and stops. Two explicit gates before merge:
1. The operator must run the verification checklist in the migration-log entry
   "2026-07-14 — Waitlist 'class available' dedup consolidation" (db push, dedupe index,
   template state, trigger-path single-row check, cron-path suppression check,
   orphan-token check).
2. The operator sequences `brief/email-template-consolidation`, which is to be REBASED ON
   TOP of this branch afterward. Do not merge this branch out of order and do not touch
   `brief/email-template-consolidation` from other sessions.

One flagged item awaiting possible operator override: the operator brief contained a line
"no changes to the template body," but the earlier explicit gate approval of the merged
canonical body supersedes it (main session flagged the conflict to the operator). The body
update is isolated in section 2 of `202607141000_waitlist_consolidate_dedup.sql`,
strippable on its own if the operator reverses.

### `fix/registration-class-options-drift` — HOLD on production execution (2026-10-22)

Status: repair migration `202610220100` written, reviewed and tested on an isolated model (17 of 17 PASS).
PR #6 open; CI migration gate passed. Runbook: `docs/REGISTRATION_CLASS_OPTIONS_REPAIR_2026-10-22.md`.

Hold conditions before the production SQL runs:
1. Owner approval for this exact DDL only (`is_online`, `confirmed_start_date` on `public.class_options`).
2. Preflight queries P1–P4 match the expected values in the runbook.
3. The production schema-history row is recorded by an approved mechanism. `supabase db push` is not
   suitable while production has 9 remote-only versions (`202609231000`…`202610030004`).
4. Operational readiness: public registrations re-open when the class list works.

Do not execute the other 60 non-baseline drifted objects, or the remote-only C1/C6 versions, in the same change.

### `rocksolid-staging` (site `268dac64…`) — HOLD on any deployment or retirement (2026-10-22)

Status: no repository files are published (every probed repository path returns the SPA shell, identical
bytes). Manual deploys only. Last deploy 2026-09-19. Staging database shows no applicant or audit activity
since 2026-09-19. Owner decision needed: restrict access (for example, password protection if the plan allows)
or retire. No change has been made.

### Production schema drift and unapplied-but-recorded migrations — HOLD (2026-10-22)

Production has 60 non-baseline schema objects that repo migrations create but production lacks (see the
migration log entry of the same date). Several affect security (RLS policies on `attendance_records`
are not the intended teacher-scoped set; the audit canonicalization trigger and columns are absent).
Production also has 9 migration versions from the unmerged C1 and C6 branches recorded as applied, which are
not on `main`. No production schema change beyond the approved registration DDL is authorised.

### PR #12 (`brief/spa-cutover-v2`) — uncertified workflows held for full operational release (2026-10-22)

PR #12 is certified for **limited frontend rollout only**, at SHA `524725e`. Record: `docs/migration-log.md`,
entry 2026-10-22 (PR #12 limited frontend certification). PR #12 stays draft and unmerged.

The following workflows stay disabled and are NOT certified for full operational release:

- Teacher attendance submission — `ATTENDANCE_SUBMIT_CERTIFIED = false` (`foundation-spa/src/releaseHolds.js`).
- Availability approval — `APPROVAL_CERTIFIED = false`.
- Moodle retry — `MOODLE_RETRY_CERTIFIED = false`.

Release condition: each flag may be set to `true` only after its own backend certification is recorded.
Do not set any flag as part of PR #12 or this documentation change.

### PR #21 (`brief/legacy-login-safe-next`) — login-security dependency for PR #20 (2026-10-23)

PR #21 is the separate legacy `/foundation` login open-redirect fix (`safe-next`), head `026d88d`, open and
not merged. It is a release dependency of PR #20 (`brief/spa-cutover-integration`), not part of it. PR #20 does
not contain the legacy login fix. The older candidate `d39ed1e` (`brief/static-login-next-hardening`) is
superseded by PR #21 and must not be imported or merged.

Release condition: PR #21 must be reviewed and merged under its own owner gate before any limited SPA launch
that keeps `/foundation/auth/login.html` live. Verify its status before the next staging run.

Known limitation: the staging harness must refresh authentication after sign-out, because the sign-out test
revokes the teacher session that later tests reuse.


## Resolved (moot — already merged)

### `brief/moodle-credential-safety` — RESOLVED 2026-07-23

This entry was stale. Verified 2026-07-23: the branch's full commit range (through
`911e3a2 docs: Phase A findings for real-Moodle verification gate`) is already an ancestor
of `main` (`git log main..911e3a2` is empty) — it was committed directly to `main` in an
earlier session, before this hold was written. There is nothing left to merge. The
`rso-moodle-credential-safety` worktree (detached HEAD at `911e3a2`, one untracked
`deno.lock`) is stale and slated for removal as part of general worktree cleanup.

The separate open follow-up noted below was NOT re-verified and remains unaddressed:
4 data-integrity rows were found with `sync_status = 'SYNCED'` and `synced_at IS NULL`,
including duplicate emails with differing `moodle_user_id` values. That issue must not be
silently dropped — it needs its own brief if picked up.

### `brief/attendance-rls-containment` (PR #35, head `d94ea44`) — RESERVATION RECORDED; HOLD on staging and production application (2026-10-25)

Status: draft, not merged. Owner accepted the containment design at `d94ea44` for review. Do not apply, do not merge, do not deploy, do not record migration history.
Scope: `supabase/migrations/20261024130000_attendance_rls_containment.sql` (attendance policies and grant hardening), its security regression test, `docs/ATTENDANCE_RLS_PRODUCTION_RUNBOOK.md`, and the production-shaped fixture under `supabase/tests/`.
CI on `d94ea44`: Unit tests, Migration gate and Security regression passed. Netlify "Pages changed" is neutral.
Note: `docs/RELEASE_LEDGER.md` recorded head `79baba8b`, which is an earlier commit on this branch. The current head is `d94ea44`.

Migration reservation: **OWNER CONFIRMED (2026-10-25).** Owner decision: APPROVED. Version `20261024130000` is formally reserved exclusively for PR #35.
- Confirmed by the owner: no migration-version collisions across checked refs; PR #35 head `d94ea448`; PR #32 migration `20261024120000` must precede PR #35; existing owner-accepted attendance permission restrictions unchanged.
- This approval reserves the migration number only. It does not authorize migration execution, production changes, database history repair, PR merge, or deployment.
- PR #35 remains on HOLD until PR #32 is applied, the staging-history discrepancy is resolved, and a separately approved atomic application procedure is ready.
- Version `20261024130000` is reserved for PR #35 (`brief/attendance-rls-containment`).
- Collision check on 2026-10-25 across all local and remote refs: the version appears only on this branch. No other branch, main, or open PR head carries a `20261024…` or later migration file that collides with it.
- Preceding migration: `20261024120000_audit_provenance_guard.sql` (PR #32, `brief/security-authz-audit-provenance`, head `9b9b7046`). PR #32 has not been rebased in this step. Rebase is a gate, not done here.

Owner-accepted temporary permission changes (containment behavior, all in the migration):
- No direct authenticated writes to `attendance_records`. Authenticated keeps SELECT only.
- Pastor and subgroup_admin `attendance_records` reads are denied.
- Teacher rows without a verifiable assigned `class_option_id` remain inaccessible to teachers.
- Service-role operations are preserved. The migration does not change service-role grants.
- Accepted operational disruption: pastor and subgroup_admin lose `attendance_records` reads; teachers lose reads on rows with a null `class_option_id`.

Outstanding application gates (all must clear before any live application):
1. Reservation confirmation: satisfied by the owner decision recorded above (2026-10-25). A separate Agent 4 confirmation has not been recorded; it is not required to hold the reservation, but the owner may still request it.
2. PR #32 applied first (`20261024120000`), after its rebase onto current main and its own approval. Applying `20261024130000` before it breaks migration order. Runbook §2.
3. The atomic history procedure is pending. The apply is one file in one transaction. Recording history (`supabase migration repair --status applied 20261024130000 --linked`) needs its own exact-command approval. No unplanned gap between apply and history repair. Runbook §4–§6.
4. Separate live approvals for staging and for production. Each needs its own preflight, application window and postcheck (runbook §3, §5). The production preflight must match the 2026-10-24 captured state.
5. The staging `202610220100` history discrepancy (recorded in production, not in staging) needs its own approved reconciliation first.

Proposed single-transaction application-and-history plan (for separate review; NOT approved, NOT executed):
- Replaces the two-step `psql -1 -f` apply followed by `supabase migration repair --status applied 20261024130000 --linked`. That two-step sequence is not to be executed.
- Shape: one `psql -X -v ON_ERROR_STOP=1 -1` session containing the migration file body followed by a history insert into `supabase_migrations.schema_migrations` (version `20261024130000`, name `attendance_rls_containment`), so either both commit or neither does.
- Reviewer items to settle before any approval: confirm the history row columns (`version`, `name`, `statements`) against the CLI's own writes; confirm the CLI accepts a row inserted this way; confirm the statements field content; confirm rollback behaviour if the history insert fails.
- Preconditions: PR #32 (`20261024120000`) applied and recorded; `202610220100` staging discrepancy reconciled; exact target environment, window and preflight named per gate 4.
- Status: prepared for review only. Gates 2–5 above still apply.

Distinct follow-up issues, not in this change:
- Staging at-risk defect: `count_consecutive_misses()` reads a non-existent column.
- Production attendance_log role-scope concern: pastor and subgroup_admin have broad `attendance_log` access via `is_admin_like()` (runbook §11).

Recovery: policy-only rollback in runbook §8. The grant hardening stays in place; restoring grants is a separate owner decision.
No live application has occurred. Production verification was SELECT-only. The fixture result (44/44) is not evidence about live JWT or PostgREST behavior.
