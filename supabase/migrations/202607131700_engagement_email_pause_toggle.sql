-- Adds a config-driven on/off toggle for the "never started" and "dropped off"
-- re-engagement emails, without touching the detection/flagging logic that
-- marks students At Risk / needs_attention. Defaults to '0' (paused) per
-- explicit request; flip to '1' to re-enable without a code deploy.

insert into public.student_engagement_config (key, value, description) values
  ('never_started_email_enabled', '0', 'Set to 1 to send the engagement_never_started email; 0 pauses the email but keeps flagging students At Risk'),
  ('dropped_off_email_enabled',   '0', 'Set to 1 to send the engagement_dropped_off email; 0 pauses the email but keeps flagging students At Risk')
on conflict (key) do nothing;
