#!/usr/bin/env bash
# Reproducible PostgreSQL 17 rehearsal for migration 202610220100 and its rollback.
#
# SYNTHETIC DATA ONLY. Never point this at a real database: it creates its own throwaway cluster
# in a temp directory, on a private port, and deletes it at the end.
#
# Requires a PostgreSQL 17 installation. Set PG_BIN to its bin directory, for example:
#   PG_BIN="/c/Program Files/PostgreSQL/17/bin" bash supabase/tests/class-options-repair/run.sh
#
# Exit code 0 = all checks passed. Any failure prints FAIL and exits 1.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/202610220100_repair_class_options_registration_columns.sql"
ROLLBACK="$ROOT/supabase/ops/202610220100_rollback_class_options_repair.sql"
SETUP="$HERE/00_setup.sql"

PG_BIN="${PG_BIN:?set PG_BIN to a PostgreSQL 17 bin directory}"
PORT="${PG_PORT:-55439}"
DB="rehearsal"
WORK="$(mktemp -d)"
DATA="$WORK/data"
LOG="$WORK/server.log"

exe() { if [ -x "$PG_BIN/$1.exe" ]; then echo "$PG_BIN/$1.exe"; else echo "$PG_BIN/$1"; fi; }
PSQL="$(exe psql)"; INITDB="$(exe initdb)"; PGCTL="$(exe pg_ctl)"
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  PASS  $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }
check() { # check "name" command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi
}

# q: run psql against the rehearsal database as the superuser, stopping on the first error.
q() { "$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }
# qv: like q, but prints only the last line of output (drops the "SET" lines psql prints for set role).
qv() { q -tA "$@" | tail -n 1; }

# expect_fail "name" "regex" -- command...   (passes if the command fails AND its output matches the regex)
expect_fail() {
  local name="$1" pattern="$2"; shift 2
  local out; out="$("$@" 2>&1)"; local rc=$?
  if [ $rc -ne 0 ] && echo "$out" | grep -qE "$pattern"; then ok "$name"; else bad "$name (rc=$rc)"; echo "$out" | sed 's/^/        /' | head -5; fi
}

cleanup() {
  "$PGCTL" -D "$(native "$DATA")" -m fast -w stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

ORIG_COLUMNS="select class_option_id, class_id, teacher_id, teacher_name, fellowship_codes, group_id, subgroup_id, day, class_time, active, enrollment_open, max_capacity, label_suffix, deleted_at, created_by, updated_by, created_at, updated_at from public.class_options"
checksum_original() { qv -c "select md5(string_agg(row_to_json(x)::text, '|' order by class_option_id)) from ($ORIG_COLUMNS) x"; }
REGISTRATION_QUERY="select class_option_id, class_id, fellowship_codes, teacher_id, teacher_name, day, class_time, active, is_online, confirmed_start_date from public.class_options where active = true and enrollment_open = true and deleted_at is null"
registration_as_anon() { qv -c "set role anon" -c "select count(*) from ($REGISTRATION_QUERY) r"; }

echo "== class_options repair rehearsal (PostgreSQL 17, synthetic data) =="
echo "   workdir: $WORK"

# --- cluster -----------------------------------------------------------------
"$INITDB" -D "$(native "$DATA")" -U postgres --auth=trust -E UTF8 >"$WORK/initdb.log" 2>&1 || { echo "initdb failed"; cat "$WORK/initdb.log"; exit 1; }
"$PGCTL" -D "$(native "$DATA")" -o "-p $PORT -h 127.0.0.1" -l "$(native "$LOG")" -w start >"$WORK/start.log" 2>&1 || { echo "pg_ctl start failed"; cat "$WORK/start.log"; exit 1; }
VERSION="$("$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'show server_version')"
case "$VERSION" in
  17.*) ok "server is PostgreSQL 17 ($VERSION)" ;;
  *) bad "server is not PostgreSQL 17 ($VERSION)"; exit 1 ;;
esac

q -d postgres -qc "create database $DB" >/dev/null
q -d postgres -qc "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end \$\$;" >/dev/null
q -q -f "$(native "$SETUP")" >/dev/null && ok "synthetic schema and 13 open class options loaded" || { bad "setup failed"; exit 1; }

PRE_CHECKSUM="$(checksum_original)"
echo "   pre-repair checksum: $PRE_CHECKSUM"

# --- before repair -----------------------------------------------------------
expect_fail "registration query FAILS before repair (42703)" 'column "is_online" does not exist' \
  q -tA -c "set role anon" -c "$REGISTRATION_QUERY"

# --- forward migration -------------------------------------------------------
check "forward migration 202610220100 applies" q -q -f "$(native "$MIGRATION")"
check "registration query SUCCEEDS after repair (anon)" test "$(registration_as_anon)" = "13"
check "original class-option values unchanged by repair" test "$(checksum_original)" = "$PRE_CHECKSUM"
check "existing rows get is_online=false" test "$(qv -c "select count(*) from public.class_options where is_online = false")" = "13"
check "existing rows get confirmed_start_date NULL" test "$(qv -c "select count(*) from public.class_options where confirmed_start_date is null")" = "13"
check "no NULL is_online after repair" test "$(qv -c "select count(*) from public.class_options where is_online is null")" = "0"

# --- idempotency -------------------------------------------------------------
check "migration re-applies cleanly (idempotent)" q -q -f "$(native "$MIGRATION")"
check "original values still unchanged after re-apply" test "$(checksum_original)" = "$PRE_CHECKSUM"

# --- admin writes under representative policies ------------------------------
check "admin update of is_online and confirmed_start_date persists" \
  q -q -c "set role authenticated" -c "set rso.test_role = 'admin'" -c "update public.class_options set is_online = true, confirmed_start_date = date '2026-11-02' where class_option_id = 'CO-R001'"
check "admin update is visible afterwards" test "$(qv -c "select is_online::text || '|' || confirmed_start_date::text from public.class_options where class_option_id = 'CO-R001'")" = "true|2026-11-02"
check "admin insert with the new fields persists" \
  q -q -c "set role authenticated" -c "set rso.test_role = 'admin'" -c "insert into public.class_options (class_option_id, class_id, group_id, subgroup_id, active, enrollment_open, is_online) values ('CO-H001','CLASS-1','GRP-1','SUB-1',true,true,true)"
teacher_write_denied() {
  # CO-R002 starts with is_online = false. A denied teacher write (setting true) must leave it false.
  q -q -c "set role authenticated" -c "set rso.test_role = 'teacher'" \
    -c "update public.class_options set is_online = true where class_option_id = 'CO-R002'" >/dev/null 2>&1 || true
  [ "$(qv -c "select is_online::text from public.class_options where class_option_id = 'CO-R002'")" = "false" ]
}
check "teacher (non-admin) write is denied by representative policy" teacher_write_denied
expect_fail "NOT NULL on is_online is enforced" 'null value in column "is_online"' \
  q -q -c "update public.class_options set is_online = null where class_option_id = 'CO-R003'"
check "attendance read of confirmed_start_date works (authenticated)" \
  test "$(qv -c "set role authenticated" -c "select confirmed_start_date::text from public.class_options where class_option_id = 'CO-R001'")" = "2026-11-02"
q -q -c "delete from public.class_options where class_option_id = 'CO-H001'" >/dev/null

# --- rollback refusals (data written after repair must not be discarded silently) ----
POST_REPAIR_ROWS="$(qv -c "select count(*) from public.class_options where is_online is distinct from false or confirmed_start_date is not null")"
echo "   rows carrying post-repair values: $POST_REPAIR_ROWS"
expect_fail "rollback REFUSES with no authorization" 'rso.rollback_authorization is not set' \
  q -q -f "$(native "$ROLLBACK")"
expect_fail "rollback REFUSES with authorization but no export confirmation" 'rso.rollback_export_confirmed is not set' \
  q -q -c "set rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS'" -f "$(native "$ROLLBACK")"
expect_fail "rollback REFUSES without an expected row count" 'rso.rollback_expected_rows is not set' \
  q -q -c "set rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS'" -c "set rso.rollback_export_confirmed = 'yes'" -f "$(native "$ROLLBACK")"
expect_fail "rollback REFUSES when the export count does not match the live count" 'rows carry post-repair values but the export lists' \
  q -q -c "set rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS'" -c "set rso.rollback_export_confirmed = 'yes'" -c "set rso.rollback_expected_rows = '0'" -f "$(native "$ROLLBACK")"
check "refused rollbacks left the post-repair value in place" \
  test "$(qv -c "select is_online::text from public.class_options where class_option_id = 'CO-R001'")" = "true"

# --- authorized rollback -----------------------------------------------------
check "authorized rollback with a matching export count succeeds" \
  q -q -c "set rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS'" -c "set rso.rollback_export_confirmed = 'yes'" -c "set rso.rollback_expected_rows = '$POST_REPAIR_ROWS'" -f "$(native "$ROLLBACK")"
check "columns are gone after rollback" test "$(qv -c "select count(*) from information_schema.columns where table_schema='public' and table_name='class_options' and column_name in ('is_online','confirmed_start_date')")" = "0"
check "original class-option values unchanged by rollback" test "$(checksum_original)" = "$PRE_CHECKSUM"
expect_fail "registration query FAILS again after rollback (42703)" 'column "is_online" does not exist' \
  q -tA -c "set role anon" -c "$REGISTRATION_QUERY"
expect_fail "rollback REFUSES when columns are already absent" 'expected both repaired columns to exist' \
  q -q -c "set rso.rollback_authorization = 'DISCARD_CLASS_OPTIONS_REPAIR_COLUMNS'" -c "set rso.rollback_export_confirmed = 'yes'" -c "set rso.rollback_expected_rows = '0'" -f "$(native "$ROLLBACK")"

# --- reapply after rollback --------------------------------------------------
check "reapplying the migration after rollback succeeds" q -q -f "$(native "$MIGRATION")"
check "registration query succeeds again after reapply" test "$(registration_as_anon)" = "13"
check "original values unchanged after reapply" test "$(checksum_original)" = "$PRE_CHECKSUM"

echo
echo "== result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
