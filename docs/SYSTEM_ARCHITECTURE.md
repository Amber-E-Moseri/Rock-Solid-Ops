# Rock Solid Ops — System Architecture

> **Purpose:** Visual and textual overview of Rock Solid Ops architecture, data flows, and component relationships.  
> **Audience:** Engineers, architects, on-call ops.  
> **Last Updated:** 2026-09-22

---

## High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ROCK SOLID OPS SYSTEM                           │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND LAYER                                 │
├──────────────────────────────────────────────────────────────────────────┤
│  React (Vite)              │  Vanilla HTML/CSS/JS                        │
│  foundation-spa/           │  foundation/                                │
│  - Dashboard               │  - Staff portals (admin, batch mgmt)        │
│  - Teacher portal          │  - Applicant directory                      │
│  - Mobile-optimized UX     │  - Attendance, class editor                 │
│                            │  - Retry center, audit logs                 │
│                            │                                              │
│  Deployed: Netlify (https://rocksolidsuite.netlify.app)                 │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                            HTTP API (JSON)
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      SUPABASE EDGE FUNCTIONS                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Intake Pipeline:          Notification Pipeline:                        │
│  ├─ registration-processor │ ├─ notification-batch-processor             │
│  └─ [validates, assigns]   │ ├─ email-sender (Resend API)               │
│                            │ └─ [queues, retries, logs]                  │
│                            │                                              │
│  Sync & Ops:               Retry & Recovery:                             │
│  ├─ moodle-sync            │ ├─ retry-worker (hourly cron)              │
│  ├─ [LMS enrollment]       │ └─ [retries, escalates]                     │
│                            │                                              │
│  Scheduled Jobs:           Utility:                                      │
│  ├─ missed-class-detector  │ ├─ system-health-check                      │
│  ├─ student-engagement     │ └─ [monitoring, metrics]                    │
│  └─ report-generator       │                                              │
│                                                                           │
│  Deployed: Supabase Functions (Deno / TypeScript)                       │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                           Postgres Protocol
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   SUPABASE POSTGRES DATABASE                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Core Tables:                      Operational Tables:                   │
│  ├─ applicants (registrations)     ├─ email_queue                        │
│  ├─ classes (course sections)      ├─ moodle_enrollments                │
│  ├─ batches (cohorts)              ├─ attendance_records                 │
│  ├─ profiles (staff accounts)      ├─ audit_logs                         │
│  ├─ teacher_availability           └─ scheduled_notifications            │
│  └─ milestones                                                            │
│                                                                           │
│  Auth:                             RLS:                                   │
│  ├─ Supabase Auth (users table)   │ Every table has row-level            │
│  └─ JWT sessions                  │ security policies per role           │
│                                                                           │
│  Project: xelpsttqhrcqmttmjory (production)                             │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ Moodle LMS  │ │ Resend API  │ │ Nexus API   │
            │ (REST)      │ │ (Email)     │ │ (Project    │
            │             │ │             │ │  Escalation)│
            └─────────────┘ └─────────────┘ └─────────────┘
```

---

## Core Data Flow: Registration → Assignment → Moodle

```
1. INTAKE (Public Registration Form)
   User submits: { email, phone, name, batch_id, class_id }
   ↓
   registration-processor (Edge Function)
   ├─ Validate input (email format, phone, required fields)
   ├─ Check for duplicates (same email + phone + DOB)
   ├─ Assign to batch/class (if space available)
   ├─ Write to applicants table
   └─ Emit audit event: { action: 'registration_intake', applicant_id, status }
   ↓
   Applicant status → ASSIGNED | WAITLISTED | DUPLICATE | REVIEW

2. ASSIGNMENT (Admin Review)
   Admins review DUPLICATE / REVIEW / WAITLISTED applicants
   ├─ Approve duplicates (resolve conflict, pick canonical record)
   ├─ Manually assign WAITLISTED to available class
   └─ Update applicants.registration_status → ASSIGNED
   ↓
   Trigger: applicants.registration_status = ASSIGNED
   Audit event: { action: 'registration_approved', applicant_id }

3. MOODLE SYNC (Enrollment)
   moodle-sync Edge Function (triggered by update OR polled)
   ├─ Find all ASSIGNED applicants without moodle_enrollments record
   ├─ Query Moodle Course ID from classes.moodle_course_id
   ├─ Call Moodle API: POST /webservice/rest/server.php
   │  └─ Enroll user in course (create account if needed)
   ├─ On success: write moodle_enrollments { applicant_id, course_id, enrolled_at }
   └─ On failure:
      ├─ Retryable (timeout, 5xx): status = 'pending_retry', retry_count++
      ├─ Non-retryable (403, 401, missing mapping): status = 'failed', alert admin
      └─ Audit event: { action: 'moodle_sync_failed|success', applicant_id, error }
   ↓
   Applicant: Now enrolled in Moodle LMS

4. NOTIFICATION (Lifecycle Email)
   notification-batch-processor (every 15 min)
   ├─ Query scheduled_notifications { status: 'pending' }
   ├─ For each: build email body, queue to email_queue
   └─ Email types:
      ├─ foundation_welcome (on ASSIGNED)
      ├─ duplicate_registration (on DUPLICATE)
      ├─ waitlist_confirmation (on WAITLISTED)
      ├─ no_suitable_times (on review failure)
      └─ registration_under_review
   ↓
   email-sender (every 15 min or on-demand)
   ├─ Pick up to 50 pending emails from queue
   ├─ Call Resend API: POST /emails
   ├─ Log each send (success / fail / rate-limit)
   └─ Retry if: Resend timeout or 5xx → status = 'pending_retry'
   ↓
   Applicant: Receives lifecycle email

5. RETRY & RECOVERY (Hourly Sweep + Manual Intervention)
   retry-worker (cron: top of every hour)
   ├─ Scan moodle_enrollments { status: 'pending_retry', retry_count < 5 }
   ├─ Scan email_queue { status: 'pending_retry', retry_count < 5 }
   ├─ Retry each one
   ├─ On failure > 5 retries: escalate to Retry Center (manual admin review)
   └─ Audit: { action: 'retry_worker_executed', count_retried, count_exhausted }

   Manual Retry Center (Admin Portal)
   ├─ View all failed/exhausted records
   ├─ Choose: Retry | Resolve | Mark Failed
   └─ Audit: { action: 'manual_retry_triggered', actor_id, record_id }
```

---

## Role-Based Access Control (RLS)

Every table uses Postgres Row-Level Security. Access rules:

| Role | applicants | classes | batches | profiles | email_queue | audit_logs |
|---|---|---|---|---|---|---|
| **superadmin** | All | All | All | All | All | All |
| **admin** | Assigned jurisdiction | Assigned jurisdiction | Assigned jurisdiction | Own profile + team | All | All |
| **teacher** | Own cohort only | Own classes | Assigned batches | Own profile | None | Own actions |
| **regional_secretary** | Assigned region | Assigned region | Assigned region | Own profile | None | Read-only |
| **public** | None (form submission only) | None | None | None | None | None |

---

## Edge Function Contracts

### registration-processor

**Endpoint:** `POST /functions/v1/registration-processor`  
**Auth:** Public (anonymous)  
**Input:**
```json
{
  "email": "user@example.com",
  "phone": "+1234567890",
  "full_name": "Jane Doe",
  "date_of_birth": "2000-01-15",
  "fellowship_id": "uuid",
  "batch_id": "uuid",
  "preferred_class_ids": ["uuid1", "uuid2"]
}
```
**Output:**
```json
{
  "applicant_id": "uuid",
  "registration_status": "ASSIGNED | WAITLISTED | DUPLICATE | REVIEW",
  "class_id": "uuid | null",
  "message": "..."
}
```

### moodle-sync

**Endpoint:** `POST /functions/v1/moodle-sync`  
**Auth:** Service role (internal)  
**Trigger:** Manual or scheduled  
**Process:**
- Query unsynced ASSIGNED applicants.
- Enroll in Moodle via REST API.
- Log failures to moodle_enrollments + audit_logs.

### email-sender

**Endpoint:** `POST /functions/v1/email-sender`  
**Auth:** Service role (internal)  
**Trigger:** Every 15 minutes  
**Process:**
- Fetch up to 50 pending emails from queue.
- Send via Resend API.
- Log success / fail.

---

## Database Schema Overview

### Key Tables

**applicants**
- `id` (PK, UUID)
- `email`, `phone`, `full_name`, `date_of_birth`
- `registration_status` (PENDING, ASSIGNED, WAITLISTED, DUPLICATE, REVIEW, INACTIVE, COMPLETED)
- `batch_id`, `class_id` (FK)
- `fellowship_id`, `group_id` (organizational hierarchy)
- `created_at`, `updated_at`

**classes**
- `id` (PK, UUID)
- `batch_id` (FK)
- `class_name`, `description`
- `day`, `start_time`, `end_time`
- `capacity`, `moodle_course_id` (external mapping)
- `created_at`, `updated_at`

**batches**
- `id` (PK, UUID)
- `batch_name`, `status` (DRAFT, ACTIVE, UPCOMING, COMPLETED, ARCHIVED)
- `start_date`, `end_date`
- `created_at`, `updated_at`

**email_queue**
- `id` (PK, UUID)
- `applicant_id` (FK)
- `email_type` (foundation_welcome, duplicate_registration, etc.)
- `recipient`, `subject`, `body_html`
- `status` (pending, sent, pending_retry, failed)
- `retry_count`, `last_error`
- `created_at`, `updated_at`

**moodle_enrollments**
- `id` (PK, UUID)
- `applicant_id` (FK)
- `moodle_course_id`
- `moodle_user_id` (external ID)
- `status` (pending, enrolled, pending_retry, failed)
- `retry_count`, `last_error`
- `enrolled_at`, `created_at`, `updated_at`

**audit_logs**
- `id` (PK, UUID)
- `action` (registration_intake, email_sent, moodle_sync_failed, etc.)
- `actor_id` (FK to profiles; null for system)
- `target_id` (applicant_id or related entity)
- `metadata` (JSON; error details, old/new values)
- `created_at`

---

## Deployment & Infrastructure

**Frontend:**
- Framework: React (Vite) + Vanilla HTML/CSS/JS
- Host: Netlify
- CI/CD: GitHub Actions → Netlify deploy on push to main
- URL: https://rocksolidsuite.netlify.app

**Backend:**
- Database: Supabase Postgres (project: xelpsttqhrcqmttmjory)
- Edge Functions: Supabase Functions (Deno / TypeScript)
- Auth: Supabase Auth
- CI/CD: `supabase functions deploy` (manual or via GitHub Actions)

**Secrets Management:**
- Stored in Supabase project settings (not in repo).
- Required secrets:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `MOODLE_API_URL`, `MOODLE_API_TOKEN`
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (web push)
  - `NEXUS_API_KEY` (internal project management)

---

## Security Model

### Authentication
- Supabase Auth handles user login/signup.
- JWT tokens in session storage.
- Tokens verified in edge functions + frontend auth guards.

### Authorization
- Supabase RLS enforces row-level access on all tables.
- Edge functions verify caller role server-side before privileged actions.
- No client-side role checks are the sole enforcement point.

### Audit & Compliance
- All significant actions logged to `audit_logs` with actor, action, target, timestamp, and metadata.
- Audit logs retained indefinitely.
- No data deletion without admin + operator approval.

---

## Performance & Scalability

**Current Limits (Supabase Free / Pro):**
- Database: Shared or dedicated (prod uses dedicated).
- Edge Functions: 50ms–5s cold start; warm requests < 100ms.
- Email throughput: Resend ~100 requests/sec limit.
- Concurrent connections: Postgres max 100–200 depending on plan.

**Scaling Strategy:**
- Caching: React SPA caches UI state; avoid re-rendering on every page load.
- Database indexing: Add partial indexes on frequently filtered columns (e.g., `applicants.registration_status`, `email_queue.status`).
- Async processing: Moodle sync + email sending are queued, not synchronous.
- Rate limiting: Implement on registration form + API endpoints (future).

---

## Future Phases

1. **Phase B (Responsive UI):** Complete mobile UX across staff/teacher portals.
2. **Phase C (Advanced Features):** Attendance tracking, milestone management, student engagement scoring.
3. **Phase D (Analytics):** Real-time dashboards, cohort performance, success metrics.

---

## Contact & References

- **Architecture Owner:** Amber Moseri
- **Reference Docs:** See `docs/` directory (ARCHITECTURE.md, migration-log.md, PRODUCTION_READINESS_2026-09-19.md)
- **Code:** `foundation/` (frontend), `supabase/functions/` (backend), `supabase/migrations/` (schema)
