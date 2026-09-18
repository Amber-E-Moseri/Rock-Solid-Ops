-- Waitlist processor email template + cron schedule
-- BEFORE RUNNING: replace <SERVICE_ROLE_KEY> with your actual service role key from
-- Project Settings → API → service_role. Do NOT commit the key to version control.

-- Email template: waitlist_promoted
INSERT INTO public.notification_templates (template_key, subject, body_html, active)
VALUES (
  'waitlist_promoted',
  'Great news — you have been assigned to a Foundation School class!',
  '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You Have Been Assigned!</title>
</head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Manrope,''Segoe UI'',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(76,42,146,.10);">
        <tr>
          <td style="background:#4C2A92;padding:32px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">🎉 Your Spot is Confirmed!</div>
            <div style="font-size:15px;color:#d4c5f9;margin-top:6px;">Foundation School · BLW Canada</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="font-size:18px;font-weight:700;color:#171327;margin:0 0 16px;">Hi {{first_name}},</p>
            <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 20px;">
              Your patience has paid off! We are thrilled to let you know that a spot has opened up in a Foundation School class, and you have been <strong>officially assigned</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;margin:0 0 28px;">
              <tr>
                <td style="padding:24px 28px;">
                  <div style="font-size:13px;color:#6b5c91;text-transform:uppercase;font-weight:700;letter-spacing:.08em;margin-bottom:12px;">Your Class Details</div>
                  <div style="font-size:16px;font-weight:700;color:#4C2A92;margin-bottom:6px;">📅 {{class_day}} at {{class_time}}</div>
                  <div style="font-size:15px;color:#444;margin-bottom:4px;">👩‍🏫 Teacher: <strong>{{teacher_name}}</strong></div>
                  <div style="font-size:15px;color:#444;">📍 Fellowship: <strong>{{fellowship_code}}</strong></div>
                </td>
              </tr>
            </table>
            <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 20px;">
              Your next step is to log in to Moodle and complete your course materials. Your class is ready and waiting for you.
            </p>
            <div style="text-align:center;margin:0 0 28px;">
              <a href="{{moodle_url}}" style="display:inline-block;background:#4C2A92;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;">
                Log in to Moodle →
              </a>
            </div>
            <p style="font-size:14px;color:#888;line-height:1.6;margin:0;">
              If you have any questions, simply reply to this email. We look forward to seeing you in class!
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f3ff;padding:20px 40px;text-align:center;">
            <div style="font-size:12px;color:#9b8cb5;">Rock Solid Foundation School · BLW Canada</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>',
  true
)
ON CONFLICT (template_key) DO UPDATE
  SET subject   = EXCLUDED.subject,
      body_html = EXCLUDED.body_html,
      active    = EXCLUDED.active;

-- Cron: run waitlist-processor every 15 minutes (only if pg_cron is available)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not available; skipping waitlist-processor schedule';
    RETURN;
  END IF;

  EXECUTE format('SELECT cron.schedule(%L, %L, %L)',
    'waitlist-processor',
    '*/15 * * * *',
    'SELECT net.http_post(url := ''https://xelpsttqhrcqmttmjory.supabase.co/functions/v1/waitlist-processor'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}''::jsonb, body := ''{}''::jsonb)'
  );
END $$;
