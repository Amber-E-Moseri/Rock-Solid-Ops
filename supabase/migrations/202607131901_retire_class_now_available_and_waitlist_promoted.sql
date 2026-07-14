-- Retires two redundant "your class is ready" templates:
--   class_now_available  — waitlist-processor now uses the existing,
--                           already-correct classes_now_available template
--                           (working personal selection link) instead.
--   waitlist_promoted    — orphaned; no code path ever set this template_key.
-- Deactivated, not deleted, so historical email_queue rows remain resolvable.

update public.notification_templates
set active = false, updated_at = now()
where template_key in ('class_now_available', 'waitlist_promoted');
