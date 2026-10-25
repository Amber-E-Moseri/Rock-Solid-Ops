begin;

-- C6 post-certification fix: stop retrying a confirmed-permanent assignee failure.
--
-- Observed in certification: a rocksolid_admin_mappings row pointing at a Nexus user that does not exist makes
-- task-api answer  400 {"error":"assignee not found"}  on every attempt. The row was left FAILED, which
-- claim_nexus_task re-claims immediately, so the same dead mapping was re-POSTed on every producer run, forever.
--
-- New terminal status ASSIGNEE_REJECTED (justification: FAILED is deliberately re-claimable, so it cannot stop the
-- retries; RECONCILE_FAILED means "reconciliation gave up", which this is not). The edge code sets it ONLY for
-- 400 + the exact body "assignee not found" while an assignee_id was sent. Every other 400, 401, 403, 429, 5xx,
-- timeout or network error keeps its existing (retryable / reconciling) behaviour.
--
-- claim_nexus_task is otherwise IDENTICAL to 202610030002: ASSIGNEE_REJECTED joins TIMEOUT_UNKNOWN and
-- RECONCILE_FAILED as a status the producer path never re-claims. No column or constraint changes (status has
-- no CHECK, by design).
--
-- Operator workflow (manual attention):
--   1. find them:  select id, source_type, source_id, error_message, updated_at
--                  from public.rocksolid_task_links where status = 'ASSIGNEE_REJECTED';
--      (also audit_logs action = 'NEXUS_TASK_ASSIGNEE_REJECTED', details.assignee_id / group_id / subgroup_id)
--   2. fix rocksolid_admin_mappings.nexus_user_id, or create the user in Nexus
--   3. release:    update public.rocksolid_task_links set status = 'FAILED', error_message = null
--                  where status = 'ASSIGNEE_REJECTED' and ...;
--      the next producer run re-claims it and re-POSTs the SAME external_unique_key (duplicate-safe).
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

  -- Terminal / owned elsewhere: never re-claimed or re-POSTed by the producer path.
  --   TIMEOUT_UNKNOWN, RECONCILE_FAILED  -> reconciliation owns them
  --   ASSIGNEE_REJECTED                 -> Nexus confirmed the mapped assignee does not exist (400 "assignee not found");
  --                                        retrying the same mapping cannot succeed. Needs a human (see header).
  if v_existing.status in ('TIMEOUT_UNKNOWN', 'RECONCILE_FAILED', 'ASSIGNEE_REJECTED') then
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
