# Deployment & Operations Guide

---

## Frontend Deployment

### Production Deployment: Netlify

**Repository Configuration:**
- Build command: `node scripts/generate-netlify-config.mjs`
- Publish directory: `.` (root)
- Source directory: `/foundation`

**Deployment Flow:**
1. Push to `main` branch
2. Netlify automatically builds and deploys
3. Frontend served from https://rocksolidsuite.netlify.app

**Redirects:**
- `/` → `/foundation/auth/login.html`
- `/staff/*` → `/foundation/staff/:splat`
- `/auth/*` → `/foundation/auth/:splat`
- `/teacher/*` → `/foundation/teacher/:splat`

### Configuration

**Local Development:**
```bash
# Copy config template
cp foundation/js/config.js.example foundation/js/config.js

# Edit with local Supabase credentials
# SUPABASE_URL=http://localhost:54321
# SUPABASE_ANON_KEY=<local-key>
```

**Never commit real credentials to config.js** — the file is gitignored.

### Testing Locally

```bash
# Start Supabase local stack
supabase start

# Serve frontend
python -m http.server 8000 --directory foundation

# Visit http://localhost:8000/auth/login.html
```

---

## Edge Functions Deployment

### Prerequisites
- Supabase CLI installed
- Project credentials in environment or `.env.local`
- All edge functions have source code in `/supabase/functions/<name>/`

### Deploying Individual Functions

```bash
# Deploy single function
supabase functions deploy email-sender

# Deploy all functions
supabase functions deploy
```

### Deploying Migrations

```bash
# Run migrations locally
supabase db push

# Check migration status
supabase migration list
```

### Environment Variables / Secrets

**Set in Supabase Project Settings → Edge Functions → Secrets:**

| Variable | Purpose | Required |
|---|---|---|
| `SUPABASE_URL` | Project URL | Yes |
| `SUPABASE_ANON_KEY` | Frontend auth/db | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged backend operations | Yes |
| `CRON_INVOKE_SECRET` | Cron function authentication | Yes |
| `INTERNAL_INVOKE_SECRET` | Function-to-function authentication | Yes |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) | Yes |
| `RESEND_API_KEY` | Email delivery via Resend | Yes |
| `MOODLE_URL` | Moodle LMS endpoint | Yes |
| `MOODLE_TOKEN` | Moodle API token | Yes |
| `NEXUS_API_URL` | Nexus task management endpoint | Yes |
| `NEXUS_API_KEY` | Nexus authentication | Yes |
| `PHASE2_WEBHOOK_SECRET` | Phase2 processor authentication (if used) | No |
| `ATTENDANCE_ADMIN_EMAIL` | Attendance ops contact | No |
| `TEACHER_PORTAL_URL` | Teacher portal URL | No |

**Do not commit real values.** All secrets are set directly in Supabase project settings.

---

## Production Checklist

Before declaring production-ready:

### Frontend
- [ ] Netlify build succeeds
- [ ] All pages load at https://rocksolidsuite.netlify.app
- [ ] Login works (Supabase Auth)
- [ ] Staff portal accessible to admin users
- [ ] Teacher portal accessible to teachers
- [ ] No console errors in browser

### Edge Functions
- [ ] All functions deployed to Supabase project
- [ ] Function logs show no errors
- [ ] Manually invoke key functions to verify they work:
  - `registration-processor` (with test payload)
  - `retry-worker` (with x-cron-secret header)
  - `admin-api` (with auth token)
  - `teacher-portal-api` (with teacher token)

### Database
- [ ] All migrations applied (check Supabase Migrations dashboard)
- [ ] RLS policies enabled on all user-facing tables
- [ ] Test data created for manual testing

### External Services
- [ ] Supabase Auth configured (email provider, redirect URIs)
- [ ] Moodle API accessible, token valid
- [ ] Resend API accessible, domain configured
- [ ] Nexus API accessible, authentication working
- [ ] CORS configuration correct (ALLOWED_ORIGINS)

### Monitoring & Ops
- [ ] Audit logs being written
- [ ] Email queue being consumed
- [ ] Moodle sync queue being processed
- [ ] Cron jobs executing (check pg_cron dashboard)
- [ ] Failed syncs surfacing in Retry Center

### Security
- [ ] CRON_INVOKE_SECRET set and not exposed
- [ ] INTERNAL_INVOKE_SECRET set and not exposed
- [ ] No real credentials in version control
- [ ] All functions verify auth server-side
- [ ] RLS policies restrict user access appropriately

---

## Rollback Procedure

If production deployment has critical issues:

1. **Stop new traffic** (if needed, disable Netlify deployment)
2. **Revert frontend code** to last known-good commit
3. **Redeploy Edge Functions** from last known-good version
4. **Run forward-fix migration** if database schema changed
5. **Verify** checkout completeness (audit logs, email queue status)
6. **Post-mortem:** Document what went wrong and how to prevent

---

## Environment-Specific Configuration

### Local Development
- Supabase local stack (port 54321)
- Deno runtime
- Test credentials

### Staging
- Supabase staging project
- Test Moodle instance
- Test email domain (Resend)

### Production
- Supabase production project
- Live Moodle instance
- Production email domain
- Real Nexus instance

**Database Migrations** are applied in order across all environments. Always test locally before running against staging or production.

---

## Monitoring Deployed Functions

### Supabase Dashboard

Check Edge Functions → Logs for:
- Function execution status
- Errors and exceptions
- Invocation count and latency
- Recent deploys

### Database Monitoring

Check Supabase Dashboard → Database → Logs for:
- Query performance
- RLS policy violations
- Replication lag (if applicable)

### Email Queue Status

```sql
SELECT status, COUNT(*) FROM email_queue GROUP BY status;
```

Healthy queue has:
- Most emails in SENT status
- Minimal FAILED/RETRYING
- Few PENDING (should be processed within 15 min)

### Moodle Sync Queue Status

```sql
SELECT sync_status, COUNT(*) FROM moodle_enrollment_sync GROUP BY sync_status;
```

Healthy queue has:
- Most rows in SYNCED status
- Few FAILED/RETRYING
- Few PENDING (should be processed within function invocation)

---

## Common Issues & Fixes

### Functions Not Invoking

**Symptom:** Email not delivered, Moodle enrollment stuck

**Checks:**
1. Verify pg_cron jobs in Supabase → Cron Jobs dashboard
2. Check function logs for errors
3. Verify CRON_INVOKE_SECRET is set
4. Manually invoke function with x-cron-secret header

### Moodle 403 Errors

**Symptom:** Moodle enrollment fails with 403

**Reason:** WAF block, permission denied, or REST API disabled

**Action:** Check Moodle logs, contact Moodle admin; manual retry via Retry Center

### Email Bounces

**Symptom:** Resend reports bounces

**Reason:** Invalid email address, domain not configured

**Action:** Fix email in registration, re-queue via Retry Center

---

## Disaster Recovery

**In case of data loss or corruption:**

1. **Check Supabase backups:** Supabase includes daily automated backups
2. **Restore from backup:** Contact Supabase support if needed
3. **Verify audit logs:** Audit logs may help identify what data was affected
4. **Manual recovery:** If applicable, re-import registration data from backup source

**Best practice:** Regular exports of critical tables (applicants, batches, classes) to version control or backup storage.
