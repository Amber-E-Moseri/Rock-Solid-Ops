# Engineering Review Findings

## Platform Summary

Foundation School is an internal staff operations platform (admin + teacher portals) backed by
Supabase Edge Functions and Postgres. Not a public SaaS product. Operates in stabilization and
hardening mode targeting pilot launch.

---

## Session 1 Findings (initial review)

### Structural Concerns

- Shell architecture partially adopted — some pages still embed per-page nav markup
- CSS design system not yet centralized — var(--muted), var(--surface) used inconsistently
- Several pages inline large style blocks that duplicate shared primitives
- JS modules exist but are not consistently imported across all pages

### Backend Concerns

- teacher-portal-api.ts handles 20+ operations in a single 1,000+ line file
- registration-processor and phase2-processor share core assignment loop (duplication)
- retry-worker and moodle-sync have implicit coupling via error code strings
- sender-worker and notification-retry-helper may overlap in responsibility
- Email pipeline has 4 async hops with no trace_id for operational debugging
- Schema instability: try-multiple-table-names pattern used in several functions

### Security Concerns

- RLS not confirmed on all tables
- CORS wildcard used in several edge functions
- config.js.example lacked clear setup instructions
- Attendance records had no deduplication guard

### Operational Visibility Gaps

- No per-applicant trace view
- failure_reason not surfaced for Moodle sync failures
- System Health did not test Moodle API connectivity directly

---

### Session 2 Updates — May 2026

Completed:
- Security: RLS hardening migrations 1-4 applied, all listed
  tables covered, anon access blocked
- Security: CORS wildcard removed from 6 edge functions +
  shared-utils, ALLOWED_ORIGINS pattern applied consistently
- Security: config.js confirmed never committed, pre-commit
  hook added, config.js.example updated with setup instructions
- Attendance: UNIQUE constraint migration added, all attendance
  writes use upsert with onConflict, removed from KNOWNBUGS
- Design system: tokens.css and primitives.css created,
  all fs-* primitives defined, admin-shell.js updated to use
  fs-* classes, existing CSS files import tokens.css
- Shell mounting: null-safe guard added to FSAdminShell.mount(),
  all 3 staff pages (batch-management, applicant-directory,
  admin-review) show "Not connected" instead of crashing
- Teacher mapping: link_teacher_to_auth_user() migration added,
  admin link-account UI added to teacher-management
- Moodle 403: classified into 4 causes, non-retryable where
  appropriate, failure_reason surfaced in Retry Center

Newly identified (from external engineering review):
- teacher-portal-api.ts is 1,071 lines handling 20+ operations —
  needs action router refactor
- registration-processor + phase2-processor duplicate the
  assignment pipeline — needs shared extraction
- auth-client.js + auth-guards.js overlap — needs consolidation
- sender-worker + notification-retry-helper may overlap —
  needs audit before merge decision
- React teacher-availability sub-app is a separate tech stack
  with no justification — target for vanilla JS rewrite
- Email pipeline has 4 async hops with no trace_id —
  operational visibility gap
- Schema instability: try-multiple-table-names patterns exist
  in several functions — needs cleanup after migration is complete
- config.js guard repeated 15+ times across pages —
  needs centralization in runtime.js
- fs-* CSS migration needs a deadline and CI enforcement

---

### Session 3 Clarification — Notification Pipeline Topology (May 2026)

The initial review identified "sender-worker + notification-retry-helper may overlap"
and flagged "email pipeline has 4 async hops with no trace_id". Both are confirmed. The
actual topology is more nuanced than the function names suggest:

Actual canonical pipeline:
  scheduled_notifications → notification-batch-processor → email_queue → email-sender → Resend

Function role corrections (the naming is actively misleading):
- notification-batch-processor      — the REAL batch processor; reads scheduled_notifications,
                            inserts email_queue rows, marks SENT, writes audit_logs
- notification-retry-helper — NOT the batch sender; single-item retry helper only;
                            resets one notification to PENDING on operator request
- email-sender            — confirmed canonical Resend delivery worker; cron daily
- sender-worker           — deprecated reconciliation worker; checks email_queue for
                            existing rows matching (email, template_key), marks
                            notifications SENT/FAILED; never inserts or calls Resend

Actions taken:
- sender-worker: deprecation comment added, confirmed already unscheduled
- notification-retry-helper: clarification comment added
- ENGINEERING_CONVENTIONS.md: canonical pipeline and function table added (§8)
- TECH_DEBT_REGISTER.md: debt item #11 added (misleading function naming)
- NOTIFICATION_PIPELINE.md: created as authoritative pipeline reference

Open debt:
- Function renaming (notification-batch-processor → notification-batch-processor, etc.)
  is deferred to avoid runtime churn; tracked in TECH_DEBT_REGISTER #11

Resolved:
- trace_id added to scheduled_notifications (NOT NULL, auto-generated) and
  email_queue (nullable, propagated by notification-batch-processor); migration
  202605121700_notification_trace_id.sql; indexes added to both tables

---

### Session 4 Update — Operational Trace MVP (May 2026)

Completed:
- Added SQL RPC `public.get_operational_trace(...)` for admin-facing trace retrieval.
- Added Operational Trace panel to System Health with inputs for applicant email, applicant ID,
  student ID, and registration ID.
- Added timeline rendering with normalized source/status/event rows and expandable JSON details.

Scope:
- Read-only operational debugging tool.
- Tolerant joins across applicants, students, class_roster, moodle_enrollment_sync,
  scheduled_notifications, email_queue, audit_logs, sync_log, and error_submissions.

Known limitations:
- No typed `trace_id` yet.
- Fallback matching (email + JSON extraction) can produce partial/duplicate matches on older records.

Phase 2 target:
- Add typed `registration_id` propagation to pipeline tables to improve join precision.

Hardening follow-up:
- RPC updated to `SECURITY DEFINER` with `search_path = public`.
- Execute restricted to `authenticated`.
- Frontend now hides Operational Trace panel when admin verification fails.
