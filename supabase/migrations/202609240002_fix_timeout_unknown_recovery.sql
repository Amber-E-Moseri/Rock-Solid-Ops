begin;

-- Fix: TIMEOUT_UNKNOWN status must not transition to CLAIMING via stale-claim recovery.
-- TIMEOUT_UNKNOWN indicates ambiguous remote commit (response lost); it requires
-- explicit reconciliation and cannot automatically become POST-eligible.

-- Replace claim_nexus_task to exclude TIMEOUT_UNKNOWN from Case D recovery
create or replace function public.claim_nexus_task(
  p_source_type  text,
  p_source_id    text,
  p_dedupe_key   text,
  p_claim_token  uuid
) returns table (
  row_id         uuid,
  nexus_task_id  text,
  status         text,
  is_owner       boolean
) language plpgsql security definer set search_path = 'public' as $$
declare
  v_existing    record;
  v_is_owner    boolean := false;
  v_ttl_minutes int := 2;
begin
  -- Try to find existing row
  select id, nexus_task_id, status, claim_token, claimed_at
  into v_existing
  from public.rocksolid_task_links
  where dedupe_key = p_dedupe_key
  for update;

  -- Case A: No existing row
  if v_existing is null then
    insert into public.rocksolid_task_links
      (source_type, source_id, dedupe_key, status, claim_token, claimed_at)
    values
      (p_source_type, p_source_id, p_dedupe_key, 'CLAIMING', p_claim_token, now())
    returning
      public.rocksolid_task_links.id,
      public.rocksolid_task_links.nexus_task_id,
      public.rocksolid_task_links.status,
      (public.rocksolid_task_links.claim_token = p_claim_token)
    into row_id, nexus_task_id, status, v_is_owner;
    is_owner := v_is_owner;
    return next;
    return;
  end if;

  -- Case B: Existing row with successful task
  if v_existing.nexus_task_id is not null then
    row_id := v_existing.id;
    nexus_task_id := v_existing.nexus_task_id;
    status := v_existing.status;
    is_owner := false;
    return next;
    return;
  end if;

  -- Case C: Fresh active claim
  if v_existing.claim_token is not null
     and v_existing.status in ('CLAIMING', 'PENDING')
     and v_existing.claimed_at > now() - make_interval(mins => v_ttl_minutes)
  then
    row_id := v_existing.id;
    nexus_task_id := v_existing.nexus_task_id;
    status := v_existing.status;
    is_owner := (v_existing.claim_token = p_claim_token);
    return next;
    return;
  end if;

  -- Case D-TIMEOUT: TIMEOUT_UNKNOWN never transitions to CLAIMING
  -- Ambiguous commit state requires explicit reconciliation
  if v_existing.status = 'TIMEOUT_UNKNOWN' then
    row_id := v_existing.id;
    nexus_task_id := v_existing.nexus_task_id;
    status := v_existing.status;
    is_owner := false;  -- Non-owner; do not allow re-POST without reconciliation
    return next;
    return;
  end if;

  -- Case D: Stale ordinary claim (caller may recover)
  update public.rocksolid_task_links
  set
    claim_token = p_claim_token,
    claimed_at = now(),
    status = 'CLAIMING'
  where id = v_existing.id
  returning
    public.rocksolid_task_links.id,
    public.rocksolid_task_links.nexus_task_id,
    public.rocksolid_task_links.status,
    true
  into row_id, nexus_task_id, status, is_owner;
  return next;
end;
$$;

commit;
