begin;

-- Add atomic claim fields to rocksolid_task_links
alter table if exists public.rocksolid_task_links
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

create index if not exists idx_rocksolid_task_links_claim_token on public.rocksolid_task_links(claim_token);
create index if not exists idx_rocksolid_task_links_claimed_at on public.rocksolid_task_links(claimed_at);

-- Atomic RPC: claim ownership of a task link for Nexus POST
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
  v_fresh_claim boolean := false;
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

  -- Case D: Stale claim (caller may recover)
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

-- Grant execution only to service role (or authenticated if called from edge function)
revoke all on function public.claim_nexus_task(text, text, text, uuid) from public;
revoke all on function public.claim_nexus_task(text, text, text, uuid) from anon;
grant execute on function public.claim_nexus_task(text, text, text, uuid) to authenticated, service_role;

commit;
