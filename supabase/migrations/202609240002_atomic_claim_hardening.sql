begin;

-- Atomic claim hardening: stale-recovery protection + minimum privileges
-- 
-- Fixes two issues in claim_nexus_task RPC:
-- 1. TIMEOUT_UNKNOWN status was recoverable after TTL expiry (requires explicit reconciliation)
-- 2. authenticated EXECUTE grant was overly broad (only service_role calls this RPC)

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
  select rtl.id, rtl.nexus_task_id, rtl.status, rtl.claim_token, rtl.claimed_at
  into v_existing
  from public.rocksolid_task_links as rtl
  where rtl.dedupe_key = p_dedupe_key
  for update;

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

  if v_existing.nexus_task_id is not null then
    row_id := v_existing.id;
    nexus_task_id := v_existing.nexus_task_id;
    status := v_existing.status;
    is_owner := false;
    return next;
    return;
  end if;

  if v_existing.status = 'TIMEOUT_UNKNOWN' then
    row_id := v_existing.id;
    nexus_task_id := v_existing.nexus_task_id;
    status := v_existing.status;
    is_owner := false;
    return next;
    return;
  end if;

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

revoke execute on function public.claim_nexus_task(text, text, text, uuid) from authenticated;

commit;
