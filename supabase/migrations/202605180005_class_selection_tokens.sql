create table if not exists public.class_selection_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  applicant_id uuid not null references public.applicants(id) on delete cascade,
  batch_id text not null,
  fellowship_code text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_class_option_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_class_selection_tokens_token on public.class_selection_tokens(token);
create index if not exists idx_class_selection_tokens_applicant_id on public.class_selection_tokens(applicant_id);

alter table public.class_selection_tokens disable row level security;

insert into public.notification_templates (template_key, subject, body_html, active)
values (
  'classes_now_available',
  'Good news — Foundation School classes are now available for you!',
  '<div style="font-family:Arial,sans-serif;background:#f5f5f7;padding:24px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5ea"><div style="background:#4C2A92;color:#fff;padding:18px 24px;display:flex;align-items:center;gap:14px"><img src="https://rocksolidsuite.netlify.app/foundation/registration/canada_sr.png" alt="BLW Canada" style="height:44px" /><div style="font-size:20px;font-weight:700">Rock Solid Foundation School</div></div><div style="padding:24px;color:#1a1a1f"><p style="margin:0 0 14px">Hi {{first_name}},</p><p style="margin:0 0 14px">We have great news! Foundation School classes are now available for your fellowship and we''d love for you to join us.</p><p style="margin:0 0 18px">To secure your spot, please choose your preferred class time using the button below. Your selection link is personal to you and expires in 7 days.</p><p style="margin:0 0 22px"><a href="{{selection_url}}" style="display:inline-block;background:#4C2A92;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Choose My Class Time</a></p><p style="margin:0 0 14px">Once you select a class, you will receive a confirmation email with your Moodle login details. No re-registration needed.</p></div><div style="padding:16px 24px;border-top:1px solid #eee;color:#666;font-size:13px">BLW Canada • <a href="mailto:info@lwcanada.org">info@lwcanada.org</a></div></div></div>',
  true
)
on conflict (template_key)
do update set
  subject = excluded.subject,
  body_html = excluded.body_html,
  active = excluded.active;

insert into public.notification_templates (template_key, subject, body_html, active)
values (
  'class_assigned_confirmation',
  'Your Foundation School class is confirmed!',
  '<div style="font-family:Arial,sans-serif;background:#f5f5f7;padding:24px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5ea"><div style="background:#4C2A92;color:#fff;padding:18px 24px;display:flex;align-items:center;gap:14px"><img src="https://rocksolidsuite.netlify.app/foundation/registration/canada_sr.png" alt="BLW Canada" style="height:44px" /><div style="font-size:20px;font-weight:700">Rock Solid Foundation School</div></div><div style="padding:24px;color:#1a1a1f"><p style="margin:0 0 14px">Hi {{first_name}}, your class is confirmed!</p><div style="border:1px solid #4dcc8f;background:#f1fff7;color:#155b3b;border-radius:10px;padding:14px 16px;margin:0 0 16px"><p style="margin:0 0 8px;font-weight:700">✓ Class Details</p><p style="margin:0 0 4px">Teacher: {{teacher_name}}</p><p style="margin:0">Day &amp; Time: {{class_day}} at {{class_time}}</p></div><p style="margin:0 0 18px">Your Moodle learning account will be set up shortly and you will receive login details in a separate email.</p><p style="margin:0"><a href="https://rocksolid.lwcanada.org/" style="display:inline-block;background:#4C2A92;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Visit Moodle</a></p></div><div style="padding:16px 24px;border-top:1px solid #eee;color:#666;font-size:13px">BLW Canada • <a href="mailto:info@lwcanada.org">info@lwcanada.org</a></div></div></div>',
  true
)
on conflict (template_key)
do update set
  subject = excluded.subject,
  body_html = excluded.body_html,
  active = excluded.active;

create or replace function public.class_selection_finalize(
  p_token text,
  p_class_option_id text
)
returns table (
  ok boolean,
  error text,
  applicant_id uuid,
  teacher_name text,
  class_day text,
  class_time text,
  batch_id text,
  fellowship_code text
)
language plpgsql
security definer
as $$
declare
  v_tok public.class_selection_tokens%rowtype;
  v_app public.applicants%rowtype;
  v_co public.class_options%rowtype;
  v_slot public.class_slots%rowtype;
begin
  select * into v_tok
  from public.class_selection_tokens
  where token = p_token
  for update;

  if not found then
    return query select false, 'INVALID_TOKEN', null::uuid, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if v_tok.used_at is not null then
    return query select false, 'TOKEN_USED', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    return;
  end if;

  if v_tok.expires_at < now() then
    return query select false, 'TOKEN_EXPIRED', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    return;
  end if;

  select * into v_app
  from public.applicants
  where id = v_tok.applicant_id
  for update;

  if not found then
    return query select false, 'APPLICANT_NOT_FOUND', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    return;
  end if;

  select * into v_co
  from public.class_options
  where class_option_id = p_class_option_id
    and active = true
    and enrollment_open = true
    and deleted_at is null
    and (fellowship_codes @> array[v_tok.fellowship_code]::text[] or fellowship_codes @> array['REGIONAL']::text[])
  for update;

  if not found then
    return query select false, 'CLASS_NOT_ALLOWED', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    return;
  end if;

  select * into v_slot
  from public.class_slots
  where class_option_id = p_class_option_id
    and batch_id = v_tok.batch_id
  for update;

  if not found then
    return query select false, 'SLOT_NOT_FOUND', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    return;
  end if;

  if v_slot.max_capacity is not null and v_slot.current_enrolment >= v_slot.max_capacity then
    return query select false, 'CLASS_FULL', v_tok.applicant_id, v_co.teacher_name, v_co.day, v_co.class_time, v_tok.batch_id, v_tok.fellowship_code;
    return;
  end if;

  update public.applicants
  set class_option_id = p_class_option_id,
      registration_status = 'ASSIGNED',
      assigned_at = now()
  where id = v_tok.applicant_id;

  update public.class_slots
  set current_enrolment = coalesce(current_enrolment, 0) + 1
  where class_slot_id = v_slot.class_slot_id;

  insert into public.moodle_enrollment_sync (
    applicant_id,
    email,
    full_name,
    batch_id,
    class_option_id,
    sync_status,
    registration_status,
    created_at,
    updated_at
  )
  values (
    v_app.id,
    v_app.email,
    v_app.full_name,
    v_tok.batch_id,
    p_class_option_id,
    'PENDING',
    'ASSIGNED',
    now(),
    now()
  )
  on conflict (email, batch_id)
  do update set
    applicant_id = excluded.applicant_id,
    class_option_id = excluded.class_option_id,
    sync_status = 'PENDING',
    registration_status = 'ASSIGNED',
    updated_at = now();

  update public.class_selection_tokens
  set used_at = now(),
      used_class_option_id = p_class_option_id
  where id = v_tok.id;

  return query select true, null::text, v_app.id, v_co.teacher_name, v_co.day, v_co.class_time, v_tok.batch_id, v_tok.fellowship_code;
exception
  when others then
    return query select false, left(sqlerrm, 250), v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
end;
$$;

grant execute on function public.class_selection_finalize(text, text) to service_role;

