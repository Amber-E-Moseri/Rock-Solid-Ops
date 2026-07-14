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

### `brief/moodle-credential-safety`

Status: SQL-query hold resolved. Branch still not ready to merge: remaining open gate is
test-verification/manual-verification of the core Moodle warnings-detection fix.

Resolution: operator ran both live-database queries. Query 1 returned 9 students spanning
2026-05-17 through 2026-06-28 in the "SYNCED with no grades activity" shape, plus 4 separate
data-integrity rows (`SYNCED` with `synced_at IS NULL`) that are not part of this hold.
Query 2 confirmed the broader Moodle-rejection mechanism is real on a create-user path, while
not directly hitting the exact silent password-reset bug this branch fixes — expected, because
that silent path logged nothing. Operator then manually verified the other affected students'
logins and confirmed only `taquangminh081` needed a manual credential fix. This closes the
incident-classification/SQL-query gate: confirmed isolated incident, not systemic outbreak.

Remaining gate before any merge decision: the branch's separate
test-verification/manual-verification gate. The core fix still has synthetic-fixture coverage
only; it has not been verified against a real Moodle rejection response.

Separate open follow-up, not part of the resolved SQL hold: 4 data-integrity rows were found
with `sync_status = 'SYNCED'` and `synced_at IS NULL`, including duplicate emails with differing
`moodle_user_id` values. That issue remains unaddressed and must not be silently dropped.

Queries that were reviewed for this resolved hold:

```sql
-- Query 1: other students currently in the same synced-but-silent state
-- Reconstructed durably from the branch's own fixed 48h threshold logic in
-- 202607131700_moodle_no_login_flag_threshold.sql because the current checked-in
-- migration-log entry refers to these queries but does not preserve the SQL text.
SELECT
  ms.id,
  ms.applicant_id,
  ms.student_id,
  ms.email,
  ms.full_name,
  ms.batch_id,
  ms.class_option_id,
  ms.course_id,
  ms.moodle_user_id,
  ms.sync_status,
  ms.synced_at,
  ms.created_at,
  ms.updated_at
FROM public.moodle_enrollment_sync ms
JOIN public.applicants a
  ON a.id = ms.applicant_id
WHERE upper(COALESCE(ms.sync_status, '')) = 'SYNCED'
  AND COALESCE(a.registration_status, a.status) = 'ASSIGNED'
  AND ms.synced_at < now() - interval '48 hours'
  AND NOT EXISTS (
    SELECT 1
    FROM public.student_grades sg
    WHERE sg.applicant_id::text = a.id::text
       OR sg.student_id::text = a.id::text
  )
ORDER BY ms.synced_at DESC NULLS LAST, ms.created_at DESC;
```

```sql
-- Query 2: historical audit-log evidence of Moodle password rejection
-- Reconstructed durably from moodle-sync's failure logging shape on this branch:
-- action MOODLE_SYNC_FAILED on entity_type moodle_enrollment_sync, with the rejection
-- surfaced in details.message as MOODLE_WARNING_REJECTED...
SELECT
  al.id,
  al.logged_at,
  al.entity_id,
  al.action,
  al.status,
  al.details
FROM public.audit_logs al
WHERE al.entity_type = 'moodle_enrollment_sync'
  AND al.action = 'MOODLE_SYNC_FAILED'
  AND (
    COALESCE(al.details->>'message', '') ILIKE '%MOODLE_WARNING_REJECTED%'
    OR COALESCE(al.details->>'reason', '') ILIKE '%MOODLE_WARNING_REJECTED%'
    OR al.details::text ILIKE '%password%'
    OR al.details::text ILIKE '%warning%'
  )
ORDER BY al.logged_at DESC;
```

Current instruction: do not merge this branch yet. The SQL-query hold is closed, but the
remaining test-verification gate is still open until the operator explicitly decides whether to
1. find a way to verify against a real Moodle rejection response,
2. accept synthetic-fixture-only verification for this now-confirmed isolated edge case, or
3. choose a different gate/verification path.
