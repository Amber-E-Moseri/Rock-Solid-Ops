-- Consolidates 4 near-identical "still working on it" registration emails
-- (no_suitable_times, no_class_available, waitlist_confirmation,
-- registration_under_review) into a single templated email driven by a
-- {{status_message}} payload variable set per-condition in
-- registration-processor. duplicate_registration is untouched — it is a
-- distinct notice, not a holding-pattern message.
--
-- Old rows are deactivated, not deleted, so historical email_queue rows
-- that already reference them remain resolvable for audit purposes.

insert into public.notification_templates (template_key, subject, body_html, active)
values (
  'registration_status_update',
  'An update on your Foundation School registration',
  $q$<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>An update on your Foundation School registration</title>
  <style>
    body { margin: 0; padding: 0; background: #f0f4f8; font-family: 'Manrope', 'DM Sans', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(26,60,94,.10); }
    .header { background: #1a3c5e; padding: 28px 40px 22px; text-align: center; }
    .header img { display: block; margin: 0 auto 8px; }
    .header h1 { margin: 0; color: #fff; font-size: 24px; font-weight: 800; letter-spacing: -.02em; }
    .header p { margin: 6px 0 0; color: rgba(255,255,255,.80); font-size: 13px; }
    .body { padding: 32px 40px; color: #1a1a2e; }
    .body p { margin: 0 0 16px; line-height: 1.7; font-size: 15px; }
    .status-box { background: #f0f4f8; border-left: 4px solid #1a3c5e; border-radius: 8px; padding: 14px 18px; margin: 0 0 16px; font-size: 14px; color: #1a3c5e; line-height: 1.6; }
    .footer { background: #f5f5f5; padding: 20px 40px; text-align: center; color: #888; font-size: 12px; line-height: 1.7; }
    .footer a { color: #888; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <img src="https://rocksolidsuite.netlify.app/foundation/registration/canada_sr.png" alt="BLW Canada" style="height:72px;margin-bottom:8px;" />
      <h1>Rock Solid</h1>
      <p>Foundation School &middot; BLW Canada</p>
    </div>
    <div class="body">
      <p>Hi {{first_name}},</p>
      <div class="status-box">{{status_message}}</div>
      <p>Thank you for your patience — we'll be in touch as soon as there's an update.</p>
    </div>
    <div class="footer">
      Rock Solid Foundation School &middot; BLW Canada<br />
      Questions? <a href="mailto:info@lwcanada.org">info@lwcanada.org</a>
    </div>
  </div>
</body>
</html>$q$,
  true
)
on conflict (template_key) do update set
  subject = excluded.subject,
  body_html = excluded.body_html,
  active = excluded.active;

update public.notification_templates
set active = false, updated_at = now()
where template_key in ('no_suitable_times', 'no_class_available', 'waitlist_confirmation', 'registration_under_review');
