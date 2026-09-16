# Next Steps

## Cutover Enforcement
- Keep archived legacy registration code out of runtime traffic paths.

## Audit Operations
- Apply migration `202605071800_audit_logs_canonicalization.sql`.
- Confirm all active edge functions write to `public.audit_logs`.

## Retry Operations
- Confirm `retry-worker` auto sweep is operating and skipping non-retryable Moodle auth/WAF/mapping failures.
- Keep manual retry controls in Retry Center for targeted operator intervention.

## Pilot Launch Validation
1. Registration creates records once (no duplicate pipeline).
2. Audit entries continue writing under `audit_logs`.
3. Historical audit rows remain accessible (including legacy pathway).
4. Moodle sync retry flow is automatic and bounded.
5. Retry Center, System Health, and Notification Center remain functional.

## Remaining Operational Debt
- Keep legacy archive read-only and continue Supabase-first hardening.
- Continue mobile density/readability refinements on operational pages where required.
- Keep RLS and role-policy reviews aligned with any new operational tables.

## Current Platform State � May 2026
- RLS hardening baseline completed (continue incremental policy audits as new flows ship).
- CORS cleanup baseline completed.
- Attendance dedupe baseline completed.
- fs-* design system introduced (`tokens.css` + `primitives.css`).
- `teacher-portal-api` router refactor completed.
- Moodle 403 classification completed (WAF vs permissions vs REST-disabled paths).
- Shared `supabase/functions/_shared/` utilities introduced.
- `sender-worker` deprecation tracked; verify function artifact state in each environment before release.
- Operational visibility improved across retry/error surfaces.

## Current Highest Priority Consolidation Tasks
- Shared assignment pipeline extraction (`registration-processor` + `phase2-processor`).
- Auth module consolidation (`auth-client.js` + `auth-guards.js`).
- fs-* migration completion across remaining staff pages.
- Schema canonicalization (remove fallback table-name loops).
- Operational trace view (per-applicant lifecycle view).

## Do Not Reintroduce
- Duplicate workers for the same notification pipeline.
- Duplicate auth paths for the same user/session checks.
- Legacy CSS primitives when fs-* alternatives exist.
- Try-multiple-table-name fallbacks in active edge code.
- Inline config guards repeated per page.
- Page-specific design systems outside `tokens.css`/`primitives.css`.

## Completed
- 2026-05-24: `auth-client.js` runtime config read path hardened to use `window.FS_CONFIG` as primary source and `FSConfig.validate()` for validation/rendering.
- 2026-05-24: `teacher-portal-api/getStudentMilestonesForClass` migrated from legacy `student_milestones` query to canonical `student_milestone_status` query via class applicant IDs.
- 2026-05-24: `report-generator` updated to call `applyAllowedOrigin(req)` to ensure browser edge-invoke requests receive origin-allow headers.
- 2026-05-24: Admin shell teacher-mode availability expanded to `admin` and `superadmin` roles; teacher switch label normalized to `Teacher Mode`.
- 2026-05-24: `class-editor` table now includes per-class `Enrolled` totals from `applicants` with `registration_status = ASSIGNED`.
- 2026-05-13: Keep Supabase `registration-processor` as canonical and only active registration processor. `phase2-processor` registration path is hard-disabled with a 410 guard.
- 2026-05-13: Treat dual endpoint configuration as a release blocker. Legacy `APPS_SCRIPT_URL` was removed from `registration-form.html`.
- 2026-05-13: Ensure scheduled invocation of `retry-worker` is active in deployed project. Confirmed active in `supabase/functions/retry-worker/config.toml` (`0 * * * *`, hourly; no change required).
- 2026-05-13: `sender-worker` must remain unscheduled. Confirmed no cron entry exists (no change required).
- 2026-05-14: `sender-worker` deprecation intent recorded. Follow-up required: verify runtime function file/state and update this note to match the current repository/deployed artifact.







