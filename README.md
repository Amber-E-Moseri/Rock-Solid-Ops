# Rock Solid Ops - Operations Platform

> **RockSolid OPS** - Internal staff operations platform for Foundation School.
> Manages student registration, teacher scheduling, attendance, cohort batches, notifications, Moodle enrollment, and milestone tracking.
> **Status: MVP Ready - Supabase-first backend, pilot launch ready (May 2026).**

---

> **Portfolio Summary:** Full production operations platform for a school. Replaced a legacy Google Sheets + Apps Script backend with Supabase Edge Functions, a multi-stage email pipeline with retry/trace infrastructure, Moodle LMS sync, and a staff portal managing the student lifecycle from registration to graduation.

---

## Architecture Overview

```
Public Registration Form
  -> registration-processor (canonical intake)
     -> ASSIGNED -> moodle-sync
     -> WAITLISTED -> waitlist queue + class selection
     -> DUPLICATE/REVIEW -> admin review

Notification pipeline:
  scheduled_notifications (PENDING)
    -> notification-batch-processor
    -> email_queue (Pending)
    -> email-sender (every 15 minutes)

Operations layer:
  retry-worker (every 20 min)
  missed-class-detector
  clickup-sync
  student-engagement-monitor
  report-generator

Portals:
  /foundation/staff/*   (admin/staff shell)
  /foundation/teacher/* (teacher shell)

Data:
  Supabase Postgres with RLS
```

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Tech Stack](#tech-stack)
3. [Repository Structure](#repository-structure)
4. [Core Features](#core-features)
5. [Edge Functions Reference](#edge-functions-reference)
6. [Cron Schedule](#cron-schedule)
7. [Status Enums](#status-enums)
8. [Deployment](#deployment)
9. [Environment Variables / Secrets](#environment-variables--secrets)
10. [Known Issues](#known-issues)
11. [Tech Debt Register (Summary)](#tech-debt-register-summary)
12. [Security Rules](#security-rules)
13. [Legacy Archive](#legacy-archive)
14. [Latest Updates (May 2026)](#latest-updates-may-2026)

---

## What This Is

Foundation School is an internal staff operations platform (not public SaaS). It is used by admins, regional secretaries, and teachers to run the student lifecycle:

- Intake registrations from the public form
- Assign students to batches and classes
- Manage teacher availability and attendance
- Sync assigned students to Moodle
- Send lifecycle emails
- Track milestones and engagement
- Surface failures, retries, and audit events

Backend migration from Google Apps Script + Sheets to Supabase Postgres + Edge Functions completed in May 2026.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Database | Supabase Postgres (public schema) |
| Auth | Supabase Auth (JWT sessions) |
| Backend logic | Supabase Edge Functions (Deno / TypeScript) |
| Frontend | Plain HTML / CSS / Vanilla JS |
| Email delivery | Resend API |
| LMS sync | Moodle REST Web Services API |
| Task escalation | Nexus API (internal project management) |
| Hosting | Vercel (static frontend) + Supabase (functions) |
| Design tokens | `tokens.css`, `primitives.css` |
| Font | Manrope |

---

## Repository Structure

```
/
|- foundation/
|  |- auth/
|  |- staff/
|  |- teacher/
|  |- js/
|  |- ui/
|  `- docs/
|- supabase/
|  |- functions/
|  |  |- _shared/
|  |  `- <function>/
|  `- migrations/
|- ai/
|- archive/
|  `- apps-script-legacy/
`- vercel.json
```

---

## Core Features

### 1. Registration Pipeline

Canonical intake path: `registration-processor` only.

- Validates and normalizes payload
- Writes applicants and workflow state
- Resolves fellowship/group/subgroup
- Produces status: `PENDING`, `ASSIGNED`, `WAITLISTED`, `DUPLICATE`, `REVIEW`
- Triggers downstream notifications
- Writes trace/audit entries

Rules:
- WAITLISTED students are never enrolled in Moodle
- DUPLICATE status is preserved and visible

### 2. Admin Portal

Located at `foundation/staff/`, using `admin-shell.js`.

Key pages include: `admin-dashboard.html`, `admin-review.html`, `applicant-directory.html`, `batch-management.html`, `class-editor.html`, `teacher-management.html`, `waitlist.html`, `notification-center.html`, `messages.html`, `failed-sync-retry-center.html`, `system-health.html`, `audit-log.html`, `reports.html`, `dashboards.html`.

Shell UX:
- Mobile hamburger + backdrop sidebar behavior
- Smooth page transitions with top progress bar during nav
- Teacher-mode switch for eligible admin roles (`regional_secretary`, `admin`, `superadmin`)

### 3. Teacher Portal

Located at `foundation/teacher/`, using `teacher-shell.js`.

- Teacher auth linkage required
- Availability submission
- Roster/class view
- Attendance submission via `teacher-attendance.html`
- Milestone updates
- In-app messaging section via `index.html?section=messages`

Teacher actions are routed through `teacher-portal-api`.

Shell UX:
- Mobile hamburger + backdrop sidebar behavior
- Smooth page transitions with top progress bar during nav

### 4. Batch and Class Management

- Batch lifecycle: `DRAFT`, `UPCOMING`, `ACTIVE`, `COMPLETED`, `ARCHIVED`
- Class options include day/time/fellowship mappings
- Supports multi-campus fellowship selection

### 5. Attendance and Session Outcomes

- Attendance data stored in canonical attendance tables
- Deduplication hardening in migrations
- Late-start handling supported
- Reminder/detector workers for missing attendance

### 6. Milestones

- Definitions are admin-managed
- Student milestone status tracked per student/milestone
- Includes `water_baptized`

### 7. Notifications and Email Pipeline

Pipeline:

- `scheduled_notifications` (PENDING)
- `notification-batch-processor`
- `email_queue`
- `email-sender`

### 8. Moodle Enrollment Sync

- Function: `moodle-sync`
- Queue: `moodle_enrollment_sync`
- Enroll ASSIGNED only
- Failure classification for WAF/permissions/REST disabled/unknown 403

### 9. Retry and Recovery Center

- UI: `failed-sync-retry-center.html`
- Worker: `retry-worker`
- Manual helper: `notification-retry-helper`

### 10. Nexus Escalation

- Function: `clickup-sync` (retained name; posts to Nexus, not ClickUp)
- Creates tasks in Nexus for missed classes and operational escalations
- Admin-to-Nexus-user mapping: `rocksolid_admin_mappings`
- Idempotency via `rocksolid_task_links`
- Mapping UI: `foundation/staff/rocksolid-management.html`

### 11. Waitlist Processor

- Function: `waitlist-processor`
- Supports class-selection token flow

### 12. Student Engagement Monitoring

- Function: `student-engagement-monitor`
- Surfaces at-risk signals

### 13. Reports and Data Exports

- Function: `report-generator`
- UI: `reports.html`, `data-exports.html`

### 14. System Health and Operational Trace

- UI: `system-health.html`
- JS: `system-health.js`, `operational-trace.js`
- Trace RPC: `public.get_operational_trace(...)`

### 15. Fellowship and Subgroup Management

- UI: `fellowship-management.html`
- Table: `fellowship_map`

### 16. Audit Logging

- Canonical table: `public.audit_logs`

### 17. Auth and RBAC

Roles in `profiles.role` include: `superadmin`, `admin`, `regional_secretary`, `pastor`, `subgroup_admin`, `principal`, `teacher`, `pending`.

Note: current access is primarily role-based; regional data scoping is not globally enforced in every flow by default.

### 18. In-App Messaging (Phase 1)

- Edge function: `messaging-api`
- Actions: `sendMessage`, `listMessages`, `listConversations`, `markRead`
- DB tables: `message_conversations`, `message_participants`, `message_messages`
- Migration: `202605240200_phase1_in_app_messaging.sql`
- Staff UI: `foundation/staff/messages.html`
- Teacher UI: `foundation/teacher/sections/teacher-messages.html` (routed from teacher portal section)
- Email notification: queues new-message alerts into `email_queue` using `template_key = direct_message`
- Jurisdiction scope model:
  - `teacher`: class-linked scope (derived from assigned class options)
  - `subgroup_admin`: subgroup scope
  - `pastor`: fellowship/group scope
  - `regional_secretary`: Canada-wide scope
  - `admin/superadmin`: full scope

---

## Edge Functions Reference

| Function | Schedule | Auth | Role |
|---|---|---|---|
| `registration-processor` | On-demand | JWT (verify_jwt=true) | Canonical registration intake |
| `admin-api` | On-demand | Bearer token | Admin API router |
| `teacher-portal-api` | On-demand | Bearer token | Teacher API router |
| `messaging-api` | On-demand | Bearer token | In-app messaging API router |
| `phase2-processor` | On-demand | Internal | Assignment processing (legacy/consolidation path) |
| `moodle-sync` | On-demand | Bearer token | Moodle enrollment |
| `moodle-grade-sync` | Cron | Cron auth + Bearer | Moodle grade pull |
| `retry-worker` | `*/20 * * * *` (config.toml) | Cron auth | Retry sweep |
| `notification-batch-processor` | On-demand | Cron auth | Scheduled notification batching |
| `email-sender` | `*/15 * * * *` | Cron auth | Resend delivery |
| `email-retry` | On-demand | Cron auth | Email retry helper |
| `notification-retry-helper` | On-demand | Bearer token | Single-notification reset |
| `notification-dispatcher` | On-demand | Internal | Notification routing |
| `missed-class-detector` | `15 2 * * *` | Cron auth | Nightly attendance gap detection |
| `attendance-reminder` | Cron | Cron auth | Attendance reminders |
| `review-checkin` | Cron | Cron auth | REVIEW follow-up |
| `student-engagement-monitor` | Cron | Cron auth | Engagement monitoring |
| `clickup-sync` | On-demand | Bearer token | Nexus escalation (retained function name) |
| `nexus-users-search` | On-demand | Bearer token | Nexus user lookup for admin mapping UI |
| `waitlist-processor` | On-demand | Internal | Waitlist evaluation |
| `class-selection` | On-demand | Token | Class selection token handler |
| `report-generator` | Cron | Cron auth | Report generation |
| `reminder-processor` | Do not schedule | — | Legacy stub |

**Auth Note (Sept 2026):** Cron-scheduled functions now validate `x-cron-secret` header via `validateCronAuth()` in `_shared/auth.ts`. Functions use `verify_jwt = false` in config and handle token validation internally, allowing support for both cron invocation and manual staff bearer-token calls.

---

## Cron Schedule

| Time | Function | Status (Sept 2026) |
|---|---|---|
| Every 15 min | `email-sender` | Declared in function config; verify active in Supabase |
| Every 20 min | `retry-worker` | Declared in function config; verify active in Supabase |
| Daily 02:15 UTC | `missed-class-detector` | Declared in function config |
| Per function config | `attendance-reminder`, `review-checkin`, `student-engagement-monitor`, `report-generator`, `moodle-grade-sync` | See individual function config.toml files |
| **Unscheduled** | `email-retry`, `scheduled-notification-sender` | Both are single-item retry helpers; retry responsibility moved to `retry-worker` (manually callable via Retry Center) |

**Never schedule:** `notification-retry-helper`, `reminder-processor`.

**Note:** As of Sept 21, 2026, `retry-worker` and `notification-batch-processor` have cron declarations in `config.toml` but their actual production scheduling should be verified in the Supabase dashboard — scheduled invocation may be a separate decision from code deployment.

---

## Status Enums

```
Registration: PENDING | ASSIGNED | WAITLISTED | DUPLICATE | REVIEW | INACTIVE | COMPLETED
Batch: DRAFT | UPCOMING | ACTIVE | COMPLETED | ARCHIVED
Teacher availability: PENDING | APPROVED | REJECTED | RESET
```

---

## Deployment

### Pre-deploy

1. Create `foundation/js/config.js` from `config.js.example`
2. Set frontend config values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
3. Set required Supabase secrets
4. Run `supabase db push`
5. Run `supabase functions deploy`
6. Confirm `ALLOWED_ORIGINS`

Messaging Phase 1 deploy commands:

1. `supabase db push --include-all`
2. `supabase functions deploy messaging-api`

### Post-deploy checks

- Login works
- Registration fellowships load
- Admin portal loads
- Teacher portal loads
- Email is delivered
- Moodle health check is green

### Rollback

1. Revert frontend deploy
2. Redeploy prior function versions
3. Apply forward-fix migration if needed
4. Re-run smoke tests

---

## Environment Variables / Secrets

| Secret | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` | Yes | Frontend auth/db access |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Function privileged operations |
| `ALLOWED_ORIGINS` | Yes | CORS allowlist |
| `RESEND_API_KEY` | Yes | Email delivery |
| `MOODLE_URL` | Yes | Moodle endpoint |
| `MOODLE_TOKEN` | Yes | Moodle token |
| `NEXUS_API_URL` | Yes | Nexus task API base URL |
| `NEXUS_API_KEY` | Yes | Shared secret with Nexus (also set in Nexus project) |
| `PHASE2_WEBHOOK_SECRET` | Yes | Phase2 auth |
| `ATTENDANCE_ADMIN_EMAIL` | Yes | Attendance ops email |
| `TEACHER_PORTAL_URL` | Yes | Teacher portal link |

Never commit real credentials.

---

## Known Issues

| Issue | Location | Status |
|---|---|---|
| CSS token migration incomplete | Staff pages (`foundation/staff/*.html`) | In Progress (14 pages) |
| Moodle HTTP 403 / WAF blocks enrollment sync | `moodle-sync` | External dependency |
| Mobile table overflow on operational pages | `admin-management.html`, others | Partial (UX pass in progress) |
| CLASS_OPTIONS creation failure on approval flow | `phase2-processor`, admin-review | Open |
| Large tables overflow on mobile | Multiple staff pages | Open |

---

## Tech Debt Register (Summary)

| Area | Risk | Status (Sept 2026) |
|---|---|---|
| CSS token standardization | Medium | In Progress (14 HTML pages + ongoing) |
| Assignment logic split across `registration-processor` and `phase2-processor` | High | Pending Q4 2026 consolidation |
| Edge function auth verification | Medium | Completed (cron auth added Sept 2026) |
| Schema fallback loops in some functions | Medium | Ongoing review |
| Per-page style duplication | Medium | Reduced via shared tokens.css |
| Legacy audit fallback paths | Low | Audit_logs canonicalization applied |

---

## Security Rules

Before PR:

- No real credentials in git
- RLS enabled on new tables
- Server-side auth checks on privileged functions
- No client-only authorization assumptions
- Additive/idempotent migrations

Never:

- Add a second registration pipeline
- Enroll WAITLISTED students in Moodle
- Remove RLS from protected tables
- Expose service role operations publicly

---

## Legacy Archive

`archive/apps-script-legacy/` is read-only historical reference and not part of runtime.

---

## Latest Updates (September 2026)

**Security & Auth:**
- Edge function auth hardening: internal cron authentication via `validateCronAuth()` in `_shared/auth.ts`. Functions like `moodle-grade-sync`, `retry-worker`, `attendance-reminder` now validate cron tokens and bearer tokens independently rather than relying on `verify_jwt` in config.
- `verify_jwt` now set to `false` on cron-scheduled functions (auth handled internally). `registration-processor` retains `verify_jwt = true` for public intake.
- Internal auth test suite added (`internal-auth.test.ts`) covering cron and staff-role validation paths.

**Configuration & Functions:**
- `config.toml` updated: `retry-worker` changed to `verify_jwt = false`; new function entries for `attendance-reminder`, `attention-flag-push-sweep`, `notification-batch-processor`.
- Cron job scheduling audit complete (Sept 21): `email-retry` and `scheduled-notification-sender` unscheduled (both are single-item retry helpers, not batch workers).

**UI/CSS Standardization:**
- Staff pages undergoing CSS token migration: `var(--surface)` → `var(--color-surface)`, `var(--muted)` → `var(--color-text-muted)`, etc.
- Pages affected: applicant-directory, attendance, availability-approval, batch-management, class-editor, dashboards, email-campaigns, failed-sync-retry-center, teacher-management, waitlist.
- Goal: full alignment with `tokens.css` + `primitives.css` canonical token set by Q4 2026.

**Mobile UX:**
- Responsive layout improvements: CSS utilities in `components.css` and `layout.css` expanded for better mobile density on operational pages.
- Dashboard mobile card view, table fallback views, and breakpoint improvements.

**API & Waitlist:**
- Waitlist processor enhanced (77 lines of additions) to support expanded class-selection and auto-assign scenarios.
- Report generator and moodle-grade-sync refactored for robustness.

## Latest Updates (July 2026)

- ClickUp integration replaced with internal Nexus project management system. `clickup-sync` function retained its name but now posts to Nexus (`NEXUS_API_URL`/`NEXUS_API_KEY`); tables renamed to `rocksolid_admin_mappings` and `rocksolid_task_links`.
- New `nexus-users-search` function backs a searchable user picker in the admin mapping UI (`rocksolid-management.html`, not yet committed — uses legacy `fs-*` CSS classes and needs a rebuild against current design tokens before merge).

## Latest Updates (May 2026)

- Shell navigation now uses smooth transition states (fade + subtle lift) for both admin and teacher portals.
- Top loading progress bar added during cross-page navigation in both shells.
- Mobile shell behavior standardized: slide-in sidebar + backdrop + body lock class (`fs-sidebar-open`).
- Shared responsive utility rules in `foundation/ui/primitives.css` expanded for tables, drawers, modals, and KPI grids.
- Help guide hardened for public access (works without auth config) with optional role filtering when session/config is available.
- `scheduled_notifications` dedupe writes moved away from `ON CONFLICT (dedupe_key)` pattern to explicit dedupe lookup + insert where needed.

---

Generated May 2026. Keep updated as platform evolves.
