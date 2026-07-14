# REGISTRATION STATUSES

PENDING
ASSIGNED
WAITLISTED
DUPLICATE
REVIEW
INACTIVE
COMPLETED

---

# AVAILABILITY / ASSIGNMENT STATUSES

CLASS_ASSIGNED
CLASS_FULL
NO_MATCHING_TIME
MANUAL_REVIEW_REQUIRED
CLASS_AVAILABLE

CLASS_AVAILABLE means: a NO_MATCHING_TIME applicant has been queued a
"class now available" notification (waitlist-processor cron flips the status
so the 15-minute cron does not re-notify). Allowed by the check constraint
since 202605250002; documented 2026-07-14 as part of the waitlist dedup
consolidation.

Dedupe key for the consolidated "class now available" notification
(scheduled_notifications.dedupe_key), shared by BOTH producers:

    class_available:{applicant_id}:{batch_id}:{class_option_id}

* Producers: DB trigger function queue_waitlisted_class_available_notifications
  (recreated in migration 202607141000) and the waitlist-processor cron
  (supabase/functions/waitlist-processor/dedupe.ts). The format MUST be
  byte-identical in both — parity-tested in
  supabase/functions/waitlist-processor/waitlist-dedup.test.ts.
* Timestamp-free and idempotent: one notification per
  (applicant, batch, class_option), ever, regardless of how many availability
  events fire.
* Insert-if-absent only: producers must never upsert-overwrite an existing
  row (a SENT row flipped back to PENDING re-sends). Suppressed duplicates are
  audited as WAITLIST_DUPLICATE_SUPPRESSED.
* Canonical template for this notification: 'classes_now_available'
  (notification_templates). 'class_now_available' retired/inactive 202607141000.

---

# BATCH STATUSES

DRAFT
ACTIVE
UPCOMING
COMPLETED
ARCHIVED

---

# TEACHER AVAILABILITY STATUSES

PENDING
APPROVED
REJECTED
RESET

---

# EMAIL QUEUE TYPES

foundation_welcome
duplicate_registration
waitlist_confirmation
registration_under_review
no_suitable_times
no_class_available

---

# WAITLIST RULES

WAITLISTED means:

* pending placement
* pending capacity
* pending admin review
* pending future batch assignment

WAITLISTED does NOT mean rejected.

---

# DUPLICATE RULES

DUPLICATE means:

* prior registration exists
* avoid duplicate onboarding
* avoid duplicate Moodle enrollment
* avoid duplicate class assignment

---

# REVIEW RULES

REVIEW means:

* manual admin intervention required
* conflicting data
* suspicious duplicate
* invalid assignment state
* migration inconsistency

---

### MOODLE SYNC FAILURE REASONS

MOODLE_WAF_BLOCK — retryable
MOODLE_REST_DISABLED — non-retryable
MOODLE_PERMISSION_DENIED — non-retryable
MOODLE_403_UNKNOWN — non-retryable (conservative)

---

### TEACHER MAPPING STATUS

LINKED — teacher_user_id set, portal access works
UNLINKED — no teacher_user_id, portal returns INVALID_TEACHER_MAPPING
  Fix: run link_teacher_to_auth_user(email) or use admin UI

---

### NOTIFICATION PIPELINE FUNCTIONS

notification-batch-processor — CANONICAL batch processor
  Reads: scheduled_notifications (PENDING, due)
  Writes: email_queue (Pending)
  Schedule: on-demand / trigger
  Must not be duplicated or run in parallel with sender-worker

email-sender — CANONICAL delivery worker
  Reads: email_queue (Pending)
  Writes: Resend API + delivery status (Sent | Failed)
  Schedule: cron daily 07:00 EST (0 12 * * *)

notification-retry-helper — RETRY HELPER ONLY
  Not the canonical batch sender
  Resets one scheduled_notification to PENDING on operator request
  Used by Retry Center only
  Must not be given a cron schedule
# sender-worker deleted 2026-05-18 — reconcile-stuck.sql archived in git history.
