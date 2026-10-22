# Operational Health Dashboard

> **Purpose:** Define production health metrics, thresholds, and runbooks for Rock Solid Ops.  
> **Last Updated:** 2026-09-22  
> **Operator:** On-call team + Amber Moseri (platform engineer)

---

## System Health Checkpoints

### 1. Email Pipeline

**Metrics:**
- `email_queue` unprocessed rows (target: < 10; alert: > 50)
- `email_queue` failed rows (count of `status = 'failed'` after 24h; alert: > 5)
- `notification_batch_processor` last invocation (target: within last 15 min; alert: > 30 min stale)

**Healthy State:**
- Most emails sent within 5 minutes of queueing.
- Failed sends (Resend API timeouts, invalid address) logged to `audit_logs` with `action = 'email_send_failed'`.
- Resend API rate limit (`100 requests/second`) not breached.

**Runbook — Email Stuck:**
1. Check `email_queue` → `status = 'pending'` count. If > 100, investigate Resend API status.
2. Query `audit_logs` → `action = 'email_send_failed'` (last 1 hour). Check error type.
3. If Resend API is down, wait for recovery and manual retry via Retry Center.
4. If address invalid, admin marks record `resolved` in Retry Center; applicant flagged for correction.

---

### 2. Moodle Sync

**Metrics:**
- `moodle_enrollments` unprocessed rows (target: < 5; alert: > 20)
- Moodle HTTP 403 / WAF blocks (count in `audit_logs` within 24h; alert: > 2 independent WAF events)
- Moodle sync last run (target: within last 60 min; alert: > 90 min stale)

**Healthy State:**
- ASSIGNED applicants enrolled in Moodle within 10 minutes of assignment.
- Network timeouts classified as retryable; retried on hourly sweep.
- Missing Moodle mapping (applicant has no `moodle_course_id`) flagged as non-retryable; admin reviews.

**Runbook — Moodle Enrollment Failing:**
1. Check `audit_logs` → `action = 'moodle_sync_failed'` (last 1 hour).
2. If HTTP 403 (WAF block):
   - This is non-retryable. Escalate to Moodle admin; log ticket reference in `audit_logs`.
   - Do NOT retry; WAF will block again.
3. If network timeout or connection refused:
   - Retryable. Wait for next hourly `retry-worker` sweep (top of hour).
   - Or manually trigger via Retry Center if urgent.
4. If missing `moodle_course_id`: admin adds mapping in `classes` table; next sync will retry.

---

### 3. Retry Worker

**Metrics:**
- `retry-worker` last invocation (cron: `0 * * * *`, i.e., top of every hour; alert if > 90 min late)
- Retryable queue depth (count `status = 'pending_retry'` in `moodle_enrollments` + `email_queue`; alert: > 50)
- Exhausted retries (count `retry_count >= 5` AND `status = 'pending_retry'`; alert: > 3)

**Healthy State:**
- Retryable failures automatically re-attempted on hourly sweep.
- Non-retryable failures (auth, WAF, invalid input) logged and surfaced to admin.
- Manual retry via Retry Center is the operator escape hatch.

**Runbook — Retry Worker Not Running:**
1. Verify edge function deployment: `supabase functions list` → `retry-worker` shows as deployed.
2. Check Supabase cron schedule: `https://app.supabase.com/{project}/functions` → Logs tab → filter by `retry-worker`.
3. If logs show errors, check function code at `supabase/functions/retry-worker/index.ts`.
4. If function is deployed but not invoked, recreate cron trigger:
   ```bash
   supabase functions deploy retry-worker --follow
   ```
5. Verify invocation: next hour, check logs.

---

### 4. Registration Pipeline

**Metrics:**
- `applicants` newly created (last 1h; expected: 0–100 depending on campaign)
- DUPLICATE records (count `registration_status = 'DUPLICATE'`; expected: 0–5% of daily intake)
- REVIEW queue (count `registration_status = 'REVIEW'`; alert: > 10 unaddressed after 24h)

**Healthy State:**
- Registrations processed synchronously; applicant sees status within 5 seconds.
- Duplicates detected by email + phone matching; flagged for admin review (not auto-silenced).
- Waitlist overflow (class full) → applicant in WAITLISTED + queued for class selection email.

**Runbook — Registration Intake Jamming:**
1. Check `audit_logs` → `action = 'registration_intake'` (last 1 hour) → look for error messages.
2. Check `registration-processor` edge function logs.
3. Common issues:
   - Invalid `batch_id` / `class_id` in form submission → form validation issue (frontend bug).
   - Database constraint violation (e.g., missing fellowship) → data integrity issue.
   - Moodle sync failure for ASSIGNED applicants → see Moodle Sync runbook.

---

### 5. Scheduled Jobs

**Active Cron Schedules:**

| Function | Schedule | Purpose | Alert Threshold |
|---|---|---|---|
| `retry-worker` | `0 * * * *` | Retry failed Moodle/email | > 90 min stale |
| `notification-batch-processor` | Every 15 min | Process notification queue | > 30 min stale |
| (Future) `missed-class-detector` | Daily 6am UTC | Flag no-shows | Not yet deployed |
| (Future) `student-engagement-monitor` | Weekly Thu 5pm UTC | Health check + nudge | Not yet deployed |

**Runbook — Scheduled Job Not Firing:**
1. Verify cron is configured in Supabase project.
2. Check function deployment: `supabase functions list`.
3. Check logs for the scheduled time window (e.g., if `retry-worker` should run at 14:00, check logs from 14:00–14:05).
4. If logs are silent, redeploy: `supabase functions deploy <function-name> --follow`.

---

### 6. Database Migrations

**Metrics:**
- Current migration version (target: matches repo HEAD in `supabase/migrations/`)
- Migration backlog (count pending migrations in repo not yet applied; alert: > 0)

**Healthy State:**
- All migrations in `supabase/migrations/` are applied to production Postgres.
- Schema is consistent with repo canonical state.

**Runbook — Migrations Out of Sync:**
1. Check current production schema: `supabase db pull` (requires local Supabase CLI auth).
2. Compare to repo: `git log supabase/migrations/ --oneline | head -5`.
3. If production is behind, apply pending migrations:
   ```bash
   supabase db push
   ```
4. If production has migrations not in repo, escalate (schema drift; requires manual reconciliation).

---

### 7. Auth & Session Security

**Metrics:**
- Failed login attempts (count `audit_logs` → `action = 'auth_failed'`; alert: > 10 in 1 hour from same IP)
- Privilege escalation attempts (count `action = 'unauthorized_privilege_change'`; alert: > 0)
- JWT expiry issues (count `action = 'auth_token_expired'`; expected: normal, no alert)

**Healthy State:**
- All edge functions verify JWT role server-side before privileged actions.
- RLS policies enforce row-level access.
- No unauthenticated callers can trigger admin functions.

**Runbook — Suspected Auth Breach:**
1. Check `audit_logs` → `action LIKE 'auth%'` for last 24h.
2. Look for privilege escalation patterns or repeated failed attempts.
3. If breach suspected, rotate service role key immediately and redeploy all edge functions.
4. Audit applicant/staff data access in same period.

---

## On-Call Escalation Path

| Issue | Owner | Escalate If | Action |
|---|---|---|---|
| Email stuck > 2h | Email ops | > 100 pending | Check Resend; manual retry or mark failed |
| Moodle WAF block | Moodle admin | > 1 concurrent block | Escalate to LMS provider; manual retry banned |
| Retry worker stale > 2h | Ops engineer | Verified down | Redeploy; check logs |
| Registration intake down | Platform team | > 30 min outage | Check `registration-processor` logs; possible rollback |
| Auth suspected breach | Security + ops | Any privilege escalation | Rotate keys; audit access; notify staff |

---

## Data Backup & Recovery

**Current State:**
- Automatic daily snapshots via Supabase (retention: 7 days free, configurable).
- No manual backups required (snapshots are automated).

**Recovery Procedure (if needed):**
1. Go to Supabase dashboard → Backups.
2. Select snapshot.
3. Restore to new database or current (with confirmation).

**Production Data Integrity:**
- Audit logs retained indefinitely.
- No data deletion without admin + ops sign-off + audit log.

---

## Health Check Automation (Future)

**Proposed:** Scheduled Lambda/GitHub Actions to:
- Query production metrics hourly.
- Post health status to ops Slack channel.
- Alert on threshold breaches.

**Status:** Not yet implemented. Manual checks sufficient for current scale.

---

## Contacts & Escalation

- **Platform Engineer:** Amber Moseri (blwcan.elvanto@gmail.com)
- **Moodle Admin:** [TBD — add LMS contact]
- **Resend Support:** support@resend.com
- **Supabase Support:** support@supabase.com
