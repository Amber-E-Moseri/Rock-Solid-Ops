-- Simplify the brand name in applicant/staff-facing email copy: "Rock Solid
-- Foundation School" -> "Rock Solid" wherever it appears as that compound
-- name in subjects or body copy.
--
-- Does NOT touch the header lockup ("Rock Solid" title + "Foundation School
-- BLW Canada" subtitle on a separate line, applied by 202605201000) -- that
-- is two distinct lines already, not the compound name string.
--
-- notification_templates is the canonical, live-read template table
-- (email-sender/index.ts reads notification_templates only; email_templates
-- has zero readers/writers per the 2026-07-13 Email Pipeline Audit,
-- docs/migration-log.md). This migration only touches notification_templates.
--
-- Confirmed against two real, live-sent emails that diverge from every
-- checked-in migration's template body: the waitlist "Rock Oslid" report and
-- the moodle_credentials subject "Your Moodle Access — Rock Solid Foundation
-- School" (checked-in subject is 'Your Moodle Access - {{class_label}}',
-- no brand tail at all, per 202605191430_moodle_credentials_template_alignment.sql;
-- the 202605201000 branding pass explicitly does not touch subject lines).
-- Both confirm notification_templates rows have been hand-edited in the
-- Supabase dashboard and now diverge from version control. This migration
-- corrects the "Rock Solid Foundation School" -> "Rock Solid" wording
-- wherever it landed as a result; it does not attempt to fully resync every
-- dashboard edit back to the checked-in body/subject text.
--
-- Idempotent: the replace() is a no-op on rows that no longer contain the
-- compound phrase, so re-running this migration after it has already applied
-- changes nothing.

update public.notification_templates
set
  body_html = replace(body_html, 'Rock Solid Foundation School', 'Rock Solid'),
  subject   = replace(subject, 'Rock Solid Foundation School', 'Rock Solid'),
  updated_at = now()
where body_html like '%Rock Solid Foundation School%'
   or subject like '%Rock Solid Foundation School%';
