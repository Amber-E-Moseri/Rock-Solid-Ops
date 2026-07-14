-- Consolidates 4 unwired teacher status templates (teacher_approved,
-- teacher_rejected, teacher_suspended, teacher_reactivated) into 2:
-- teacher_status_positive (approved/reactivated) and teacher_status_negative
-- (rejected/suspended), parameterized by {{scenario_label}}. None of the 4
-- old templates were ever actually sent — teacherManagement.js had only a
-- placeholder comment — so this ships alongside the real send code being
-- added in the same change, not a behavior change to an existing send path.
--
-- Old rows are deactivated, not deleted.
--
-- Note: email-sender substitutes {{var}} via plain regex replace only — it
-- does not support {{#reason}}...{{/reason}} conditional blocks (confirmed
-- by reading email-sender/index.ts). The negative template always renders
-- the reason line; the caller supplies a fallback string when no reason was
-- given, rather than relying on template-level conditionals.

insert into public.notification_templates (template_key, subject, body_html, active)
values
  (
    'teacher_status_positive',
    'An update on your Foundation School teacher account',
    '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Teacher Account Update</title>
  <style>
    body { margin:0; padding:0; background:#f7f7f7; font-family:''Manrope'',''DM Sans'',Arial,sans-serif; }
    .wrapper { max-width:600px; margin:32px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
    .header { background:#16a34a; padding:28px 40px 22px; text-align:center; }
    .header h1 { margin:0; color:#fff; font-size:20px; font-weight:800; }
    .header p  { margin:6px 0 0; color:rgba(255,255,255,.80); font-size:13px; }
    .body { padding:32px 40px; color:#1a1a2e; }
    .body p { margin:0 0 16px; line-height:1.65; font-size:15px; }
    .name { font-weight:800; color:#16a34a; }
    .welcome-box { background:#f0fdf4; border-left:4px solid #16a34a; border-radius:8px; padding:14px 18px; margin:20px 0; font-size:14px; color:#14532d; line-height:1.6; }
    .cta { text-align:center; margin:28px 0; }
    .cta a { display:inline-block; background:#C8102E; color:#fff; text-decoration:none; padding:12px 30px; border-radius:999px; font-weight:800; font-size:14px; }
    .footer { border-top:1px solid #f0f0f0; padding:20px 40px; text-align:center; color:#888; font-size:12px; line-height:1.7; }
    .footer a { color:#C8102E; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Rock Solid Foundation School</h1>
      <p>BLW Canada &mdash; LoveWorld Canada</p>
    </div>
    <div class="body">
      <p>Dear <span class="name">{{first_name}}</span>,</p>
      <p>Your Foundation School teacher account has been <strong>{{scenario_label}}</strong>.</p>
      <div class="welcome-box">
        <strong>You''re all set!</strong><br />
        You can log in to the teacher portal to access your dashboard, class schedule, and student roster.
      </div>
      <p>Thank you for your commitment to serving in the Kingdom. Your contribution to the growth of our students is greatly valued.</p>
      <div class="cta">
        <a href="{{cta_url}}">{{cta_label}}</a>
      </div>
      <p style="font-size:13px;color:#555;">
        God bless you,<br />
        <strong>The Rock Solid Foundation School Team</strong><br />
        BLW Canada
      </p>
    </div>
    <div class="footer">
      <strong>LoveWorld Canada &mdash; BLW Canada</strong><br />
      Questions? Email <a href="mailto:foundation@lwcanada.org">foundation@lwcanada.org</a>
    </div>
  </div>
</body>
</html>',
    true
  ),
  (
    'teacher_status_negative',
    'An update on your Foundation School teacher account',
    '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Teacher Account Update</title>
  <style>
    body { margin:0; padding:0; background:#f7f7f7; font-family:''Manrope'',''DM Sans'',Arial,sans-serif; }
    .wrapper { max-width:600px; margin:32px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
    .header { background:#C8102E; padding:28px 40px 22px; text-align:center; }
    .header h1 { margin:0; color:#fff; font-size:20px; font-weight:800; }
    .header p  { margin:6px 0 0; color:rgba(255,255,255,.80); font-size:13px; }
    .body { padding:32px 40px; color:#1a1a2e; }
    .body p { margin:0 0 16px; line-height:1.65; font-size:15px; }
    .name { font-weight:800; color:#C8102E; }
    .reason-box { background:#fff5f5; border-left:4px solid #C8102E; border-radius:8px; padding:14px 18px; margin:20px 0; font-size:14px; color:#7f1d1d; line-height:1.6; }
    .cta { text-align:center; margin:28px 0; }
    .cta a { display:inline-block; background:#C8102E; color:#fff; text-decoration:none; padding:12px 30px; border-radius:999px; font-weight:800; font-size:14px; }
    .footer { border-top:1px solid #f0f0f0; padding:20px 40px; text-align:center; color:#888; font-size:12px; line-height:1.7; }
    .footer a { color:#C8102E; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Rock Solid Foundation School</h1>
      <p>BLW Canada &mdash; LoveWorld Canada</p>
    </div>
    <div class="body">
      <p>Dear <span class="name">{{first_name}}</span>,</p>
      <p>Your Foundation School teacher account has been <strong>{{scenario_label}}</strong>.</p>
      <div class="reason-box">
        <strong>Reason:</strong><br />{{reason}}
      </div>
      <p>If you have questions, please reach out to your administrator directly.</p>
      <div class="cta">
        <a href="mailto:foundation@lwcanada.org">Contact Administration</a>
      </div>
      <p style="font-size:13px;color:#555;">
        God bless you,<br />
        <strong>The Rock Solid Foundation School Team</strong><br />
        BLW Canada
      </p>
    </div>
    <div class="footer">
      <strong>LoveWorld Canada &mdash; BLW Canada</strong><br />
      Questions? Email <a href="mailto:foundation@lwcanada.org">foundation@lwcanada.org</a>
    </div>
  </div>
</body>
</html>',
    true
  )
on conflict (template_key) do update
  set subject   = excluded.subject,
      body_html = excluded.body_html,
      active    = excluded.active,
      updated_at = now();

update public.notification_templates
set active = false, updated_at = now()
where template_key in ('teacher_approved', 'teacher_rejected', 'teacher_suspended', 'teacher_reactivated');
