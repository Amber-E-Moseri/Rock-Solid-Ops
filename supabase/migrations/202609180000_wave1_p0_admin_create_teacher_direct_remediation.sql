-- WAVE 1 P0 REMEDIATION: admin_create_teacher_direct authorization + schema fix
--
-- Issue 1: SECURITY DEFECT
--   RPC admin_create_teacher_direct had no internal authorization check
--   Callable by all authenticated users (pending, teacher, admin, superadmin)
--   Should only be callable by admin/superadmin
--
-- Issue 2: SCHEMA MISMATCH
--   RPC attempts to INSERT audit_logs(target_id, metadata)
--   Canonical schema has entity_id, details (from 202605071800)
--   Later migrations (202607142100, 202607231200) use canonical names
--
-- Remediation:
--   - Add IF NOT public.is_admin() authorization gate to both overloads
--   - Restore canonical audit_logs column names (entity_id, details)
--   - Preserve all other behavior: SECURITY DEFINER, return type, parameters

BEGIN;

-- ========== 7-parameter overload ==========
-- CREATE OR REPLACE to preserve parameter count and defaults
-- Preserve exact behavior except: add authorization check, fix audit column names

CREATE OR REPLACE FUNCTION public.admin_create_teacher_direct(
  p_full_name text,
  p_email text,
  p_phone text default null,
  p_group_id text default null,
  p_subgroup_id text default null,
  p_notes text default null,
  p_actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_actor text := nullif(trim(coalesce(p_actor_email, '')), '');
  v_teacher_id text;
  v_existing_teacher_id text;
begin
  -- WAVE 1: Authorization gate — only admin/superadmin can create teachers directly
  if not public.is_admin() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Insufficient permission: only admins can create teachers directly'
    );
  end if;

  if v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'Email is required');
  end if;

  if v_full_name = '' then
    return jsonb_build_object('ok', false, 'error', 'Full name is required');
  end if;

  select t.teacher_id
  into v_existing_teacher_id
  from public.teachers t
  where lower(trim(coalesce(t.email, ''))) = v_email
    and t.deleted_at is null
  limit 1;

  if v_existing_teacher_id is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'A teacher with this email already exists',
      'teacher_id', v_existing_teacher_id
    );
  end if;

  v_teacher_id :=
    'T-' ||
    upper(
      substring(
        regexp_replace(gen_random_uuid()::text, '[^a-zA-Z0-9]', '', 'g')
        from 1 for 8
      )
    );

  insert into public.teachers (
    teacher_id,
    full_name,
    email,
    phone,
    group_id,
    subgroup_id,
    notes,
    status,
    active,
    created_by,
    updated_by
  )
  values (
    v_teacher_id,
    v_full_name,
    v_email,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_group_id, '')), ''),
    nullif(trim(coalesce(p_subgroup_id, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'PENDING',
    false,
    coalesce(v_actor, 'admin'),
    coalesce(v_actor, 'admin')
  );

  -- WAVE 1: Fix canonical audit_logs column names (entity_id, details not target_id, metadata)
  insert into public.audit_logs (
    action,
    actor_id,
    entity_id,
    entity_type,
    details
  )
  values (
    'teacher_created_direct',
    coalesce(v_actor, 'admin'),
    v_teacher_id,
    'teacher',
    jsonb_build_object(
      'full_name', v_full_name,
      'email', v_email,
      'method', 'direct_no_email',
      'group_id', nullif(trim(coalesce(p_group_id, '')), ''),
      'subgroup_id', nullif(trim(coalesce(p_subgroup_id, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'teacher_id', v_teacher_id);
end $$;


-- ========== 8-parameter overload (with fellowship_code) ==========

CREATE OR REPLACE FUNCTION public.admin_create_teacher_direct(
  p_full_name text,
  p_email text,
  p_phone text default null,
  p_group_id text default null,
  p_subgroup_id text default null,
  p_fellowship_code text default null,
  p_notes text default null,
  p_actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_actor text := nullif(trim(coalesce(p_actor_email, '')), '');
  v_teacher_id text;
  v_existing_teacher_id text;
  v_fellowship_code text := nullif(upper(trim(coalesce(p_fellowship_code, ''))), '');
begin
  -- WAVE 1: Authorization gate — only admin/superadmin can create teachers directly
  if not public.is_admin() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Insufficient permission: only admins can create teachers directly'
    );
  end if;

  if v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'Email is required');
  end if;

  if v_full_name = '' then
    return jsonb_build_object('ok', false, 'error', 'Full name is required');
  end if;

  if v_fellowship_code is not null then
    if not exists (
      select 1
      from public.fellowship_map fm
      where fm.fellowship_code = v_fellowship_code
    ) then
      return jsonb_build_object('ok', false, 'error', 'Invalid fellowship_code');
    end if;
  end if;

  select t.teacher_id
  into v_existing_teacher_id
  from public.teachers t
  where lower(trim(coalesce(t.email, ''))) = v_email
    and t.deleted_at is null
  limit 1;

  if v_existing_teacher_id is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'A teacher with this email already exists',
      'teacher_id', v_existing_teacher_id
    );
  end if;

  v_teacher_id :=
    'T-' ||
    upper(
      substring(
        regexp_replace(gen_random_uuid()::text, '[^a-zA-Z0-9]', '', 'g')
        from 1 for 8
      )
    );

  insert into public.teachers (
    teacher_id,
    full_name,
    email,
    phone,
    group_id,
    subgroup_id,
    fellowship_code,
    notes,
    status,
    active,
    created_by,
    updated_by
  )
  values (
    v_teacher_id,
    v_full_name,
    v_email,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_group_id, '')), ''),
    nullif(trim(coalesce(p_subgroup_id, '')), ''),
    v_fellowship_code,
    nullif(trim(coalesce(p_notes, '')), ''),
    'PENDING',
    false,
    coalesce(v_actor, 'admin'),
    coalesce(v_actor, 'admin')
  );

  -- WAVE 1: Fix canonical audit_logs column names (entity_id, details not target_id, metadata)
  insert into public.audit_logs (
    action,
    actor_id,
    entity_id,
    entity_type,
    details
  )
  values (
    'teacher_created_direct',
    coalesce(v_actor, 'admin'),
    v_teacher_id,
    'teacher',
    jsonb_build_object(
      'full_name', v_full_name,
      'email', v_email,
      'method', 'direct_no_email',
      'group_id', nullif(trim(coalesce(p_group_id, '')), ''),
      'subgroup_id', nullif(trim(coalesce(p_subgroup_id, '')), ''),
      'fellowship_code', v_fellowship_code
    )
  );

  return jsonb_build_object('ok', true, 'teacher_id', v_teacher_id);
end $$;

COMMIT;
