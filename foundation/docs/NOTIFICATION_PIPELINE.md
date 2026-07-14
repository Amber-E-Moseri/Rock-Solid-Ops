# Notification Pipeline

Authoritative reference for the Foundation School email notification pipeline.
Keep this document up to date when pipeline functions change.

Last updated: July 14, 2026

---

## Canonical Flow

```
┌─────────────────────────────────────────────────────┐
│         scheduled_notifications                     │
│         status = PENDING, scheduled_for <= now()    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼  (batch, every run)
         ┌─────────────────────────┐
         │    notification-batch-processor   │  ← CANONICAL BATCH PROCESSOR
         │                         │
         │  Reads:  scheduled_notifications (PENDING, due)
         │  Writes: email_queue (status=Pending)
         │  Marks:  scheduled_notifications (status=SENT)
         │  Logs:   audit_logs
         └──────────────┬──────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│         email_queue                                 │
│         status = Pending                            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼  (cron: daily 07:00 EST)
         ┌─────────────────────────┐
         │      email-sender       │  ← CANONICAL DELIVERY WORKER
         │                         │
         │  Reads:  email_queue (status=Pending, batch 50)
         │  Resolves: body_html from row or email_templates
         │  Sends:  Resend API
         │  Marks:  email_queue (status=Sent | Failed)
         └─────────────────────────┘
```

---

## Function Responsibilities

### notification-batch-processor — CANONICAL BATCH PROCESSOR

**File:** `supabase/functions/notification-batch-processor/index.ts`
**Schedule:** Not on a fixed cron; invoked on-demand or by upstream trigger.
**Status:** Active — canonical.

Responsibility:
- Reads `scheduled_notifications` where `status = PENDING` and `scheduled_for <= now()`
- For each row: inserts a corresponding `email_queue` row (`status = Pending`)
- Marks the notification `SENT` and increments `attempts`
- Writes an `audit_logs` entry per notification queued
- On row-level error: marks notification `FAILED` or leaves at `PENDING` if retries remain

This is the **only** function that should move scheduled_notifications into email_queue.

---

### email-sender — CANONICAL DELIVERY WORKER

**File:** `supabase/functions/email-sender/index.ts`
**Schedule:** `0 12 * * *` (daily 07:00 EST / 12:00 UTC winter)
**Status:** Active — canonical.

Responsibility:
- Reads up to 50 `email_queue` rows where `status = Pending`
- Resolves email content: uses `body_html` on the row if present, otherwise fetches from
  `email_templates` table by `template_key`
- Substitutes `{{variables}}` from row fields and `metadata`
- Sends via Resend API using `RESEND_API_KEY` env var
- On success: marks row `Sent`, sets `sent_at`
- On failure: marks row `Failed`, sets `error_message`
- Logs run summary to `sync_log`

---

### retry-worker — UNIFIED RETRY + MOODLE SWEEP

**File:** `supabase/functions/retry-worker/index.ts`
**Schedule:** `0 * * * *` (hourly)
**Status:** Active — canonical retry handler.

Responsibility:
- **`action: "retry"`** — single-item retry for `email_queue` or `scheduled_notifications`:
  - Reads row, validates status is FAILED/ERROR/PENDING (case-insensitive)
  - Increments `attempts`
  - For `email_queue`: resets `status = "Pending"`, clears `error_message` / `last_error`
  - For `scheduled_notifications`: resets `status = "PENDING"`, resets `scheduled_for = now()`, clears `last_error`
- **`action: "sweep"`** — auto-sweeps Moodle enrollment failures, retries failed syncs
- On the hourly cron: runs the Moodle sweep automatically

This function merges all logic previously split across `email-retry` and `notification-retry-helper`.
Both of those functions are now tombstoned (HTTP 410).

---

### sender-worker — DELETED

**File:** `supabase/functions/sender-worker/index.ts`
**Schedule:** None.
**Status:** DELETED — removed May 18, 2026. No historical stuck rows remained.

Legacy reconciliation behavior is retired. See git history for one-off reconcile script.

---

## Retry Behavior

### Notification-level retry (scheduled_notifications)

When a notification is FAILED or stuck PENDING, an operator can trigger a retry via the
Retry Center. This calls `retry-worker` with `{ action: "retry", source: "scheduled_notifications", id }`,
which resets it to `PENDING` with `scheduled_for = now()`. On the next `notification-batch-processor` run,
it will be picked up and re-queued to `email_queue`.

### Email-level retry (email_queue)

When an `email_queue` row is `Failed`, the operator can reset it to `Pending` via the
Retry Center. This calls `retry-worker` with `{ action: "retry", source: "email_queue", id }`.
On the next `email-sender` cron run (daily 07:00 EST), it will be retried.

### Retry limits

| Table | Max attempts field | Behavior at limit |
|---|---|---|
| `scheduled_notifications` | `max_attempts` | Marked FAILED, not re-queued |
| `email_queue` | No built-in limit | Manual reset required |

---

## Operational Troubleshooting

### Notification sent but email not received

1. Check `scheduled_notifications` row status — should be `SENT`.
2. Check `email_queue` for a matching row with `template_key` and `recipient_email`.
3. Check `email_queue.status` — `Failed` means Resend rejected it; see `error_message`.
4. Check `email_queue.status = Sent` + `sent_at` — confirms successful Resend delivery.
5. If `email_queue` row is `Pending` and `sent_at` is null, `email-sender` has not run yet
   (cron fires daily at 07:00 EST).

### Notification stuck as PENDING

1. Confirm `scheduled_for <= now()` on the row.
2. Confirm `notification-batch-processor` has run (check `audit_logs` for `SCHEDULED_NOTIFICATION_QUEUED`).
3. If not run: trigger `notification-batch-processor` manually via the Retry Center or admin API.
4. If `attempts >= max_attempts`: row will not be picked up — use Retry Center to reset.

### email_queue row stuck as Pending

1. Confirm `email-sender` cron is active (check `supabase/functions/email-sender/config.toml`).
2. Trigger `email-sender` manually if needed.
3. Check `RESEND_API_KEY` env var is configured.

### Notification marked FAILED unexpectedly

If a notification is FAILED with `last_error` like "No matching email_queue row found":
this is the `sender-worker` reconciliation behavior. `sender-worker` must be unscheduled.
Confirm it has no cron and has not been manually triggered. Reset the notification via the
Retry Center.

---

## Active Cron Summary

| Function | Schedule | Role |
|---|---|---|
| `email-sender` | `0 12 * * *` (daily 07:00 EST) | Resend delivery |
| `retry-worker` | `0 * * * *` (hourly) | Moodle enrollment retry sweep + unified retry handler |
| `missed-class-detector` | `15 2 * * *` (daily 02:15) | Attendance gap detection |
| `notification-batch-processor` | None (on-demand) | Notification batch queuing |

---

## Trace ID

Both `scheduled_notifications` and `email_queue` carry a `trace_id` UUID column.

- `scheduled_notifications.trace_id`: NOT NULL, auto-generated (`gen_random_uuid()`) on
  insert. Backfilled for pre-migration rows.
- `email_queue.trace_id`: nullable, copied from `scheduled_notifications.trace_id` by
  `notification-batch-processor` at queue time. Pre-migration rows have `trace_id = NULL`.
- `moodle_enrollment_sync.trace_id`: nullable, populated when enrollment sync rows are
  created from registration flows that have a trace context.

Trace lifecycle (current):
1. `registration-processor` creates one flow `trace_id` per registration run.
2. That same `trace_id` is written to immediate `email_queue` notifications and any
   `scheduled_notifications` created by the same flow.
3. `notification-batch-processor` propagates `scheduled_notifications.trace_id` into `email_queue`.
4. `moodle_enrollment_sync` rows created from assigned registrations carry the same `trace_id`.
5. Retry Center surfaces `trace_id` for failed notification/sync rows when available.

To trace a notification end-to-end:

```sql
-- Find all email_queue rows for a scheduled notification
SELECT eq.*
FROM email_queue eq
JOIN scheduled_notifications sn ON sn.trace_id = eq.trace_id
WHERE sn.id = '<notification-id>';

-- Or directly by trace_id if you already know it
SELECT * FROM scheduled_notifications WHERE trace_id = '<trace-id>';
SELECT * FROM email_queue           WHERE trace_id = '<trace-id>';
SELECT * FROM moodle_enrollment_sync WHERE trace_id = '<trace-id>';
```

Both tables have an index on `trace_id` for efficient lookups.

Operator lookup flow:

```sql
-- 1) Resolve trace from a known registration/applicant
SELECT id as applicant_id, email, created_at
FROM applicants
WHERE email = '<email>'
ORDER BY created_at DESC
LIMIT 1;

-- 2) Find notification rows and copy trace_id
SELECT id, trace_id, template_key, status, scheduled_for, created_at
FROM scheduled_notifications
WHERE applicant_id = '<applicant-uuid>'
ORDER BY created_at DESC;

-- 3) Follow same trace_id across outbound email + Moodle sync
SELECT id, status, recipient_email, sent_at, error_message, created_at
FROM email_queue
WHERE trace_id = '<trace-id>'
ORDER BY created_at ASC;

SELECT id, sync_status, failure_reason, last_error, updated_at
FROM moodle_enrollment_sync
WHERE trace_id = '<trace-id>'
ORDER BY updated_at ASC;
```

---

## Future Work

- Rename completed: `reminder-processor` -> `notification-batch-processor`.
- Consider adding a `notification-batch-processor` cron schedule once the batch behavior is confirmed
  stable in production.
- Surface `trace_id` in System Health per-applicant trace view when that feature is built.

---

## Operational Trace MVP (May 2026)

System Health now includes a read-only Operational Trace panel for debugging by:
- applicant email
- applicant ID
- student ID
- registration ID

Data is pulled via SQL RPC `public.get_operational_trace(...)` and normalized into a
chronological timeline across:
- applicants
- students
- class_roster
- moodle_enrollment_sync
- scheduled_notifications
- email_queue
- audit_logs
- sync_log
- error_submissions (best-effort)

Current limitation:
- This MVP intentionally uses tolerant joins and legacy fallback matching (email + JSON extraction).
- Older records may produce partial or duplicate matches.

Phase 2:
- Add typed `registration_id` propagation to pipeline tables (especially notification/email logs)
  to reduce ambiguity and tighten trace joins.

Implementation note (MVP safety hardening):
- RPC is `SECURITY DEFINER` with `search_path = public`.
- Execute privilege is limited to `authenticated` only.

---

## Deleted / Tombstoned Functions

| Function | Status | Date | Reason |
|---|---|---|---|
| `sender-worker` | Deleted | May 18, 2026 | Deprecated reconciliation path removed; no stuck PENDING rows |
| `scheduled-notification-sender` | Deleted | May 18, 2026 | Renamed to `notification-retry-helper`; old stub removed |
| `sender-healthcheck` | Deleted | May 18, 2026 | Non-operational stub retired |
| `email-retry` | Tombstoned (410) | May 23, 2026 | Merged into `retry-worker` — supports both `email_queue` and `scheduled_notifications` |
| `notification-retry-helper` | Tombstoned (410) | May 23, 2026 | Merged into `retry-worker` — `scheduled_for` reset behavior preserved |

---

## Template Inventory

Full audit of every row in `notification_templates` as of July 14, 2026 (43 rows). This is
the only table `email-sender` reads from (`email-sender/index.ts` — canonical template source
comment: "`notification_templates` only"); the separate `email_templates` table is dead code
with zero readers anywhere in `supabase/functions/` or `foundation/`.

Three producers (`campaign`, `report`, `announcement`) queue emails against template keys
that have **no corresponding row** in `notification_templates` at all — they aren't in the 43
rows below because there's no row to list. See Known Issues.

| Template Key | Status | Producer(s) | Notes |
|---|---|---|---|
| `foundation_welcome` | live | `_shared/lib/assign-applicant.ts:176`, called from `registration-processor` (immediate ASSIGNED) and `admin-api` manual assign | `phase2-processor`'s call site is likely dead (its own registration path returns 410) |
| `no_class_available` | live | `registration-processor/index.ts:495,509` | WAITLISTED + no class option available |
| `no_suitable_times` | live | `registration-processor/index.ts:494,509` | PENDING + NO_MATCHING_TIME |
| `class_assigned` | live | `registration-processor/index.ts:620` → `notification-batch-processor` (daily 9am cron pass-through) | |
| `duplicate_registration` | live | `registration-processor/index.ts:493,509` | |
| `class_reminder_7_day` | unwired-reserved | none | reserved; see migration-log.md 2026-07-14 entry (extends prior reserved-templates entry) |
| `class_reminder_1_day` | unwired-reserved | none | reserved; see migration-log.md 2026-07-14 entry |
| `class_reminder_2_hour` | unwired-reserved | none | reserved; see migration-log.md 2026-07-14 entry |
| `waitlist_confirmation` | live | `registration-processor/index.ts:497,509` | WAITLISTED fallback, no other template matched |
| `registration_under_review` | live | `registration-processor/index.ts:496,509` | duplicate-flagged (name) — see `registration_under_review_checkin` |
| `engagement_never_started` | live, duplicate-flagged | `student-engagement-monitor/index.ts:168,314` (daily cron) **and** manual "Send Check-in" button (`at-risk-students.html`, `atRisk.js`) | dual producers, no shared dedupe — see Known Issues |
| `engagement_dropped_off` | live, duplicate-flagged | `student-engagement-monitor/index.ts:252` (daily cron) **and** the same manual button | same dual-producer gap |
| `engagement_final_notice` | unwired-reserved | none | reserved; see migration-log.md 2026-07-14 "Reserved templates explicitly unwired" |
| `missed_class_checkin` | live, trigger unconfirmed | `missed-class-detector/index.ts:277` | no cron/schedule for this function found anywhere in the repo despite docs claiming a daily cron exists — see Known Issues |
| `registration_under_review_checkin` | live | `review-checkin/index.ts:102` (daily cron) | duplicate-flagged (name) — see `registration_under_review` |
| `teacher_suspended` | live, legacy-only | `foundation/js/teacher-management.js:433` | SPA equivalent is stubbed (no-op) — see Known Issues |
| `teacher_reactivated` | live, legacy-only | `teacher-management.js:441` | same SPA gap |
| `class_reassignment_notice` | live | `applicant-directory.js:1313` (legacy) + `mutations.js:93` (SPA) | expected legacy/SPA pair, not a bug |
| `teacher_approved` | live, legacy-only | `teacher-management.js:459` | same SPA gap |
| `teacher_rejected` | live, legacy-only | `teacher-management.js:467` | same SPA gap |
| `batch_rollover_notice` | live | `batch-management.html:407` (legacy) + `batchManagement.js:108` (SPA) | expected pair |
| `waitlist_promoted` | unwired-reserved, contested | none | reserved per 2026-07-14 log entry; `brief/email-template-consolidation` (unmerged) deactivates it as "orphaned" — unresolved conflict, see Known Issues |
| `class_time_changed` | live | `class-editor.html:517` (legacy) + `classEditor.js:109` (SPA) | expected pair |
| `class_slot_cancelled` | unwired-reserved | none | reserved; see migration-log.md 2026-07-14 "Reserved templates explicitly unwired" |
| `classes_now_available` | live, duplicate-flagged | DB trigger `queue_waitlisted_class_available_notifications()` (`202605191920...sql`) | duplicate pair with `class_now_available` — pending merge of `brief/waitlist-dedup-consolidation` |
| `class_assigned_confirmation` | live | `class-selection/index.ts:173` | student self-selects a class via token link |
| `direct_message` | live | `messaging-api/index.ts:413` (in-app messaging) + `direct-email-modal.js:212` (admin ad-hoc broadcast) | one template shared by two unrelated features — see Known Issues |
| `moodle_credentials` | live | `moodle-sync/index.ts:571,602` | fires after Moodle account is created/enrolled |
| `makeup_reminder` | unwired-reserved | none | no producer found anywhere in the repo; not previously documented as reserved — flagging here for the first time |
| `moodle_login_reminder` | live | `submit-teacher-attendance.ts:336` → `notification-batch-processor` (`moodle_login_check` handling, daily cron) | |
| `class_now_available` | live, duplicate-flagged | `waitlist-processor/index.ts:77` (15-min cron) | duplicate pair with `classes_now_available` — pending merge of `brief/waitlist-dedup-consolidation` |
| `WELCOME` | dead (deactivated) | none | empty body, dupe of `foundation_welcome` — deactivated in `202607142000` |
| `CLASS_ASSIGNED` | dead (deactivated) | none | empty body, dupe of `class_assigned` — deactivated in `202607142000` |
| `TEACHER_ROSTER_DAILY` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `TEACHER_ROSTER_WEEKLY` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `WEEK3_FOLLOWUP` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `WEEK6_FOLLOWUP` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `ATTENDANCE_FLAG_CLASS1` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `ATTENDANCE_FLAG_REPEAT` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `GRADUATION_READY` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `TRANSITION_OVERDUE` | dead (deactivated) | none | empty body — deactivated in `202607142000` |
| `attendance_reminder` | live | `attendance-reminder/index.ts:151` (daily cron) | promoted from `email_templates` by `202605221030` but is real/live — not a dead stub |
| `attendance_escalation` | live | `attendance-reminder/index.ts:184` (same daily cron) | same — real/live, not a dead stub |

### Known issues — not fixed in this pass

These were found during the same audit that produced the table above. None are touched by
migration `202607142000` — flagging them here so they aren't lost, not proposing fixes.

- **`campaign` / `report` / `announcement` have no `notification_templates` row at all.**
  `email-sender`'s `resolveContent` throws `"No template found for key: ..."` for any of
  these — every queued send (fellowship-wide campaigns, weekly/monthly regional reports,
  batch-wide announcements) currently lands `Failed`. Live producers:
  `foundation/js/email-campaigns.js` + SPA equivalent (`campaign`), `report-generator/index.ts`
  (`report`), `batch-management.html` + SPA (`announcement`).
- **SPA teacher-status emails silently no-op.**
  `foundation-spa/src/features/teacher-management/lib/teacherManagement.js:80-83` builds the
  template map but never inserts into `email_queue` — comment reads *"Email would be queued
  here in production."* Teacher suspend/reactivate/approve/reject emails only send when the
  action is taken from the legacy page, never from the SPA.
- **`notification-dispatcher` / `notification_rules` is entirely dead machinery.** Every real
  send in this codebase is a direct `email_queue`/`scheduled_notifications` insert from
  application code. No live producer anywhere reaches the rules/dispatcher path — this
  corrects an earlier audit (2026-07-13 Email Pipeline Audit) that believed one producer used
  it; that producer (the waitlist trigger) actually inserts directly and just happens to share
  an `event_type` name with an orphaned rule row.
- **`class-selection`'s `notify_waitlisted` action is unreachable dead code** (produces
  `classes_now_available`, but nothing anywhere calls it — the real producer for that key is
  the DB trigger).
- **`missed-class-detector`'s cron trigger can't be confirmed.** Docs (`README.md`,
  `SYSTEM_OVERVIEW.md`, `NOTIFICATION_PIPELINE.md` itself) all claim a daily `15 2 * * *`
  cron, but no `pg_cron` migration or `config.toml` schedule line exists anywhere in the repo
  for this function, unlike every sibling cron function. Either it relies on an
  out-of-repo Dashboard cron, or `missed_class_checkin` doesn't actually send today.
- **`phase2-processor`'s call into the shared assignment/welcome-email pipeline is likely
  dead** — its own registration path is hard-410'd, and no DB webhook wiring it to `applicants`
  INSERT exists in the repo despite docs claiming one does.
- **`classes_now_available` vs `class_now_available`** — confirmed duplicate pair (two
  templates, two producers, same "a class opened up for you" purpose). Already being fixed on
  the unmerged `brief/waitlist-dedup-consolidation` branch; not touched here.
- **`registration_under_review` vs `registration_under_review_checkin`** — different real
  purposes (initial review notice vs. a days-later follow-up), but similar enough names to be
  easy to mix up when wiring a new event trigger.
- **`engagement_never_started` / `engagement_dropped_off` have two uncoordinated producers**
  each: a daily cron and a manual "Send Check-in" button on the At-Risk Students page. The
  cron path checks `student_engagement_log` before queuing; the manual button does not appear
  to check the same log — same duplicate-risk shape as the waitlist bug already fixed
  elsewhere, not yet addressed here.
- **`direct_message` is shared by two unrelated features** — in-app peer messaging and an
  admin's ad-hoc broadcast modal. Not confirmed wrong, worth a copy review to make sure the
  template reads sensibly for both.
- **`waitlist_promoted` has conflicting fates on two unmerged branches.** The existing
  2026-07-14 "Reserved templates explicitly unwired" log entry keeps it active/reserved;
  `brief/email-template-consolidation` deactivates it as orphaned. Both are correct that it
  has no producer — they disagree on what to do about it. Whoever merges either branch first
  should resolve this.
- **`makeup_reminder` has zero producers anywhere** and wasn't previously documented as
  reserved (unlike its siblings `class_slot_cancelled`, `waitlist_promoted`,
  `engagement_final_notice`, and the three `class_reminder_*` keys). Flagging it here for the
  first time; not deactivated in this pass since it's real content, not an empty stub, and may
  simply be awaiting a producer rather than being dead.

