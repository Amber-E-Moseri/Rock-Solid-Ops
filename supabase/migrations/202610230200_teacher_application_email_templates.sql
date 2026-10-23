-- Teacher application email templates (additive, forward-only).
--
-- notification_templates is the canonical renderer (email-sender reads only this table).
-- email_templates is the compatibility mirror that email_queue.template_key references.
-- Rows are inserted with ON CONFLICT DO NOTHING so an owner-edited live copy is never overwritten.
-- Bodies contain no reviewer free text: applicants read their message in the portal, not in email.

begin;

insert into public.notification_templates (template_key, subject, body_html, active)
values
  (
    'teacher_application_received',
    'We received your Rock Solid teacher application',
    '<p>Dear {{first_name}},</p>'
    '<p>Thank you for applying to serve as a teacher. Your application has been received and is waiting for review by the administration team.</p>'
    '<p>You can check its status any time by signing in to Rock Solid. We will email you again only when there is a decision or something we need from you.</p>',
    true
  ),
  (
    'teacher_application_info_requested',
    'We need a little more information for your teacher application',
    '<p>Dear {{first_name}},</p>'
    '<p>The administration team has reviewed your teacher application and needs some additional information.</p>'
    '<p>Please sign in to Rock Solid to read the request and update your application.</p>',
    true
  ),
  (
    'teacher_application_rejected',
    'Update on your Rock Solid teacher application',
    '<p>Dear {{first_name}},</p>'
    '<p>Thank you for your interest in serving as a teacher. After review, we are unable to take your application further at this time.</p>'
    '<p>If you have questions, please contact the administration team.</p>',
    true
  )
on conflict (template_key) do nothing;

insert into public.email_templates (template_key, subject, body_html, active)
select nt.template_key, nt.subject, nt.body_html, nt.active
from public.notification_templates nt
where nt.template_key in (
  'teacher_application_received',
  'teacher_application_info_requested',
  'teacher_application_rejected'
)
on conflict (template_key) do nothing;

commit;
