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

### `brief/security-authz-audit-provenance` — HOLD on staging and production application (2026-10-24)

Scope: `supabase/migrations/20261024120000_audit_provenance_guard.sql` (audit_logs privileges, policies and
TEACHER_AUTH_* provenance guard) plus its regression test and recovery runbook (`docs/AUDIT_LOGS_GUARD_RECOVERY.md`).
Owner decision 2026-10-24: GO for the isolated remediation PR; NO-GO for any staging or production application.
Before any application: reconcile the nine remote-only versions (202609231000 to 202610030004) against lineage. `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md` section 8 records them as applied in production, and staging's history also ends at 202610030004, so they are not staging-only. They come from unmerged C1/C6 branches. Reconcile,
use a targeted apply method (not `supabase db push`), and get owner approval for the exact SQL. Do not
modify migration-history records. Version `20261022140000` is claimed by `brief/phase-a-security-candidate`
and must not be reused; this PR uses `20261024120000`.

Version reservation (2026-10-24): `20261024120000` is assigned to PR #32 only. No migration on any local or remote ref, worktree or open PR uses that prefix. Coordinator confirmation is still pending. `202610221200` has a same-version collision on `brief/approval-rpc-prior-status` (unpushed, `approval_rpc_prior_status.sql`). The Phase A candidate used that version once and renamed it to `20261022115900`.
