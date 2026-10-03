#!/usr/bin/env bash
# C6 claim_nexus_task: real-Postgres concurrency + semantics regression.
#
# Certified defect (b13b7e5): simultaneous FIRST claims of one dedupe_key raised 23505 for the losers
# (143 of 400 calls). Required: exactly one owner, every other caller answered is_owner=false, ZERO exceptions.
#
# CC01  N simultaneous first claims of the same key -> exactly 1 owner, 0 errors, 1 row   (repeated over rounds)
# CC02  a FAILED row is re-claimable
# CC03  TIMEOUT_UNKNOWN and RECONCILE_FAILED are never re-claimed (even with an ancient claim)
# CC04  a live lease is respected; an expired lease is recovered with a NEW token (old token fenced)
# CC05  a completed row returns its canonical id and is never owned
# CC06  ASSIGNEE_REJECTED is terminal: never re-claimed by the producer path
#
# Real psql processes are released together through an advisory-lock barrier, so the claim calls genuinely
# overlap. Requires psql and a database that has the full migration chain applied.
#
# Run:  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#         bash supabase/tests/security/c6-claim-concurrency.test.sh
# Env:  C6_CC_KEYS (default 8) keys per round, C6_CC_WORKERS (default 6) workers per key, C6_CC_ROUNDS (default 3).
set -uo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
KEYS="${C6_CC_KEYS:-8}"
WORKERS="${C6_CC_WORKERS:-6}"
ROUNDS="${C6_CC_ROUNDS:-3}"
BARRIER=7770601
PSQL=(psql "$DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1)

FAIL=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }
sql()  { "${PSQL[@]}" -c "$1" 2>&1; }
val()  { "${PSQL[@]}" -c "$1" 2>/dev/null | head -1 | tr -d '[:space:]'; }

WORK="$(mktemp -d)"
cleanup() {
  "${PSQL[@]}" -c "delete from public.rocksolid_task_links where dedupe_key like 'c6cc:%'" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if ! "${PSQL[@]}" -c "select 1" >/dev/null 2>&1; then
  echo "ERROR: cannot connect with DATABASE_URL"; exit 2
fi
if [ "$(val "select count(*) from pg_proc where proname='claim_nexus_task'")" != "1" ]; then
  echo "ERROR: claim_nexus_task is not installed (apply the migration chain first)"; exit 2
fi
cleanup_rows() { "${PSQL[@]}" -c "delete from public.rocksolid_task_links where dedupe_key like 'c6cc:%'" >/dev/null 2>&1; }
cleanup_rows

claim() { # key token -> "owner|status|nexus_task_id"
  sql "select is_owner||'|'||status||'|'||coalesce(nexus_task_id,'') from public.claim_nexus_task('c6cc','$1','c6cc:$1','$2'::uuid)" | tail -1
}

echo "========================================"
echo "C6 CLAIM CONCURRENCY — $KEYS keys x $WORKERS workers x $ROUNDS rounds (real, overlapping psql sessions)"
echo "========================================"

TOTAL_ERRORS=0; TOTAL_CALLS=0; BAD_KEYS=0
for round in $(seq 1 "$ROUNDS"); do
  RD="$WORK/r$round"; mkdir -p "$RD"
  # Barrier holder: takes the exclusive advisory lock, keeps it until the workers are all connected, then exits.
  ( "${PSQL[@]}" -c "select pg_advisory_lock($BARRIER); select pg_sleep(${C6_CC_HOLD:-4});" >/dev/null 2>&1 ) &
  HOLDER=$!
  for _ in $(seq 1 100); do
    [ "$(val "select count(*) from pg_locks where locktype='advisory' and granted and objid=$BARRIER")" = "1" ] && break
    sleep 0.05
  done
  PIDS=()
  for k in $(seq 1 "$KEYS"); do
    for w in $(seq 1 "$WORKERS"); do
      tok="$(cat /proc/sys/kernel/random/uuid)"
      (
        "${PSQL[@]}" \
          -c "select pg_advisory_lock_shared($BARRIER)" \
          -c "select is_owner||'|'||status from public.claim_nexus_task('c6cc','r${round}k${k}','c6cc:r${round}k${k}','$tok'::uuid)" \
          > "$RD/k${k}_w${w}.out" 2> "$RD/k${k}_w${w}.err"
        echo $? > "$RD/k${k}_w${w}.rc"
      ) &
      PIDS+=($!)
    done
  done
  # wait for every worker to be parked on the barrier, then release them all at once
  for _ in $(seq 1 200); do
    waiting=$(val "select count(*) from pg_locks where locktype='advisory' and not granted and objid=$BARRIER")
    [ "${waiting:-0}" -ge $((KEYS * WORKERS)) ] && break
    sleep 0.05
  done
  kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
  wait "${PIDS[@]}" 2>/dev/null

  for k in $(seq 1 "$KEYS"); do
    owners=0; errs=0
    for w in $(seq 1 "$WORKERS"); do
      TOTAL_CALLS=$((TOTAL_CALLS + 1))
      rc=$(cat "$RD/k${k}_w${w}.rc" 2>/dev/null || echo 99)
      if [ "$rc" != "0" ] || [ -s "$RD/k${k}_w${w}.err" ]; then errs=$((errs + 1)); continue; fi
      grep -q '^true|' "$RD/k${k}_w${w}.out" && owners=$((owners + 1))
    done
    TOTAL_ERRORS=$((TOTAL_ERRORS + errs))
    rows=$(val "select count(*) from public.rocksolid_task_links where dedupe_key='c6cc:r${round}k${k}'")
    if [ "$owners" != "1" ] || [ "$rows" != "1" ]; then BAD_KEYS=$((BAD_KEYS + 1)); echo "    round $round key $k: owners=$owners rows=$rows errors=$errs"; fi
  done
done

[ "$TOTAL_ERRORS" = "0" ] && pass "CC01 no exceptions across $TOTAL_CALLS simultaneous claims (unique violations = 0)" \
  || { fail "CC01 $TOTAL_ERRORS of $TOTAL_CALLS concurrent claims raised an error"; for f in "$WORK"/r*/*.err; do [ -s "$f" ] && { head -2 "$f"; break; }; done; }
[ "$BAD_KEYS" = "0" ] && pass "CC01 exactly one owner and exactly one row per key ($((KEYS * ROUNDS)) keys)" \
  || fail "CC01 $BAD_KEYS keys did not end with exactly one owner / one row"

echo ""
echo "SEMANTICS preserved by the conflict-safe claim"
T1="$(cat /proc/sys/kernel/random/uuid)"; T2="$(cat /proc/sys/kernel/random/uuid)"

r=$(claim s-failed "$T1"); [ "${r%%|*}" = "true" ] || fail "CC02 setup: first claim should own ($r)"
sql "update public.rocksolid_task_links set status='FAILED' where dedupe_key='c6cc:s-failed'" >/dev/null
r=$(claim s-failed "$T2"); [ "${r%%|*}" = "true" ] && pass "CC02 FAILED row is re-claimable immediately" || fail "CC02 FAILED row was not re-claimable ($r)"

for st in TIMEOUT_UNKNOWN RECONCILE_FAILED; do
  claim "s-$st" "$T1" >/dev/null
  sql "update public.rocksolid_task_links set status='$st', claimed_at = now() - interval '1 day' where dedupe_key='c6cc:s-$st'" >/dev/null
  r=$(claim "s-$st" "$T2")
  [ "${r%%|*}" = "false" ] && [ "$(echo "$r" | cut -d'|' -f2)" = "$st" ] && pass "CC03 $st is never re-claimed (ancient claim ignored)" || fail "CC03 $st was re-claimed or changed ($r)"
done

claim s-lease "$T1" >/dev/null
r=$(claim s-lease "$T2"); [ "${r%%|*}" = "false" ] && pass "CC04 live lease is not stolen" || fail "CC04 live lease stolen ($r)"
sql "update public.rocksolid_task_links set claimed_at = now() - interval '3 minutes' where dedupe_key='c6cc:s-lease'" >/dev/null
r=$(claim s-lease "$T2"); [ "${r%%|*}" = "true" ] && pass "CC04 expired lease is recovered by the new caller" || fail "CC04 expired lease not recovered ($r)"
old=$(val "update public.rocksolid_task_links set nexus_task_id='STALE', status='CREATED' where dedupe_key='c6cc:s-lease' and claim_token='$T1'::uuid returning 1")
[ -z "$old" ] && pass "CC04 the superseded worker's token is fenced out (0 rows)" || fail "CC04 stale token still writes"

claim s-done "$T1" >/dev/null
sql "update public.rocksolid_task_links set nexus_task_id='NX-1', status='CREATED' where dedupe_key='c6cc:s-done'" >/dev/null
r=$(claim s-done "$T2"); [ "$r" = "false|CREATED|NX-1" ] && pass "CC05 completed row returns its canonical id, not owned" || fail "CC05 unexpected ($r)"

claim s-rej "$T1" >/dev/null
sql "update public.rocksolid_task_links set status='ASSIGNEE_REJECTED', claimed_at = now() - interval '1 day' where dedupe_key='c6cc:s-rej'" >/dev/null
r=$(claim s-rej "$T2")
[ "$r" = "false|ASSIGNEE_REJECTED|" ] && pass "CC06 ASSIGNEE_REJECTED is terminal: never re-claimed by the producer path" || fail "CC06 ASSIGNEE_REJECTED was re-claimed or changed ($r)"
sql "update public.rocksolid_task_links set status='FAILED' where dedupe_key='c6cc:s-rej'" >/dev/null
r=$(claim s-rej "$T2"); [ "${r%%|*}" = "true" ] && pass "CC06 operator release (-> FAILED) makes it claimable again" || fail "CC06 released row not claimable ($r)"

echo ""
if [ "$FAIL" -ne 0 ]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: ALL PASS"
