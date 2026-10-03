begin;

-- C6 post-certification fix: simultaneous FIRST claims of the same dedupe_key must not raise.
--
-- Defect (reproduced against real Postgres, 50 keys x 8 simultaneous workers): the previous body did
--   SELECT ... FOR UPDATE            -- finds nothing for a brand-new key, so nothing is locked
--   INSERT ...                       -- every concurrent caller reaches this; the losers hit the
--                                    -- rocksolid_task_links_dedupe_key_key unique index and raise 23505
-- 143 of 400 calls surfaced as exceptions. The safety invariant held (one owner), but contention should not
-- be an error.
--
-- Fix: make the first insert itself the arbiter.
--   INSERT ... ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
-- Exactly one concurrent inserter gets a row back (it owns the claim); every other caller waits for the
-- winner's transaction, takes DO NOTHING, and falls through to the existing locked-row logic, where it
-- observes a live lease it does not own and answers is_owner = false.
--
-- Everything after the first insert is IDENTICAL to 202610030001:
--   * completed rows (nexus_task_id set) are returned, never owned
--   * TIMEOUT_UNKNOWN / RECONCILE_FAILED are never re-claimed (reconciliation owns them)
--   * a live CLAIMING/PENDING lease (2 minutes) is respected; an expired one is recovered
--   * FAILED (and other non-terminal states) are re-claimable immediately
--   * claim_token fencing is unchanged (callers write with WHERE claim_token = their token)
-- Rows deleted between the conflict and the lock (operator cleanup) are handled by retrying the insert.
--
-- Additive and idempotent (CREATE OR REPLACE). Callable by service_role only, as before.

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
  v_new_id      uuid;
  v_tries       int := 0;
  v_ttl_minutes int := 2;
begin
  loop
    v_tries := v_tries + 1;

    -- Atomic first claim. A concurrent inserter of the same key blocks here until the winner commits,
    -- then returns no row instead of raising 23505.
    insert into public.rocksolid_task_links as l
      (source_type, source_id, dedupe_key, status, claim_token, claimed_at)
    values
      (p_source_type, p_source_id, p_dedupe_key, 'CLAIMING', p_claim_token, now())
    on conflict (dedupe_key) do nothing
    returning l.id into v_new_id;

    if v_new_id is not null then
      row_id := v_new_id;
      nexus_task_id := null;
      status := 'CLAIMING';
      is_owner := true;
      return next;
      return;
    end if;

    -- The row exists (committed by someone else). Lock it and decide.
    select rtl.id, rtl.nexus_task_id, rtl.status, rtl.claim_token, rtl.claimed_at
    into v_existing
    from public.rocksolid_task_links as rtl
    where rtl.dedupe_key = p_dedupe_key
    for update;

    exit when v_existing.id is not null;

    -- Vanished between the conflict and the lock (deleted): try the insert again.
    if v_tries >= 5 then
      raise exception 'claim_nexus_task: could not claim dedupe_key after % attempts', v_tries
        using errcode = '40001';
    end if;
  end loop;

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

commit;
