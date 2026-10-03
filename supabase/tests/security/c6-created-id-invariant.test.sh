#!/usr/bin/env bash
# C6: CREATED => nexus_task_id invariant, on a fresh chain AND against legacy data.
#
# CI01  constraint exists on a database that has the migration chain
# CI02  CREATED without a nexus_task_id is rejected (INSERT and UPDATE); other states stay unconstrained
# CI03  legacy upgrade: pre-existing CREATED/NULL rows do NOT fail the migration; the constraint is added
#       NOT VALID (convalidated = false), still rejects NEW violations, and a warning names the count
# CI04  the legacy violator is not touched and is re-claimable by claim_nexus_task (self-heals via a same-key POST)
# CI05  once the legacy row is resolved the constraint can be validated; re-applying the migration is idempotent
#
# Mutates (and restores) the constraint inside the target database; use a scratch / local database only.
set -uo pipefail
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$HERE/../../migrations/202610030003_rocksolid_task_links_created_requires_id.sql"
CON=rocksolid_task_links_created_requires_nexus_task_id
PSQL=(psql "$DATABASE_URL" -X -q -t -A)
FAIL=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAIL=1; }
val() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null | head -1 | tr -d '[:space:]'; }
sql() { "${PSQL[@]}" -c "$1" 2>&1; }
# matches(<sql>, <text>): run the statement, capture ALL output first (psql exits 1 on error; avoid pipefail), then grep
matches() { local o; o="$(sql "$1")"; grep -q -i -- "$2" <<<"$o"; }
clean() { "${PSQL[@]}" -c "delete from public.rocksolid_task_links where dedupe_key like 'c6ci:%'" >/dev/null 2>&1; }
trap clean EXIT

"${PSQL[@]}" -c "select 1" >/dev/null 2>&1 || { echo "ERROR: cannot connect"; exit 2; }
clean
echo "========================================"
echo "C6 CREATED/nexus_task_id INVARIANT"
echo "========================================"

[ "$(val "select count(*) from pg_constraint where conname='$CON'")" = "1" ] && pass "CI01 constraint exists" || fail "CI01 constraint missing"

matches "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status,nexus_task_id) values ('t','1','c6ci:a','CREATED',null)" "violates check constraint" \
  && pass "CI02 INSERT of CREATED without an id is rejected" || fail "CI02 INSERT of CREATED/NULL accepted"
sql "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status) values ('t','1','c6ci:b','CLAIMING')" >/dev/null
matches "update public.rocksolid_task_links set status='CREATED' where dedupe_key='c6ci:b'" "violates check constraint" \
  && pass "CI02 UPDATE to CREATED without an id is rejected" || fail "CI02 UPDATE to CREATED/NULL accepted"
ok=1
for st in PENDING CLAIMING FAILED TIMEOUT_UNKNOWN RECONCILE_FAILED; do
  matches "update public.rocksolid_task_links set status='$st' where dedupe_key='c6ci:b'" "error" && ok=0
done
[ "$ok" = "1" ] && pass "CI02 no constraint invented for PENDING/CLAIMING/FAILED/TIMEOUT_UNKNOWN/RECONCILE_FAILED" || fail "CI02 a non-CREATED state was rejected"
matches "update public.rocksolid_task_links set status='CREATED', nexus_task_id='NX' where dedupe_key='c6ci:b'" "error" \
  && fail "CI02 valid CREATED+id was rejected" || pass "CI02 CREATED with an id is accepted"

echo ""
echo "LEGACY UPGRADE (constraint dropped, legacy-shaped rows written, migration re-applied)"
sql "alter table public.rocksolid_task_links drop constraint if exists $CON" >/dev/null
sql "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status,nexus_task_id,clickup_task_id) values ('missed_class','L1','c6ci:legacy','CREATED',null,'CU-OLD')" >/dev/null
out=$("${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1); rc=$?
[ "$rc" = "0" ] && pass "CI03 migration applies over legacy CREATED/NULL data (exit 0)" || fail "CI03 migration failed on legacy data: $out"
grep -q "1 legacy CREATED row" <<<"$out" && pass "CI03 a warning reports the legacy row count" || fail "CI03 no warning for legacy rows"
[ "$(val "select convalidated from pg_constraint where conname='$CON'")" = "f" ] && pass "CI03 constraint left NOT VALID while legacy rows exist" || fail "CI03 constraint unexpectedly validated"
matches "insert into public.rocksolid_task_links(source_type,source_id,dedupe_key,status,nexus_task_id) values ('t','2','c6ci:new','CREATED',null)" "violates check constraint" \
  && pass "CI03 NEW violations are still rejected while NOT VALID" || fail "CI03 NOT VALID constraint does not protect new writes"
[ "$(val "select nexus_task_id is null and clickup_task_id='CU-OLD' and status='CREATED' from public.rocksolid_task_links where dedupe_key='c6ci:legacy'")" = "t" ] \
  && pass "CI04 the legacy row was left untouched (no invented id)" || fail "CI04 legacy row modified"
r=$(sql "select is_owner from public.claim_nexus_task('missed_class','L1','c6ci:legacy',gen_random_uuid())" | tail -1)
[ "$r" = "t" ] && pass "CI04 the legacy violator is re-claimable (self-heals via a same-key POST)" || fail "CI04 legacy violator not re-claimable ($r)"

sql "update public.rocksolid_task_links set status='FAILED' where dedupe_key='c6ci:legacy'" >/dev/null
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$MIG" >/dev/null 2>&1 && [ "$(val "select convalidated from pg_constraint where conname='$CON'")" = "t" ] \
  && pass "CI05 re-applying once no violator remains validates the constraint (idempotent)" || fail "CI05 migration not idempotent / did not validate"

echo ""
[ "$FAIL" -ne 0 ] && { echo "RESULT: FAIL"; exit 1; }
echo "RESULT: ALL PASS"
