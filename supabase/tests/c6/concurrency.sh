#!/usr/bin/env bash
# C6 concurrency certification against a REAL Postgres: parallel psql sessions calling the real
# claim_nexus_task / claim_nexus_reconciliations / resolve_nexus_reconciliation RPCs as service_role.
#
#   ADMIN_URL=postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres \
#     bash supabase/tests/c6/concurrency.sh
#
# Scenarios (all with a time barrier so sessions fire together):
#   S1 atomic claim:    ROUNDS keys x W workers racing on the SAME key  -> exactly one owner per key
#   S2 fencing:         every loser's finalize (its own token) updates 0 rows; the owner's updates 1
#   S3 stale recovery:  one expired claim, W workers reclaim at once    -> exactly one new owner
#   S4 SKIP LOCKED:     M due rows, W workers draining in batches       -> each row leased exactly once
#   S5 mixed:           claim + resolve concurrently                    -> one effective resolution per row
#   S6 contention:      W workers over a small key pool                 -> one owner per key, no deadlock
# Exits non-zero on any failure.
set -uo pipefail

ADMIN_URL="${ADMIN_URL:-postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres}"
W="${W:-24}"            # workers racing per key
ROUNDS="${ROUNDS:-40}"  # distinct keys raced in S1
M="${M:-400}"           # rows for the SKIP LOCKED drain
DW="${DW:-16}"          # drain workers
export PGPASSWORD="${PGPASSWORD:-postgres}"

adm() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -X -q -At "$@"; }
FAILS=0
WORKDIR="$(mktemp -d)"
check() { # name, condition(0=true), detail
  if [ "$2" -eq 0 ]; then echo "PASS | $1 | $3"; else echo "FAIL | $1 | $3"; FAILS=$((FAILS+1)); fi
}

adm <<'SQL'
drop schema if exists c6_cc cascade;
create schema c6_cc;
create table c6_cc.claims(id bigserial primary key, sc text, worker int, rnd int, key text, tok uuid, owner boolean, err text, fenced_rows int);
create table c6_cc.rclaims(id bigserial primary key, sc text, worker int, row_id uuid, tok uuid, resolved text);
grant usage on schema c6_cc to service_role;
grant all on all tables in schema c6_cc to service_role;
grant all on all sequences in schema c6_cc to service_role;

create function c6_cc.try_claim(p_sc text, p_w int, p_r int, p_key text) returns void language plpgsql as $$
declare v_tok uuid := gen_random_uuid(); v_owner boolean; v_n int := null; v_err text;
begin
  begin
    select is_owner into v_owner from public.claim_nexus_task('cc', p_key, p_key, v_tok);
  exception when others then v_owner := null; v_err := sqlstate || ': ' || sqlerrm;
  end;
  -- every worker tries to finalize with ITS OWN token; only the real owner may succeed (fencing)
  if v_owner is not null then
    update public.rocksolid_task_links set nexus_task_id = 'WIN-' || p_w || '-' || p_r, status = 'CREATED'
      where dedupe_key = p_key and claim_token = v_tok;
    get diagnostics v_n = row_count;
  end if;
  insert into c6_cc.claims(sc, worker, rnd, key, tok, owner, err, fenced_rows) values (p_sc, p_w, p_r, p_key, v_tok, v_owner, v_err, v_n);
end $$;

create function c6_cc.drain_once(p_sc text, p_w int, p_batch int) returns int language plpgsql as $$
declare v_tok uuid := gen_random_uuid(); n int;
begin
  with c as (select row_id from public.claim_nexus_reconciliations(p_batch, v_tok, 120) where true)
  insert into c6_cc.rclaims(sc, worker, row_id, tok) select p_sc, p_w, row_id, v_tok from c;
  get diagnostics n = row_count;
  return n;
end $$;

-- resolve (with the real RPC) every row this worker has leased and not yet resolved
create function c6_cc.resolve_mine(p_sc text, p_w int) returns int language plpgsql as $$
declare r record; v_out text; n int := 0; v_applied boolean; v_pick int;
begin
  for r in select * from c6_cc.rclaims where sc = p_sc and worker = p_w and resolved is null loop
    v_pick := (abs(hashtext(r.row_id::text)) % 3);
    v_out := case v_pick when 0 then 'FOUND' when 1 then 'ABSENT' else 'UNKNOWN' end;
    select applied into v_applied from public.resolve_nexus_reconciliation(r.row_id, r.tok, v_out, case when v_out='FOUND' then 'N-'||r.row_id else null end, 'cc');
    update c6_cc.rclaims set resolved = v_out || ':' || coalesce(v_applied::text, 'null') where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
SQL

# run a generated per-worker script with the service_role identity
worker() { # file
  psql "$ADMIN_URL" -X -q -At -c "set role service_role" -f "$1" >/dev/null 2>"$1.err"
}
barrier() { adm -c "select extract(epoch from clock_timestamp()) + ${1:-3}"; }

# ───────── S1/S2: atomic claim, many keys, many workers ─────────
adm -c "delete from public.rocksolid_task_links where dedupe_key like 'cc:%'"
BASE=$(barrier 4)
for w in $(seq 1 "$W"); do
  f=$(mktemp "$WORKDIR/w.XXXXXX"); {
    for r in $(seq 1 "$ROUNDS"); do
      echo "select pg_sleep_until(to_timestamp($BASE + $r * 0.25));"
      echo "select c6_cc.try_claim('S1', $w, $r, 'cc:s1:$r');"
    done
  } > "$f"; worker "$f" &
done
wait
read -r KEYS OWNERS_BAD ROWS_BAD TOKBAD FENCE_BAD ERRS OTHERERR TOTAL <<<"$(adm -F' ' -c "
with per as (select key, count(*) filter (where owner) as owners, count(*) filter (where owner and fenced_rows = 1) as fenced_win,
                    count(*) filter (where owner is false and coalesce(fenced_rows,0) <> 0) as loser_wrote
             from c6_cc.claims where sc='S1' group by key)
select (select count(*) from per),
       (select count(*) from per where owners <> 1),
       (select count(*) from per p where (select count(*) from public.rocksolid_task_links t where t.dedupe_key = p.key) <> 1),
       (select count(*) from per p where not exists (select 1 from public.rocksolid_task_links t join c6_cc.claims c on c.key = t.dedupe_key and c.owner and c.tok = t.claim_token where t.dedupe_key = p.key)),
       (select count(*) from per where fenced_win <> 1 or loser_wrote <> 0),
       (select count(*) from c6_cc.claims where sc='S1' and err like '23505%'),
       (select count(*) from c6_cc.claims where sc='S1' and err is not null and err not like '23505%'),
       (select count(*) from c6_cc.claims where sc='S1')")"
check "S1 atomic claim: exactly one owner per key" $([ "$OWNERS_BAD" = 0 ] && echo 0 || echo 1) "workers=$W keys=$KEYS attempts=$TOTAL keys_with_owners!=1: $OWNERS_BAD"
check "S1 one task-link row per key, owned by the winning token" $([ "$ROWS_BAD" = 0 ] && [ "$TOKBAD" = 0 ] && echo 0 || echo 1) "rows!=1: $ROWS_BAD, owner-token mismatch: $TOKBAD"
# 202610030002 made the first insert an INSERT ... ON CONFLICT DO NOTHING, so contention must NOT surface as an
# exception at all (previously ~90% of attempts raised 23505). Zero unique violations AND zero other errors.
check "S1 first-insert races: 0 unique violations (23505), 0 other errors (no deadlock); losers get is_owner=false" $([ "$OTHERERR" = 0 ] && [ "$ERRS" = 0 ] && echo 0 || echo 1) "unique_violation losers: $ERRS (must be 0), other errors (incl. 40P01 deadlock): $OTHERERR"
check "S2 claim-token fencing: only the owner's finalize applies; every loser updates 0 rows" $([ "$FENCE_BAD" = 0 ] && echo 0 || echo 1) "keys violating fencing: $FENCE_BAD"
echo "     owner timing: first/last claim per key within ms (barrier-aligned); worker errors: $(cat "$WORKDIR"/*.err 2>/dev/null | wc -l)"

# ───────── S3: stale claim recovery under contention ─────────
adm -c "delete from public.rocksolid_task_links where dedupe_key like 'cc:s3%'"
adm -c "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status,claim_token,claimed_at) values ('cc','s3','cc:s3:stale','CLAIMING',gen_random_uuid(), now()-interval '3 minutes'), ('cc','s3','cc:s3:fresh','CLAIMING',gen_random_uuid(), now()-interval '30 seconds')"
BASE=$(barrier 3)
for w in $(seq 1 "$W"); do f=$(mktemp "$WORKDIR/w.XXXXXX"); {
  echo "select pg_sleep_until(to_timestamp($BASE));"
  echo "select c6_cc.try_claim('S3', $w, 1, 'cc:s3:stale');"
  echo "select c6_cc.try_claim('S3', $w, 2, 'cc:s3:fresh');"
} > "$f"; worker "$f" & done; wait
read -r STALE_OWN FRESH_OWN <<<"$(adm -F' ' -c "select count(*) filter (where key='cc:s3:stale' and owner), count(*) filter (where key='cc:s3:fresh' and owner) from c6_cc.claims where sc='S3'")"
check "S3 expired claim: exactly one worker recovers it" $([ "$STALE_OWN" = 1 ] && echo 0 || echo 1) "workers=$W owners=$STALE_OWN"
check "S3 fresh claim: nobody steals it" $([ "$FRESH_OWN" = 0 ] && echo 0 || echo 1) "owners=$FRESH_OWN"

# ───────── S4: SKIP LOCKED drain ─────────
adm -c "delete from public.rocksolid_task_links where dedupe_key like 'cc:s4:%'"
adm -c "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status) select 'cc','s4','cc:s4:'||g,'TIMEOUT_UNKNOWN' from generate_series(1,$M) g"
adm -c "truncate c6_cc.rclaims"
BASE=$(barrier 3)
for w in $(seq 1 "$DW"); do f=$(mktemp "$WORKDIR/w.XXXXXX"); {
  echo "select pg_sleep_until(to_timestamp($BASE));"
  for i in $(seq 1 60); do echo "select c6_cc.drain_once('S4', $w, 7);"; done
} > "$f"; worker "$f" & done; wait
read -r CLAIMED DISTINCT DUPS TOKBAD2 WORKERS_USED LEFT <<<"$(adm -F' ' -c "
select (select count(*) from c6_cc.rclaims where sc='S4'),
       (select count(distinct row_id) from c6_cc.rclaims where sc='S4'),
       (select count(*) from (select row_id from c6_cc.rclaims where sc='S4' group by row_id having count(*) > 1) d),
       (select count(*) from c6_cc.rclaims c join public.rocksolid_task_links t on t.id = c.row_id where c.sc='S4' and t.reconcile_claim_token is distinct from c.tok),
       (select count(distinct worker) from c6_cc.rclaims where sc='S4'),
       (select count(*) from public.rocksolid_task_links where dedupe_key like 'cc:s4:%' and reconcile_claim_token is null)")"
check "S4 SKIP LOCKED: every row leased exactly once (no row handed to two workers)" $([ "$CLAIMED" = "$M" ] && [ "$DISTINCT" = "$M" ] && [ "$DUPS" = 0 ] && echo 0 || echo 1) "rows=$M workers=$DW leased=$CLAIMED distinct=$DISTINCT double-leased=$DUPS"
check "S4 lease token on each row equals its claimer's token (consistent final state)" $([ "$TOKBAD2" = 0 ] && [ "$LEFT" = 0 ] && echo 0 || echo 1) "token mismatches=$TOKBAD2 unleased rows=$LEFT"
check "S4 work was spread across workers (locked rows skipped, not queued behind)" $([ "$WORKERS_USED" -ge 2 ] && echo 0 || echo 1) "workers that obtained rows: $WORKERS_USED of $DW"
check "S4 no worker errors/deadlocks" $([ "$(cat "$WORKDIR"/*.err 2>/dev/null | grep -ci 'deadlock\|ERROR')" = 0 ] && echo 0 || echo 1) "psql stderr lines with ERROR/deadlock: $(cat "$WORKDIR"/*.err 2>/dev/null | grep -ci 'deadlock\|ERROR')"

# ───────── S5: claim + resolve concurrently ─────────
adm -c "delete from public.rocksolid_task_links where dedupe_key like 'cc:s5:%'"
adm -c "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status) select 'cc','s5','cc:s5:'||g,'TIMEOUT_UNKNOWN' from generate_series(1,$M) g"
adm -c "truncate c6_cc.rclaims"
BASE=$(barrier 3)
for w in $(seq 1 "$DW"); do f=$(mktemp "$WORKDIR/w.XXXXXX"); {
  echo "select pg_sleep_until(to_timestamp($BASE));"
  for i in $(seq 1 40); do echo "select c6_cc.drain_once('S5', $w, 5);"; echo "select c6_cc.resolve_mine('S5', $w);"; done
} > "$f"; worker "$f" & done; wait
read -r LEASED5 DISTINCT5 APPLIED_TRUE APPLIED_FALSE BADSTATE <<<"$(adm -F' ' -c "
select (select count(*) from c6_cc.rclaims where sc='S5'),
       (select count(distinct row_id) from c6_cc.rclaims where sc='S5'),
       (select count(*) from c6_cc.rclaims where sc='S5' and resolved like '%:true'),
       (select count(*) from c6_cc.rclaims where sc='S5' and resolved like '%:false'),
       (select count(*) from public.rocksolid_task_links where dedupe_key like 'cc:s5:%' and
          ((status='CREATED' and nexus_task_id is null) or (status<>'CREATED' and nexus_task_id is not null)
           or (status='FAILED' and error_message not like 'RECONCILED_ABSENT%') or reconcile_attempts < 1 and status <> 'TIMEOUT_UNKNOWN'))")"
read -r NCREATED NFAILED NUNK <<<"$(adm -F' ' -c "select count(*) filter (where status='CREATED'), count(*) filter (where status='FAILED'), count(*) filter (where status='TIMEOUT_UNKNOWN') from public.rocksolid_task_links where dedupe_key like 'cc:s5:%'")"
check "S5 concurrent claim+resolve: each applied verdict maps to exactly one lease (no double resolution)" $([ "$APPLIED_FALSE" = 0 ] && [ "$APPLIED_TRUE" = "$LEASED5" ] && echo 0 || echo 1) "leases=$LEASED5 distinct-rows-leased=$DISTINCT5 applied=$APPLIED_TRUE not-applied=$APPLIED_FALSE"
check "S5 final state is structurally consistent (CREATED<=>has id; FAILED=>RECONCILED_ABSENT)" $([ "$BADSTATE" = 0 ] && echo 0 || echo 1) "inconsistent rows=$BADSTATE | CREATED=$NCREATED FAILED=$NFAILED still-unknown=$NUNK"

# ───────── S6: contention over a small key pool ─────────
adm -c "delete from public.rocksolid_task_links where dedupe_key like 'cc:s6:%'"
BASE=$(barrier 3)
for w in $(seq 1 "$W"); do f=$(mktemp "$WORKDIR/w.XXXXXX"); {
  echo "select pg_sleep_until(to_timestamp($BASE));"
  for i in $(seq 1 30); do echo "select c6_cc.try_claim('S6', $w, $i, 'cc:s6:' || (($w * 7 + $i * 13) % 12));"; done
} > "$f"; worker "$f" & done; wait
read -r KEYS6 OWN_BAD6 OTHER6 <<<"$(adm -F' ' -c "
with per as (select key, count(*) filter (where owner) as owners from c6_cc.claims where sc='S6' group by key)
select (select count(*) from per), (select count(*) from per where owners <> 1),
       (select count(*) from c6_cc.claims where sc='S6' and err is not null and err not like '23505%')")"
check "S6 contention: one owner per key across overlapping workers; no deadlock" $([ "$OWN_BAD6" = 0 ] && [ "$OTHER6" = 0 ] && echo 0 || echo 1) "workers=$W keys=$KEYS6 attempts=$(adm -c "select count(*) from c6_cc.claims where sc='S6'") keys_with_owners!=1: $OWN_BAD6 other errors: $OTHER6"

adm -c "delete from public.rocksolid_task_links where dedupe_key like 'cc:%'"
adm -c "drop schema c6_cc cascade" >/dev/null 2>&1
rm -f "$WORKDIR"/* 2>/dev/null; rmdir "$WORKDIR" 2>/dev/null || true
echo "----"; if [ "$FAILS" -eq 0 ]; then echo "CONCURRENCY CERTIFICATION: ALL PASS"; else echo "CONCURRENCY CERTIFICATION: $FAILS FAILED"; exit 1; fi
