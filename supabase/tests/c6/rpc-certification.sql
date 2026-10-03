-- C6 RPC certification: executes the REAL claim_nexus_task / claim_nexus_reconciliations /
-- resolve_nexus_reconciliation against a real Postgres (Supabase image), as the real roles.
--
-- Run (after a fresh migration replay):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/c6/rpc-certification.sql
-- Prints one row per case: input | starting state | returned | resulting state | PASS/FAIL, then a
-- summary. Exits non-zero (ERROR) if any case fails. All fixtures use keys prefixed 'cert:' and are removed.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep ' | '

drop schema if exists c6_cert cascade;
create schema c6_cert;
create table c6_cert.results (
  n serial primary key, grp text, name text, input text, start_state text, returned text, end_state text, pass boolean
);

-- compact state of a task-link row (tokens abbreviated so the output is readable)
create function c6_cert.snap(p_key text) returns text language sql as $$
  select coalesce((
    select format('status=%s tok=%s nexus=%s claimed=%s attempts=%s next=%s rtok=%s rclaimed=%s err=%s',
      status, coalesce(left(claim_token::text, 4),'-'), coalesce(nexus_task_id,'-'),
      case when claimed_at is null then '-' else round(extract(epoch from now()-claimed_at))::text||'s ago' end,
      reconcile_attempts,
      case when next_reconcile_at is null then '-' else round(extract(epoch from next_reconcile_at-now())/60)::text||'m' end,
      coalesce(left(reconcile_claim_token::text, 4),'-'),
      case when reconcile_claimed_at is null then '-' else round(extract(epoch from now()-reconcile_claimed_at))::text||'s ago' end,
      left(coalesce(error_message,'-'), 24))
    from public.rocksolid_task_links where dedupe_key = p_key), '(no row)');
$$;

create function c6_cert.rec(p_grp text, p_name text, p_input text, p_start text, p_ret text, p_end text, p_pass boolean)
returns void language sql as $$
  insert into c6_cert.results(grp, name, input, start_state, returned, end_state, pass) values (p_grp, p_name, p_input, p_start, p_ret, p_end, p_pass);
$$;

-- fixture: insert a row directly (as the table owner)
create function c6_cert.mk(p_key text, p_status text, p_nexus text default null, p_tok uuid default null,
  p_claimed_ago interval default null, p_attempts int default 0, p_next_in interval default null,
  p_rtok uuid default null, p_rclaimed_ago interval default null) returns void language sql as $$
  insert into public.rocksolid_task_links(source_type, source_id, dedupe_key, status, nexus_task_id, claim_token, claimed_at,
    reconcile_attempts, next_reconcile_at, reconcile_claim_token, reconcile_claimed_at)
  values ('cert', p_key, p_key, p_status, p_nexus, p_tok, now() - p_claimed_ago, p_attempts, now() + p_next_in, p_rtok, now() - p_rclaimed_ago);
$$;

-- call the real RPC as service_role (the role the edge functions use)
create function c6_cert.claim(p_key text, p_tok uuid) returns text language plpgsql as $$
declare r record; out text;
begin
  execute 'set local role service_role';
  select * into r from public.claim_nexus_task('cert', p_key, p_key, p_tok);
  execute 'reset role';
  return format('owner=%s status=%s nexus=%s', r.is_owner::text, r.status, coalesce(r.nexus_task_id,'-'));
end $$;

create function c6_cert.do_resolve(p_id uuid, p_tok uuid, p_outcome text, p_nexus text default null, p_err text default null) returns text language plpgsql as $$
declare r record;
begin
  execute 'set local role service_role';
  select * into r from public.resolve_nexus_reconciliation(p_id, p_tok, p_outcome, p_nexus, p_err);
  execute 'reset role';
  return format('applied=%s status=%s', r.applied::text, r.status);
end $$;

create function c6_cert.id_of(p_key text) returns uuid language sql as $$ select id from public.rocksolid_task_links where dedupe_key = p_key $$;
create function c6_cert.clean() returns void language sql as $$ delete from public.rocksolid_task_links where dedupe_key like 'cert:%' $$;

-- ───────────────────────── claim_nexus_task ─────────────────────────
do $t$
declare t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); told uuid := gen_random_uuid();
        k text; s text; r text; e text;
begin
  perform c6_cert.clean();

  -- C01 Case A: no row -> caller owns it
  k := 'cert:c01'; s := c6_cert.snap(k); r := c6_cert.claim(k, t1); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C01 new row is claimed by caller','token t1', s, r, e,
    r = 'owner=true status=CLAIMING nexus=-' and e like 'status=CLAIMING tok='||left(t1::text,4)||'%');

  -- C02 Case B: already linked -> never owner, id returned, row untouched
  k := 'cert:c02'; perform c6_cert.mk(k,'CREATED','N-100',told,'1 hour'); s := c6_cert.snap(k);
  r := c6_cert.claim(k, t2); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C02 linked task is reused, not re-owned','token t2', s, r, e,
    r = 'owner=false status=CREATED nexus=N-100' and e = s);

  -- C03/C04 unresolved outcomes are never reclaimable, however old
  k := 'cert:c03'; perform c6_cert.mk(k,'TIMEOUT_UNKNOWN',null,told,'30 days'); s := c6_cert.snap(k);
  r := c6_cert.claim(k, t2); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C03 TIMEOUT_UNKNOWN (30 days old) is not reclaimable','token t2', s, r, e,
    r = 'owner=false status=TIMEOUT_UNKNOWN nexus=-' and e = s);
  k := 'cert:c04'; perform c6_cert.mk(k,'RECONCILE_FAILED',null,told,'30 days'); s := c6_cert.snap(k);
  r := c6_cert.claim(k, t2); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C04 RECONCILE_FAILED is not reclaimable','token t2', s, r, e,
    r = 'owner=false status=RECONCILE_FAILED nexus=-' and e = s);

  -- C05 fresh claim: not stolen; the holder re-claiming with its own token stays owner
  k := 'cert:c05'; perform c6_cert.mk(k,'CLAIMING',null,told,'30 seconds'); s := c6_cert.snap(k);
  r := c6_cert.claim(k, t2); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C05 fresh claim (30s) is not stolen','token t2', s, r, e,
    r = 'owner=false status=CLAIMING nexus=-' and e = s);
  r := c6_cert.claim(k, told); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C05b holder re-claim with its own token','token told', s, r, e, r = 'owner=true status=CLAIMING nexus=-');

  -- C06 stale claim (3 min) recovered by new owner
  k := 'cert:c06'; perform c6_cert.mk(k,'CLAIMING',null,told,'3 minutes'); s := c6_cert.snap(k);
  r := c6_cert.claim(k, t2); e := c6_cert.snap(k);
  perform c6_cert.rec('claim','C06 stale claim (3 min) is recovered','token t2', s, r, e,
    r = 'owner=true status=CLAIMING nexus=-' and e like 'status=CLAIMING tok='||left(t2::text,4)||' %claimed=0s ago%');

  -- C07 lease boundary: 119s fresh, 121s stale
  k := 'cert:c07a'; perform c6_cert.mk(k,'CLAIMING',null,told,'119 seconds'); s := c6_cert.snap(k); r := c6_cert.claim(k, t2);
  perform c6_cert.rec('claim','C07a lease boundary: 119s still held','token t2', s, r, c6_cert.snap(k), r like 'owner=false%');
  k := 'cert:c07b'; perform c6_cert.mk(k,'CLAIMING',null,told,'121 seconds'); s := c6_cert.snap(k); r := c6_cert.claim(k, t2);
  perform c6_cert.rec('claim','C07b lease boundary: 121s expired','token t2', s, r, c6_cert.snap(k), r like 'owner=true%');

  -- C08 FAILED (and token-less PENDING) rows are re-claimable
  k := 'cert:c08'; perform c6_cert.mk(k,'FAILED',null,told,'10 seconds'); s := c6_cert.snap(k); r := c6_cert.claim(k, t2);
  perform c6_cert.rec('claim','C08 FAILED row is re-claimable at once','token t2', s, r, c6_cert.snap(k), r like 'owner=true%');
  k := 'cert:c09'; perform c6_cert.mk(k,'PENDING'); s := c6_cert.snap(k); r := c6_cert.claim(k, t2);
  perform c6_cert.rec('claim','C09 PENDING without token is claimable','token t2', s, r, c6_cert.snap(k), r like 'owner=true%');

  perform c6_cert.clean();
end $t$;

-- ───────────────── claim-token fencing (the write the edge performs after a POST) ─────────────────
do $t$
declare t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); k text := 'cert:f01'; s text; e text; n1 int; n2 int; r1 text; r2 text;
begin
  perform c6_cert.clean();
  r1 := c6_cert.claim(k, t1);
  update public.rocksolid_task_links set claimed_at = now() - interval '3 minutes' where dedupe_key = k;   -- worker 1's lease expires
  r2 := c6_cert.claim(k, t2);                                                                              -- worker 2 recovers it
  s := c6_cert.snap(k);
  -- worker 1 (stale) finally persists its result with the same guard the edge uses
  update public.rocksolid_task_links set nexus_task_id = 'STALE-WRITER', status = 'CREATED' where dedupe_key = k and claim_token = t1;
  get diagnostics n1 = row_count;
  e := c6_cert.snap(k);
  perform c6_cert.rec('fencing','F01 old worker cannot overwrite the new owner','w1 claim, lease expires, w2 reclaims, w1 writes (guard claim_token=t1)',
    s, 'rows updated by stale writer = '||n1, e, r1 like 'owner=true%' and r2 like 'owner=true%' and n1 = 0 and e like 'status=CLAIMING tok='||left(t2::text,4)||' nexus=-%');
  update public.rocksolid_task_links set nexus_task_id = 'N-WINNER', status = 'CREATED' where dedupe_key = k and claim_token = t2;
  get diagnostics n2 = row_count;
  perform c6_cert.rec('fencing','F02 current owner can persist its result','w2 writes (guard claim_token=t2)', s, 'rows updated = '||n2, c6_cert.snap(k), n2 = 1 and c6_cert.snap(k) like 'status=CREATED %nexus=N-WINNER%');
  perform c6_cert.clean();
end $t$;

-- ───────────────────────── claim_nexus_reconciliations ─────────────────────────
do $t$
declare tk uuid := gen_random_uuid(); told uuid := gen_random_uuid(); got text; s text; cnt int; one int; zero int; big int; ex text;
begin
  perform c6_cert.clean();
  perform c6_cert.mk('cert:ra','TIMEOUT_UNKNOWN');                                   -- due (never scheduled)
  perform c6_cert.mk('cert:rb','TIMEOUT_UNKNOWN',null,null,null,1,'-5 minutes');     -- due (past)
  perform c6_cert.mk('cert:rc','TIMEOUT_UNKNOWN',null,null,null,1,'30 minutes');     -- not due (future)
  perform c6_cert.mk('cert:rd','TIMEOUT_UNKNOWN',null,null,null,0,null,told,'10 seconds'); -- leased by another worker
  perform c6_cert.mk('cert:re','TIMEOUT_UNKNOWN',null,null,null,0,null,told,'3 minutes');  -- lease expired
  perform c6_cert.mk('cert:rf','CREATED','N-1');                                     -- resolved
  perform c6_cert.mk('cert:rg','FAILED');                                            -- released
  perform c6_cert.mk('cert:rh','TIMEOUT_UNKNOWN','N-2');                             -- inconsistent: has an id
  perform c6_cert.mk('cert:ri','RECONCILE_FAILED');                                  -- terminal

  execute 'set local role service_role';
  select string_agg(dedupe_key, ',' order by dedupe_key), count(*) into got, cnt from public.claim_nexus_reconciliations(10, tk, 120) where dedupe_key like 'cert:%';
  execute 'reset role';
  perform c6_cert.rec('reconcile-claim','RC01 leases exactly the due, unleased TIMEOUT_UNKNOWN rows','limit 10, lease 120s',
    'due: ra,rb,re | not due: rc | leased: rd | other: rf,rg,rh,ri', 'claimed='||got,
    'ra: '||c6_cert.snap('cert:ra')||' || rc: '||c6_cert.snap('cert:rc')||' || rd: '||c6_cert.snap('cert:rd'),
    got = 'cert:ra,cert:rb,cert:re' and cnt = 3
    and c6_cert.snap('cert:ra') like '%rtok='||left(tk::text,4)||'%' and c6_cert.snap('cert:rb') like '%rtok='||left(tk::text,4)||'%'
    and c6_cert.snap('cert:re') like '%rtok='||left(tk::text,4)||'%'
    and c6_cert.snap('cert:rc') like '%rtok=%' is not null and c6_cert.snap('cert:rc') not like '%rtok='||left(tk::text,4)||'%'
    and c6_cert.snap('cert:rd') like '%rtok='||left(told::text,4)||'%');

  -- a second call while leases are held returns nothing for those rows
  execute 'set local role service_role';
  select count(*) into cnt from public.claim_nexus_reconciliations(10, gen_random_uuid(), 120) where dedupe_key like 'cert:%';
  execute 'reset role';
  perform c6_cert.rec('reconcile-claim','RC02 leased rows are not handed to a second worker','second worker, same instant','ra,rb,re leased', 'claimed='||cnt, '-', cnt = 0);

  -- limit handling
  perform c6_cert.clean();
  perform c6_cert.mk('cert:l'||g, 'TIMEOUT_UNKNOWN') from generate_series(1,5) g;
  execute 'set local role service_role';
  select count(*) into one  from public.claim_nexus_reconciliations(1, gen_random_uuid(), 120) where dedupe_key like 'cert:%';
  select count(*) into zero from public.claim_nexus_reconciliations(0, gen_random_uuid(), 120) where dedupe_key like 'cert:%';
  select count(*) into big  from public.claim_nexus_reconciliations(1000, gen_random_uuid(), 120) where dedupe_key like 'cert:%';
  execute 'reset role';
  perform c6_cert.rec('reconcile-claim','RC03 p_limit is honoured (1, 0, over-cap)','5 due rows; limits 1 / 0 / 1000','5 due', format('1->%s 0->%s 1000->%s', one, zero, big), '-', one = 1 and zero = 0 and big = 4);

  -- lease expiry makes a row claimable again
  update public.rocksolid_task_links set reconcile_claimed_at = now() - interval '3 minutes' where dedupe_key like 'cert:l%' and reconcile_claim_token is not null;
  execute 'set local role service_role';
  select count(*) into cnt from public.claim_nexus_reconciliations(100, gen_random_uuid(), 120) where dedupe_key like 'cert:%';
  execute 'reset role';
  perform c6_cert.rec('reconcile-claim','RC04 an abandoned lease is reclaimable after expiry','leases aged 3 min','5 rows leased (expired)','claimed='||cnt,'-', cnt = 5);
  perform c6_cert.clean();
end $t$;

-- ───────────────────────── resolve_nexus_reconciliation ─────────────────────────
do $t$
declare tk uuid := gen_random_uuid(); tw uuid := gen_random_uuid(); k text; s text; r text; e text; id uuid; i int; st text; at int; terminal_at int := null; nexts text := '';
begin
  perform c6_cert.clean();

  -- V01 FOUND with the right lease -> CREATED + id persisted, lease released
  k := 'cert:v01'; perform c6_cert.mk(k,'TIMEOUT_UNKNOWN',null,gen_random_uuid(),'5 minutes',2,null,tk,'5 seconds'); id := c6_cert.id_of(k); s := c6_cert.snap(k);
  r := c6_cert.do_resolve(id, tk, 'FOUND', 'N-FOUND'); e := c6_cert.snap(k);
  perform c6_cert.rec('resolve','V01 FOUND -> CREATED with Nexus id persisted','outcome FOUND, id N-FOUND, right token', s, r, e,
    r = 'applied=true status=CREATED' and e like 'status=CREATED %nexus=N-FOUND %attempts=3 next=- rtok=%' and e not like '%rtok='||left(tk::text,4)||'%');
  -- V02 replay / wrong outcome after resolution is a no-op
  r := c6_cert.do_resolve(id, tk, 'ABSENT'); perform c6_cert.rec('resolve','V02 replay after resolution is a no-op','outcome ABSENT, same token', e, r, c6_cert.snap(k), r = 'applied=false status=CREATED' and c6_cert.snap(k) = e);

  -- V03 wrong token cannot finalize another worker's lease
  k := 'cert:v03'; perform c6_cert.mk(k,'TIMEOUT_UNKNOWN',null,null,null,0,null,tk,'5 seconds'); id := c6_cert.id_of(k); s := c6_cert.snap(k);
  r := c6_cert.do_resolve(id, tw, 'FOUND', 'N-HIJACK');
  perform c6_cert.rec('resolve','V03 wrong lease token cannot finalize','outcome FOUND by a different worker', s, r, c6_cert.snap(k), r = 'applied=false status=TIMEOUT_UNKNOWN' and c6_cert.snap(k) = s);
  -- V04 FOUND without an id is not a resolution
  r := c6_cert.do_resolve(id, tk, 'FOUND', null); perform c6_cert.rec('resolve','V04 FOUND without id is rejected (null)','FOUND, id null', s, r, c6_cert.snap(k), r = 'applied=false status=TIMEOUT_UNKNOWN' and c6_cert.snap(k) = s);
  r := c6_cert.do_resolve(id, tk, 'FOUND', '   '); perform c6_cert.rec('resolve','V04b FOUND without id is rejected (blank)','FOUND, id blank', s, r, c6_cert.snap(k), r = 'applied=false status=TIMEOUT_UNKNOWN' and c6_cert.snap(k) = s);

  -- V05 ABSENT -> FAILED (released), then reclaimable by the producer path
  k := 'cert:v05'; perform c6_cert.mk(k,'TIMEOUT_UNKNOWN',null,gen_random_uuid(),'5 minutes',0,null,tk,'5 seconds'); id := c6_cert.id_of(k); s := c6_cert.snap(k);
  r := c6_cert.do_resolve(id, tk, 'ABSENT'); e := c6_cert.snap(k);
  perform c6_cert.rec('resolve','V05 ABSENT -> FAILED "RECONCILED_ABSENT"','outcome ABSENT', s, r, e, r = 'applied=true status=FAILED' and e like 'status=FAILED %nexus=- %attempts=1%err=RECONCILED_ABSENT%');
  r := c6_cert.claim(k, tw);
  perform c6_cert.rec('resolve','V05b released row is then claimable (producer re-POST path)','claim_nexus_task by producer', e, r, c6_cert.snap(k), r = 'owner=true status=CLAIMING nexus=-');

  -- V06 UNKNOWN stays unresolved with attempts + exponential backoff (10m,20m,40m,...)
  k := 'cert:v06'; perform c6_cert.mk(k,'TIMEOUT_UNKNOWN',null,null,null,0,null,tk,'5 seconds'); id := c6_cert.id_of(k); s := c6_cert.snap(k);
  r := c6_cert.do_resolve(id, tk, 'UNKNOWN', null, 'lookup_unreachable'); e := c6_cert.snap(k);
  perform c6_cert.rec('resolve','V06 UNKNOWN -> stays TIMEOUT_UNKNOWN, attempts+1, backoff','outcome UNKNOWN reason lookup_unreachable', s, r, e,
    r = 'applied=true status=TIMEOUT_UNKNOWN' and e like 'status=TIMEOUT_UNKNOWN %attempts=1 next=10m rtok=%' and e like '%err=TIMEOUT_UNKNOWN: lookup_%' and e not like '%rtok='||left(tk::text,4)||'%');

  -- V07 invalid verdicts are rejected
  begin
    execute 'set local role service_role';
    perform * from public.resolve_nexus_reconciliation(id, tk, 'MAYBE', null, null);
    execute 'reset role';
    perform c6_cert.rec('resolve','V07 invalid outcome is rejected','outcome MAYBE', e, 'no error', '-', false);
  exception when sqlstate '22023' then
    execute 'reset role';
    perform c6_cert.rec('resolve','V07 invalid outcome is rejected','outcome MAYBE', e, 'ERROR 22023 invalid reconciliation outcome', '-', true);
  end;

  -- V08 missing row / inconsistent row (id already set) are no-ops
  r := c6_cert.do_resolve(gen_random_uuid(), tk, 'FOUND', 'N-X'); perform c6_cert.rec('resolve','V08 unknown row id is a no-op','random uuid', '(no row)', r, '-', r = 'applied=false status=MISSING');
  k := 'cert:v09'; perform c6_cert.mk(k,'TIMEOUT_UNKNOWN','N-PRE',null,null,0,null,tk,'5 seconds'); id := c6_cert.id_of(k); s := c6_cert.snap(k);
  r := c6_cert.do_resolve(id, tk, 'ABSENT'); perform c6_cert.rec('resolve','V09 row that already has a Nexus id cannot be released','outcome ABSENT on linked row', s, r, c6_cert.snap(k), r like 'applied=false%' and c6_cert.snap(k) = s);

  perform c6_cert.clean();
end $t$;

-- V10: attempt counting to the terminal threshold, through the REAL claim + resolve RPCs.
-- RECONCILE_FAILED must appear on the 24th inconclusive attempt and not before.
do $t$
declare v_key text := 'cert:v10'; v_id uuid; v_tok uuid; i int; v_st text; v_at int; v_first_terminal int; v_early_terminal boolean := false;
        v_trace text := ''; v_cnt int; v_start text; v_end text; v_c1 text; v_c2 int;
begin
  perform c6_cert.clean();
  perform c6_cert.mk(v_key, 'TIMEOUT_UNKNOWN'); v_id := c6_cert.id_of(v_key); v_start := c6_cert.snap(v_key);
  for i in 1..24 loop
    v_tok := gen_random_uuid();
    update public.rocksolid_task_links set next_reconcile_at = now() - interval '1 minute', reconcile_claimed_at = null where dedupe_key = v_key;
    execute 'set local role service_role';
    select count(*) into v_cnt from public.claim_nexus_reconciliations(5, v_tok, 120) where dedupe_key = v_key;
    execute 'reset role';
    perform c6_cert.do_resolve(v_id, v_tok, 'UNKNOWN', null, 'down');
    select status, reconcile_attempts into v_st, v_at from public.rocksolid_task_links where dedupe_key = v_key;
    if i in (1, 23, 24) then v_trace := v_trace || format('[#%s claimed=%s -> %s attempts=%s] ', i, v_cnt, v_st, v_at); end if;
    if v_st = 'RECONCILE_FAILED' and v_first_terminal is null then v_first_terminal := i; end if;
    if v_st = 'RECONCILE_FAILED' and i < 24 then v_early_terminal := true; end if;
    if v_cnt <> 1 then v_early_terminal := true; end if;  -- every due attempt must have been claimable
  end loop;
  v_end := c6_cert.snap(v_key);
  perform c6_cert.rec('resolve','V10 24 inconclusive attempts -> RECONCILE_FAILED at the 24th, not earlier','24 x (make due, claim, resolve UNKNOWN)', v_start,
    v_trace, v_end, v_first_terminal = 24 and not v_early_terminal and v_end like 'status=RECONCILE_FAILED %attempts=24 next=- rtok=-%err=RECONCILE_EXHAUSTED%');

  -- terminal row: never leased again, never reclaimed by the producer path
  v_tok := gen_random_uuid();
  update public.rocksolid_task_links set next_reconcile_at = null where dedupe_key = v_key;
  execute 'set local role service_role';
  select count(*) into v_c2 from public.claim_nexus_reconciliations(100, v_tok, 120) where dedupe_key = v_key;
  execute 'reset role';
  v_c1 := c6_cert.claim(v_key, v_tok);
  perform c6_cert.rec('resolve','V11 RECONCILE_FAILED is terminal for both claim paths','claim_nexus_reconciliations + claim_nexus_task', v_end,
    format('reconciliation claimed=%s; producer %s', v_c2, v_c1), c6_cert.snap(v_key), v_c2 = 0 and v_c1 = 'owner=false status=RECONCILE_FAILED nexus=-' and c6_cert.snap(v_key) = v_end);
  perform c6_cert.clean();
end $t$;

-- ───────────────────────── privileges (service-only RPCs) ─────────────────────────
do $t$
declare f text; role_name text; has_priv boolean; msg text; blocked boolean; ok_all boolean := true; detail text := '';
begin
  foreach f in array array['public.claim_nexus_task(text,text,text,uuid)',
                           'public.claim_nexus_reconciliations(integer,uuid,integer)',
                           'public.resolve_nexus_reconciliation(uuid,uuid,text,text,text)'] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      has_priv := has_function_privilege(role_name, f, 'EXECUTE');
      detail := detail || format('%s:%s=%s ', split_part(split_part(f,'.',2),'(',1), role_name, has_priv);
      if (role_name = 'service_role') <> has_priv then ok_all := false; end if;
    end loop;
    -- PUBLIC pseudo-role must not hold EXECUTE either
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      ok_all := false; detail := detail || 'PUBLIC=true ';
    end if;
  end loop;
  perform c6_cert.rec('privileges','P01 EXECUTE: service_role only (no anon / authenticated / PUBLIC)','has_function_privilege x 3 functions x 3 roles','-', detail, '-', ok_all);

  foreach role_name in array array['anon','authenticated'] loop
    blocked := false; msg := 'EXECUTED (not blocked)';
    begin
      execute format('set local role %I', role_name);
      perform * from public.claim_nexus_task('cert','cert:p02','cert:p02', gen_random_uuid());
      execute 'reset role';
    exception when insufficient_privilege then
      execute 'reset role'; blocked := true; msg := 'ERROR 42501 permission denied';
    end;
    perform c6_cert.rec('privileges','P02 '||role_name||' cannot call claim_nexus_task','real call as '||role_name,'-', msg, c6_cert.snap('cert:p02'), blocked and c6_cert.snap('cert:p02') = '(no row)');
    blocked := false; msg := 'EXECUTED (not blocked)';
    begin
      execute format('set local role %I', role_name);
      perform * from public.claim_nexus_reconciliations(5, gen_random_uuid(), 120);
      execute 'reset role';
    exception when insufficient_privilege then execute 'reset role'; blocked := true; msg := 'ERROR 42501 permission denied'; end;
    perform c6_cert.rec('privileges','P03 '||role_name||' cannot call claim_nexus_reconciliations','real call as '||role_name,'-', msg,'-', blocked);
    blocked := false; msg := 'EXECUTED (not blocked)';
    begin
      execute format('set local role %I', role_name);
      perform * from public.resolve_nexus_reconciliation(gen_random_uuid(), gen_random_uuid(), 'FOUND', 'N', null);
      execute 'reset role';
    exception when insufficient_privilege then execute 'reset role'; blocked := true; msg := 'ERROR 42501 permission denied'; end;
    perform c6_cert.rec('privileges','P04 '||role_name||' cannot call resolve_nexus_reconciliation','real call as '||role_name,'-', msg,'-', blocked);
  end loop;
  perform c6_cert.clean();
end $t$;

-- ───────────────────────── report ─────────────────────────
select format('%s | %s | in: %s | start: %s | returned: %s | end: %s | %s',
  name, grp, input, start_state, returned, end_state, case when pass then 'PASS' else 'FAIL' end)
from c6_cert.results order by n;

select format('SUMMARY: %s cases, %s PASS, %s FAIL', count(*), count(*) filter (where pass), count(*) filter (where not pass)) from c6_cert.results;

do $t$ begin
  if exists (select 1 from c6_cert.results where not pass) then
    raise exception 'C6 RPC certification FAILED: %', (select string_agg(name, '; ') from c6_cert.results where not pass);
  end if;
end $t$;

drop schema c6_cert cascade;
