-- Deactivate confirmed-dead legacy stub templates.
--
-- These 10 template_key rows were promoted into notification_templates by the
-- one-time migration 202605221030_consolidate_template_sources.sql (copied from
-- the now-dead email_templates table). All have empty body_html and zero
-- producers anywhere in the codebase. Two are near-duplicate keys of real live
-- templates: WELCOME (dupe of foundation_welcome) and CLASS_ASSIGNED (dupe of
-- class_assigned). Full audit: foundation/docs/NOTIFICATION_PIPELINE.md
-- "Template Inventory" section; docs/migration-log.md entry for this branch.
--
-- Deactivated, not deleted -- this repo's convention is never to hard-delete
-- notification_templates rows.
--
-- NOTE: attendance_reminder and attendance_escalation were ALSO promoted by the
-- same 202605221030 migration but are real, live templates wired to
-- supabase/functions/attendance-reminder/index.ts (daily cron) -- deliberately
-- excluded from this list.

update public.notification_templates
set active = false, updated_at = now()
where template_key in (
  'WELCOME',
  'CLASS_ASSIGNED',
  'TEACHER_ROSTER_DAILY',
  'TEACHER_ROSTER_WEEKLY',
  'WEEK3_FOLLOWUP',
  'WEEK6_FOLLOWUP',
  'ATTENDANCE_FLAG_CLASS1',
  'ATTENDANCE_FLAG_REPEAT',
  'GRADUATION_READY',
  'TRANSITION_OVERDUE'
)
and active = true;
