# Architecture

## Backend Canonical State (May 2026)
- Primary backend: Supabase Postgres + Supabase Edge Functions.
- Staff portals: plain HTML/CSS/JS under `foundation/staff`.
- Auth/session: Supabase Auth.
- Registration intake: `registration-processor` is the only active registration pipeline.
- Legacy registration processing is archived and non-operational.

## Registration Flow
1. Public registration submits payload.
2. `registration-processor` validates/normalizes and writes operational records.
3. Follow-up sync/notification pipelines execute via queue + edge functions.
4. Audit events write to `public.audit_logs`.

## Teacher Lifecycle Flow
- Teacher profile + status transitions are Supabase-backed.
- Portal-level actions (approve/suspend/reactivate) are role-gated.
- Operational changes emit audit events.

## Attendance + Session Outcomes
- Attendance and outcomes data are stored in Supabase tables and consumed by staff portals.
- Session outcomes migrations and RLS are under `supabase/migrations/*session_outcomes*` and hardening SQL.

## Milestones
- Milestones are Supabase-backed via definitions + student status tables.
- Role policy: admin/superadmin can update student milestone status; definition management remains superadmin policy-controlled.

## Moodle Sync + Retry/Recovery
- `moodle-sync` processes enrollment rows and classifies retryable vs non-retryable failures.
- `retry-worker` supports:
  - manual admin retry/resolve operations
  - scheduled auto sweep every hour (`0 * * * *`)
- Auto sweep retries only retryable Moodle failures; non-retryable auth/WAF/mapping errors are not endlessly retried.

## Notification/Email Ops
- Notification and sender workers run as Supabase edge functions.
- Failed sends/retries are surfaced to retry center and audit logs.

## Audit Logging Canonical Table
- Canonical table: `public.audit_logs`.
- New runtime code writes directly to `audit_logs`.

## Operational Dashboards
- Admin portal links to:
  - Retry Center
  - System Health
  - Audit Log
  - Notification Center
- Admin tools enforce Supabase-only registration configuration.



