-- Consolidate email template source of truth.
-- Keep email_templates for reference only; notification_templates is canonical.

WITH copied AS (
  INSERT INTO public.notification_templates (template_key, subject, body_html, active)
  SELECT et.template_key, et.subject, et.body_html, et.active
  FROM public.email_templates et
  WHERE et.template_key NOT IN (
    SELECT nt.template_key FROM public.notification_templates nt
  )
  ON CONFLICT (template_key) DO NOTHING
  RETURNING template_key
)
SELECT COUNT(*) AS copied_template_count FROM copied;

COMMENT ON TABLE public.email_templates IS
'DEPRECATED  use notification_templates. Kept for reference only.';
