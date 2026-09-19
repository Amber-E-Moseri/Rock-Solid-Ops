-- Durable email_queue.template_key FK support.
--
-- notification_templates is the canonical template source, and email-sender
-- resolves content from notification_templates. The older email_queue table
-- still has a foreign key to email_templates(template_key), so every template
-- key that can be enqueued must also exist there after a clean migration reset.
--
-- This is not a second source of truth: email_templates remains a compatibility
-- mirror for the FK while notification_templates owns rendered content.

-- These two producers intentionally provide final subject/body content in the
-- email_queue payload. The template row is still required because email-sender
-- resolves all queued mail through notification_templates before rendering.
INSERT INTO public.notification_templates (template_key, subject, body_html, active)
VALUES
  ('campaign', '{{subject}}', '{{body_html}}', true),
  ('report', '{{subject}}', '{{body_html}}', true)
ON CONFLICT (template_key) DO UPDATE
SET subject = EXCLUDED.subject,
    body_html = EXCLUDED.body_html,
    active = EXCLUDED.active,
    updated_at = now();

INSERT INTO public.email_templates (template_key, subject, body_html, active)
SELECT nt.template_key, nt.subject, nt.body_html, nt.active
FROM public.notification_templates nt
ON CONFLICT (template_key) DO UPDATE
SET subject = EXCLUDED.subject,
    body_html = EXCLUDED.body_html,
    active = EXCLUDED.active,
    updated_at = now();

COMMENT ON TABLE public.email_templates IS
  'Deprecated compatibility mirror for email_queue.template_key FK. '
  'notification_templates is canonical for rendered content.';
