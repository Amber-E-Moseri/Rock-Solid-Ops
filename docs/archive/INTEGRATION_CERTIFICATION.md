# ROCK SOLID OPS — INTEGRATION CERTIFICATION

**Date:** 2026-09-16  
**Status:** IN PROGRESS  
**Scope:** Foundation School Platform (Internal Staff Operations)

---

## IDENTIFIED INTEGRATIONS

Based on codebase audit (all edge functions, migrations, and configuration):

### 1. **Supabase** (Canonical Backend)
- **Role:** Primary backend for all data, auth, and orchestration
- **Functions:** Postgres + Supabase Auth + Supabase Edge Functions
- **Dependencies:** All registration, attendance, enrollment, and operational flows
- **Configuration:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side)
- **Status:** ACTIVE (mandatory, not optional)

### 2. **Moodle** (Enrollment Sync)
- **Role:** External LMS enrollment and grade sync
- **Functions:** `moodle-sync` (enrollment), `moodle-grade-sync` (grades), `moodle-profile-sync` (future)
- **Dependencies:** Enrollment pipeline (registration → ASSIGNED status → moodle-sync)
- **Configuration:** `MOODLE_URL`, `MOODLE_TOKEN`
- **Status:** ACTIVE (enrollment push, grade pull, 403 classification hardened)
- **Failure Handling:** HTTP 403 failures classified as WAF, REST-disabled, or permission-denied; non-retryable failures preserved in audit
- **Retry Scope:** Moodle timeouts/transients retried; WAF blocks retried; permission/config errors NOT retried
- **Escalation:** Non-retryable Moodle failures escalated to `rocksolid_task_links` (Nexus task)

### 3. **Resend API** (Email Sending)
- **Role:** Transactional email delivery
- **Functions:** `email-sender` (queue processor), triggered by `email-queue` table
- **Dependencies:** All registration confirmations, waitlist, attention-flag, approval notifications
- **Configuration:** `RESEND_API_KEY`
- **Schedule:** Every 15 minutes (`*/15 * * * *`)
- **Status:** ACTIVE (queue-based with atomicity guard against double-send)
- **Failure Handling:** Rate-limit 429 retried; delivery failures queued back to Pending
- **Audit:** `email_queue` table tracks status (Pending → Processing → Sent/Failed)
- **Recovery:** Stale Processing rows auto-recovered after 10 minutes

### 4. **Nexus API** (Task Management Escalations)
- **Role:** Operational escalation task creation (Missed Class, Escalations)
- **Functions:** `clickup-sync` (creates Nexus tasks, legacy "ClickUp" naming)
- **Dependencies:** Missed class follow-up, enrollment failures, data issues
- **Configuration:** `NEXUS_API_URL`, `NEXUS_API_KEY`, hardcoded space/list IDs
- **Status:** OPTIONAL (escalations fail non-fatally if Nexus is unavailable)
- **Failure Handling:** Nexus task creation failures logged to `rocksolid_task_links`, marked FAILED
- **Deduplication:** Dedupe key prevents duplicate task creation
- **Audit:** All Nexus task operations written to `audit_logs`

### 5. **Web Push (VAPID)** (Push Notifications)
- **Role:** Complementary in-app push notifications for staff/teachers
- **Functions:** `send-push` (manual/admin sender), internal `notifyProfilesPush()` (trigger-based)
- **Dependencies:** Registration status changes, attention flags, availability approvals
- **Configuration:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- **Status:** ACTIVE (Phase C.2, profiles-first, applicants have no auth/push)
- **Failure Handling:** Push failures are non-fatal; email is authoritative
- **Retry:** Failed subscriptions cleaned up; no retry loop

### 6. **Scheduled Jobs (Cron)** (Process Orchestration)
- **Components:**
  - `retry-worker` (every hour `0 * * * *`) — manually retry failed syncs, auto-retry email
  - `email-sender` (every 15 min `*/15 * * * *`) — process email queue
  - `moodle-grade-sync` (manual trigger) — pull course completion
  - `missed-class-detector` (scheduled) — flag attendance gaps
  - `review-checkin` (scheduled) — periodic review template sends
  - `attendance-reminder` (scheduled) — pre-class notifications
- **Status:** ACTIVE (every-hour and every-15-min are primary heartbeats)
- **Failure Handling:** Each worker is idempotent; overlapping runs prevented by atomic claims
- **Audit:** All scheduled actions write to `audit_logs`

### 7. **Mailchimp** (Deprecated/Not Active)
- **Status:** INACTIVE (constraints mention it; no active code uses it)
- **Note:** Constraint documentation pre-dates backend migration; treat as historical

### 8. **Admin Mappings → Nexus User IDs** (Authorization)
- **Role:** Admin-to-Nexus user mapping for task assignee resolution
- **Table:** `rocksolid_admin_mappings`
- **Status:** LOOKUP ONLY (no push to Nexus user system; mapping is local)

---

## CERTIFICATION TEST PLAN

### A. CONFIGURATION AUDIT

#### Supabase
- [ ] `SUPABASE_URL` is set and reachable
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is valid (NOT anon key)
- [ ] `SUPABASE_ANON_KEY` is set for public operations
- [ ] Database connection pool is stable
- [ ] RLS policies are enforced on all tables

#### Moodle
- [ ] `MOODLE_URL` is set and reachable
- [ ] `MOODLE_TOKEN` is valid (web services token)
- [ ] Moodle web services are enabled (admin check)
- [ ] Required functions are added to the service (core_completion_get_course_completion_status, gradereport_user_get_grade_items)
- [ ] Completion tracking is enabled in Moodle

#### Resend
- [ ] `RESEND_API_KEY` is valid and has send permissions
- [ ] API rate limits are known and configurable

#### Nexus
- [ ] `NEXUS_API_URL` is set
- [ ] `NEXUS_API_KEY` is valid
- [ ] Hardcoded space/list IDs exist in Nexus and are accessible
- [ ] Service can create tasks without interference

#### Web Push
- [ ] `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set (or gracefully skipped if not)
- [ ] Private key is never exposed in client-side code
- [ ] Public key is safely distributed to PWA service worker

---

### B. AUTHENTICATION TESTS

#### Supabase Auth
```
Test: POST /auth/v1/signup with valid email/password
Expected: User created, JWT returned, profile row auto-created
Verify: Audit log entry for user.created
```

#### Moodle API
```
Test: Call webservice/rest/server.php with MOODLE_TOKEN
Expected: HTTP 200, valid JSON response
Verify: No 403 WAF block, no "web services disabled" error
```

#### Resend API
```
Test: POST https://api.resend.com/emails with RESEND_API_KEY
Expected: HTTP 200, email_id returned
Verify: Email delivery confirmed via Resend dashboard within 30s
```

#### Nexus API
```
Test: POST /tasks with NEXUS_API_KEY
Expected: HTTP 201, task_id returned
Verify: Task visible in Nexus UI with correct assignee
```

---

### C. HAPPY PATH TESTS

#### Registration Intake → Moodle Sync
```
1. User submits registration form (public endpoint)
   POST /functions/v1/registration-processor
   
   Payload:
   {
     "first_name": "Alice",
     "last_name": "Test",
     "email": "alice@example.com",
     "phone": "+1234567890",
     "batch_id": "<batch_id>",
     "selected_classes": ["<class_option_id>"]
   }

2. Expected registration record created with status PENDING
3. Audit log: registration_created (actor: public, status: PENDING)
4. If classes available → status becomes ASSIGNED
   Audit log: applicant_assigned_to_class
5. Trigger moodle-sync:
   POST /functions/v1/moodle-sync { id: "<sync_id>" }
6. Expected: moodle_enrollment_sync row created
   - sync_status: PENDING → PROCESSING → SYNCED
   - moodle_user_id populated
   - moodle_course_id populated
7. Audit log: moodle_user_created, moodle_enrolled_in_course
8. Poll Moodle API: GET core_webservice_get_site_info
   Verify: User exists in Moodle with same email/username

Verification Checklist:
- [ ] Applicant record created in `applicants` table
- [ ] Registration status is ASSIGNED (not DUPLICATE, not WAITLISTED)
- [ ] Moodle enrollment sync row exists with SYNCED status
- [ ] Moodle user ID is numeric and matches Moodle user
- [ ] Audit log has 3+ entries for this registration
- [ ] No silent failures (all errors are in audit_logs.details)
```

#### Email Queue → Resend Delivery
```
1. Trigger registration notification:
   INSERT INTO email_queue (template_key, recipient_email, payload)
   VALUES ('foundation_welcome', 'alice@example.com', {...})

2. email-sender runs (every 15 min):
   GET /functions/v1/email-sender

3. Expected:
   - Queue row claimed (status: Processing)
   - Template fetched from notification_templates
   - Email sent via Resend API
   - Queue row updated (status: Sent)
   - Audit log: email_sent_via_resend

4. Verify:
   - Email arrives in inbox within 30s
   - Email has correct subject, body, sender address
   - Reply-to header set from config table

Verification Checklist:
- [ ] Queue row transitions from Pending → Processing → Sent
- [ ] Resend API receives POST request with correct template data
- [ ] Email delivered and received at recipient
- [ ] Audit log tracks send with timestamp and recipient count
- [ ] No duplicate sends (claim prevents overlap)
```

#### Attention Flag → Push Notification
```
1. Trigger attention flag creation:
   INSERT INTO attention_flags (student_id, reason) VALUES (...)

2. Trigger handler calls notifyProfilesPush() with admin/superadmin role IDs

3. Expected:
   - Resolve recipient profiles with push_enabled=true
   - Send Web Push to each subscription
   - Log audit entry: attention_flag_push_sent

4. Verify:
   - Push notification delivered to staff app
   - Notification title/body matches trigger
   - No errors for users without push subscriptions

Verification Checklist:
- [ ] Push sent only to push-enabled profiles
- [ ] Push notification displayed in browser
- [ ] Audit log: attention_flag_triggered + push_sent entries
- [ ] Non-VAPID environments skip silently (skipped=true)
```

#### Missed Class → Nexus Escalation
```
1. Missed class detector finds attendance gap:
   INSERT INTO rocksolid_task_links (source_type, payload)

2. POST /functions/v1/clickup-sync
   { type: "missed_class", payload: {...student, class...} }

3. Expected:
   - Resolve assignee from admin mappings
   - Create Nexus task with due date + priority
   - Store nexus_task_id in rocksolid_task_links
   - Audit log: nexus_task_created

4. Verify:
   - Task exists in Nexus with correct title/description
   - Task assigned to correct group admin
   - Due date is +1 day from now
   - No duplicate tasks (dedupe key prevents)

Verification Checklist:
- [ ] rocksolid_task_links row has status CREATED
- [ ] nexus_task_id is populated and numeric
- [ ] Nexus API called only once (atomicity)
- [ ] Audit log: clickup_sync_called, nexus_task_created
```

#### Retry Worker Auto-Sweep
```
1. Manually set a moodle_enrollment_sync row to FAILED:
   UPDATE moodle_enrollment_sync SET sync_status='FAILED'

2. Wait for retry-worker to run (every hour):
   GET /functions/v1/retry-worker

3. Expected (if failure is retryable):
   - Row re-attempted
   - Status: FAILED → RETRYING → SYNCED (or stays FAILED if non-retryable)
   - Audit log: moodle_sync_retried_auto

4. Verify:
   - Non-retryable failures (permission, REST-disabled) are NOT retried
   - Transient failures (timeout, 500) ARE retried with backoff

Verification Checklist:
- [ ] Retryable failures are re-attempted
- [ ] Non-retryable failures remain FAILED (no endless loop)
- [ ] Retry count increments
- [ ] Audit log distinguishes retryable vs non-retryable
```

---

### D. FAILURE PATH TESTS

#### Moodle Unavailable
```
Scenario: Moodle API is down or timing out

1. Set MOODLE_URL to invalid/unreachable host
2. Trigger moodle-sync for an applicant
3. Expected:
   - Request times out or returns connection error
   - Error classified as RETRYABLE (network)
   - Sync row status: FAILED (not permanent)
   - Audit log: moodle_sync_failed, error_type=NETWORK_TIMEOUT
   - Application continues (registration not blocked)

4. When Moodle recovers:
   - retry-worker picks up FAILED row
   - Retry succeeds, status becomes SYNCED
   - Audit log: moodle_sync_retried_auto, status=SUCCESS

Verification Checklist:
- [ ] Sync failure is logged (not silent)
- [ ] Operator can see failure in Retry Center
- [ ] Applicant registration is not stuck
- [ ] Auto-retry eventually succeeds when Moodle returns
```

#### Moodle WAF Block (HTTP 403)
```
Scenario: Moodle is behind WAF that blocks requests

1. Moodle responds with HTTP 403 + Cloudflare headers
2. Expected:
   - moodle-sync detects WAF block (CF-Ray header, Cloudflare in response)
   - Classifies as MOODLE_WAF_BLOCK (retryable)
   - Sync row status: FAILED
   - Audit log: moodle_sync_failed, error_code=MOODLE_WAF_BLOCK
   - Escalates to Nexus: escalation (type=moodle_enrollment_sync)

3. When WAF block clears:
   - retry-worker retries
   - Succeeds, status becomes SYNCED
   - Audit log: moodle_sync_retried_auto, status=SUCCESS

Verification Checklist:
- [ ] WAF block correctly identified (not confused with permission error)
- [ ] Classified as retryable (not permanently marked FAILED)
- [ ] Nexus task created for operator review
- [ ] Retry succeeds when WAF block clears
```

#### Moodle Permission Error (HTTP 403 – No WAF)
```
Scenario: Moodle returns 403 for permission error (admin not enrolled in course)

1. Sync tries to enroll user in course
2. Moodle responds: HTTP 403 + {"errorcode":"accessexception","message":"..."}
3. Expected:
   - Error detected as MOODLE_PERMISSION_DENIED (non-retryable)
   - Sync row status: PERMANENTLY_FAILED
   - Audit log: moodle_sync_failed, error_code=MOODLE_PERMISSION_DENIED, non_retryable=true
   - Escalates to Nexus: escalation (type=moodle_enrollment_sync, error=MOODLE_PERMISSION_DENIED)
   - retry-worker skips this row (does NOT retry)

4. Operator must manually fix in Moodle (e.g., enroll admin) and trigger manual retry

Verification Checklist:
- [ ] Error correctly classified as NON-RETRYABLE
- [ ] Status marked PERMANENTLY_FAILED (prevents endless loops)
- [ ] Nexus task created with high priority
- [ ] Operator sees clear error message and remediation path
```

#### Email Rate Limit (429)
```
Scenario: Resend API rate limit exceeded

1. email-sender processes queue, sends to Resend
2. Resend responds: HTTP 429 (Too Many Requests)
3. Expected:
   - Email failure classified as RETRYABLE
   - Queue row status: Failed → reverted to Pending
   - Audit log: email_send_failed, error_code=RATE_LIMIT
   - On next email-sender run: row is re-claimed and retried

4. Verify:
   - No user-visible error (queue handles internally)
   - Email eventually delivered when rate limit resets

Verification Checklist:
- [ ] Queue row reverted to Pending (not stuck in Processing)
- [ ] Audit log distinguishes rate limit from permanent failures
- [ ] Subsequent retry succeeds
```

#### Email Delivery Failure (Invalid Email)
```
Scenario: Email address is invalid (Resend rejects it)

1. email-sender tries to send to "not_an_email"
2. Resend responds: HTTP 400 (Invalid request)
3. Expected:
   - Classified as NON-RETRYABLE
   - Queue row status: Failed (not Pending)
   - Audit log: email_send_failed, error_code=INVALID_RECIPIENT, non_retryable=true
   - No further retries
   - Operator sees error in Notification Center

Verification Checklist:
- [ ] Invalid addresses do not cause endless retries
- [ ] Audit log shows non-retryable reason
- [ ] Operator can investigate and update email in applicant record
```

#### Nexus Unavailable
```
Scenario: Nexus API is down

1. POST /functions/v1/clickup-sync (missed class or escalation)
2. Nexus API unreachable or responds HTTP 500
3. Expected:
   - clickup-sync returns { ok: false, non_fatal: true, error: "..." }
   - rocksolid_task_links row status: FAILED
   - Audit log: nexus_task_failed, error_code=API_TIMEOUT
   - Application continues (escalation is optional)
   - Operator can manually retry from Retry Center

4. When Nexus recovers:
   - retry-worker can re-trigger clickup-sync
   - Task creation succeeds
   - rocksolid_task_links status: CREATED

Verification Checklist:
- [ ] Nexus failure does not block registration/attendance
- [ ] Non-fatal error prevents app crash
- [ ] Audit log clear about what failed and why
- [ ] Operator has manual retry option
```

#### Push Subscription Expired
```
Scenario: User's Web Push subscription becomes invalid

1. notifyProfilesPush() tries to send to expired subscription
2. VAPID send fails (e.g., 410 Gone)
3. Expected:
   - Subscription marked as expired in profiles table
   - Push failure counted (not retried)
   - Audit log: push_send_failed, reason=expired_subscription
   - Next push attempt skips this user

Verification Checklist:
- [ ] Expired subscriptions are cleaned up (not retried)
- [ ] Audit log distinguishes expired from network errors
- [ ] User can re-subscribe via PWA settings
```

---

### E. RETRY BEHAVIOR TESTS

#### Exponential Backoff
```
Test: Verify retry-worker uses exponential backoff for transient failures

1. Set MOODLE_URL to timeout endpoint
2. First sync attempt: Fails immediately (timeout)
3. retry-worker runs: 1st retry after 1 minute backoff
4. 2nd retry after 2 minutes backoff
5. 3rd retry after 4 minutes backoff
6. ...continues up to configurable max attempts

Verification Checklist:
- [ ] Each retry attempt is logged with attempt number
- [ ] Backoff time increases exponentially
- [ ] Max retry attempts prevents infinite loops
- [ ] Audit log shows all attempts with timestamps
```

#### Idempotent Re-processing
```
Test: Verify idempotent operations don't create duplicates

Scenario: Email-sender crashes after email is sent but before queue update

1. Send email via Resend (succeeds)
2. Simulate crash before queue status update
3. Next run: Row still has status "Processing"
   - 10-minute auto-recovery kicks in
   - Row reverted to Pending
   - Resend is called again
4. Resend should recognize duplicate (idempotency key or email ID tracking)
5. Expected: Email not double-sent (Resend's duplicate detection or queue logic)

Verification Checklist:
- [ ] Idempotency key is used (Resend API supports this)
- [ ] Processing timeout auto-recovery works
- [ ] No duplicate emails sent
- [ ] Audit log shows both attempts + duplicate detection
```

---

### F. LOGGING & OPERATOR VISIBILITY

#### Audit Log Coverage
```
Test: Every external integration call is logged

For each integration:
1. Successful call → audit_logs entry with status=SUCCESS
2. Retryable failure → audit_logs entry with status=FAILED, error_code=<RETRYABLE>
3. Non-retryable failure → audit_logs entry with status=FAILED, error_code=<NON_RETRYABLE>

Verify each type has:
- [ ] actor_email (system, admin, or auto-processor name)
- [ ] action (moodle_sync_called, email_sent, nexus_task_created, etc.)
- [ ] entity_type (moodle_enrollment_sync, email, push, task, etc.)
- [ ] entity_id (sync ID, email ID, push ID, task ID)
- [ ] status (SUCCESS, FAILED, SKIPPED)
- [ ] details (timing, retry_count, error_code, error_message)
- [ ] logged_at (timestamp)

Dashboard View:
- [ ] Audit log searchable by actor, action, entity_type, status, date range
- [ ] Error details are readable (not truncated)
- [ ] Timeline view shows causality (registration → sync → email → push)
```

#### Operator Dashboards
```
Test: Operator visibility into integration health

Retry Center:
- [ ] Lists all failed syncs (Moodle, email, Nexus)
- [ ] Filters by source (email_queue, moodle_enrollment_sync, rocksolid_task_links)
- [ ] Shows error code and message
- [ ] Allows manual retry or resolve
- [ ] Shows retry count and last retry timestamp

System Health:
- [ ] Moodle API health (last successful call, error rate)
- [ ] Email queue depth (Pending, Processing, Sent, Failed)
- [ ] Nexus task creation rate (success, failure, avg time)
- [ ] Scheduled job status (retry-worker, email-sender, grade-sync) — last run, next run
- [ ] Push notification stats (attempted, sent, expired, failed)

Notification Center:
- [ ] Lists recent email sends (with delivery status)
- [ ] Lists recent Nexus tasks created
- [ ] Lists recent push notifications sent
```

---

### G. REALISTIC REGISTRATION LIFECYCLE TEST

**Goal:** Verify one complete registration flows through all integration layers without silent failures.

#### Test Scenario
```
Applicant: "Bob Student" (bob@example.com)
Registration Date: 2026-09-16
Batch: "Fall 2026 Cohort A"
Selected Classes: 
  - Class 1 (Class Option ID: xyz123, Moodle Course ID: 42)
  - Class 2 (Class Option ID: abc789, Moodle Course ID: 43)
Admin Contact: alice@example.com (superadmin)

Step 1: Submit Registration
  POST /functions/v1/registration-processor
  
  Verify:
  - Applicant record created in `applicants` table
  - Status: ASSIGNED (if classes are available)
  - Created audit log entry: registration_created

Step 2: Auto-trigger Moodle Sync
  POST /functions/v1/moodle-sync { id: "<sync_record_id>" }
  
  Verify (per class):
  - Moodle user created (username: bob_xxxxxxxx, email: bob@example.com)
  - User enrolled in Moodle Course 42 and 43
  - moodle_enrollment_sync rows created with status=SYNCED
  - Audit log entries: moodle_user_created, moodle_enrolled_in_course (x2)

Step 3: Email Welcome Notification
  INSERT INTO email_queue (template: foundation_welcome, recipient: bob@example.com)
  
  Verify (after 15 min when email-sender runs):
  - Email queue row transitions: Pending → Processing → Sent
  - Email delivered to bob@example.com
  - Subject: "Welcome to Foundation School"
  - Body includes: batch name, class schedule, next steps
  - Audit log: email_sent_via_resend

Step 4: Notify Admin of New Registration
  INSERT INTO email_queue (template: admin_new_registration, recipient: alice@example.com)
  
  Verify:
  - Admin receives notification
  - Audit log: email_sent_via_resend

Step 5: Send Push to Admin (if push enabled)
  notifyProfilesPush([alice_user_id], { title: "New Registration", body: "Bob Student..." })
  
  Verify:
  - Push notification delivered (if VAPID configured)
  - Audit log: attention_flag_push_sent or registration_push_notification

Step 6: Teacher Availability Check
  If teachers are at capacity or no matching times, applicant → WAITLISTED
  
  Verify:
  - Status updated to WAITLISTED
  - Moodle unenrollment triggered (only ASSIGNED students stay enrolled)
  - Waitlist confirmation email queued
  - Audit log: applicant_waitlisted, moodle_unenrolled

Step 7: Grade Sync (after student completes work)
  POST /functions/v1/moodle-grade-sync { email: "bob@example.com" }
  
  Verify:
  - Course completion status fetched from Moodle
  - Student grades retrieved via gradereport_user_get_grade_items
  - Milestone status updated (if completion met)
  - Audit log: moodle_grades_synced

Step 8: Attendance Tracking
  Teacher checks in Bob for class session on 2026-09-20
  
  Verify:
  - attendance_records row created
  - Status: PRESENT
  - Audit log: attendance_recorded

Step 9: End-to-End Verification
  GET /operational-trace?student_id=bob_xxx&batch_id=fall_2026_cohort_a
  
  Verify:
  - Timeline shows: registration_created → moodle_sync_started → moodle_user_created → 
    moodle_enrolled → email_welcome_queued → email_sent → push_sent → 
    attendance_recorded → grades_synced
  - No gaps in timeline (no silent failures)
  - All steps have audit log entries
  - All failures (if any) are marked FAILED with error_code
```

---

## CURRENT STATUS

### Configuration State (Based on Codebase)

**Active Integrations:**
- ✅ Supabase (mandatory, fully integrated)
- ✅ Moodle (active, 403 classification hardened)
- ✅ Resend Email (active, queue-based, atomic claim)
- ✅ Web Push (active, profiles-first, optional/graceful if no VAPID)
- ✅ Scheduled Jobs (retry-worker hourly, email-sender every 15 min)
- ✅ Nexus/ClickUp Escalations (optional, non-fatal)

**Inactive Integrations:**
- ❌ Mailchimp (no active code)

### Known Issues to Verify

From `NEXT_STEPS.md` and `KNOWNBUGS.md`:
1. ❓ Retry-worker schedule discrepancy: Code shows `0 * * * *` (hourly) but CLAUDE.md says 20 minutes
   - **Action:** Confirm actual schedule in staging environment
2. ❓ Moodle HTTP 403 / WAF blocks are classified correctly (should be MOODLE_WAF_BLOCK)
   - **Action:** Test with actual Moodle instance
3. ❓ Nexus API credentials are properly configured
   - **Action:** Verify NEXUS_API_URL and NEXUS_API_KEY in staging
4. ❓ VAPID keys are configured for Web Push
   - **Action:** Verify VAPID keys in staging; confirm graceful skip if not present

---

## STAGING VERIFICATION CHECKLIST

Before deploying to production, verify:

### Environment Configuration
- [ ] All required env vars are set (SUPABASE_URL, MOODLE_URL, RESEND_API_KEY, etc.)
- [ ] No credentials are hardcoded or committed
- [ ] Service role key is being used server-side (NOT anon key)
- [ ] CORS allowed origins match actual frontend URLs

### Database & Migrations
- [ ] All migrations applied (especially `202607090001` for email claim protocol)
- [ ] RLS policies are active on all tables
- [ ] Audit logs table is writable and indexed
- [ ] All queue/sync tables have status columns

### Edge Functions
- [ ] All functions deployed and enabled in Supabase dashboard
- [ ] Cron schedules are active (retry-worker, email-sender)
- [ ] Function logs are accessible
- [ ] No timeout errors on first invocation

### External APIs
- [ ] Moodle instance is reachable
- [ ] Moodle web services are enabled
- [ ] Resend API key is valid (test send successful)
- [ ] Nexus API is reachable (if being used)
- [ ] VAPID public key distributed to PWA service worker

### Integration Tests
- [ ] Complete registration lifecycle succeeds
- [ ] Moodle sync completes without silent failures
- [ ] Email delivery succeeds and arrives
- [ ] Retry logic works for transient failures
- [ ] Non-retryable failures are correctly identified
- [ ] Operator dashboards show all integration health

### Audit & Logging
- [ ] audit_logs has entries for all integration calls
- [ ] Error details are complete (not truncated)
- [ ] Retry Center displays failures correctly
- [ ] No sensitive data in audit logs

---

## SIGN-OFF GATES

### Pre-Staging Gate
- [ ] All integrations identified and documented
- [ ] Configuration validated (no missing keys)
- [ ] Happy path tests pass (happy-path-tests.md)
- [ ] Failure classification is correct (retryable vs non-retryable)
- [ ] Audit logging is comprehensive

### Pre-Production Gate (Staging Verified)
- [ ] One complete registration lifecycle succeeds
- [ ] All external API integrations tested and working
- [ ] Retry behavior verified (auto-sweep, exponential backoff)
- [ ] Failure paths verified (silent failures prevented)
- [ ] Operator dashboards show clear integration health
- [ ] Security review passed (no creds leaked, RLS enforced)

---

## NEXT STEPS

1. **Resolve schedule discrepancy:** Verify actual retry-worker schedule in staging
2. **Test with staging Moodle:** Confirm 403 classification against real instance
3. **Verify Nexus credentials:** Test Nexus task creation in staging
4. **Run full lifecycle test:** Register a student, verify all integrations
5. **Operator training:** Ensure team knows how to use dashboards and retry logic

---

## Verdict

**Status: NOT YET CERTIFIED**

**Blockers for Certification:**
1. ❓ Retry-worker schedule must be verified (hourly vs 20-minute discrepancy)
2. ❓ Moodle 403 classification must be tested against staging instance
3. ❓ Nexus credentials must be confirmed available in staging
4. ❓ Web Push VAPID keys must be confirmed in staging (or graceful skip verified)
5. ❓ One complete registration lifecycle must succeed in staging

**Estimated Timeline:**
- Configuration verification: 1 hour
- Integration testing: 4-6 hours (per integration)
- Full lifecycle test: 2-4 hours
- Total: 7-11 hours

---

## Test Execution Log

*To be filled during staging certification:*

| Date | Integration | Test | Result | Notes |
|------|-------------|------|--------|-------|
| | Supabase | Connection | | |
| | Moodle | 403 Classification | | |
| | Resend | Email Delivery | | |
| | Web Push | Subscription | | |
| | Nexus | Task Creation | | |
| | Retry Worker | Auto-Sweep | | |
| | Full Lifecycle | Registration→Moodle→Email→Push | | |

