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
2. [Quick Start](#quick-start)
3. [Tech Stack](#tech-stack)
4. [Repository Structure](#repository-structure)
5. [Core Features](#core-features)
6. [Edge Functions Reference](#edge-functions-reference)
7. [Cron Schedule](#cron-schedule)
8. [Status Enums](#status-enums)
9. [Deployment](#deployment)
10. [Environment Variables / Secrets](#environment-variables--secrets)
11. [Testing](#testing)
12. [Known Issues](#known-issues)
13. [Security Rules](#security-rules)
14. [Documentation](#documentation)
15. [Legacy Archive](#legacy-archive)
16. [Latest Updates](#latest-updates)

---

## Quick Start

**For developers:**
1. Install Supabase CLI: `npm install -g supabase`
2. Clone repo & install dependencies: `npm install`
3. Start Supabase locally: `supabase start`
4. Apply migrations: `supabase db push`
5. Deploy functions: `supabase functions deploy`
6. Run frontend: `cd foundation-spa && npm run dev` (React) or open `foundation/staff/dashboards.html` (Vanilla)

**For ops:**
- Check health: `docs/OPERATIONAL_HEALTH.md`
- System overview: `docs/SYSTEM_ARCHITECTURE.md`
- Production status: `docs/PRODUCTION_READINESS_2026-09-19.md`
- Troubleshooting: `docs/migration-log.md` (decision history)

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
| **Database** | Supabase Postgres (public schema) |
| **Auth** | Supabase Auth (JWT sessions, RLS-enforced) |
| **Backend Logic** | Supabase Edge Functions (Deno / TypeScript) |
| **Frontend - Staff Portals** | Vanilla HTML / CSS / JavaScript (admin/staff pages under `foundation/staff/`) |
| **Frontend - Teacher & Dashboard** | React (Vite) + TypeScript (SPA under `foundation-spa/`) |
| **Email Delivery** | Resend API |
| **LMS Sync** | Moodle REST Web Services API |
| **Task Escalation** | Nexus API (internal project management) |
| **Web Push Notifications** | Web Push API (VAPID keys, service workers) |
| **Hosting** | Netlify (frontend) + Supabase (Postgres + Edge Functions + Auth) |
| **Design System** | CSS tokens (`tokens.css`, `primitives.css`), Manrope font |
| **Package Manager** | npm (monorepo with `foundation/` and `foundation-spa/`) |

---

## Repository Structure

```
/
|- foundation/                              # Vanilla HTML/CSS/JS staff portals
|  |- auth/                                 # Auth flows, login, session handling
|  |- staff/                                # Admin/staff pages (batch management, dashboards, etc.)
|  |- teacher/                              # (Legacy) teacher portal auth
|  |- js/                                   # Shared JavaScript modules (api-client, admin-shell, auth-guards, etc.)
|  |- ui/                                   # Shared CSS (tokens.css, components.css, layout.css, primitives.css)
|  |- docs/                                 # (Local) architecture, known bugs, next steps
|
|- foundation-spa/                          # React (Vite) SPA for teacher portal & dashboard
|  |- src/
|  |  |- pages/                             # Page components (Dashboard, TeacherPortal, etc.)
|  |  |- components/                        # Reusable React components
|  |  |- hooks/                             # Custom React hooks
|  |  |- services/                          # API client, auth service, data fetching
|  |  |- styles/                            # CSS modules (inherits design tokens from foundation/ui/)
|  |  `- main.tsx
|  |- public/                               # Static assets
|  |- package.json
|  |- vite.config.ts
|  `- tsconfig.json
|
|- supabase/                                # Backend (Edge Functions + Database)
|  |- functions/                            # Supabase Edge Functions (Deno / TypeScript)
|  |  |- _shared/                           # Shared utilities (auth hardening, error classification)
|  |  |- registration-processor/            # Canonical registration intake
|  |  |- moodle-sync/                       # Moodle enrollment sync
|  |  |- email-sender/                      # Resend email delivery
|  |  |- retry-worker/                      # Hourly retry sweep
|  |  |- [other-functions]/
|  |  `- config.toml                        # Cron schedules, env vars
|  `- migrations/                           # Postgres schema migrations (YYYYMMDDHHMMSS_*.sql)
|
|- docs/                                    # Canonical documentation
|  |- archive/                              # Historical audits and certifications (read-only)
|  |- PRODUCTION_READINESS_2026-09-19.md   # Current production certification
|  |- STAGING_CERTIFICATION_2026-09-19.md  # Current staging certification
|  |- OPERATIONAL_HEALTH.md                 # Health metrics, thresholds, runbooks
|  |- SYSTEM_ARCHITECTURE.md                # System diagram, data flows, RLS model
|  |- migration-log.md                      # Migration decision log
|  |- BRANCH_HOLDS.md                       # Feature/fix holds (unmerged briefs)
|
|- ai/                                      # AI workflow docs (constraints, statuses, refactor roadmap)
|- archive/                                 # Historical legacy backend (read-only)
|  `- apps-script-legacy/
|
|- scripts/                                 # Utility scripts (testing, setup, etc.)
|- .github/                                 # GitHub Actions CI/CD (TBD: PR checks, deployment)
|- .env.example                             # Environment variables template
|- .env.local                               # Local environment overrides (gitignored)
|- vercel.json                              # Netlify/Vercel frontend routing config
|- netlify.toml                             # Netlify deployment config
|- package.json                             # Root npm dependencies
`- CLAUDE.md                                # AI / project instructions (local reference)
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

### Prerequisites

- Supabase project (production: `xelpsttqhrcqmttmjory`)
- Netlify site (production: `https://rocksolidsuite.netlify.app`)
- Supabase CLI installed & authenticated
- All required secrets configured in Supabase project (see below)

### Deploy Workflow

**Step 1: Database Migrations**
```bash
supabase db push                    # Apply all pending migrations to linked project
supabase db push --dry-run --linked # Preview without applying (if linked to production)
```

**Step 2: Edge Functions**
```bash
supabase functions deploy           # Deploy all functions to linked project
supabase functions deploy <name>    # Deploy specific function
supabase functions list             # Verify deployment
```

**Step 3: Frontend (Vanilla + React SPA)**
```bash
# Build both frontends
npm run build                       # Builds both foundation/ and foundation-spa/

# Deploy to Netlify (auto-triggered on main push)
# OR manual deploy via Netlify CLI:
netlify deploy --prod               # Deploy to production
```

### Post-Deployment Checks

After deploying, verify:
- [ ] Supabase functions deployed successfully: `supabase functions list`
- [ ] Database migrations applied: `supabase db pull` matches repo HEAD
- [ ] Frontend loads: `https://rocksolidsuite.netlify.app/foundation/staff/dashboards.html`
- [ ] Login works: Test staff + teacher credentials
- [ ] Registration form accessible: `/foundation/auth/register.html`
- [ ] Email sending works: Check Resend dashboard or test notification
- [ ] Moodle sync health: `docs/OPERATIONAL_HEALTH.md` → Moodle Sync section
- [ ] Cron jobs firing: Check edge function logs for `retry-worker`, `email-sender`

### Rollback Procedure

If deployment causes issues:

1. **Frontend:** Revert to prior Netlify deployment (Netlify dashboard → Deploys → Rollback)
2. **Functions:** Redeploy prior function versions: `supabase functions deploy`
3. **Database:** Migrations are forward-only; use forward-fix migrations if needed
4. **Smoke tests:** Re-run checks above

### Staging Deployment

Staging uses the same repository but a separate Supabase project. Deploy staging to test migrations + functions before production:

```bash
supabase link --project-ref <staging-project-id>
supabase db push
supabase functions deploy
```

See `docs/STAGING_CERTIFICATION_*.md` for staging status.

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

## Testing

### Unit & Integration Tests

Run automated tests:
```bash
npm run test                    # Run all tests
npm run test -- --watch        # Watch mode
npm run test -- --coverage     # Coverage report
```

### Edge Function Testing

Test Supabase Edge Functions locally:
```bash
supabase functions serve        # Start edge function server
curl -X POST http://localhost:54321/functions/v1/<function-name> \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}'
```

### Manual Verification Checklist

After deployment, verify:
- [ ] Login works (staff + teacher + public)
- [ ] Registration form submits and creates applicant
- [ ] Admin can view and approve registrations
- [ ] Assigned applicants enroll in Moodle
- [ ] Email notifications send (check Resend logs)
- [ ] Retry center shows failed records
- [ ] Cron jobs fire on schedule (check edge function logs)

### Database Schema Testing

Test migrations on a clean database:
```bash
supabase start                  # Fresh local Postgres
supabase db push                # Apply all migrations
supabase db pull                # Verify schema matches repo
psql "postgresql://..." -c "SELECT COUNT(*) FROM applicants;"
```

See `supabase/migrations/README.md` for migration best practices and idempotency rules.

---

## Documentation

| Document | Purpose | Audience |
|---|---|---|
| **[docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md)** | System diagram, data flows, RLS model, function contracts | Engineers, architects |
| **[docs/OPERATIONAL_HEALTH.md](docs/OPERATIONAL_HEALTH.md)** | Health metrics, thresholds, runbooks, escalation paths | On-call ops, platform team |
| **[docs/PRODUCTION_READINESS_2026-09-19.md](docs/PRODUCTION_READINESS_2026-09-19.md)** | Current production certification status | Stakeholders, release leads |
| **[docs/STAGING_CERTIFICATION_2026-09-19.md](docs/STAGING_CERTIFICATION_2026-09-19.md)** | Staging environment status | QA, staging team |
| **[supabase/migrations/README.md](supabase/migrations/README.md)** | Migration conventions, idempotency, testing | Engineers working on schema |
| **[docs/migration-log.md](docs/migration-log.md)** | Decision log, phase transitions, known bugs | Long-term reference, architects |
| **[CLAUDE.md](CLAUDE.md)** | AI workflow, constraints, architecture rules | AI assistants, developers |
| **[ai/statuses.md](ai/statuses.md)** | Canonical status enums (registration, batch, teacher) | Developers |
| **[ai/constraints.md](ai/constraints.md)** | Hard engineering constraints (never violate) | All engineers |

### Historical Reference

Old audit and certification documents are archived in `docs/archive/` for reference. Current source of truth is `docs/PRODUCTION_READINESS_*.md`.

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

### September 22, 2026 - Repo Polish & Documentation

- **Repo cleanup:** Archived 11 superseded audit/certification docs to `docs/archive/`; deleted backup SQL files, ZIPs, and logs.
- **New documentation:**
  - `docs/OPERATIONAL_HEALTH.md`: Health checkpoints, metrics, runbooks, on-call escalation paths
  - `docs/SYSTEM_ARCHITECTURE.md`: System diagram, data flows (registration → Moodle → notifications), RLS model, function contracts
  - `supabase/migrations/README.md`: Migration conventions, idempotency patterns, testing, production deployment
- **README updates:** Clarified tech stack (Vanilla HTML/JS + React SPA), improved repository structure documentation, added Quick Start, Testing, and Documentation sections.
- **GitHub CI (pending):** Planning PR checks for migrations, secret scanning, type checking, RLS tests.

**Production Status:** All core security gates closed. Database fully current with repo HEAD (157 migrations). Production certified Sept 20, 2026.

### September 2026 - Security & Auth

- Edge function auth hardening: cron authentication via `validateCronAuth()` in `_shared/auth.ts`
- `verify_jwt` set to `false` on cron-scheduled functions; auth handled internally
- Internal auth test suite covers cron and staff-role validation paths

### July 2026 - Integration Consolidation

- ClickUp replaced with Nexus API for task escalation
- `clickup-sync` function renamed logically; posts to `NEXUS_API_URL`
- Tables: `rocksolid_admin_mappings`, `rocksolid_task_links`

### May 2026 - UX & Mobile Improvements

- Shell navigation: smooth transitions + progress bar during cross-page nav
- Mobile behavior standardized: slide-in sidebar + backdrop
- Responsive utilities expanded for tables, drawers, modals
- CSS tokens moved to shared `tokens.css` / `primitives.css`

---

**Platform Status:** Production-ready, fully audited and certified. See `docs/PRODUCTION_READINESS_2026-09-19.md` for current certification.

For questions or issues, see [docs/migration-log.md](docs/migration-log.md) for decision history and [CLAUDE.md](CLAUDE.md) for engineering constraints.
