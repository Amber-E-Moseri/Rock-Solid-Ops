-- Add reminder templates and ensure scheduled_notifications dedupe support.

insert into public.notification_templates (template_key, subject, body_html, active)
values
(
  'moodle_login_reminder',
  'Your Foundation School class has started — log in to Moodle',
  '<div style="font-family:Manrope,Segoe UI,Arial,sans-serif;color:#0f172a">'
  || '<div style="background:#1a3c5e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Rock Solid Foundation School</h2></div>'
  || '<div style="border:1px solid #d6dbe7;border-top:0;border-radius:0 0 10px 10px;padding:18px">'
  || '<p>Hi {{first_name}},</p>'
  || '<p>Your Foundation School class has started. We noticed you have not logged into Moodle yet.</p>'
  || '<p><strong>Your login details:</strong><br>'
  || 'Moodle URL: {{moodle_url}}<br>'
  || 'Username: {{email}}<br>'
  || 'Forgot password: {{moodle_url}}/login/forgot_password.php</p>'
  || '<p><strong>Your class:</strong> {{class_label}}<br><strong>Teacher:</strong> {{teacher_name}}</p>'
  || '<p><a href="{{moodle_url}}" style="display:inline-block;background:#1a3c5e;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700">Log in to Moodle</a></p>'
  || '<p>Log in now and join your classmates.</p>'
  || '<p style="margin-top:20px">Rock Solid Foundation School</p>'
  || '</div></div>',
  true
),
(
  'class_now_available',
  'Good news — a class is now available for you',
  '<div style="font-family:Manrope,Segoe UI,Arial,sans-serif;color:#0f172a">'
  || '<div style="background:#16a34a;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Rock Solid Foundation School</h2></div>'
  || '<div style="border:1px solid #d6dbe7;border-top:0;border-radius:0 0 10px 10px;padding:18px">'
  || '<p>Hi {{first_name}},</p>'
  || '<p>Great news! A new class has opened that matches your availability.</p>'
  || '<p><strong>Class:</strong> {{class_day}} at {{class_time}}<br>'
  || '<strong>Teacher:</strong> {{teacher_name}}<br>'
  || '<strong>Fellowship:</strong> {{fellowship_code}}</p>'
  || '<p><a href="{{moodle_url}}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700">Register / Confirm your spot</a></p>'
  || '<p style="margin-top:20px">Rock Solid Foundation School</p>'
  || '</div></div>',
  true
)
on conflict (template_key) do update
set subject = excluded.subject,
    body_html = excluded.body_html,
    active = excluded.active,
    updated_at = now();

alter table public.scheduled_notifications
  add column if not exists dedupe_key text;

create unique index if not exists scheduled_notifications_dedupe_key
  on public.scheduled_notifications(dedupe_key)
  where dedupe_key is not null;
