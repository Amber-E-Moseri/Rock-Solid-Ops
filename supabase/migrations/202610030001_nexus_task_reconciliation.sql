begin;

-- C6: reconciliation of TIMEOUT_UNKNOWN Nexus task outcomes.
--
-- A Nexus create that times out may or may not have produced a task. Such rows are parked
-- as TIMEOUT_UNKNOWN and are never re-POSTed by the producer path. This migration adds the
-- durable state and the two atomic operations the reconciler (edge: _shared/nexus-reconcile.ts,
-- run by retry-worker) needs, WITHOUT changing how a task is created:
--
--   TIMEOUT_UNKNOWN --FOUND--->  CREATED          (remote task located; id persisted)
--   TIMEOUT_UNKNOWN --ABSENT-->  FAILED           (released: the producer re-claims and POSTs the SAME
--                                                  external_unique_key, which Nexus guarantees cannot
--                                                  create a second task)
--   TIMEOUT_UNKNOWN --UNKNOWN--> TIMEOUT_UNKNOWN  (attempts+1, exponential backoff, 6h cap)
--   TIMEOUT_UNKNOWN --UNKNOWN x24--> RECONCILE_FAILED  (terminal, operator action; never auto-claimed)
--
-- Additive and idempotent. No table is created, so no new RLS is required; the existing
-- rocksolid_task_links policies cover the new columns. The functions are SECURITY DEFINER and
-- callable by service_role only.

alter table if exists public.rocksolid_task_links
  add column if not exists reconcile_attempts integer not null default 0,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists last_reconcile_at timestamptz,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconcile_claim_token uuid,
  add column if not exists reconcile_claimed_at timestamptz;

create index if not exists idx_rocksolid_task_links_reconcile_due
  on public.rocksolid_task_links (next_reconcile_at)
  where status = 'TIMEOUT_UNKNOWN' and nexus_task_id is null;

-- claim_nexus_task: identical to 202609240002, plus RECONCILE_FAILED is non-recoverable like
-- TIMEOUT_UNKNOWN (an unresolved outcome must never be silently re-claimed and re-POSTed).
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

  if v_existing.status in ('TIMEOUT_UNKNOWN', 'RECONCILE_FAILED') then
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

revoke all on function public.claim_nexus_task(text, text, text, uuid) from public;
revoke all on function public.claim_nexus_task(text, text, text, uuid) from anon;
revoke execute on function public.claim_nexus_task(text, text, text, uuid) from authenticated;
grant execute on function public.claim_nexus_task(text, text, text, uuid) to service_role;

-- Atomically lease a batch of due TIMEOUT_UNKNOWN rows. FOR UPDATE SKIP LOCKED + a claim token
-- give concurrent reconcilers disjoint batches; an abandoned lease becomes reclaimable after
-- p_lease_seconds.
create or replace function public.claim_nexus_reconciliations(
  p_limit          integer,
  p_claim_token    uuid,
  p_lease_seconds  integer default 120
) returns table (
  row_id             uuid,
  dedupe_key         text,
  source_type        text,
  source_id          text,
  reconcile_attempts integer
) language plpgsql security definer set search_path = 'public' as $$
begin
  return query
  with picked as (
    select rtl.id
    from public.rocksolid_task_links as rtl
    where rtl.status = 'TIMEOUT_UNKNOWN'
      and rtl.nexus_task_id is null
      and (rtl.next_reconcile_at is null or rtl.next_reconcile_at <= now())
      and (
        rtl.reconcile_claimed_at is null
        or rtl.reconcile_claimed_at < now() - make_interval(secs => greatest(p_lease_seconds, 1))
      )
    order by coalesce(rtl.next_reconcile_at, rtl.created_at), rtl.id
    limit greatest(least(p_limit, 100), 0)
    for update skip locked
  ),
  upd as (
    update public.rocksolid_task_links as t
    set reconcile_claim_token = p_claim_token,
        reconcile_claimed_at = now(),
        last_reconcile_at = now()
    from picked
    where t.id = picked.id
    returning t.id, t.dedupe_key, t.source_type, t.source_id, t.reconcile_attempts
  )
  select upd.id, upd.dedupe_key, upd.source_type, upd.source_id, upd.reconcile_attempts
  from upd;
end;
$$;

-- Apply a reconciliation verdict. Only the current lease holder can resolve a row that is still
-- TIMEOUT_UNKNOWN with no task id, so repeated or racing resolutions are no-ops (applied = false).
create or replace function public.resolve_nexus_reconciliation(
  p_row_id         uuid,
  p_claim_token    uuid,
  p_outcome        text,
  p_nexus_task_id  text default null,
  p_error          text default null
) returns table (
  row_id   uuid,
  status   text,
  applied  boolean
) language plpgsql security definer set search_path = 'public' as $$
declare
  v_row          record;
  v_attempts     integer;
  v_max_attempts constant integer := 24;
begin
  if p_outcome is null or p_outcome not in ('FOUND', 'ABSENT', 'UNKNOWN') then
    raise exception 'invalid reconciliation outcome: %', p_outcome using errcode = '22023';
  end if;

  select rtl.id, rtl.status, rtl.nexus_task_id, rtl.reconcile_attempts, rtl.reconcile_claim_token
  into v_row
  from public.rocksolid_task_links as rtl
  where rtl.id = p_row_id
  for update;

  if v_row.id is null
     or v_row.reconcile_claim_token is distinct from p_claim_token
     or v_row.status <> 'TIMEOUT_UNKNOWN'
     or v_row.nexus_task_id is not null
  then
    row_id := p_row_id;
    status := coalesce(v_row.status, 'MISSING');
    applied := false;
    return next;
    return;
  end if;

  if p_outcome = 'FOUND' then
    if p_nexus_task_id is null or btrim(p_nexus_task_id) = '' then
      -- A FOUND verdict without a task id is not a resolution.
      row_id := p_row_id;
      status := v_row.status;
      applied := false;
      return next;
      return;
    end if;

    update public.rocksolid_task_links
    set status = 'CREATED',
        nexus_task_id = btrim(p_nexus_task_id),
        error_message = null,
        reconcile_attempts = reconcile_attempts + 1,
        reconciled_at = now(),
        last_reconcile_at = now(),
        next_reconcile_at = null,
        reconcile_claim_token = null,
        reconcile_claimed_at = null,
        updated_at = now()
    where id = p_row_id;

    row_id := p_row_id;
    status := 'CREATED';
    applied := true;
    return next;
    return;
  end if;

  if p_outcome = 'ABSENT' then
    -- Released, not retried here: FAILED is re-claimable by the producer path, which re-POSTs the
    -- same external_unique_key (one task per key on the Nexus side).
    update public.rocksolid_task_links
    set status = 'FAILED',
        error_message = 'RECONCILED_ABSENT: no Nexus task found for this external_unique_key',
        reconcile_attempts = reconcile_attempts + 1,
        reconciled_at = now(),
        last_reconcile_at = now(),
        next_reconcile_at = null,
        reconcile_claim_token = null,
        reconcile_claimed_at = null,
        updated_at = now()
    where id = p_row_id;

    row_id := p_row_id;
    status := 'FAILED';
    applied := true;
    return next;
    return;
  end if;

  -- UNKNOWN: lookup unavailable or inconclusive. Stay unresolved.
  v_attempts := v_row.reconcile_attempts + 1;

  if v_attempts >= v_max_attempts then
    update public.rocksolid_task_links
    set status = 'RECONCILE_FAILED',
        error_message = left('RECONCILE_EXHAUSTED after ' || v_attempts || ' attempts: ' || coalesce(p_error, 'inconclusive'), 500),
        reconcile_attempts = v_attempts,
        last_reconcile_at = now(),
        next_reconcile_at = null,
        reconcile_claim_token = null,
        reconcile_claimed_at = null,
        updated_at = now()
    where id = p_row_id;

    row_id := p_row_id;
    status := 'RECONCILE_FAILED';
    applied := true;
    return next;
    return;
  end if;

  update public.rocksolid_task_links
  set error_message = left('TIMEOUT_UNKNOWN: ' || coalesce(p_error, 'lookup inconclusive'), 500),
      reconcile_attempts = v_attempts,
      last_reconcile_at = now(),
      next_reconcile_at = now() + least(interval '6 hours', interval '5 minutes' * power(2, least(v_attempts, 6))),
      reconcile_claim_token = null,
      reconcile_claimed_at = null,
      updated_at = now()
  where id = p_row_id;

  row_id := p_row_id;
  status := 'TIMEOUT_UNKNOWN';
  applied := true;
  return next;
end;
$$;

revoke all on function public.claim_nexus_reconciliations(integer, uuid, integer) from public;
revoke all on function public.claim_nexus_reconciliations(integer, uuid, integer) from anon;
revoke all on function public.claim_nexus_reconciliations(integer, uuid, integer) from authenticated;
grant execute on function public.claim_nexus_reconciliations(integer, uuid, integer) to service_role;

revoke all on function public.resolve_nexus_reconciliation(uuid, uuid, text, text, text) from public;
revoke all on function public.resolve_nexus_reconciliation(uuid, uuid, text, text, text) from anon;
revoke all on function public.resolve_nexus_reconciliation(uuid, uuid, text, text, text) from authenticated;
grant execute on function public.resolve_nexus_reconciliation(uuid, uuid, text, text, text) to service_role;

commit;
