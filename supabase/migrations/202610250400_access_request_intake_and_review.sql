-- Request Access, Phase 3: general access-request intake and review.
-- Forward-only and additive. Date: 2026-10-26.
--
-- Scope of this migration:
--   * Organization options for the public form (read-only, active rows only).
--   * access_requests for pastor, subgroup_admin and other requests. Teacher requests stay in
--     teacher_applications (Phase 2) and are not duplicated here.
--   * Submission, applicant withdrawal and scoped review RPCs. Authority is resolved from auth.uid()
--     and stored assignments, never from client input or user_metadata.
--   * Applicant and reviewer views. Reviewers see only the rows they may decide.
--   * The teacher applicant view gains group_id and subgroup_id so a teacher can see what they applied for.
--
-- Not changed: profiles.role values, role constraints, elevated-role triggers, staff_scope_assignments,
-- teachers, account creation, role elevation, activation, provisioning, email delivery, the retry-worker,
-- Moodle and Nexus. Approval records APPROVAL_PENDING_PROVISIONING and nothing else.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Organization options for the public form (active rows only, no applicant data)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.access_request_org_options()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('group_id', g.group_id, 'subgroups', g.subgroups)
           order by g.group_id
         ), '[]'::jsonb)
  from (
    select s.group_id,
           jsonb_agg(
             jsonb_build_object('subgroup_id', s.subgroup_id, 'fellowships', s.fellowships)
             order by s.subgroup_id
           ) as subgroups
    from (
      select o.group_id,
             o.subgroup_id,
             jsonb_agg(
               jsonb_build_object('code', f.fellowship_code, 'campus', f.campus_name)
               order by f.fellowship_code
             ) as fellowships
      from public.org_subgroups o
      join public.fellowship_map f
        on f.group_id = o.group_id and f.subgroup_id = o.subgroup_id and f.active
      where o.active
      group by o.group_id, o.subgroup_id
    ) s
    group by s.group_id
  ) g;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Lifecycle contract for general access requests
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.access_request_transition_allowed(p_from text, p_to text)
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
      ('SUBMITTED',       'APPROVAL_PENDING_PROVISIONING'),
      ('INFO_REQUESTED',  'APPROVAL_PENDING_PROVISIONING'),
      ('SUBMITTED',       'WITHDRAWN'),
      ('INFO_REQUESTED',  'WITHDRAWN')
    ) as t(from_status, to_status)
    where t.from_status = p_from
      and t.to_status = p_to
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.access_requests (
  id                uuid        primary key default gen_random_uuid(),
  applicant_user_id uuid        not null references auth.users (id) on delete restrict,
  email             text        not null,
  email_normalized  text        not null,
  full_name         text        not null,
  phone             text,
  fellowship_code   text        not null references public.fellowship_map (fellowship_code),
  group_id          text        not null,
  subgroup_id       text        not null,
  requested_role    text        not null,
  note              text,
  status            text        not null default 'SUBMITTED',
  version           integer     not null default 1,
  email_verified_at timestamptz not null,
  review_message    text,        -- applicant-visible request for information
  reviewer_note     text,        -- internal; never returned to the applicant
  reviewed_by       uuid        references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  submitted_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint access_requests_role_chk
    check (requested_role in ('pastor', 'subgroup_admin', 'other')),
  constraint access_requests_status_chk
    check (status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING', 'REJECTED', 'WITHDRAWN')),
  constraint access_requests_email_normalized_chk
    check (email_normalized = lower(btrim(email_normalized)) and email_normalized <> ''),
  constraint access_requests_full_name_chk
    check (char_length(btrim(full_name)) between 2 and 120),
  constraint access_requests_phone_chk
    check (phone is null or char_length(phone) <= 32),
  constraint access_requests_note_chk
    check (note is null or char_length(note) <= 1000),
  constraint access_requests_version_chk
    check (version >= 1),
  -- The subgroup must belong to its group. The database enforces it, not the caller.
  constraint access_requests_group_subgroup_fk
    foreign key (subgroup_id, group_id)
    references public.org_subgroups (subgroup_id, group_id)
    on update restrict on delete restrict,
  constraint access_requests_reviewed_chk
    check (status in ('SUBMITTED', 'INFO_REQUESTED', 'WITHDRAWN')
           or (reviewed_at is not null and reviewed_by is not null))
);

comment on table public.access_requests is
  'General staff access requests (pastor, subgroup_admin, other). Teacher requests live in teacher_applications. Filing grants nothing; approval records a pending state only.';

create unique index if not exists access_requests_open_applicant_uq
  on public.access_requests (applicant_user_id)
  where status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING');

create unique index if not exists access_requests_open_email_uq
  on public.access_requests (email_normalized)
  where status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING');

create index if not exists access_requests_status_submitted_idx
  on public.access_requests (status, submitted_at);

create table if not exists public.access_request_events (
  id          bigserial   primary key,
  request_id  uuid        not null references public.access_requests (id) on delete cascade,
  actor_id    uuid        not null references auth.users (id) on delete restrict,
  action      text        not null,
  from_status text,
  to_status   text        not null,
  version     integer     not null,
  note        text,       -- reviewer-only; read through access_request_events_review
  created_at  timestamptz not null default now(),
  constraint access_request_events_action_chk
    check (action in ('SUBMITTED', 'RESUBMITTED', 'UPDATED', 'WITHDRAWN', 'REQUEST_INFO', 'REJECT', 'APPROVE'))
);

comment on table public.access_request_events is
  'Append-only decision and submission history for access_requests. No client role can write or read it directly.';

create index if not exists access_request_events_request_idx
  on public.access_request_events (request_id, created_at);

create or replace function public.access_requests_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_access_requests_updated_at on public.access_requests;
create trigger trg_access_requests_updated_at
  before update on public.access_requests
  for each row execute function public.access_requests_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Decision authority (resolved from auth.uid() only)
-- ─────────────────────────────────────────────────────────────────────────────

-- Pastor and subgroup_admin requests: superadmin and regional_secretary decide them organization-wide.
-- A pastor with an active assignment for the request's subgroup may decide subgroup_admin requests.
-- Pastor requests and other requests are organization-wide only. No group-wide inference.
create or replace function public.access_request_can_decide(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  r       record;
  v_email text;
begin
  if v_actor is null or p_request_id is null then
    return false;
  end if;

  select a.applicant_user_id, a.email_normalized, a.group_id, a.subgroup_id, a.requested_role
    into r
  from public.access_requests a
  where a.id = p_request_id;
  if not found then
    return false;
  end if;

  -- No self-decision, by user id or by normalized email.
  if r.applicant_user_id = v_actor then
    return false;
  end if;
  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_actor;
  if v_email is not null and v_email = r.email_normalized then
    return false;
  end if;

  if public.staff_scope_org_wide(v_actor) then
    return true;
  end if;

  if r.requested_role = 'subgroup_admin'
     and exists (
       select 1 from public.profiles p
       where p.user_id = v_actor and p.is_active and p.role = 'pastor'
     )
     and public.staff_scope_covers(v_actor, r.group_id, r.subgroup_id) then
    return true;
  end if;

  return false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Submission (applicant, verified email, one open request per applicant and address)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_access_request(
  p_requested_role text,
  p_full_name      text,
  p_phone          text,
  p_fellowship_code text,
  p_group_id       text,
  p_subgroup_id    text,
  p_note           text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_email        text;
  v_verified_at  timestamptz;
  v_role         text := lower(btrim(coalesce(p_requested_role, '')));
  v_name         text := btrim(coalesce(p_full_name, ''));
  v_phone        text := nullif(btrim(coalesce(p_phone, '')), '');
  v_fellowship   text := upper(btrim(coalesce(p_fellowship_code, '')));
  v_group        text := btrim(coalesce(p_group_id, ''));
  v_subgroup     text := btrim(coalesce(p_subgroup_id, ''));
  v_note         text := nullif(btrim(coalesce(p_note, '')), '');
  v_profile_role   text;
  v_profile_active boolean;
  v_open_id      uuid;
  v_prior        text;
  v_prior_version integer;
  v_prior_role   text;
  v_id           uuid;
  v_status       text;
  v_version      integer;
  v_outcome      text;
  v_changed      boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in to request access';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_verified_at
  from auth.users u
  where u.id = v_uid;
  if coalesce(v_email, '') = '' then
    raise exception 'EMAIL_REQUIRED: the account has no email address';
  end if;
  if v_verified_at is null then
    raise exception 'EMAIL_NOT_VERIFIED: confirm your email address before requesting access';
  end if;

  if v_role = 'teacher' then
    raise exception 'USE_TEACHER_APPLICATION: teacher requests use the teacher application';
  end if;
  if v_role not in ('pastor', 'subgroup_admin', 'other') then
    raise exception 'INVALID_ROLE: choose a requested role';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_FULL_NAME: enter 2 to 120 characters';
  end if;
  if v_phone is not null and char_length(v_phone) > 32 then
    raise exception 'INVALID_PHONE: 32 characters maximum';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'INVALID_NOTE: 1000 characters maximum';
  end if;

  -- Group, subgroup and fellowship must agree with each other and with the authoritative map.
  if v_group = '' or v_subgroup = '' then
    raise exception 'INVALID_SCOPE: group and subgroup are required';
  end if;
  if not exists (
    select 1 from public.fellowship_map f where f.fellowship_code = v_fellowship and f.active
  ) then
    raise exception 'INVALID_FELLOWSHIP: choose an active fellowship';
  end if;
  if not exists (
    select 1 from public.fellowship_map f
    where f.fellowship_code = v_fellowship and f.active
      and f.group_id = v_group and f.subgroup_id = v_subgroup
  ) then
    raise exception 'INVALID_SCOPE: the fellowship does not belong to the selected group and subgroup';
  end if;
  if not exists (
    select 1 from public.org_subgroups o
    where o.subgroup_id = v_subgroup and o.group_id = v_group and o.active
  ) then
    raise exception 'INVALID_SCOPE: the subgroup is not active under the selected group';
  end if;

  -- Accounts that already hold staff access do not file access requests.
  select p.role, p.is_active into v_profile_role, v_profile_active
  from public.profiles p
  where p.user_id = v_uid;
  if found then
    if not coalesce(v_profile_active, false) then
      raise exception 'ACCOUNT_INACTIVE: this account cannot file a request';
    end if;
    if v_profile_role not in ('pending', 'teacher') then
      raise exception 'ALREADY_STAFF: this account already holds a staff role';
    end if;
  end if;

  if exists (
    select 1 from public.teacher_applications t
    where t.email_normalized = v_email
      and t.status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING')
  ) then
    raise exception 'OPEN_TEACHER_APPLICATION: a teacher application is already open for this address';
  end if;

  -- A request owned by someone else for the same address is never edited here.
  if exists (
    select 1 from public.access_requests a
    where a.email_normalized = v_email
      and a.applicant_user_id <> v_uid
      and a.status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING')
  ) then
    raise exception 'DUPLICATE_OPEN_REQUEST: an open request already exists for this address';
  end if;

  if exists (
    select 1 from public.access_requests a
    where a.email_normalized = v_email and a.status = 'APPROVAL_PENDING_PROVISIONING'
  ) then
    raise exception 'APPLICATION_PENDING: this request is awaiting provisioning review';
  end if;

  if exists (
    select 1 from public.access_requests a
    where a.email_normalized = v_email and a.status = 'REJECTED'
  ) then
    raise exception 'APPLICATION_NOT_ALLOWED: a previous request was not approved. Contact an administrator';
  end if;

  select a.id, a.status, a.version, a.requested_role,
         (a.full_name, a.phone, a.fellowship_code, a.note, a.group_id, a.subgroup_id)
           is distinct from (v_name, v_phone, v_fellowship, v_note, v_group, v_subgroup) as changed
    into v_open_id, v_prior, v_prior_version, v_prior_role, v_changed
  from public.access_requests a
  where a.applicant_user_id = v_uid
    and a.status in ('SUBMITTED', 'INFO_REQUESTED')
  for update;

  if v_open_id is not null then
    if v_prior_role <> v_role then
      raise exception 'EXISTING_REQUEST: withdraw your open request before requesting a different role';
    end if;
    if v_prior = 'SUBMITTED' and not v_changed then
      return jsonb_build_object('ok', true, 'request_id', v_open_id, 'outcome', 'UNCHANGED',
                                'status', v_prior, 'version', v_prior_version);
    end if;
    update public.access_requests a
       set full_name = v_name,
           phone = v_phone,
           fellowship_code = v_fellowship,
           group_id = v_group,
           subgroup_id = v_subgroup,
           note = v_note,
           status = 'SUBMITTED',
           version = a.version + 1,
           submitted_at = case when v_prior = 'INFO_REQUESTED' then now() else a.submitted_at end
     where a.applicant_user_id = v_uid
       and a.status in ('SUBMITTED', 'INFO_REQUESTED')
    returning a.id, a.status, a.version into v_id, v_status, v_version;
    v_outcome := case when v_prior = 'INFO_REQUESTED' then 'RESUBMITTED' else 'UPDATED' end;
  else
    begin
      insert into public.access_requests (
        applicant_user_id, email, email_normalized, full_name, phone, fellowship_code,
        group_id, subgroup_id, requested_role, note, status, email_verified_at
      )
      values (
        v_uid, v_email, v_email, v_name, v_phone, v_fellowship,
        v_group, v_subgroup, v_role, v_note, 'SUBMITTED', v_verified_at
      )
      returning id, status, version into v_id, v_status, v_version;
      v_outcome := 'SUBMITTED';
    exception when unique_violation then
      raise exception 'DUPLICATE_OPEN_REQUEST: an open request already exists for this address';
    end;
  end if;

  insert into public.access_request_events (request_id, actor_id, action, from_status, to_status, version)
  values (v_id, v_uid, v_outcome, v_prior, v_status, v_version);

  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(), v_email, 'ACCESS_REQUEST_' || v_outcome, 'access_request', v_id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_uid, 'request_id', v_id, 'requested_role', v_role,
                       'version', v_version, 'group_id', v_group, 'subgroup_id', v_subgroup)
  );

  return jsonb_build_object('ok', true, 'request_id', v_id, 'outcome', v_outcome,
                            'status', v_status, 'version', v_version);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Applicant withdrawal (owner only; another person's request is "not found")
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.withdraw_access_request(
  p_request_id       uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  a     public.access_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in to withdraw';
  end if;

  select * into a
  from public.access_requests r
  where r.id = p_request_id and r.applicant_user_id = v_uid
  for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if a.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: the request changed. Reload and try again';
  end if;
  if not public.access_request_transition_allowed(a.status, 'WITHDRAWN') then
    raise exception 'INVALID_TRANSITION: % to WITHDRAWN', a.status;
  end if;

  update public.access_requests r
     set status = 'WITHDRAWN', version = a.version + 1
   where r.id = a.id;

  insert into public.access_request_events (request_id, actor_id, action, from_status, to_status, version)
  values (a.id, v_uid, 'WITHDRAWN', a.status, 'WITHDRAWN', a.version + 1);

  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(), (select u.email from auth.users u where u.id = v_uid),
    'ACCESS_REQUEST_WITHDRAWN', 'access_request', a.id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_uid, 'request_id', a.id, 'from_status', a.status, 'version', a.version + 1)
  );

  return jsonb_build_object('ok', true, 'request_id', a.id, 'status', 'WITHDRAWN', 'version', a.version + 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Scoped review. REQUEST_INFO and REJECT are reviewer messages. APPROVE records a pending state only.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.decide_access_request(
  p_request_id       uuid,
  p_action           text,
  p_expected_version integer,
  p_message          text default null,
  p_note             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  a       public.access_requests%rowtype;
  v_to    text;
  v_msg   text := nullif(btrim(coalesce(p_message, '')), '');
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_action not in ('REQUEST_INFO', 'REJECT', 'APPROVE') then
    raise exception 'INVALID_ACTION';
  end if;

  -- Authority first, so an unauthorized caller learns nothing about whether a request id exists.
  if not public.access_request_can_decide(p_request_id) then
    if exists (
      select 1 from public.access_requests t
      where t.id = p_request_id
        and (t.applicant_user_id = v_actor
             or t.email_normalized = (select lower(btrim(u.email)) from auth.users u where u.id = v_actor))
    ) then
      raise exception 'FORBIDDEN: reviewers cannot decide their own request';
    end if;
    raise exception 'FORBIDDEN: not authorized to decide this request';
  end if;

  select * into a
  from public.access_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  v_to := case p_action
            when 'REQUEST_INFO' then 'INFO_REQUESTED'
            when 'REJECT' then 'REJECTED'
            else 'APPROVAL_PENDING_PROVISIONING'
          end;

  if p_action in ('REQUEST_INFO', 'REJECT') then
    if v_msg is null then
      raise exception 'MESSAGE_REQUIRED: a message or reason is required';
    end if;
    if char_length(v_msg) > 1000 then
      raise exception 'MESSAGE_TOO_LONG: 1000 characters maximum';
    end if;
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'NOTE_TOO_LONG: 1000 characters maximum';
  end if;

  if a.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT: the request changed. Reload and try again';
  end if;
  if not public.access_request_transition_allowed(a.status, v_to) then
    raise exception 'INVALID_TRANSITION: % to %', a.status, v_to;
  end if;

  update public.access_requests r
     set status = v_to,
         version = a.version + 1,
         reviewed_at = now(),
         reviewed_by = v_actor,
         review_message = case when p_action = 'REQUEST_INFO' then v_msg else r.review_message end,
         reviewer_note = case
                           when p_action = 'REJECT' then v_msg
                           when v_note is not null then v_note
                           else r.reviewer_note
                         end
   where r.id = a.id;

  insert into public.access_request_events (request_id, actor_id, action, from_status, to_status, version, note)
  values (a.id, v_actor, p_action, a.status, v_to, a.version + 1,
          case when p_action = 'REJECT' then v_msg else v_note end);

  -- Audit carries identifiers and states only. Free text stays in the reviewer-only tables.
  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(), (select u.email from auth.users u where u.id = v_actor),
    'ACCESS_REQUEST_' || v_to, 'access_request', a.id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_actor, 'request_id', a.id, 'from_status', a.status,
                       'to_status', v_to, 'version', a.version + 1, 'requested_role', a.requested_role)
  );

  -- No email, no role change, no scope assignment, no teacher row, no activation.
  -- APPROVAL_PENDING_PROVISIONING is held until provisioning is certified (P1 hold).
  return jsonb_build_object('ok', true, 'request_id', a.id, 'status', v_to, 'version', a.version + 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Views (least privilege: the views are the only read surface for these tables)
-- ─────────────────────────────────────────────────────────────────────────────

-- Applicant: own rows, applicant-safe columns only.
create or replace view public.access_requests_applicant
with (security_barrier = true) as
select id, requested_role, full_name, fellowship_code, group_id, subgroup_id, note,
       status, version, review_message, submitted_at, updated_at
from public.access_requests
where applicant_user_id = auth.uid();

-- Reviewer: rows the caller may decide, resolved per row from auth.uid().
create or replace view public.access_requests_review
with (security_barrier = true) as
select id, applicant_user_id, requested_role, full_name, email, phone, fellowship_code,
       group_id, subgroup_id, note, status, version, review_message, reviewer_note,
       reviewed_by, reviewed_at, submitted_at, updated_at
from public.access_requests
where public.access_request_can_decide(id);

-- Reviewer history: events for requests the caller may decide.
create or replace view public.access_request_events_review
with (security_barrier = true) as
select e.id, e.request_id, e.actor_id, e.action, e.from_status, e.to_status, e.version, e.note, e.created_at
from public.access_request_events e
where public.access_request_can_decide(e.request_id);

-- Teacher applicant view gains the group and subgroup the applicant chose. Own rows only, as before.
create or replace view public.teacher_applications_applicant
with (security_barrier = true) as
select id, status, version, full_name, phone, fellowship_code, notes,
       review_message, submitted_at, updated_at, group_id, subgroup_id
from public.teacher_applications
where applicant_user_id = auth.uid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) Privileges (deny by default)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.access_requests from public, anon, authenticated;
revoke all on public.access_request_events from public, anon, authenticated;

revoke all on public.access_requests_applicant from public, anon;
grant select on public.access_requests_applicant to authenticated;
revoke all on public.access_requests_review from public, anon;
grant select on public.access_requests_review to authenticated;
revoke all on public.access_request_events_review from public, anon;
grant select on public.access_request_events_review to authenticated;
revoke all on public.teacher_applications_applicant from public, anon;
grant select on public.teacher_applications_applicant to authenticated;

revoke all on function public.access_request_org_options() from public;
grant execute on function public.access_request_org_options() to anon, authenticated;

revoke all on function public.access_request_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function public.access_requests_set_updated_at() from public, anon, authenticated;

revoke all on function public.access_request_can_decide(uuid) from public, anon;
grant execute on function public.access_request_can_decide(uuid) to authenticated;

revoke all on function public.submit_access_request(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_access_request(text, text, text, text, text, text, text) to authenticated;

revoke all on function public.withdraw_access_request(uuid, integer) from public, anon;
grant execute on function public.withdraw_access_request(uuid, integer) to authenticated;

revoke all on function public.decide_access_request(uuid, text, integer, text, text) from public, anon;
grant execute on function public.decide_access_request(uuid, text, integer, text, text) to authenticated;

commit;
