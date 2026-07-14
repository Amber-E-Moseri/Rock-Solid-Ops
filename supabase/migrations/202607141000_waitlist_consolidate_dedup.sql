-- Consolidate the two "class now available" waitlist notification producers onto
-- ONE canonical template and ONE timestamp-free dedupe-key namespace (Option C,
-- approved at the 2026-07-14 Phase A gate; see docs/migration-log.md).
--
-- Before this migration:
--   * DB trigger path (202605191920) sent template 'classes_now_available' with a
--     dedupe key that embedded a timestamp-derived event_key -> fresh key every
--     firing, so "dedupe" never deduped across events.
--   * Cron path (waitlist-processor, every 15 min per 202605180002) sent template
--     'class_now_available' (singular) under a second key namespace, with a CTA
--     pointing at a bare Moodle login the recipient cannot use (no Moodle account
--     exists before ASSIGNED) -- a dead-end email.
--   Overlapping populations received duplicate, inconsistent emails.
--
-- After this migration:
--   * Canonical template: 'classes_now_available' (subject + body updated below).
--     Merge fields: first_name, class_day, class_time, teacher_name,
--     fellowship_code, selection_url, expires_days. No moodle_url / class_label
--     (email-sender renders unknown {{tags}} as silent empty strings; both
--     producers must supply every tag).
--   * Canonical dedupe key for ALL producers of this notification:
--       class_available:{applicant_id}:{batch_id}:{class_option_id}
--     (timestamp-free; insert-if-absent semantics -- never resurrect SENT rows).
--     The TypeScript side mirrors this byte-for-byte in
--     supabase/functions/waitlist-processor/dedupe.ts; format documented in
--     ai/statuses.md under the CLASS_AVAILABLE entry.
--   * 'class_now_available' is deactivated (kept, not deleted). email-sender
--     only loads active templates and hard-fails queue rows whose template is
--     missing (email-sender/index.ts resolveContent), so all in-flight rows
--     referencing the old key are re-pointed (or explicitly failed) below BEFORE
--     deactivation.
--
-- Additive + idempotent: IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout.

-- ---------------------------------------------------------------------------
-- 1. Safety: ensure the partial unique index on scheduled_notifications
--    (dedupe_key) exists. First created in 202605240300; recreated here
--    defensively for environments restored from partial baselines.
-- ---------------------------------------------------------------------------

create unique index if not exists scheduled_notifications_dedupe_key
  on public.scheduled_notifications(dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Canonical template: 'classes_now_available'.
--    >>> GATE-APPROVED MERGED BODY (2026-07-14 Phase A gate). This section is
--    >>> deliberately self-contained: if the operator reverses the body-merge
--    >>> decision, strip ONLY this statement (section 2); everything else in
--    >>> this migration is independent of it.
--    Body is based on the 202605201000 restyled version (purple #4C2A92 header,
--    72px logo, contact footer) plus the class-details block from the retired
--    'class_now_available' body, expiry copy parameterized as {{expires_days}}.
--    CTA: "Choose My Class Time" -> {{selection_url}}.
-- ---------------------------------------------------------------------------

insert into public.notification_templates (template_key, subject, body_html, active)
values (
  'classes_now_available',
  'Good news — a Foundation School class is now available for you!',
  $q$<div style="font-family:Arial,sans-serif;background:#f5f5f7;padding:24px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5ea"><div style="background:#4C2A92;padding:24px 32px;text-align:center;"><img src="https://rocksolidsuite.netlify.app/foundation/registration/canada_sr.png" alt="BLW Canada" style="height:72px;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" /><div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Rock Solid</div><div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;">Foundation School &middot; BLW Canada</div></div><div style="padding:24px;color:#1a1a1f"><p style="margin:0 0 14px">Hi {{first_name}},</p><p style="margin:0 0 14px">We have great news! A Foundation School class is now available for your fellowship and we&rsquo;d love for you to join us.</p><div style="border:1px solid #d4c5f9;background:#f5f3ff;color:#3b2470;border-radius:10px;padding:14px 16px;margin:0 0 18px"><p style="margin:0 0 8px;font-weight:700">Class Details</p><p style="margin:0 0 4px">Day &amp; Time: {{class_day}} at {{class_time}}</p><p style="margin:0 0 4px">Teacher: {{teacher_name}}</p><p style="margin:0">Fellowship: {{fellowship_code}}</p></div><p style="margin:0 0 18px">To secure your spot, please choose your preferred class time using the button below. Your selection link is personal to you and expires in {{expires_days}} days.</p><p style="margin:0 0 22px"><a href="{{selection_url}}" style="display:inline-block;background:#4C2A92;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Choose My Class Time</a></p><p style="margin:0 0 14px">Once you select a class, you will receive a confirmation email with your Moodle login details. No re-registration needed.</p></div><div style="background:#f5f5f5;padding:14px 24px;text-align:center;font-size:12px;color:#888;">Rock Solid Foundation School &middot; BLW Canada<br />Questions? <a href="mailto:info@lwcanada.org" style="color:#888;">info@lwcanada.org</a></div></div></div>$q$,
  true
)
on conflict (template_key)
do update set
  subject = excluded.subject,
  body_html = excluded.body_html,
  active = excluded.active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Recreate queue_waitlisted_class_available_notifications() with the
--    canonical timestamp-free dedupe key.
--    Signature unchanged (the 202605191920 triggers still pass p_event_key);
--    the event_key now goes only into notification_events payload and audit
--    metadata -- it is no longer part of the dedupe key, so an applicant is
--    notified at most once per (applicant, batch, class_option) regardless of
--    how many availability events fire.
--    Suppressed duplicates are now audited (WAITLIST_DUPLICATE_SUPPRESSED).
--    Insert-if-absent semantics preserved: an existing row (any status,
--    including SENT) is never touched.
-- ---------------------------------------------------------------------------

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
as $fn$
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
      a.full_name,
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
    -- Dedupe key format: see ai/statuses.md CLASS_AVAILABLE entry. Must be
    -- identical in both trigger and cron. No timestamp component.
    -- (Cron mirror: buildClassAvailableDedupeKey() in
    -- supabase/functions/waitlist-processor/dedupe.ts.)
    v_dedupe_key := format(
      'class_available:%s:%s:%s',
      v_app.id,
      p_batch_id,
      p_class_option_id
    );

    if exists (
      select 1
      from public.scheduled_notifications sn
      where sn.dedupe_key = v_dedupe_key
    ) then
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
        'WAITLIST_DUPLICATE_SUPPRESSED',
        'applicant',
        v_app.id::text,
        'SUCCESS',
        jsonb_build_object(
          'class_option_id', p_class_option_id,
          'batch_id', p_batch_id,
          'dedupe_key', v_dedupe_key,
          'source', 'trigger',
          'event_key', p_event_key
        ),
        now()
      );
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Token minted only after the dedupe check passes, so suppressed
    -- duplicates never create orphan selection tokens.
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
        'dedupe_key', v_dedupe_key,
        'event_key', p_event_key
      ),
      now()
    );

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Re-point in-flight rows that still reference 'class_now_available',
--    BEFORE deactivating the template. email-sender only loads active
--    templates and marks rows Failed when no template resolves, so leaving
--    these rows untouched would hard-fail them.
--
--    4a. scheduled_notifications PENDING rows: these carry applicant_id and a
--        payload with batch_id / fellowship_code / class details. We mint a
--        selection token, add selection_url + expires_days, and move the row
--        to the canonical template + dedupe key. If a canonical-key row
--        already exists for the same (applicant, batch, class_option), the
--        old row is a duplicate by definition and is failed explicitly
--        instead of sent.
--    (Population is expected to be ~zero: the cron flips availability_status
--    at queue time and rows drain within minutes; this block is defensive.)
-- ---------------------------------------------------------------------------

do $mig$
declare
  v_row record;
  v_batch_id text;
  v_fellowship text;
  v_class_option text;
  v_new_key text;
  v_token text;
begin
  for v_row in
    select sn.id, sn.applicant_id, sn.payload
    from public.scheduled_notifications sn
    where sn.template_key = 'class_now_available'
      and sn.status = 'PENDING'
    for update
  loop
    v_batch_id := coalesce(v_row.payload->>'batch_id', '');
    v_fellowship := coalesce(nullif(trim(v_row.payload->>'fellowship_code'), ''), '');
    v_class_option := coalesce(v_row.payload->>'class_option_id', '');

    if v_row.applicant_id is null or v_batch_id = '' or v_fellowship = '' or v_class_option = '' then
      update public.scheduled_notifications
      set status = 'FAILED',
          error_message = 'DEDUP_CONSOLIDATION_202607141000: cannot re-point to classes_now_available (missing applicant/batch/fellowship/class context)'
      where id = v_row.id;
      continue;
    end if;

    -- Canonical key format: see ai/statuses.md CLASS_AVAILABLE entry.
    v_new_key := format(
      'class_available:%s:%s:%s',
      v_row.applicant_id,
      v_batch_id,
      v_class_option
    );

    if exists (
      select 1 from public.scheduled_notifications sn2
      where sn2.dedupe_key = v_new_key
    ) then
      update public.scheduled_notifications
      set status = 'FAILED',
          error_message = 'DEDUP_CONSOLIDATION_202607141000: superseded by existing ' || v_new_key
      where id = v_row.id;
      continue;
    end if;

    insert into public.class_selection_tokens (applicant_id, batch_id, fellowship_code)
    values (v_row.applicant_id, v_batch_id, v_fellowship)
    returning token into v_token;

    update public.scheduled_notifications
    set template_key = 'classes_now_available',
        dedupe_key = v_new_key,
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'selection_url', 'https://rocksolidsuite.netlify.app/foundation/registration/class-selection.html?token=' || v_token,
          'expires_days', 7
        )
    where id = v_row.id;
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
--    4b. email_queue Pending rows (already staged by notification-batch-
--        processor but not yet sent). email_queue has no applicant_id column;
--        recover the applicant via (email, batch_id) from the payload. A row
--        we cannot unambiguously map is failed explicitly rather than left to
--        hard-fail with a confusing "No template found" error at send time.
-- ---------------------------------------------------------------------------

do $mig2$
declare
  v_row record;
  v_email text;
  v_batch_id text;
  v_fellowship text;
  v_applicant_id uuid;
  v_match_count integer;
  v_token text;
begin
  for v_row in
    select eq.id, eq.recipient_email, eq.payload
    from public.email_queue eq
    where eq.template_key = 'class_now_available'
      and eq.status = 'Pending'
    for update
  loop
    v_email := lower(trim(coalesce(nullif(v_row.payload->>'email', ''), v_row.recipient_email, '')));
    v_batch_id := coalesce(v_row.payload->>'batch_id', '');
    v_fellowship := coalesce(nullif(trim(v_row.payload->>'fellowship_code'), ''), '');

    select count(*), min(a.id::text)
    into v_match_count, v_applicant_id
    from public.applicants a
    where lower(trim(coalesce(a.email, ''))) = v_email
      and a.batch_id = v_batch_id;

    if v_email = '' or v_batch_id = '' or v_fellowship = '' or v_match_count <> 1 then
      update public.email_queue
      set status = 'Failed',
          error_message = 'DEDUP_CONSOLIDATION_202607141000: template class_now_available retired; could not re-point (ambiguous or missing applicant context)'
      where id = v_row.id;
      continue;
    end if;

    insert into public.class_selection_tokens (applicant_id, batch_id, fellowship_code)
    values (v_applicant_id, v_batch_id, v_fellowship)
    returning token into v_token;

    update public.email_queue
    set template_key = 'classes_now_available',
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'selection_url', 'https://rocksolidsuite.netlify.app/foundation/registration/class-selection.html?token=' || v_token,
          'expires_days', 7
        )
    where id = v_row.id;
  end loop;
end
$mig2$;

-- ---------------------------------------------------------------------------
-- 5. Deactivate (do NOT delete) the retired template. Kept for history and so
--    any already-SENT rows referencing it remain interpretable.
-- ---------------------------------------------------------------------------

update public.notification_templates
set active = false,
    updated_at = now()
where template_key = 'class_now_available';
