# INTEGRATION TEST RUNBOOK

**For:** Rock Solid Ops / Foundation School Platform  
**Date:** 2026-09-16  
**Audience:** QA, DevOps, Release Manager

---

## PRE-TEST SETUP

### 1. Verify Staging Environment

```bash
# Check Supabase project
supabase projects list
# Note the staging project ID

# Verify environment is staging (not production)
echo $SUPABASE_URL
# Should contain "staging" or non-prod domain
```

### 2. Prepare Test User Accounts

Create or reset test accounts:
- **Applicant:** bob.student@test-foundation.org (password: TestPass123!)
- **Admin:** alice.admin@test-foundation.org (role: superadmin)
- **Teacher:** carol.teacher@test-foundation.org (role: teacher)

```sql
-- Reset test users in Supabase
DELETE FROM profiles WHERE user_id IN (
  SELECT user_id FROM profiles WHERE email LIKE '%@test-foundation.org'
);

DELETE FROM auth.users WHERE email LIKE '%@test-foundation.org';
```

### 3. Verify External Integrations Are Reachable

```bash
# Moodle
curl -I https://moodle.staging.rocksolid.org

# Resend
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -d '{"from":"test@example.com"}' 2>&1 | grep -o "HTTP/[0-9.]* [0-9]*"

# Nexus (if applicable)
curl -I https://nexus.staging.rocksolid.org/api/tasks \
  -H "Authorization: Bearer $NEXUS_API_KEY"
```

### 4. Configure Test Fixtures

**Email Template for Testing:**
```sql
INSERT INTO notification_templates 
  (template_key, subject, body_html, active)
VALUES (
  'test_welcome',
  'Test Welcome Email',
  '<p>Welcome to the test environment!</p>',
  true
)
ON CONFLICT (template_key) DO UPDATE SET active = true;
```

**Test Batch:**
```sql
INSERT INTO batches (id, name, status, start_date)
VALUES (
  'batch-test-fall-2026',
  'Test Fall 2026 Cohort',
  'ACTIVE',
  '2026-09-01'
)
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
```

**Test Class Option:**
```sql
INSERT INTO class_options 
  (id, batch_id, class_name, location, capacity, max_registrations, moodle_course_id)
VALUES (
  'class-opt-001',
  'batch-test-fall-2026',
  'Test Class 1',
  'Online',
  30,
  30,
  42  -- Moodle staging course ID
)
ON CONFLICT (id) DO UPDATE SET capacity = 30;
```

---

## TEST EXECUTION

### Test 1: Configuration Audit ⏱️ 15 minutes

#### 1.1 Supabase Configuration
```bash
# Verify SUPABASE_URL
echo $SUPABASE_URL
# Expected: https://xyz.supabase.co (staging subdomain)

# Verify service role key is loaded (should NOT print)
echo "Key length: ${#SUPABASE_SERVICE_ROLE_KEY}"
# Expected: 100+ characters

# Test connection
curl -X GET "$SUPABASE_URL/rest/v1/batches?limit=1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
# Expected: HTTP 200 with JSON response
```

**Checklist:**
- [ ] SUPABASE_URL is valid staging URL
- [ ] SUPABASE_SERVICE_ROLE_KEY is valid (not anon key)
- [ ] Connection test succeeds

#### 1.2 Moodle Configuration
```bash
# Check MOODLE_URL and token
echo "MOODLE_URL: $MOODLE_URL"
echo "Token set: ${#MOODLE_TOKEN} chars"

# Test Moodle connection
curl -X POST "$MOODLE_URL/webservice/rest/server.php" \
  -d "wstoken=$MOODLE_TOKEN&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json"
# Expected: HTTP 200, site name returned
```

**Checklist:**
- [ ] MOODLE_URL is reachable
- [ ] MOODLE_TOKEN is valid
- [ ] Moodle web services are enabled (no "Web services must be enabled" error)

#### 1.3 Resend Configuration
```bash
# Test Resend API key
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "test@foundation.rocksolid.org",
    "to": "test-inbox@test-foundation.org",
    "subject": "Configuration Test",
    "html": "<p>This is a configuration test email.</p>"
  }'
# Expected: HTTP 200, email_id returned
```

**Checklist:**
- [ ] RESEND_API_KEY is valid
- [ ] Test email sent successfully
- [ ] Email received in test inbox within 30 seconds

#### 1.4 Nexus Configuration
```bash
# Check Nexus credentials
echo "NEXUS_API_URL: $NEXUS_API_URL"
echo "NEXUS_API_KEY set: ${#NEXUS_API_KEY} chars"

# Test Nexus connection (list tasks)
curl -X GET "$NEXUS_API_URL/tasks" \
  -H "Authorization: Bearer $NEXUS_API_KEY"
# Expected: HTTP 200, task list returned (may be empty)
```

**Checklist:**
- [ ] NEXUS_API_URL is reachable (if Nexus is being used)
- [ ] NEXUS_API_KEY is valid
- [ ] API responds to requests

#### 1.5 Web Push Configuration
```bash
# Check VAPID keys are set
echo "VAPID_PUBLIC_KEY set: ${#VAPID_PUBLIC_KEY} chars"
echo "VAPID_PRIVATE_KEY set: ${#VAPID_PRIVATE_KEY} chars"

# Verify keys are not exposed in functions
grep -r "VAPID_PRIVATE_KEY" ./foundation/ 2>/dev/null || echo "✓ Private key not in client code"
grep -r "VAPID_PUBLIC_KEY" ./foundation/ 2>/dev/null | head -1
# Expected: Found only in frontend build, not in server code
```

**Checklist:**
- [ ] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set
- [ ] Private key is never sent to client
- [ ] Public key is available to service worker

---

### Test 2: Happy Path – Registration Intake ⏱️ 30 minutes

#### 2.1 Submit Registration Form
```bash
# Register Bob Student
curl -X POST "https://rocksolid-staging.netlify.app/.netlify/functions/registration-processor" \
  -H "Content-Type: application/json" \
  -H "Origin: https://rocksolid-staging.netlify.app" \
  -d '{
    "first_name": "Bob",
    "last_name": "Student",
    "email": "bob.student@test-foundation.org",
    "phone": "+1234567890",
    "batch_id": "batch-test-fall-2026",
    "selected_classes": ["class-opt-001"]
  }' | jq .
```

**Expected Response:**
```json
{
  "ok": true,
  "registration_id": "reg-xxx",
  "status": "ASSIGNED",
  "moodle_sync_triggered": true
}
```

**Checklist:**
- [ ] HTTP 200
- [ ] registration_id returned
- [ ] status is ASSIGNED (not DUPLICATE, not WAITLISTED)
- [ ] moodle_sync_triggered is true

#### 2.2 Verify Applicant Record Created
```bash
# Query applicant
curl -X GET "$SUPABASE_URL/rest/v1/applicants?email=eq.bob.student@test-foundation.org" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[] | {id, email, registration_status, moodle_sync_id}'
```

**Expected:**
```json
{
  "id": "applicant-xxx",
  "email": "bob.student@test-foundation.org",
  "registration_status": "ASSIGNED",
  "moodle_sync_id": "sync-xxx"
}
```

**Checklist:**
- [ ] Applicant exists
- [ ] Email matches
- [ ] Status is ASSIGNED
- [ ] moodle_sync_id is populated

#### 2.3 Verify Audit Log Entry
```bash
# Check audit log
curl -X GET "$SUPABASE_URL/rest/v1/audit_logs?entity_type=eq.applicants&entity_id=eq.applicant-xxx&order=logged_at.desc&limit=1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {action, status, details}'
```

**Expected:**
```json
{
  "action": "registration_created",
  "status": "SUCCESS",
  "details": {
    "applicant_id": "applicant-xxx",
    "registration_source": "web_form",
    "initial_status": "PENDING"
  }
}
```

**Checklist:**
- [ ] Audit log entry exists
- [ ] action is registration_created
- [ ] status is SUCCESS
- [ ] details include applicant_id and source

---

### Test 3: Happy Path – Moodle Sync ⏱️ 30 minutes

#### 3.1 Trigger Moodle Sync
```bash
# Get the sync ID from previous test
SYNC_ID="sync-xxx"  # Replace with actual ID

curl -X POST "$SUPABASE_URL/functions/v1/moodle-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "'$SYNC_ID'"}' | jq .
```

**Expected Response:**
```json
{
  "ok": true,
  "sync_id": "sync-xxx",
  "status": "SYNCED",
  "moodle_user_id": 12345,
  "moodle_username": "bob_xxxxxxxx"
}
```

**Checklist:**
- [ ] HTTP 200
- [ ] status is SYNCED
- [ ] moodle_user_id is numeric
- [ ] moodle_username is generated from email

#### 3.2 Verify Moodle User Created
```bash
# Query Moodle API
curl -X POST "https://moodle.staging.rocksolid.org/webservice/rest/server.php" \
  -d "wstoken=$MOODLE_TOKEN&wsfunction=core_user_get_users&moodlewsrestformat=json&criteria[0][key]=email&criteria[0][value]=bob.student@test-foundation.org" | jq '.users[0] | {id, email, username, firstname, lastname}'
```

**Expected:**
```json
{
  "id": 12345,
  "email": "bob.student@test-foundation.org",
  "username": "bob_xxxxxxxx",
  "firstname": "Bob",
  "lastname": "Student"
}
```

**Checklist:**
- [ ] User exists in Moodle
- [ ] Email matches registration
- [ ] Username matches moodle_username from sync
- [ ] Name fields populated

#### 3.3 Verify Moodle Enrollment
```bash
# Check enrollment
curl -X POST "https://moodle.staging.rocksolid.org/webservice/rest/server.php" \
  -d "wstoken=$MOODLE_TOKEN&wsfunction=core_enrol_get_enrolled_users&moodlewsrestformat=json&courseid=42" | jq '.[] | select(.id == 12345) | {id, email, fullname}'
```

**Expected:**
```json
{
  "id": 12345,
  "email": "bob.student@test-foundation.org",
  "fullname": "Bob Student"
}
```

**Checklist:**
- [ ] User is enrolled in Moodle course 42
- [ ] Enrollment visible in course participants

#### 3.4 Verify moodle_enrollment_sync Record
```bash
curl -X GET "$SUPABASE_URL/rest/v1/moodle_enrollment_sync?email=eq.bob.student@test-foundation.org" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {id, sync_status, moodle_user_id, moodle_course_id, attempts, failure_reason}'
```

**Expected:**
```json
{
  "id": "sync-xxx",
  "sync_status": "SYNCED",
  "moodle_user_id": 12345,
  "moodle_course_id": 42,
  "attempts": 1,
  "failure_reason": null
}
```

**Checklist:**
- [ ] sync_status is SYNCED
- [ ] moodle_user_id matches Moodle user
- [ ] moodle_course_id matches course
- [ ] No failure_reason (successful sync)

---

### Test 4: Happy Path – Email Delivery ⏱️ 30 minutes

#### 4.1 Trigger Email Queue
```bash
# Manually insert email into queue (or trigger via registration)
curl -X POST "$SUPABASE_URL/rest/v1/email_queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template_key": "test_welcome",
    "recipient_email": "bob.student@test-foundation.org",
    "recipient_name": "Bob Student",
    "status": "Pending",
    "payload": {"batch_name": "Test Fall 2026"}
  }' | jq '.[] | {id, status, recipient_email}'
```

**Expected:**
```json
{
  "id": "email-xxx",
  "status": "Pending",
  "recipient_email": "bob.student@test-foundation.org"
}
```

**Checklist:**
- [ ] Email queued with status Pending
- [ ] recipient_email is correct

#### 4.2 Trigger Email Sender (or wait for cron)
```bash
# Manually trigger email-sender
curl -X POST "$SUPABASE_URL/functions/v1/email-sender" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.sent, .failed, .errors'
```

**Expected:**
```json
1, 0, []
```

**Checklist:**
- [ ] sent > 0 (at least 1 email processed)
- [ ] failed = 0
- [ ] No errors

#### 4.3 Verify Email Queued Row Transitioned
```bash
curl -X GET "$SUPABASE_URL/rest/v1/email_queue?id=eq.email-xxx" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {id, status, sent_at}'
```

**Expected:**
```json
{
  "id": "email-xxx",
  "status": "Sent",
  "sent_at": "2026-09-16T14:30:45Z"
}
```

**Checklist:**
- [ ] Status transitioned to Sent
- [ ] sent_at is populated

#### 4.4 Verify Email Delivered
```bash
# Check test inbox (use your email provider's API or manual check)
# Expected: Email from "Foundation School Team <no-reply@foundation.rocksolid.org>"
# Subject: "Test Welcome Email"
# Body includes: "Welcome to the test environment!"
```

**Checklist:**
- [ ] Email arrives in inbox within 60 seconds
- [ ] Subject and body match template
- [ ] Sender is correct
- [ ] Reply-to header is set

#### 4.5 Verify Audit Log Entry
```bash
curl -X GET "$SUPABASE_URL/rest/v1/audit_logs?entity_type=eq.email&entity_id=eq.email-xxx&order=logged_at.desc&limit=1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {action, status, details}'
```

**Expected:**
```json
{
  "action": "email_sent_via_resend",
  "status": "SUCCESS",
  "details": {
    "recipient": "bob.student@test-foundation.org",
    "template_key": "test_welcome",
    "resend_message_id": "..."
  }
}
```

**Checklist:**
- [ ] Audit log entry exists
- [ ] action is email_sent_via_resend
- [ ] status is SUCCESS

---

### Test 5: Failure Path – Moodle Timeout ⏱️ 20 minutes

#### 5.1 Simulate Moodle Unavailable
```bash
# Option 1: Use firewall rules to block Moodle (requires infrastructure access)
# Option 2: Temporarily set MOODLE_URL to invalid endpoint
export MOODLE_URL="https://moodle-unavailable.invalid.test"

# Or manually create a sync record in FAILED state
curl -X PATCH "$SUPABASE_URL/rest/v1/moodle_enrollment_sync?id=eq.sync-test-001" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sync_status": "FAILED",
    "failure_reason": "Network timeout",
    "attempts": 1
  }' | jq '.[] | {id, sync_status, failure_reason}'
```

**Checklist:**
- [ ] Sync record has sync_status = FAILED
- [ ] failure_reason is set

#### 5.2 Verify Audit Log Entry
```bash
curl -X GET "$SUPABASE_URL/rest/v1/audit_logs?entity_type=eq.moodle_enrollment_sync&action=eq.moodle_sync_failed" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {status, details}'
```

**Expected:**
```json
{
  "status": "FAILED",
  "details": {
    "error_code": "NETWORK_TIMEOUT",
    "retry_eligible": true
  }
}
```

**Checklist:**
- [ ] Audit log entry exists
- [ ] error_code indicates network issue
- [ ] retry_eligible is true

#### 5.3 Verify Retry Center Shows Failure
```bash
# Navigate to admin dashboard Retry Center
# Expected: Failed sync row visible with error message and retry button
```

**Checklist:**
- [ ] Failed sync appears in Retry Center
- [ ] Error message is clear
- [ ] Retry button is present

#### 5.4 Wait for Auto-Retry (or Trigger Manually)
```bash
# Restore MOODLE_URL
unset MOODLE_URL  # Use env var again
# Wait 1 hour for scheduled retry-worker, or manually trigger:

curl -X POST "$SUPABASE_URL/functions/v1/retry-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "retry", "source": "moodle_enrollment_sync", "id": "sync-test-001"}' | jq '.ok'
```

**Checklist:**
- [ ] Retry-worker picks up FAILED row
- [ ] Sync re-attempted (attempts count increments)

#### 5.5 Verify Retry Succeeds
```bash
curl -X GET "$SUPABASE_URL/rest/v1/moodle_enrollment_sync?id=eq.sync-test-001" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {sync_status, attempts, failure_reason}'
```

**Expected (after Moodle recovers):**
```json
{
  "sync_status": "SYNCED",
  "attempts": 2,
  "failure_reason": null
}
```

**Checklist:**
- [ ] sync_status eventually becomes SYNCED
- [ ] attempts count incremented
- [ ] failure_reason cleared

---

### Test 6: Failure Path – Moodle 403 (Permission Error) ⏱️ 20 minutes

#### 6.1 Simulate Moodle Permission Error
```bash
# Create a scenario where Moodle user lacks course access
# (This requires manual Moodle setup: disable teacher enrollment in test course)

# Then trigger sync:
curl -X POST "$SUPABASE_URL/functions/v1/moodle-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "'$SYNC_ID'"}' | jq '.failure_reason'
```

**Expected (assuming Moodle returns 403 + accessexception):**
```json
"MOODLE_PERMISSION_DENIED"
```

**Checklist:**
- [ ] Error correctly classified as MOODLE_PERMISSION_DENIED
- [ ] Not retried (status stays FAILED, not RETRYING)

#### 6.2 Verify Non-Retryable Status
```bash
curl -X GET "$SUPABASE_URL/rest/v1/moodle_enrollment_sync?id=eq.sync-xxx" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {sync_status, failure_reason}'
```

**Expected:**
```json
{
  "sync_status": "FAILED",
  "failure_reason": "MOODLE_PERMISSION_DENIED"
}
```

**Checklist:**
- [ ] sync_status is FAILED (not RETRYING, not PERMANENTLY_FAILED)
- [ ] failure_reason is MOODLE_PERMISSION_DENIED

#### 6.3 Verify Retry-Worker Skips Non-Retryable
```bash
# Wait for scheduled retry-worker (hourly)
# OR manually trigger:
curl -X POST "$SUPABASE_URL/functions/v1/retry-worker" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

# Check that attempts count does NOT increment
curl -X GET "$SUPABASE_URL/rest/v1/moodle_enrollment_sync?id=eq.sync-xxx" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0].attempts'
# Expected: 1 (no retry attempt was made)
```

**Checklist:**
- [ ] Retry-worker does not retry non-retryable failures
- [ ] Attempts count stays at 1
- [ ] Application continues (no crash or hang)

#### 6.4 Verify Nexus Escalation
```bash
curl -X GET "$SUPABASE_URL/rest/v1/rocksolid_task_links?source_type=eq.escalation:moodle_enrollment_sync&source_id=eq.sync-xxx" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {status, nexus_task_id}'
```

**Expected:**
```json
{
  "status": "CREATED",
  "nexus_task_id": "task-12345"
}
```

**Checklist:**
- [ ] Nexus task created for permission error
- [ ] Status is CREATED
- [ ] nexus_task_id is populated

---

### Test 7: Full Registration Lifecycle ⏱️ 60 minutes

**Goal:** One complete registration flows through all layers.

```bash
#!/bin/bash

# Setup
BATCH_ID="batch-test-fall-2026"
CLASS_ID="class-opt-001"
STUDENT_EMAIL="charlie.fulltest@test-foundation.org"
STUDENT_NAME="Charlie FullTest"
ADMIN_EMAIL="alice.admin@test-foundation.org"

echo "=== FULL REGISTRATION LIFECYCLE TEST ==="

# 1. Submit registration
echo "Step 1: Submitting registration..."
REG_RESPONSE=$(curl -s -X POST "https://rocksolid-staging.netlify.app/.netlify/functions/registration-processor" \
  -H "Content-Type: application/json" \
  -H "Origin: https://rocksolid-staging.netlify.app" \
  -d '{
    "first_name": "'$(echo $STUDENT_NAME | cut -d' ' -f1)'",
    "last_name": "'$(echo $STUDENT_NAME | cut -d' ' -f2)'",
    "email": "'$STUDENT_EMAIL'",
    "phone": "+1234567890",
    "batch_id": "'$BATCH_ID'",
    "selected_classes": ["'$CLASS_ID'"]
  }')
echo $REG_RESPONSE | jq .
APP_ID=$(echo $REG_RESPONSE | jq -r '.registration_id')
SYNC_ID=$(echo $REG_RESPONSE | jq -r '.moodle_sync_id')

# 2. Verify applicant created
echo "Step 2: Verifying applicant record..."
curl -s -X GET "$SUPABASE_URL/rest/v1/applicants?id=eq.$APP_ID" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {id, email, registration_status, created_at}'

# 3. Verify registration audit log
echo "Step 3: Checking audit log (registration)..."
curl -s -X GET "$SUPABASE_URL/rest/v1/audit_logs?entity_type=eq.applicants&entity_id=eq.$APP_ID&limit=1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.[0] | {action, status, logged_at}'

# 4. Trigger Moodle sync
echo "Step 4: Triggering Moodle sync..."
curl -s -X POST "$SUPABASE_URL/functions/v1/moodle-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "'$SYNC_ID'"}' | jq '{ok, status: .sync_status}'

sleep 2

# 5. Verify Moodle user created
echo "Step 5: Verifying Moodle user..."
curl -s -X POST "https://moodle.staging.rocksolid.org/webservice/rest/server.php" \
  -d "wstoken=$MOODLE_TOKEN&wsfunction=core_user_get_users&moodlewsrestformat=json&criteria[0][key]=email&criteria[0][value]=$STUDENT_EMAIL" | jq '.users[0] | {id, email, username}'

# 6. Verify email queued
echo "Step 6: Queuing welcome email..."
curl -s -X POST "$SUPABASE_URL/rest/v1/email_queue" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template_key": "test_welcome",
    "recipient_email": "'$STUDENT_EMAIL'",
    "recipient_name": "'$STUDENT_NAME'",
    "status": "Pending",
    "payload": {}
  }' | jq '.[] | {id, status}'

# 7. Trigger email sender
echo "Step 7: Processing email queue..."
EMAIL_RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/email-sender" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
echo $EMAIL_RESULT | jq '{sent: .sent, failed: .failed, errors: .errors}'

# 8. Verify email sent
echo "Step 8: Checking email delivery..."
# Manual check: look in test inbox for welcome email
echo "⏳ Check test-inbox@test-foundation.org for welcome email (60 seconds)"
sleep 5
echo "✓ Check complete (manual verification required)"

# 9. Verify push notification (if VAPID configured)
echo "Step 9: Checking push notification..."
PUSH_RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/send-push" \
  -H "Authorization: Bearer $(get_admin_token)" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Registration Confirmation",
    "body": "Charlie FullTest has registered for Fall 2026 Cohort",
    "type": "manual_test"
  }')
echo $PUSH_RESULT | jq '{ok, skipped}'

# 10. Summary
echo "=== LIFECYCLE TEST COMPLETE ==="
echo "Applicant ID: $APP_ID"
echo "Sync ID: $SYNC_ID"
echo "Student Email: $STUDENT_EMAIL"
echo "✓ All steps completed (manual verification of email delivery required)"
```

**Checklist:**
- [ ] Registration submitted and accepted (HTTP 200, registration_id returned)
- [ ] Applicant record created with status ASSIGNED
- [ ] Moodle user created and matches email
- [ ] Moodle enrollment confirmed
- [ ] Email queued and sent
- [ ] Email delivered to test inbox within 60 seconds
- [ ] Audit log has entries for each step
- [ ] Push notification sent (if VAPID configured)
- [ ] No silent failures (all errors in audit logs)

---

## SCHEDULE CHECK

### Critical Discrepancy
```bash
# Check actual retry-worker schedule in config
cat supabase/functions/retry-worker/config.toml | grep schedule

# Expected per CLAUDE.md: "*/20 * * * *" (every 20 minutes)
# Actual in file: "0 * * * *" (every hour at :00)

# ACTION REQUIRED: Verify which is correct in deployed environment
# If should be every 20 min, update to: "*/20 * * * *"
```

**Resolution:**
```bash
# If changing to 20-minute interval:
sed -i 's/schedule = "0 \* \* \* \*"/schedule = "\/20 * * * *"/' supabase/functions/retry-worker/config.toml

# Redeploy:
supabase functions deploy retry-worker
```

---

## PASS/FAIL CRITERIA

### PASS (Integrations Certified for Staging)
- ✅ All configuration tests pass (Supabase, Moodle, Resend, Nexus, VAPID)
- ✅ Happy path tests pass (registration → moodle sync → email → push)
- ✅ Failure paths handled correctly (retryable vs non-retryable)
- ✅ Retry behavior verified (auto-sweep, no infinite loops)
- ✅ Audit logging complete (no silent failures)
- ✅ Operator dashboards functional
- ✅ Full lifecycle test succeeds

### FAIL (Not Certified)
- ❌ Configuration tests fail (external API unreachable)
- ❌ Happy path stops at any step (registration fails, Moodle sync fails, email not delivered)
- ❌ Retry behavior incorrect (non-retryable marked as retryable, causing endless loops)
- ❌ Audit logs missing (silent failures present)
- ❌ Operator dashboards show errors or blank
- ❌ Full lifecycle test has any uncaught errors

---

## Sign-Off

Test Date: ________________  
Tested By: ________________  
Result: ☐ PASS ☐ FAIL  

Comments:
_________________________________________________________________
_________________________________________________________________

---

## Appendix: Useful Commands

```bash
# Invoke Supabase function
curl -X POST "$SUPABASE_URL/functions/v1/<function-name>" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{...}' | jq .

# Query Postgres directly via Supabase REST
curl -X GET "$SUPABASE_URL/rest/v1/<table>?<filters>" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq .

# Check function logs
supabase functions download <function-name>
tail -f /path/to/logs  # Platform-dependent

# Get current environment
printenv | grep SUPABASE

# Reset test data
DELETE FROM email_queue WHERE recipient_email LIKE '%@test-foundation.org';
DELETE FROM moodle_enrollment_sync WHERE email LIKE '%@test-foundation.org';
DELETE FROM applicants WHERE email LIKE '%@test-foundation.org';
```

