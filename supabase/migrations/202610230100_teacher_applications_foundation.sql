-- Teacher application foundation (additive, forward-only).
--
-- Applications live in their own table. They never write to public.teachers and grant no
-- privileges. Approval and account linking are NOT implemented here: they must reuse the
-- hardened teacher-link contract (public.link_teacher_to_auth_user, 202605191330) once that
-- integration is resolved. Until then the review function refuses APPROVE.
--
-- Identity: the applicant's email is read from auth.users inside the function, never from
-- the client. Submission requires a confirmed email (email_confirmed_at).
-- Email: outbound mail is queued in public.email_queue (existing outbox) with a dedupe key.
-- Existing policies (including allow public teacher self registration) are untouched.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Table
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.teacher_applications (
  id                  uuid        primary key default gen_random_uuid(),
  applicant_user_id   uuid        not null references auth.users(id) on delete restrict,
  email               text        not null,
  email_normalized    text        not null,
  full_name           text        not null,
  phone               text,
  fellowship_code     text        not null references public.fellowship_map(fellowship_code),
  notes               text,
  status              text        not null default 'SUBMITTED',
  version             integer     not null default 1,
  review_message      text,       -- applicant-visible request for information (REQUEST_INFO)
  rejection_reason    text,       -- internal only (REJECT); never shown to the applicant
  email_verified_at   timestamptz not null,
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         uuid        references auth.users(id) on delete set null,
  approved_teacher_id text        references public.teachers(teacher_id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint teacher_applications_status_chk
    check (status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  constraint teacher_applications_email_normalized_chk
    check (email_normalized = lower(btrim(email_normalized)) and email_normalized <> ''),
  constraint teacher_applications_full_name_chk
    check (char_length(btrim(full_name)) between 2 and 120),
  constraint teacher_applications_phone_chk
    check (phone is null or char_length(phone) <= 32),
  constraint teacher_applications_notes_chk
    check (notes is null or char_length(notes) <= 1000),
  constraint teacher_applications_version_chk
    check (version >= 1),
  constraint teacher_applications_reviewed_chk
    check (status in ('SUBMITTED', 'INFO_REQUESTED', 'WITHDRAWN')
           or (reviewed_at is not null and reviewed_by is not null)),
  constraint teacher_applications_approved_chk
    check (status <> 'APPROVED' or approved_teacher_id is not null)
);

comment on table public.teacher_applications is
  'Teacher applications from verified Auth accounts. Separate from the active teachers roster; approval and linking are governed by the teacher-link contract.';

-- At most one open application per normalized email, and per applicant.
create unique index if not exists uq_teacher_applications_open_email
  on public.teacher_applications (email_normalized)
  where status in ('SUBMITTED', 'INFO_REQUESTED');

create unique index if not exists uq_teacher_applications_open_applicant
  on public.teacher_applications (applicant_user_id)
  where status in ('SUBMITTED', 'INFO_REQUESTED');

create index if not exists idx_teacher_applications_status_submitted
  on public.teacher_applications (status, submitted_at);

-- Outbox dedupe: a retried enqueue for the same application event is a no-op.
create unique index if not exists uq_email_queue_teacher_application_dedupe
  on public.email_queue ((metadata ->> 'dedupe_key'))
  where metadata ->> 'dedupe_key' is not null;

create or replace function public.teacher_applications_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_teacher_applications_updated_at on public.teacher_applications;
create trigger trg_teacher_applications_updated_at
  before update on public.teacher_applications
  for each row execute function public.teacher_applications_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Lifecycle contract (single source for RPCs and tests)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.teacher_application_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from (values
      ('SUBMITTED',       'INFO_REQUESTED'),
      ('INFO_REQUESTED',  'SUBMITTED'),
      ('SUBMITTED',       'REJECTED'),
      ('INFO_REQUESTED',  'REJECTED'),
      ('SUBMITTED',       'WITHDRAWN'),
      ('INFO_REQUESTED',  'WITHDRAWN'),
      -- Reserved for the teacher-link contract. Not reachable through review_teacher_application.
      ('SUBMITTED',       'APPROVED'),
      ('INFO_REQUESTED',  'APPROVED')
    ) as t(from_status, to_status)
    where t.from_status = p_from
      and t.to_status = p_to
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Authorization helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- Review authority: active admin or superadmin only (canonical role resolver, is_active enforced).
-- Deliberately narrower than is_admin(), which also admits pastor, principal and others.
create or replace function public.teacher_application_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_profile_role() in ('admin', 'superadmin'), false);
$$;

-- Outbox helper: enqueue once per dedupe key. Never called with client-supplied recipients.
create or replace function public.enqueue_teacher_application_email(
  p_application_id uuid,
  p_template_key   text,
  p_recipient_email text,
  p_recipient_name text,
  p_dedupe_key     text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.email_queue (template_key, recipient_email, recipient_name, status, payload, metadata)
  values (
    p_template_key,
    p_recipient_email,
    p_recipient_name,
    'Pending',
    jsonb_build_object('first_name', split_part(coalesce(p_recipient_name, ''), ' ', 1)),
    jsonb_build_object('dedupe_key', p_dedupe_key, 'source', 'teacher_application', 'application_id', p_application_id)
  )
  on conflict ((metadata ->> 'dedupe_key')) where metadata ->> 'dedupe_key' is not null
  do nothing;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Applicant submission (idempotent per applicant)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_teacher_application(
  p_full_name      text,
  p_phone          text default null,
  p_fellowship_code text default null,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_email       text;
  v_verified_at timestamptz;
  v_name        text := btrim(coalesce(p_full_name, ''));
  v_phone       text := nullif(btrim(coalesce(p_phone, '')), '');
  v_fellowship  text := upper(btrim(coalesce(p_fellowship_code, '')));
  v_notes       text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id          uuid;
  v_status      text;
  v_version     integer;
  v_outcome     text;
  v_prior_status text;
  v_changed     boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in to apply';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_verified_at
  from auth.users u
  where u.id = v_uid;

  if coalesce(v_email, '') = '' then
    raise exception 'EMAIL_REQUIRED: the account has no email address';
  end if;
  if v_verified_at is null then
    raise exception 'EMAIL_NOT_VERIFIED: confirm your email address before applying';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_FULL_NAME: enter 2 to 120 characters';
  end if;
  if v_phone is not null and char_length(v_phone) > 32 then
    raise exception 'INVALID_PHONE: 32 characters maximum';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'INVALID_NOTES: 1000 characters maximum';
  end if;
  if v_fellowship = '' or not exists (
    select 1 from public.fellowship_map f
    where f.fellowship_code = v_fellowship and f.active
  ) then
    raise exception 'INVALID_FELLOWSHIP: choose an active fellowship';
  end if;

  -- Existing roster or prior decisions for this address. Messages stay generic.
  if exists (
    select 1 from public.teachers t
    where lower(btrim(t.email)) = v_email
      and t.status = 'ACTIVE'
      and t.deleted_at is null
  ) then
    raise exception 'ALREADY_TEACHER: this address already has an active teacher account';
  end if;

  if exists (
    select 1 from public.teacher_applications a
    where a.email_normalized = v_email and a.status = 'APPROVED'
  ) then
    raise exception 'ALREADY_APPROVED: this application has already been approved';
  end if;

  if exists (
    select 1 from public.teacher_applications a
    where a.email_normalized = v_email and a.status = 'REJECTED'
  ) then
    raise exception 'APPLICATION_NOT_ALLOWED: a previous application was not approved. Contact an administrator';
  end if;

  -- Idempotent update of the applicant's own open application. A retry with identical content
  -- returns UNCHANGED: no version bump, no audit row, no second email.
  select a.id, a.status, a.version,
         (a.full_name, a.phone, a.fellowship_code, a.notes)
           is distinct from (v_name, v_phone, v_fellowship, v_notes)
    into v_id, v_prior_status, v_version, v_changed
  from public.teacher_applications a
  where a.applicant_user_id = v_uid
    and a.status in ('SUBMITTED', 'INFO_REQUESTED')
  for update;

  if found and v_prior_status = 'SUBMITTED' and not v_changed then
    return jsonb_build_object('ok', true, 'application_id', v_id, 'status', v_prior_status,
                              'version', v_version, 'outcome', 'UNCHANGED');
  end if;

  if found then
    update public.teacher_applications a
       set full_name = v_name,
           phone = v_phone,
           fellowship_code = v_fellowship,
           notes = v_notes,
           status = 'SUBMITTED',
           version = a.version + 1,
           email_verified_at = v_verified_at,
           submitted_at = case when v_prior_status = 'INFO_REQUESTED' then now() else a.submitted_at end
     where a.id = v_id
    returning a.status, a.version into v_status, v_version;
    v_outcome := case when v_prior_status = 'INFO_REQUESTED' then 'RESUBMITTED' else 'UPDATED' end;
  else
    begin
      insert into public.teacher_applications (
        applicant_user_id, email, email_normalized, full_name, phone,
        fellowship_code, notes, status, email_verified_at
      )
      values (
        v_uid, v_email, v_email, v_name, v_phone,
        v_fellowship, v_notes, 'SUBMITTED', v_verified_at
      )
      returning id, status, version into v_id, v_status, v_version;
      v_outcome := 'SUBMITTED';
    exception when unique_violation then
      -- A concurrent call from the same applicant wins the race: return that row unchanged.
      select a.id, a.status, a.version
        into v_id, v_status, v_version
      from public.teacher_applications a
      where a.applicant_user_id = v_uid
        and a.status in ('SUBMITTED', 'INFO_REQUESTED');

      if not found then
        raise exception 'DUPLICATE_OPEN_APPLICATION: an application is already open for this address';
      end if;
      return jsonb_build_object('ok', true, 'application_id', v_id, 'status', v_status,
                                'version', v_version, 'outcome', 'UNCHANGED');
    end;
  end if;

  -- The actor id travels in details. Production audit_logs lacks an actor_id column (drift inventory, row 7).
  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(), v_email,
    'TEACHER_APPLICATION_' || v_outcome,
    'teacher_application', v_id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_uid, 'application_id', v_id, 'version', v_version, 'fellowship_code', v_fellowship)
  );

  -- Confirmation mail only for a first submission or a resubmission, never for a plain edit.
  if v_outcome in ('SUBMITTED', 'RESUBMITTED') then
    perform public.enqueue_teacher_application_email(
      v_id,
      'teacher_application_received',
      v_email,
      v_name,
      'teacher_application_received:' || v_id::text || ':' || v_version::text
    );
  end if;

  return jsonb_build_object('ok', true, 'application_id', v_id, 'status', v_status,
                            'version', v_version, 'outcome', v_outcome);
end;
$$;

-- Applicant withdrawal. Only the owning applicant can see or change their application.
create or replace function public.withdraw_teacher_application(
  p_application_id   uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  a     public.teacher_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in to withdraw';
  end if;

  select * into a
  from public.teacher_applications
  where id = p_application_id
    and applicant_user_id = v_uid
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if a.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: the application changed. Reload and try again';
  end if;
  if not public.teacher_application_transition_allowed(a.status, 'WITHDRAWN') then
    raise exception 'INVALID_TRANSITION: % to WITHDRAWN', a.status;
  end if;

  update public.teacher_applications
     set status = 'WITHDRAWN',
         version = a.version + 1
   where id = a.id;

  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(), (select u.email from auth.users u where u.id = v_uid),
    'TEACHER_APPLICATION_WITHDRAWN', 'teacher_application', a.id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_uid, 'application_id', a.id, 'from_status', a.status, 'version', a.version + 1)
  );

  return jsonb_build_object('ok', true, 'application_id', a.id, 'status', 'WITHDRAWN', 'version', a.version + 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Administrator review: request information or reject (APPROVE is reserved)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.review_teacher_application(
  p_application_id uuid,
  p_action         text,
  p_expected_version integer,
  p_message        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  a       public.teacher_applications%rowtype;
  v_to    text;
  v_msg   text := nullif(btrim(coalesce(p_message, '')), '');
  v_dedupe text;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.teacher_application_reviewer() then
    raise exception 'FORBIDDEN: administrator role required';
  end if;

  if p_action = 'APPROVE' then
    raise exception 'APPROVAL_NOT_AVAILABLE: approval is served by the teacher-link contract';
  end if;

  v_to := case p_action
            when 'REQUEST_INFO' then 'INFO_REQUESTED'
            when 'REJECT'       then 'REJECTED'
            else null
          end;
  if v_to is null then
    raise exception 'INVALID_ACTION';
  end if;
  if v_msg is null then
    raise exception 'MESSAGE_REQUIRED: a message or reason is required';
  end if;
  if char_length(v_msg) > 1000 then
    raise exception 'MESSAGE_TOO_LONG: 1000 characters maximum';
  end if;

  select * into a
  from public.teacher_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if a.applicant_user_id = v_actor then
    raise exception 'FORBIDDEN: reviewers cannot decide their own application';
  end if;
  if a.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: the application changed. Reload and try again';
  end if;
  if not public.teacher_application_transition_allowed(a.status, v_to) then
    raise exception 'INVALID_TRANSITION: % to %', a.status, v_to;
  end if;

  update public.teacher_applications
     set status = v_to,
         version = a.version + 1,
         reviewed_at = now(),
         reviewed_by = v_actor,
         review_message = case when v_to = 'INFO_REQUESTED' then v_msg else review_message end,
         rejection_reason = case when v_to = 'REJECTED' then v_msg else rejection_reason end
   where id = a.id;

  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(),
    (select u.email from auth.users u where u.id = v_actor),
    'TEACHER_APPLICATION_' || v_to,
    'teacher_application', a.id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_actor, 'application_id', a.id, 'from_status', a.status, 'to_status', v_to,
                       'version', a.version + 1, 'has_message', true)
  );

  v_dedupe := 'teacher_application_' || lower(v_to) || ':' || a.id::text || ':' || (a.version + 1)::text;
  if v_to = 'INFO_REQUESTED' then
    perform public.enqueue_teacher_application_email(a.id, 'teacher_application_info_requested',
      a.email, a.full_name, v_dedupe);
  else
    perform public.enqueue_teacher_application_email(a.id, 'teacher_application_rejected',
      a.email, a.full_name, v_dedupe);
  end if;

  return jsonb_build_object('ok', true, 'application_id', a.id, 'status', v_to, 'version', a.version + 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Privileges and RLS (deny by default; anon has nothing)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.teacher_applications enable row level security;

-- Application roles have no direct access to the base table. RLS filters rows but cannot hide
-- columns, and rejection_reason and reviewed_by must never reach the applicant. Reads therefore go
-- through two views whose WHERE clauses are the authorization boundary:
--   teacher_applications_applicant  own rows only, applicant-safe columns
--   teacher_applications_review     rows only for an active admin or superadmin
revoke all on public.teacher_applications from public, anon, authenticated;
grant select, insert, update, delete on public.teacher_applications to service_role;

create or replace view public.teacher_applications_applicant
with (security_barrier = true) as
select id, status, version, full_name, phone, fellowship_code, notes,
       review_message, submitted_at, updated_at
from public.teacher_applications
where applicant_user_id = auth.uid();

create or replace view public.teacher_applications_review
with (security_barrier = true) as
select *
from public.teacher_applications
where public.teacher_application_reviewer();

revoke all on public.teacher_applications_applicant from public, anon;
grant select on public.teacher_applications_applicant to authenticated;
revoke all on public.teacher_applications_review from public, anon;
grant select on public.teacher_applications_review to authenticated;

-- No table policies. Writes happen only through the functions below, and reads only through the views.

revoke all on function public.teacher_application_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function public.teacher_application_reviewer() from public, anon;
revoke all on function public.teacher_applications_set_updated_at() from public, anon, authenticated;
grant execute on function public.teacher_application_reviewer() to authenticated;
revoke all on function public.enqueue_teacher_application_email(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.submit_teacher_application(text, text, text, text) from public, anon;
grant execute on function public.submit_teacher_application(text, text, text, text) to authenticated;
revoke all on function public.review_teacher_application(uuid, text, integer, text) from public, anon;
grant execute on function public.review_teacher_application(uuid, text, integer, text) to authenticated;
revoke all on function public.withdraw_teacher_application(uuid, integer) from public, anon;
grant execute on function public.withdraw_teacher_application(uuid, integer) to authenticated;

commit;
