# Rock Solid Foundation School — System Overview

*Last updated: May 24, 2026 � Primary audience: engineers, new contributors, and operators*

---

## 1 — What This System Is

Rock Solid Foundation School is an internal operations platform built for BLW Canada that manages the complete lifecycle of a church-run foundation school program. Students at university campuses (fellowships) across Canada register online, get assigned to a weekly class taught by a volunteer teacher, attend sessions tracked through a teacher portal, and complete coursework through an integrated Moodle LMS. Administrators at the fellowship, subgroup, regional, and national level manage registrations, class assignments, teacher approvals, and communications — all through a single Supabase-backed web application hosted on Netlify. The platform replaced a Google Apps Script + Google Sheets system and handles the full loop from a student's first registration form submission to their course completion milestone.

---

## 2 — Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         NETLIFY (Static HTML/JS)                     │
│  /foundation/staff/    — Admin portal (admin-dashboard, batch-mgmt)  │
│  /foundation/teacher/  — Teacher portal (attendance, class view)      │
│  /foundation/auth/     — Login / logout                              │
│  /foundation/registration/ — Public registration forms               │
└──────────────┬───────────────────────────────────────────────────────┘
               │  Supabase JS SDK (REST + Realtime)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (xelpsttqhrcqmttmjory)                   │
│                                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐ │
│  │   PostgreSQL 15      │    │        Edge Functions (Deno)         │ │
│  │                     │    │  registration-processor              │ │
│  │  applicants         │    │  phase2-processor                    │ │
│  │  students           │    │  moodle-sync                        │ │
│  │  class_options      │◄───│  moodle-grade-sync                  │ │
│  │  class_slots        │    │  email-sender                       │ │
│  │  batches            │    │  notification-batch-processor        │ │
│  │  email_queue        │    │  attendance-reminder                 │ │
│  │  scheduled_notifs   │    │  missed-class-detector              │ │
│  │  moodle_enroll_sync │    │  + 14 more (see Section 5)          │ │
│  │  student_grades     │    └──────────────────────────────────────┘ │
│  │  audit_logs         │                                             │
│  └─────────────────────┘                                             │
│  ┌──────────────────────┐                                            │
│  │   Supabase Auth      │                                            │
│  │   (profiles table)   │                                            │
│  └──────────────────────┘                                            │
└──────┬────────────────────────────────────┬───────────────────────────┘
       │                                    │
       ▼                                    ▼
┌─────────────┐                  ┌─────────────────────┐
│   RESEND     │                  │   MOODLE LMS        │
│ (email API)  │                  │ rocksolid.lwcanada  │
│ Transactional│                  │ .org                │
│ email        │                  │ User accounts +     │
│ delivery     │                  │ course enrollment   │
└─────────────┘                  └─────────────────────┘
       │
       ▼
┌─────────────┐    ┌──────────────────┐
│  CLICKUP     │    │   MAILCHIMP      │
│ (escalation  │    │ (marketing,      │
│  tickets)    │    │  onboarding      │
└─────────────┘    │  campaigns)      │
                   └──────────────────┘
```

---

## 3 — The Student Journey

### Step 1: Student submits registration form
**Trigger:** Student fills out the public HTML form at `/foundation/registration/`.
**Handler:** `registration-processor` edge function receives a POST with the form data.
**What happens:**
- Validates required fields (full_name, email, fellowship_code, availability slots)
- Checks for duplicate registrations (same email in same batch → `DUPLICATE` status)
- Inserts a row into `applicants` with `registration_status = PENDING`
- Queues a confirmation email via `email_queue`
- Generates a `trace_id` carried forward through the whole pipeline

**What can go wrong:** Duplicate email detection fails if batch context is missing. Missing fellowship_code causes a validation error.
**Recovery:** Check `error_submissions` table for failed processing. Fix and resubmit, or manually create the `applicants` row.

---

### Step 2: Phase 2 processor assigns to class
**Trigger:** `phase2-processor` is called by a Supabase webhook after the applicant row is inserted, or manually by an admin.
**Handler:** `phase2-processor` edge function.
**What happens:**
- Reads applicant's availability preferences from `applicants.availability_json`
- Looks up available `class_slots` for the student's fellowship/subgroup/batch
- Assigns student to the best matching slot or marks `WAITLISTED` / `NO_MATCHING_TIME` / `MANUAL_REVIEW_REQUIRED`
- Updates `applicants.registration_status` to `ASSIGNED` or a waiting state
- Updates `class_slots.current_enrolment`

**What can go wrong:** No matching slot found → `WAITLISTED`. Class full → `WAITLISTED`. Conflicting data → `REVIEW`.
**Recovery:** Admin uses the admin portal to manually assign or reassign. `waitlist-processor` runs automatically to promote waitlisted students when capacity opens.

---

### Step 3: Confirmation email sent
**Trigger:** `registration-processor` or `phase2-processor` inserts a row into `email_queue` with `status = Pending`.
**Handler:** `email-sender` edge function (runs every 15 minutes via cron).
**What happens:**
- Reads up to 50 `email_queue` rows with `status = Pending`
- Resolves body HTML from the row or from `email_templates` by `template_key`
- Substitutes `{{variables}}` from row fields and `metadata` JSON
- Sends via Resend API
- Marks row `Sent` (sets `sent_at`) or `Failed` (sets `error_message`)

**What can go wrong:** `RESEND_API_KEY` not configured → all sends fail. Invalid template key → no body HTML.
**Recovery:** Check `email_queue.error_message`. Fix the secret or template, then reset `status = Pending` via the Retry Center.

---

### Step 4: Moodle account created and enrolled
**Trigger:** `applicants.registration_status` becomes `ASSIGNED` → a row is inserted into `moodle_enrollment_sync` with `sync_status = PENDING`.
**Handler:** `moodle-sync` edge function (triggered on-demand or by `retry-worker` cron every 20 min).
**What happens:**
- Looks up or creates the Moodle user via `core_user_create_users` / `core_user_get_users`
- Enrolls the user in the course via `enrol_manual_enrol_users`
- Updates `moodle_enrollment_sync.sync_status` to `SYNCED` or `FAILED`
- Writes `moodle_user_id` and `course_id` back to the sync row

**What can go wrong:** Moodle WAF block (retryable), permissions not configured (non-retryable), REST disabled. Error code written to `failure_reason`.
**Recovery:** Check `moodle_enrollment_sync.failure_reason`. For WAF blocks, retry via Retry Center. For permissions, fix Moodle web service config.

---

### Step 5: Teacher submits attendance
**Trigger:** Teacher logs into the Teacher Portal and submits attendance for a session.
**Handler:** `teacher-portal-api` edge function, which writes to `attendance_log`.
**What happens:**
- Teacher selects the session date and marks each student present/absent
- Row inserted into `attendance_log` with `class_option_id`, `batch_id`, `class_number`
- `attendance-reminder` cron detects missing attendance and queues reminders to teachers
- `missed-class-detector` flags students who miss multiple sessions

**What can go wrong:** Teacher account not linked (`UNLINKED` status) → portal returns error. Missing `confirmed_start_date` on class option → attendance reminder skips.
**Recovery:** Run `link_teacher_to_auth_user(email)` RPC or use admin UI to link teacher account.

---

### Step 6: Milestones tracked
**Trigger:** `moodle-grade-sync` checks course completion status and fetches gradebook data.
**Handler:** `moodle-grade-sync` edge function.
**What happens:**
- Calls `core_completion_get_course_completion_status` for each SYNCED student
- If completed: upserts `student_milestone_status` with `milestone_code = HOLY_SPIRIT`
- Calls `gradereport_user_get_grade_items` to fetch per-item grades
- Upserts rows into `student_grades` (one per grade item + one "Overall Course Grade" summary)
- Sends admin in-app notification on first completion

**What can go wrong:** Moodle web service doesn't have the grade report function enabled → `grade_sync_available = false` written to the sync row. Completion tracking not enabled in Moodle settings.
**Recovery:** Enable `gradereport_user_get_grade_items` in Moodle web service config. Enable completion tracking under Site admin → Advanced features.

---

### Step 7: Graduation / Completion
When all milestones are completed and attendance is satisfactory, the admin marks the student graduated in the portal. The student's record reflects `status = Graduated` in `students` (or `registration_status = COMPLETED` in `applicants`).

---

## 4 — Role Hierarchy

| Role | Portal access | Key permissions | Cannot do |
|---|---|---|---|
| `superadmin` | All portals | Everything; system-wide config | — |
| `admin` | Staff portal | Manage all applicants, batches, teachers, fellowships | Superadmin-only config |
| `principal` | Staff portal | Same as admin | — |
| `subgroup_admin` | Staff portal | Manage applicants/classes in their subgroup | Other subgroups |
| `pastor` | Staff portal | View and manage their fellowship's registrations | Other fellowships |
| `regional_secretary` | Staff portal (read-heavy) | View reports, surface issues; limited writes | Approve teachers, create batches |
| `teacher` | Teacher portal only | Submit attendance, view own class roster | Admin portal, other classes |
| `pending` | None | No portal access until promoted | Everything |

Role checks are enforced in `auth-client.js` (`isAdmin()`, `isStaff()`, `isRegionalSecretary()`) and in Supabase RLS policies using the `is_admin_like()` helper function.

Admin Teacher Mode: `admin`, `superadmin`, and `regional_secretary` can enter `Teacher Mode` from the shared admin shell, which applies teacher-scope navigation and links into teacher portal views.

---

## 5 — Edge Functions Reference

All functions live under `supabase/functions/`. They run on Deno. Shared utilities are in `supabase/functions/_shared/`.

| Function | Purpose | Trigger | Cron schedule |
|---|---|---|---|
| `registration-processor` | Validates and creates `applicants` rows from form submissions; queues confirmation email | HTTP POST from registration form | None (on-demand) |
| `phase2-processor` | Assigns applicant to a class slot or marks waitlisted/review | Supabase webhook on `applicants` insert | None (on-demand) |
| `email-sender` | Delivers `email_queue` rows via Resend API | Cron | Every 15 min (`*/15 * * * *`) |
| `notification-batch-processor` | Moves due `scheduled_notifications` into `email_queue` | On-demand / triggered | None (on-demand) |
| `moodle-sync` | Creates Moodle accounts and enrolls students | On-demand / `retry-worker` | None directly |
| `moodle-grade-sync` | Checks completion; fetches and stores gradebook data | On-demand / Sync Gradebook button; POST `{ email }` for single student | None (on-demand) |
| `retry-worker` | Sweeps PENDING/stuck Moodle enrollment rows and retries | Cron | Every 20 min (`*/20 * * * *`) |
| `attendance-reminder` | Queues reminders to teachers for sessions with no attendance submitted | Cron | On-demand |
| `missed-class-detector` | Flags students who missed sessions; creates ClickUp tasks | Cron | `15 2 * * *` (daily 02:15 UTC) |
| `student-engagement-monitor` | Detects never-started and dropped-off students; queues engagement emails | On-demand | None |
| `waitlist-processor` | Promotes waitlisted students when slots open | On-demand | None |
| `review-checkin` | Sends status-update emails to applicants stuck in REVIEW | Cron | See `review-checkin/config.toml` |
| `notification-dispatcher` | Creates `scheduled_notifications` from trigger events | On-demand | None |
| `notification-retry-helper` | Resets a single `scheduled_notification` to PENDING (Retry Center use only) | HTTP POST `{ id }` | **Must never be scheduled** |
| `report-generator` | Generates admin reports; requires valid user JWT | HTTP POST (admin only) | None |
| `teacher-portal-api` | Teacher portal API (attendance, class view, grade visibility) | HTTP POST with teacher JWT | None |
| `admin-api` | Admin operations API (router pattern) | HTTP POST with admin JWT | None |
| `clickup-sync` | Creates ClickUp tasks for escalations / missed class notices | HTTP POST `{ type }` | None |
| `mailchimp-sync` | Syncs student data to Mailchimp audience | HTTP POST `{ email }` | None |
| `email-retry` | Resets a single `email_queue` row to Pending | HTTP POST `{ id }` | None |
| `class-selection` | Handles class time selection links for registered students | HTTP POST | None |
| `reminder-processor` | **Deprecated tombstone** — renamed to `notification-batch-processor` | Cron (still scheduled) | Every 15 min |



> **Note:** eport-generator now applies request-origin allow headers before handling requests (pplyAllowedOrigin(req)) to avoid browser edge-invoke transport failures.

---

## 6 — Key Database Tables

### Registration tables

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `applicants` | Primary registration record per student per batch. Holds status, availability, class assignment | `registration-processor`, `phase2-processor`, admins | All admin functions, `moodle-sync`, `moodle-grade-sync` |
| `students` | Enrolled student records (migrated from legacy Apps Script system) | Admin portal, bulk import | Teacher portal, reporting |
| `error_submissions` | Captures form submissions that failed processing | `registration-processor` | Admin triage UI |

Key `applicants` columns: `id` (UUID PK), `email`, `fellowship_code`, `batch_id`, `class_option_id`, `registration_status` (PENDING / ASSIGNED / WAITLISTED / DUPLICATE / REVIEW / INACTIVE / COMPLETED), `availability_json`, `trace_id`.

---

### Class tables

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `batches` | Semester/cohort records | Admin portal | All pipeline functions |
| `class_options` | A specific class time + teacher combination (e.g. "Monday 7pm with Teacher X") | Admin portal | `phase2-processor`, teacher portal |
| `class_slots` | A `class_option` activated for a specific `batch` (tracks enrolment count) | Admin portal, `phase2-processor` | `waitlist-processor`, `attendance-reminder` |
| `fellowship_map` | Maps fellowship codes (campus abbreviations) to group (CE/CS/WS) and subgroup | Admin portal | `registration-processor`, `phase2-processor` |

Key distinction: **`class_option`** is the template (teacher + time + fellowship). **`class_slot`** is the batch-specific instance with enrolment tracking.

---

### Teacher tables

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `teachers` | Teacher records with email, group, soft-delete | Admin portal | `attendance-reminder`, `teacher-portal-api` |
| `teacher_availability` | Per-teacher availability per batch (Available / Unavailable / Tentative) | Teacher availability UI | Admin scheduling |

---

### Notification tables

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `email_queue` | Pending/sent/failed outbound emails | `registration-processor`, `notification-batch-processor`, any function that sends email directly | `email-sender` |
| `scheduled_notifications` | Events that should generate emails at a future time | `notification-dispatcher`, `registration-processor`, `phase2-processor` | `notification-batch-processor` |
| `notification_templates` | Full HTML email templates (CSS-class based, used for rich emails) | Migrations | `email-sender`, `notification-batch-processor` |
| `email_templates` | Simpler HTML email templates (original table) | Migrations, admin | `email-sender` |

> **Tech debt:** Two template tables exist (`notification_templates` and `email_templates`). `email-sender` checks both.

---

### Moodle tables

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `moodle_enrollment_sync` | Tracks Moodle sync state per student (PENDING → PROCESSING → SYNCED / FAILED) | `phase2-processor`, `moodle-sync` | `moodle-sync`, `retry-worker`, `moodle-grade-sync` |
| `student_grades` | Per-student per-grade-item grades synced from Moodle | `moodle-grade-sync` | Admin portal, teacher portal (student profile drawer) |
| `student_milestone_status` | Tracks milestone completion (e.g. `HOLY_SPIRIT` = Moodle course completed) | `moodle-grade-sync` | Admin portal, student profile |

---

### Auth tables

| Table | Purpose | Written by | Read by |
|---|---|---|---|
| `profiles` | Supabase auth user profiles with role and status | Auth trigger, admin portal | `auth-client.js` (every page load) |
| `config` | Key/value system configuration (form IDs, feature flags, reply-to address) | Migrations, admin | All edge functions |
| `audit_logs` | Canonical audit trail for all significant state changes | All edge functions via `safeLogAudit()` | Admin portal, System Health |

---

## 7 — Email Pipeline

```
[Any edge function or admin action]
         │
         ▼  INSERT row into email_queue (status=Pending)
         │  OR INSERT into scheduled_notifications (status=PENDING)
         │
         ▼  [notification-batch-processor processes scheduled_notifications]
         │  → copies to email_queue, marks notification SENT
         │
         ▼
   email_queue (status=Pending)
         │
         ▼  email-sender runs every 15 minutes (*/15 * * * *)
         │
         ├─ reads body_html from row (if present)
         │  OR fetches from email_templates by template_key
         │  OR fetches from notification_templates by template_key
         │
         ├─ substitutes {{variables}} from payload/metadata fields
         │
         ├─ sends via Resend API (RESEND_API_KEY secret)
         │
         ├─ success → status=Sent, sent_at=now()
         └─ failure → status=Failed, error_message=<reason>
```

**Retry:** Failed `email_queue` rows can be reset to `Pending` via the Retry Center. There is no automatic retry limit — operators manually retry.

**Retry for scheduled_notifications:** Use `notification-retry-helper` via the Retry Center to reset one notification to `PENDING`. On the next `notification-batch-processor` run it will be re-queued.

**Trace:** Every notification carries a `trace_id`. Use it to follow a registration event across `applicants` → `scheduled_notifications` → `email_queue` → `moodle_enrollment_sync`.

---

## 8 — Moodle Integration

### How a sync row is created
When an applicant's `registration_status` becomes `ASSIGNED`, a row is inserted into `moodle_enrollment_sync` with `sync_status = PENDING` and the applicant's email, batch_id, class_option_id, and trace_id.

### moodle-sync processing
1. Reads PENDING rows (up to batch limit)
2. Sets `sync_status = PROCESSING`
3. Calls `core_user_get_users` to check if Moodle user already exists by email
4. If not found: calls `core_user_create_users` to create the account
5. Calls `enrol_manual_enrol_users` to enroll the user in the course
6. On success: sets `sync_status = SYNCED`, writes `moodle_user_id` and `course_id`
7. On failure: sets `sync_status = FAILED`, writes `failure_reason` (one of `MOODLE_WAF_BLOCK`, `MOODLE_REST_DISABLED`, `MOODLE_PERMISSION_DENIED`, `MOODLE_403_UNKNOWN`)

### Grade sync (moodle-grade-sync)
1. Reads SYNCED rows that have both `moodle_user_id` and `course_id`
2. Calls `core_completion_get_course_completion_status` — if completed, upserts HOLY_SPIRIT milestone
3. Calls `gradereport_user_get_grade_items` — stores each grade item in `student_grades`
4. Also stores an "Overall Course Grade" summary row (percentage from course total item)
5. If grade API is unavailable: sets `grade_sync_available = false` on the sync row, continues

### Failure recovery
- **Stuck PROCESSING:** Reset `sync_status = PENDING` via the Retry Center or directly in SQL: `UPDATE moodle_enrollment_sync SET sync_status='PENDING' WHERE sync_status='PROCESSING';`
- **MOODLE_WAF_BLOCK:** Retry via Retry Center (transient — will resolve).
- **MOODLE_PERMISSION_DENIED / MOODLE_REST_DISABLED:** Fix Moodle web service config; these are non-retryable.
- **Grade API unavailable:** Enable `gradereport_user_get_grade_items` and `core_completion_get_course_completion_status` in Moodle → Site admin → Web services → External services.

---

## 9 — New Developer Onboarding

### 1. Read first
- This document (SYSTEM_OVERVIEW.md)
- `CLAUDE.md` (repo root) — project context, hard constraints, and conventions
- `ai/constraints.md` — hard rules for the platform
- `ai/statuses.md` — all status values used across tables
- `foundation/docs/ENGINEERING_CONVENTIONS.md` — coding conventions
- `foundation/docs/NOTIFICATION_PIPELINE.md` — email pipeline topology

### 2. Local setup
```bash
# Install Supabase CLI
npm install -g supabase

# Install Deno (for edge functions)
# https://deno.land/manual/getting_started/installation

# Link to project
supabase link --project-ref xelpsttqhrcqmttmjory

# Set edge function secrets (copy from Supabase Dashboard → Settings → Edge Functions)
supabase secrets set RESEND_API_KEY=... MOODLE_URL=... MOODLE_TOKEN=...

# Create foundation/js/config.js from the example (for local frontend dev)
cp foundation/js/config.js.example foundation/js/config.js
# Edit config.js with your local Supabase URL and anon key
```

### 3. Key files to understand
| File | What it does |
|---|---|
| `foundation/auth/auth-client.js` | Role resolution, session management, all pages import this |
| `foundation/js/admin-shell.js` | Shared shell for all staff pages (nav, sidebar, theme) |
| `foundation/js/runtime.js` | Runtime config guard — fail fast if config absent |
| `supabase/functions/_shared/http.ts` | `jsonResponse`, `safeLogAudit`, `corsHeaders` — used by all functions |
| `supabase/functions/_shared/supabase.ts` | `createServiceClient()`, `createAnonClient()` |
| `supabase/migrations/000_baseline_squash.sql` | Complete schema baseline |

### 4. Common tasks

**Add a new staff page:**
```html
<!-- Copy from foundation/staff/admin-dashboard.html as a template -->
<!-- Include in order: -->
<link rel="stylesheet" href="../ui/tokens.css" />
<link rel="stylesheet" href="../ui/primitives.css" />
<script type="module" src="../js/runtime.js"></script>
<script type="module" src="../js/admin-shell.js"></script>
<script type="module" src="../auth/auth-client.js"></script>
```

**Add an RPC:**
```sql
-- Create a new migration file: supabase/migrations/YYYYMMDDHHNN_description.sql
CREATE OR REPLACE FUNCTION public.my_new_rpc(param text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ...
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_new_rpc TO authenticated;
```

**Add an edge function:**
```bash
# Create the function directory and index.ts
mkdir supabase/functions/my-function
# Add an entry to supabase/config.toml:
# [functions.my-function]
# enabled = true
# verify_jwt = false
# entrypoint = "./functions/my-function/index.ts"

# Deploy
supabase functions deploy my-function
```

### 5. Deploy changes
```bash
# Deploy a single edge function
supabase functions deploy moodle-grade-sync

# Apply a new migration
supabase db push

# Deploy all functions
supabase functions deploy
```

### 6. Debug a broken pipeline
1. Check `audit_logs` table for `FAILED` status rows matching the action
2. Check `email_queue.error_message` for email failures
3. Check `moodle_enrollment_sync.failure_reason` for Moodle failures
4. Check `scheduled_notifications.last_error` for notification failures
5. Use the System Health → Operational Trace panel (by email or trace_id)
6. Check Supabase Dashboard → Edge Functions → Logs for runtime errors

---

## 10 — Operational Runbook

### Manually send pending emails
```bash
curl -X POST https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/email-sender \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Retry failed Moodle syncs
```bash
curl -X POST https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/moodle-sync \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Or reset stuck PROCESSING rows first:
```sql
UPDATE moodle_enrollment_sync
SET sync_status = 'PENDING', updated_at = now()
WHERE sync_status = 'PROCESSING'
  AND updated_at < now() - interval '30 minutes';
```

### Reset a stuck registration
```sql
-- Move to REVIEW for manual admin action
UPDATE applicants
SET registration_status = 'REVIEW', updated_at = now()
WHERE email = 'student@example.com'
  AND batch_id = '2025A';
```

### Add a new fellowship
```sql
INSERT INTO fellowship_map (fellowship_code, campus_name, group_id, subgroup_id)
VALUES ('NEWCODE', 'Campus Name', 'CE', 'CESGA');
```

### Add a teacher
Use the admin portal → Teacher Management, or:
```sql
INSERT INTO teachers (teacher_id, full_name, email, group_id, subgroup_id)
VALUES ('T_NEW_001', 'Jane Doe', 'jane@example.com', 'CE', 'CESGA');
```
Then link to auth account: `SELECT link_teacher_to_auth_user('jane@example.com');`

### Create a new batch
Use the admin portal → Batch Management, or:
```sql
INSERT INTO batches (batch_id, name, start_date, end_date, active, registration_open)
VALUES ('2026A', 'Spring 2026', '2026-01-15', '2026-06-30', true, true);
```

### Check system health
```sql
-- Recent audit log activity
SELECT action, status, details, logged_at
FROM audit_logs
ORDER BY logged_at DESC
LIMIT 50;

-- Email pipeline status
SELECT status, count(*) FROM email_queue GROUP BY status;
SELECT status, count(*) FROM scheduled_notifications GROUP BY status;

-- Moodle sync status
SELECT sync_status, count(*) FROM moodle_enrollment_sync GROUP BY sync_status;
```

### Read audit logs
```sql
-- All failed actions in the last 24 hours
SELECT action, entity_type, entity_id, details, logged_at
FROM audit_logs
WHERE status = 'FAILED'
  AND logged_at > now() - interval '1 day'
ORDER BY logged_at DESC;

-- Trace a specific registration
SELECT * FROM audit_logs
WHERE details->>'trace_id' = '<your-trace-id>'
ORDER BY logged_at ASC;
```

---

## 11 — Known Limitations and Tech Debt

| # | Item | Risk | Target |
|---|---|---|---|
| 1 | Auth module duplication (`auth-client.js` + `auth-guards.js` overlap) | High | Q3 2026 (partially resolved May 2026) |
| 2 | `registration-processor` and `phase2-processor` duplicate assignment logic | High | Q3 2026 |
| 3 | Dual email template tables (`email_templates` + `notification_templates`) | Medium | Ongoing |
| 4 | `sender-worker` removed but `reminder-processor` tombstone still has a cron schedule | High | Immediate |
| 5 | Schema fallback loops in some edge functions | Medium | Q4 2026 |
| 6 | No automated test suite (no unit or integration tests) | High | Q4 2026 |
| 7 | `class_slot_id` has no auto-generation — must be provided by caller | Low | Q4 2026 |
| 8 | Per-page local `<style>` blocks instead of shared `fs-*` primitives | Medium | Q4 2026 |
| 9 | React sub-app for teacher-availability (separate build chain) | Medium | Q4 2026 |
| 10 | No per-applicant operational trace screen (only admin System Health view) | High | Q3 2026 |
| 11 | `notification-retry-helper` naming is confusing (sounds like batch processor) | High | Q3 2026 |
| 12 | IDE TypeScript errors in all edge functions (VS Code TS checker ≠ Deno runtime) | Low | Configuration only |

---

## 12 — Glossary

| Term | Definition |
|---|---|
| **Fellowship** | A university campus BLW Canada church group (e.g. CMU, YORK). Identified by a short `fellowship_code`. |
| **Group** | Top-level regional grouping: `CE` (Central East), `CS` (Central South), `WS` (West). |
| **Subgroup** | Mid-level grouping within a group (e.g. CESGA, CESGB). Several fellowships belong to one subgroup. |
| **Batch** | A semester/term of Foundation School (e.g. `2025A` = Spring 2025). All registrations and class slots belong to a batch. |
| **Class option** | A specific class offering: a teacher + a day/time + fellowship scope (e.g. "Monday 7pm with Teacher X for CE fellowships"). Rows in `class_options`. |
| **Class slot** | A `class_option` activated for a specific `batch`. Tracks current enrolment count and Active/Closed/Cancelled status. Rows in `class_slots`. |
| **Registration status** | The lifecycle state of an `applicants` row: PENDING → ASSIGNED / WAITLISTED / DUPLICATE / REVIEW / INACTIVE / COMPLETED. |
| **Availability status** | The result of the class matching algorithm: CLASS_ASSIGNED, CLASS_FULL, NO_MATCHING_TIME, MANUAL_REVIEW_REQUIRED. |
| **REGIONAL class** | A class slot open to students from multiple fellowships across a subgroup, not restricted to a single campus. |
| **HOLY_SPIRIT milestone** | The Moodle course completion milestone. When a student finishes the Moodle course, `student_milestone_status` is upserted with `milestone_code = HOLY_SPIRIT, completed = true`. |
| **Phase 1** | The initial registration form submission — creates an `applicants` row. |
| **Phase 2** | The class assignment step — `phase2-processor` assigns the applicant to a class slot. |
| **trace_id** | A UUID generated per registration flow. Propagated into `scheduled_notifications`, `email_queue`, `moodle_enrollment_sync`, and `audit_logs` so operators can trace a single student's journey across all pipeline tables. |
| **LINKED / UNLINKED teacher** | A teacher whose `teacher_id` is linked to a Supabase auth user (LINKED) has working Teacher Portal access. UNLINKED teachers cannot log in until the admin runs `link_teacher_to_auth_user(email)`. |
| **email_queue** | The outbound email delivery queue. Rows move from `Pending` → `Sent` or `Failed` as `email-sender` processes them. |
| **scheduled_notifications** | Future-dated notification events. `notification-batch-processor` moves due rows into `email_queue`. |




