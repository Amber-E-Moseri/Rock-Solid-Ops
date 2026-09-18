-- Auto-notify eligible WAITLISTED applicants when class availability opens.
-- Uses class-selection token flow + scheduled_notifications pipeline.

create or replace function public.queue_waitlisted_class_available_notifications(
  p_class_option_id text,
  p_batch_id text,
  p_event_key text
)
returns table (
  queued_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co record;
  v_base_url text := 'https://rocksolidsuite.netlify.app/foundation/registration/class-selection.html?token=';
  v_app record;
  v_token text;
  v_event_id uuid;
  v_dedupe_key text;
  v_selection_url text;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  select
    co.class_option_id,
    co.teacher_name,
    co.day,
    co.class_time,
    co.fellowship_codes
  into v_co
  from public.class_options co
  where co.class_option_id = p_class_option_id
    and co.active = true
    and co.enrollment_open = true
    and co.deleted_at is null;

  if not found then
    return query select 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.batches b
    where b.batch_id = p_batch_id
      and b.active = true
  ) then
    return query select 0, 0;
    return;
  end if;

  for v_app in
    select
      a.id,
      trim(concat(coalesce(a.first_name, ''), ' ', coalesce(a.last_name, ''))) as full_name,
      a.email,
      upper(trim(coalesce(a.fellowship_code, ''))) as fellowship_code,
      a.batch_id
    from public.applicants a
    where a.batch_id = p_batch_id
      and a.registration_status = 'WAITLISTED'
      and a.class_option_id is null
      and coalesce(trim(a.email), '') <> ''
      and upper(trim(coalesce(a.fellowship_code, ''))) = any (
        select upper(trim(code))
        from unnest(coalesce(v_co.fellowship_codes, array[]::text[])) as code
      )
  loop
    v_dedupe_key := format(
      'classes_now_available:%s:%s:%s:%s',
      v_app.id,
      p_batch_id,
      p_class_option_id,
      coalesce(p_event_key, 'event')
    );

    if exists (
      select 1
      from public.scheduled_notifications sn
      where sn.dedupe_key = v_dedupe_key
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.class_selection_tokens (
      applicant_id,
      batch_id,
      fellowship_code
    )
    values (
      v_app.id,
      p_batch_id,
      v_app.fellowship_code
    )
    returning token into v_token;

    v_selection_url := v_base_url || v_token;

    insert into public.notification_events (
      event_type,
      applicant_id,
      email,
      fellowship_code,
      class_option_id,
      batch_id,
      payload,
      occurred_at
    )
    values (
      'CLASS_OPTIONS_AVAILABLE',
      v_app.id,
      lower(v_app.email),
      v_app.fellowship_code,
      p_class_option_id,
      p_batch_id,
      jsonb_build_object(
        'source', 'class_availability_trigger',
        'selection_url', v_selection_url,
        'event_key', p_event_key
      ),
      now()
    )
    returning id into v_event_id;

    insert into public.scheduled_notifications (
      event_id,
      applicant_id,
      recipient_email,
      event_type,
      template_key,
      scheduled_for,
      status,
      attempts,
      payload,
      dedupe_key
    )
    values (
      v_event_id,
      v_app.id,
      lower(v_app.email),
      'CLASS_OPTIONS_AVAILABLE',
      'classes_now_available',
      now(),
      'PENDING',
      0,
      jsonb_build_object(
        'first_name', split_part(coalesce(v_app.full_name, 'Student'), ' ', 1),
        'full_name', coalesce(v_app.full_name, 'Student'),
        'selection_url', v_selection_url,
        'fellowship_code', v_app.fellowship_code,
        'batch_id', p_batch_id,
        'class_option_id', p_class_option_id,
        'teacher_name', coalesce(v_co.teacher_name, ''),
        'class_day', coalesce(v_co.day, ''),
        'class_time', coalesce(v_co.class_time::text, ''),
        'expires_days', 7
      ),
      v_dedupe_key
    );

    insert into public.audit_logs (
      actor_email,
      action,
      entity_type,
      entity_id,
      status,
      details,
      created_at
    )
    values (
      'class-availability@system',
      'CLASS_SELECTION_EMAIL_QUEUED',
      'applicant',
      v_app.id::text,
      'SUCCESS',
      jsonb_build_object(
        'class_option_id', p_class_option_id,
        'batch_id', p_batch_id,
        'template_key', 'classes_now_available',
        'dedupe_key', v_dedupe_key
      ),
      now()
    );

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
end;
$$;

create or replace function public.trg_notify_waitlisted_on_class_slot_available()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_key text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.status, '') <> 'Active' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if not (coalesce(old.status, '') <> 'Active' and coalesce(new.status, '') = 'Active') then
      return new;
    end if;
  else
    return new;
  end if;

  v_event_key := format(
    'slot:%s:%s',
    coalesce(new.class_slot_id, ''),
    coalesce(new.updated_at::text, new.created_at::text, now()::text)
  );

  perform public.queue_waitlisted_class_available_notifications(
    new.class_option_id,
    new.batch_id,
    v_event_key
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_waitlisted_on_class_slot_available on public.class_slots;
create trigger trg_notify_waitlisted_on_class_slot_available
after insert or update on public.class_slots
for each row
execute function public.trg_notify_waitlisted_on_class_slot_available();

create or replace function public.trg_notify_waitlisted_on_class_option_available()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_key text;
  v_slot record;
  v_old_available boolean := false;
  v_new_available boolean := false;
begin
  v_new_available := (
    coalesce(new.active, false) = true
    and coalesce(new.enrollment_open, false) = true
    and new.deleted_at is null
  );

  if tg_op = 'UPDATE' then
    v_old_available := (
      coalesce(old.active, false) = true
      and coalesce(old.enrollment_open, false) = true
      and old.deleted_at is null
    );
  end if;

  if tg_op = 'INSERT' and not v_new_available then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (v_old_available = false and v_new_available = true) then
    return new;
  end if;

  v_event_key := format(
    'class_option:%s:%s',
    coalesce(new.class_option_id, ''),
    coalesce(new.updated_at::text, new.created_at::text, now()::text)
  );

  for v_slot in
    select cs.batch_id
    from public.class_slots cs
    join public.batches b on b.batch_id = cs.batch_id
    where cs.class_option_id = new.class_option_id
      and cs.status = 'Active'
      and b.active = true
  loop
    perform public.queue_waitlisted_class_available_notifications(
      new.class_option_id,
      v_slot.batch_id,
      v_event_key
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_waitlisted_on_class_option_available on public.class_options;
create trigger trg_notify_waitlisted_on_class_option_available
after insert or update on public.class_options
for each row
execute function public.trg_notify_waitlisted_on_class_option_available();
