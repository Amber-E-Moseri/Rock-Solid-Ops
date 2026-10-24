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

### `feature/teacher-onboarding-experience` — P2 candidate, HOLD: do not merge or deploy (2026-10-24)

Local branch in worktree `../rso-teacher-onboarding-experience`, based on
`origin/integration/teacher-onboarding-candidate` (`773eb69`). Not pushed. Not a PR.

Holds that stay in force:

- Teacher applications review route and nav item are registered but gated by `TEACHER_ONBOARDING_CERTIFIED`
  (false). They stay invisible until PR #22 is deployed to staging and the hold is lifted by its owner.
- Approve control is held disabled (`APPROVAL_CONTRACT_AVAILABLE = false` in
  `src/features/teacher-applications/lib/reviewApi.js`). Release requires the P1 teacher-link contract.
- Public account forms require a Turnstile site key in production (`VITE_TURNSTILE_SITE_KEY`), and Turnstile
  CAPTCHA protection must be enabled and verified in Supabase Auth. The widget alone is not enforcement.
- `TEACHER_ONBOARDING_CERTIFIED` stays `false`. The three existing release holds are unchanged.

Release condition: PR #22 deployed to staging and verified; Supabase Auth CAPTCHA, redirect and rate-limit
settings confirmed; recovery-link verification done in staging; P1 approval and activation contract certified.


### `integration/teacher-onboarding-candidate` (PR #23, stacked on PR #20) — HOLD on merge and launch (2026-10-24)

Status: draft candidate. Teacher onboarding gate `TEACHER_ONBOARDING_CERTIFIED` is false. The three other release holds are false.

Dependencies:
- PR #20 (`brief/spa-cutover-integration`, head `9391cf0`) is the base.
- PR #21 (`brief/legacy-login-safe-next`, head `026d88d`) is cherry-picked here as `489911e`. Its validator was not in PR #20's head, and the legacy `/foundation` login had the old open-redirect check.
- PR #22 (`feature/teacher-onboarding-foundation`, head `a67e950`) supplies the applicant API at runtime. It is not in this branch's history.

Holds (each must clear before launch):
1. `/auth/reset-password` now serves the hardened page on an existing public route, while onboarding is held. Live recovery-link verification is required: a real recovery email, its redirect allow-list, the recovery `amr` claim, and expired and reused links.
2. Legacy metadata-role fallback. `foundation/auth/auth-client.js` (lines 137 and 326–335) and `foundation/index.html` (lines 99–100) still read `user_metadata` and `app_metadata` when the profile is empty or missing. The SPA `AuthContext` is fixed; the legacy pages are not. Fixing them changes 49 legacy pages and needs owner approval.
3. CI coverage. `ci.yml` now also runs `pull_request` for base `brief/spa-cutover-integration`, and the unit job runs the PR #21 test. Owner approval is required for this workflow change to stay.
4. Live sign-in and token-refresh test, to confirm the fail-closed refresh does not cause an unintended sign-out loop. Not verified.

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
