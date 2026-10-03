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

### `integration/c6-edge-security`

Status: reconciliation complete, deliberately NOT merged and NOT pushed (2026-10-03, per operator brief).
Not production certified. Full detail: `docs/C6_EDGE_SECURITY_RECONCILIATION_2026-10-03.md`.

Gates before merge authorization:
1. **Cron cutover plan approved.** Nine migration-defined pg_cron jobs (review-checkin,
   student-engagement-monitor, waitlist-processor, report-generator x4, moodle-grade-sync,
   attendance-reminder) send `Authorization: Bearer <service key>`; this branch rejects that and
   requires `x-cron-secret`. Merging/deploying without re-creating those jobs silently stops them.
   Live `retry-worker` / `email-sender` / `notification-*` / `missed-class-detector` /
   `attention-flag-push-sweep` schedules are unknown (external) and must be verified.
2. Blocked DB/Supabase gates executed where Docker exists: migration replay, RLS/RPC tests,
   `claim_nexus_task` semantics, SKIP LOCKED concurrency, `nexus-upstream`.
3. Operator decision on `notification-dispatcher` (unauthenticated, likely legacy).
4. Operator decision on the cron credential scheme (keep `x-cron-secret`, or additionally accept the
   exact service key).
5. Confirm local C6 working copy vs `brief/c6-timeout-hardening` (not comparable from GitHub).

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
