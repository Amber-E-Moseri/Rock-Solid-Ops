-- Request Access, Phase 2: group and subgroup scope for the teacher application workflow.
-- Extends PR #22's teacher_applications in place. No second intake is created.
-- Forward-only, additive except for the status check, which is replaced to add one value.
-- Date: 2026-10-26
--
-- Rules:
--   superadmin and regional_secretary  decide any teacher application (organization-wide)
--   pastor and subgroup_admin          decide applications whose group and subgroup have an active
--                                      assignment for the caller (staff_scope_covers)
--   admin, principal, teacher, pending and any applicant: no decision rights
--   no self-approval by user id or by normalized email
--   APPROVE records APPROVAL_PENDING_PROVISIONING only. It changes no role, creates no teacher row,
--   activates no account, provisions no Moodle access, and sends no email.
--   The APPROVED status and the teacher-link path stay refused (P1 hold).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Scope columns: composite FK to org_subgroups (group and subgroup must agree)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.teacher_applications add column if not exists group_id text;
alter table public.teacher_applications add column if not exists subgroup_id text;

-- NOT VALID: existing rows are not checked, and every new row must carry both values.
alter table public.teacher_applications drop constraint if exists teacher_applications_scope_required_chk;
alter table public.teacher_applications
  add constraint teacher_applications_scope_required_chk
  check (group_id is not null and subgroup_id is not null) not valid;

alter table public.teacher_applications drop constraint if exists teacher_applications_group_subgroup_fk;
alter table public.teacher_applications
  add constraint teacher_applications_group_subgroup_fk
  foreign key (subgroup_id, group_id)
  references public.org_subgroups (subgroup_id, group_id)
  on update restrict on delete restrict
  not valid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Status: add APPROVAL_PENDING_PROVISIONING and keep APPROVED reserved
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.teacher_applications drop constraint if exists teacher_applications_status_chk;
alter table public.teacher_applications
  add constraint teacher_applications_status_chk
  check (status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING', 'APPROVED', 'REJECTED', 'WITHDRAWN'));

-- An open application (including one awaiting provisioning review) blocks a second one.
drop index if exists public.uq_teacher_applications_open_email;
create unique index uq_teacher_applications_open_email
  on public.teacher_applications (email_normalized)
  where status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING');

drop index if exists public.uq_teacher_applications_open_applicant;
create unique index uq_teacher_applications_open_applicant
  on public.teacher_applications (applicant_user_id)
  where status in ('SUBMITTED', 'INFO_REQUESTED', 'APPROVAL_PENDING_PROVISIONING');

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
      -- Scoped approval records a pending state only. Nothing leaves it except provisioning.
      ('SUBMITTED',       'APPROVAL_PENDING_PROVISIONING'),
      ('INFO_REQUESTED',  'APPROVAL_PENDING_PROVISIONING'),
      -- Reserved for the teacher-link contract (P1 hold). Not reachable through any action here.
      ('SUBMITTED',       'APPROVED'),
      ('INFO_REQUESTED',  'APPROVED')
    ) as t(from_status, to_status)
    where t.from_status = p_from
      and t.to_status = p_to
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Authorization
-- ─────────────────────────────────────────────────────────────────────────────

-- Organization-wide approver. No longer admin: admin has no approval rights in this workflow.
create or replace function public.teacher_application_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.staff_scope_org_wide(auth.uid()), false);
$$;

-- Decision authority for one application, resolved from the caller's auth.uid() only.
-- The caller cannot name a reviewer, so no decision can be made for another identity.
create or replace function public.teacher_application_can_decide(p_application_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_app   record;
  v_email text;
begin
  if v_actor is null or p_application_id is null then
    return false;
  end if;

  select t.applicant_user_id, t.email_normalized, t.group_id, t.subgroup_id
    into v_app
  from public.teacher_applications t
  where t.id = p_application_id;
  if not found then
    return false;
  end if;

  -- No self-approval, by user id or by normalized email.
  if v_app.applicant_user_id = v_actor then
    return false;
  end if;
  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = v_actor;
  if v_email is not null and v_email = v_app.email_normalized then
    return false;
  end if;

  -- Organization-wide: active superadmin or regional_secretary.
  if public.staff_scope_org_wide(v_actor) then
    return true;
  end if;

  -- Scoped: active pastor or subgroup_admin with an active assignment for this group and subgroup.
  -- The role and activity checks, and the subgroup-to-group validity, are inside staff_scope_covers.
  return public.staff_scope_covers(v_actor, v_app.group_id, v_app.subgroup_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Submission: group and subgroup must agree with the fellowship and with org_subgroups
-- ─────────────────────────────────────────────────────────────────────────────

-- The four-argument form from PR #22 is superseded. It is revoked from every application role and
-- raises if called directly, so no scope-less application can be written.
create or replace function public.submit_teacher_application(
  p_full_name       text,
  p_phone           text default null,
  p_fellowship_code text default null,
  p_notes           text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'SUPERSEDED: use submit_teacher_application with group and subgroup';
end;
$$;

create or replace function public.submit_teacher_application(
  p_full_name       text,
  p_phone           text,
  p_fellowship_code text,
  p_notes           text,
  p_group_id        text,
  p_subgroup_id     text
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
  v_group       text := btrim(coalesce(p_group_id, ''));
  v_subgroup    text := btrim(coalesce(p_subgroup_id, ''));
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

  -- Group and subgroup must both be present, must match the fellowship, and must be an active pair
  -- in the authoritative map. A client value is only ever a claim checked here.
  if v_group = '' or v_subgroup = '' then
    raise exception 'INVALID_SCOPE: group and subgroup are required';
  end if;
  if not exists (
    select 1 from public.fellowship_map f
    where f.fellowship_code = v_fellowship
      and f.active
      and f.group_id = v_group
      and f.subgroup_id = v_subgroup
  ) then
    raise exception 'INVALID_SCOPE: the fellowship does not belong to the selected group and subgroup';
  end if;
  if not exists (
    select 1 from public.org_subgroups o
    where o.subgroup_id = v_subgroup and o.group_id = v_group and o.active
  ) then
    raise exception 'INVALID_SCOPE: the subgroup is not active under the selected group';
  end if;

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
    where a.email_normalized = v_email and a.status = 'APPROVAL_PENDING_PROVISIONING'
  ) then
    raise exception 'APPLICATION_PENDING: this application is awaiting provisioning review';
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

  select a.id, a.status, a.version,
         (a.full_name, a.phone, a.fellowship_code, a.notes, a.group_id, a.subgroup_id)
           is distinct from (v_name, v_phone, v_fellowship, v_notes, v_group, v_subgroup)
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
           group_id = v_group,
           subgroup_id = v_subgroup,
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
        fellowship_code, notes, status, email_verified_at, group_id, subgroup_id
      )
      values (
        v_uid, v_email, v_email, v_name, v_phone,
        v_fellowship, v_notes, 'SUBMITTED', v_verified_at, v_group, v_subgroup
      )
      returning id, status, version into v_id, v_status, v_version;
      v_outcome := 'SUBMITTED';
    exception when unique_violation then
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

  insert into public.audit_logs (logged_at, actor_email, action, entity_type, entity_id, status, details)
  values (
    now(), v_email,
    'TEACHER_APPLICATION_' || v_outcome,
    'teacher_application', v_id::text, 'SUCCESS',
    jsonb_build_object('actor_id', v_uid, 'application_id', v_id, 'version', v_version,
                       'fellowship_code', v_fellowship, 'group_id', v_group, 'subgroup_id', v_subgroup)
  );

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Review: REQUEST_INFO and REJECT keep their semantics; APPROVE records the pending state only
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
  v_actor  uuid := auth.uid();
  a        public.teacher_applications%rowtype;
  v_to     text;
  v_msg    text := nullif(btrim(coalesce(p_message, '')), '');
  v_dedupe text;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_action not in ('REQUEST_INFO', 'REJECT', 'APPROVE') then
    raise exception 'INVALID_ACTION';
  end if;

  -- Authority is checked before the row is read further, so an unauthorized caller learns nothing
  -- about whether a given application id exists.
  if not public.teacher_application_can_decide(p_application_id) then
    if exists (
      select 1 from public.teacher_applications t
      where t.id = p_application_id
        and (t.applicant_user_id = v_actor
             or t.email_normalized = (select lower(btrim(u.email)) from auth.users u where u.id = v_actor))
    ) then
      raise exception 'FORBIDDEN: reviewers cannot decide their own application';
    end if;
    raise exception 'FORBIDDEN: not authorized to decide this application';
  end if;

  select * into a
  from public.teacher_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  v_to := case p_action
            when 'REQUEST_INFO' then 'INFO_REQUESTED'
            when 'REJECT'       then 'REJECTED'
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
    jsonb_build_object('actor_id', v_actor, 'application_id', a.id, 'from_status', a.status,
                       'to_status', v_to, 'version', a.version + 1, 'has_message', v_msg is not null)
  );

  -- APPROVAL_PENDING_PROVISIONING sends no applicant email. Only the two generic templates remain.
  if v_to = 'INFO_REQUESTED' then
    v_dedupe := 'teacher_application_info_requested:' || a.id::text || ':' || (a.version + 1)::text;
    perform public.enqueue_teacher_application_email(a.id, 'teacher_application_info_requested',
      a.email, a.full_name, v_dedupe);
  elsif v_to = 'REJECTED' then
    v_dedupe := 'teacher_application_rejected:' || a.id::text || ':' || (a.version + 1)::text;
    perform public.enqueue_teacher_application_email(a.id, 'teacher_application_rejected',
      a.email, a.full_name, v_dedupe);
  end if;

  return jsonb_build_object('ok', true, 'application_id', a.id, 'status', v_to, 'version', a.version + 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Reviewer read surface: rows the caller may decide, resolved from auth.uid()
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.teacher_applications_review
with (security_barrier = true) as
select *
from public.teacher_applications
where public.teacher_application_can_decide(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Privileges
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.submit_teacher_application(text, text, text, text) from public, anon, authenticated;

revoke all on function public.submit_teacher_application(text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_teacher_application(text, text, text, text, text, text) to authenticated;

revoke all on function public.teacher_application_can_decide(uuid) from public, anon;
grant execute on function public.teacher_application_can_decide(uuid) to authenticated;

revoke all on function public.teacher_application_reviewer() from public, anon;
grant execute on function public.teacher_application_reviewer() to authenticated;

revoke all on public.teacher_applications_review from public, anon;
grant select on public.teacher_applications_review to authenticated;

commit;
