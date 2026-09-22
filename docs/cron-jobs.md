# Cron Jobs & Scheduled Functions

This document describes scheduled Edge Functions and their intended cadence.

**Important:** Declared cron schedules in `config.toml` represent source intent. Actual production scheduling requires verification in Supabase pg_cron dashboard.

---

## Scheduled Functions

### Email Delivery

**Function:** `email-sender`
- **Schedule:** Every 15 minutes (`*/15 * * * *`)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Deliver queued emails via Resend API
- **Config:** `/supabase/functions/email-sender/config.toml`
- **Production Status:** Verify pg_cron job exists and is active

### Retry Worker

**Function:** `retry-worker`
- **Schedule:** Every 20 minutes (`*/20 * * * *`)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Sweep failed operations; reattempt retryable failures; escalate permanent failures
- **Config:** `/supabase/functions/retry-worker/config.toml`
- **Production Status:** Verify pg_cron job exists and is active

### Moodle Sync

**Function:** `moodle-sync`
- **Schedule:** TBD (check config.toml and production)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Discover and process pending Moodle enrollments
- **Config:** `/supabase/functions/moodle-sync/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence

### Missed Class Detection

**Function:** `missed-class-detector`
- **Schedule:** Daily 02:15 UTC (`15 2 * * *`)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Detect attendance gaps; flag at-risk students; escalate to Nexus
- **Config:** `/supabase/functions/missed-class-detector/config.toml`
- **Production Status:** Verify pg_cron job exists and is active

### Student Engagement Monitoring

**Function:** `student-engagement-monitor`
- **Schedule:** TBD (check config.toml)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Evaluate student milestones, attendance, progress; trigger follow-up
- **Config:** `/supabase/functions/student-engagement-monitor/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence

### Attendance Reminders

**Function:** `attendance-reminder`
- **Schedule:** TBD (check config.toml)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Remind teachers to submit attendance
- **Config:** `/supabase/functions/attendance-reminder/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence

### Review Follow-Up

**Function:** `review-checkin`
- **Schedule:** TBD (check config.toml)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Follow up on applicants in REVIEW status; move to ASSIGNED or escalate
- **Config:** `/supabase/functions/review-checkin/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence

### Attention Flag Push Sweep

**Function:** `attention-flag-push-sweep`
- **Schedule:** TBD (check config.toml)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Sweep attention flags; trigger push notifications
- **Config:** `/supabase/functions/attention-flag-push-sweep/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence

### Notification Batch Processing

**Function:** `notification-batch-processor`
- **Schedule:** TBD (check config.toml)
- **Auth:** CRON_INVOKE_SECRET or On-Demand
- **Purpose:** Batch pending notifications; write to email_queue
- **Config:** `/supabase/functions/notification-batch-processor/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence (if scheduled)

### Moodle Grade Sync

**Function:** `moodle-grade-sync`
- **Schedule:** TBD (check config.toml)
- **Auth:** CRON_INVOKE_SECRET
- **Purpose:** Pull grades from Moodle; update milestone status
- **Config:** `/supabase/functions/moodle-grade-sync/config.toml`
- **Production Status:** Verify pg_cron job exists and cadence

### Report Generation

**Function:** `report-generator`
- **Schedule:** TBD (check config.toml) or On-Demand
- **Auth:** CRON_INVOKE_SECRET or User JWT
- **Purpose:** Generate data exports (applicants, attendance, engagement)
- **Config:** `/supabase/functions/report-generator/config.toml`
- **Production Status:** Verify pg_cron job exists if scheduled

---

## Unscheduled Functions

The following do NOT have active cron schedules:

### `email-retry`
- **Auth:** User JWT (manual only)
- **Purpose:** Reset single email to PENDING for manual retry
- **Invoked By:** Retry Center UI
- **Note:** One-off helper; no batch scheduling needed

### `notification-retry-helper`
- **Auth:** User JWT (manual only)
- **Purpose:** Reset single notification to PENDING for manual retry
- **Invoked By:** Retry Center UI
- **Note:** One-off helper; no batch scheduling needed

### `scheduled-notification-sender`
- **Status:** Unscheduled (batch work moved to notification-batch-processor)
- **Note:** Legacy; do not schedule

---

## Production Verification Checklist

Before claiming cron infrastructure is healthy:

- [ ] Verify each cron function has a pg_cron job in Supabase dashboard
- [ ] Confirm each job is enabled (not suspended)
- [ ] Verify schedule matches intended cadence
- [ ] Check function logs for recent successful executions
- [ ] Confirm CRON_INVOKE_SECRET is set in Supabase project settings
- [ ] Test a manual invocation with correct x-cron-secret header
- [ ] Verify downstream tables (email_queue, moodle_enrollment_sync, etc.) are being populated/consumed as expected

---

## Debugging Cron Issues

### Function Not Executing

1. Check Supabase dashboard → Edge Functions → Logs
2. Verify pg_cron job exists and is enabled
3. Verify CRON_INVOKE_SECRET environment variable is set
4. Manually invoke function with correct x-cron-secret header:
   ```bash
   curl -X POST https://<project>.supabase.co/functions/v1/email-sender \
     -H "x-cron-secret: <CRON_INVOKE_SECRET>" \
     -H "Content-Type: application/json"
   ```
5. Check function implementation for auth validation

### Function Executing But Failing

1. Check function logs for error details
2. Verify downstream API access (Moodle, Resend, Nexus)
3. Verify database connections and RLS permissions
4. Check for environment variable typos or missing secrets

### Queue Not Being Consumed

1. Verify cron function is actually running (check logs)
2. Verify queue table is being populated
3. Check for permanent failure classifications preventing retries
4. Check Retry Center for stuck records

---

## Configuration Details

Each scheduled function has a `config.toml` file in its directory:

```toml
[env]
path = "./deno.env"

[cron]
schedule = "*/15 * * * *"
```

To add or change a schedule:

1. Edit the function's `config.toml`
2. Run `supabase functions deploy <function-name>`
3. Verify in Supabase dashboard that pg_cron job was created/updated
4. Monitor logs to confirm execution

---

## Security

All cron functions use `CRON_INVOKE_SECRET` via `x-cron-secret` header. The secret is:

- Environment-specific (set in Supabase project settings, not in code)
- Never logged or exposed
- Verified via SHA-256 hash comparison (timing-safe)

**Do not:**
- Commit CRON_INVOKE_SECRET to version control
- Use the same secret for INTERNAL_INVOKE_SECRET
- Reuse CRON_INVOKE_SECRET as a user JWT
- Expose cron schedules or job IDs publicly
