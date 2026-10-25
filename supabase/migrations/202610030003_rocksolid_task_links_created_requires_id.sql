begin;

-- C6 post-certification fix: a CREATED link must carry its Nexus task id.
--
-- Invariant (proved from every writer of status = 'CREATED'):
--   * ensureNexusTask persists { nexus_task_id, status: 'CREATED' } in ONE fenced UPDATE (and only after
--     Nexus returned a task id; parseCreateResponse rejects an empty one)
--   * resolve_nexus_reconciliation(FOUND) sets both together and rejects a NULL/blank id
--   * claim_nexus_task treats a row WITH an id as complete and never changes it
-- so CREATED => nexus_task_id IS NOT NULL always holds for C6 code. Nothing is asserted for other states:
-- PENDING / CLAIMING / FAILED / TIMEOUT_UNKNOWN / RECONCILE_FAILED legitimately have no id, and an id on one
-- of them is merely unexpected, not proven impossible.
--
-- Legacy data: the pre-C6 clickup-sync on main wrote `nexus_task_id: nexusTaskId || null, status: 'CREATED'`,
-- so production may contain CREATED rows with NULL ids. Those are NOT repaired or invented here. Therefore:
--   1. the constraint is added NOT VALID: it is enforced for every INSERT and every UPDATE from now on, but
--      existing rows are not scanned, so this migration can never fail on legacy data;
--   2. it is VALIDATED only when no violating row exists. Otherwise a WARNING reports the count and the
--      constraint stays NOT VALID (still protecting all new writes) until an operator resolves the rows:
--        select id, dedupe_key, clickup_task_id, created_at from public.rocksolid_task_links
--        where status = 'CREATED' and nexus_task_id is null;
--      then:  alter table public.rocksolid_task_links
--               validate constraint rocksolid_task_links_created_requires_nexus_task_id;
--   A legacy violator is self-healing for C6: claim_nexus_task re-claims it (it is not a terminal state and has
--   no id), and the same-key POST either creates the task or returns Nexus's duplicate.
--
-- Additive and idempotent.

do $$
declare
  v_bad bigint;
begin
  if to_regclass('public.rocksolid_task_links') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rocksolid_task_links'::regclass
      and conname = 'rocksolid_task_links_created_requires_nexus_task_id'
  ) then
    alter table public.rocksolid_task_links
      add constraint rocksolid_task_links_created_requires_nexus_task_id
      check (status <> 'CREATED' or nexus_task_id is not null) not valid;
  end if;

  select count(*) into v_bad
  from public.rocksolid_task_links
  where status = 'CREATED' and nexus_task_id is null;

  if v_bad = 0 then
    alter table public.rocksolid_task_links
      validate constraint rocksolid_task_links_created_requires_nexus_task_id;
  else
    raise warning 'rocksolid_task_links: % legacy CREATED row(s) have no nexus_task_id; constraint rocksolid_task_links_created_requires_nexus_task_id left NOT VALID (enforced for new writes). Resolve them, then VALIDATE.', v_bad;
  end if;
end;
$$;

commit;
