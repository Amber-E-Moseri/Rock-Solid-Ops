#!/usr/bin/env bash
# Reproducible PostgreSQL 17 rehearsal for supabase/migrations/20261022120000_anon_privilege_hardening.sql.
#
# SYNTHETIC DATA ONLY. Never point this at a real database: it creates its own throwaway cluster
# in a temp directory, on a private port, and deletes it at the end.
#
# Requires a PostgreSQL 17 installation. Set PG_BIN to its bin directory, for example:
#   PG_BIN="/c/Program Files/PostgreSQL/17/bin" bash supabase/tests/anon-privileges/run.sh
#
# Exit code 0 = all checks passed. Any failure prints FAIL and exits 1.
# Tests that describe a known, accepted gap print INFO and do not count as pass or fail.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIGRATION="${MIGRATION_FILE:-$ROOT/supabase/migrations/20261022120000_anon_privilege_hardening.sql}"
SETUP="$HERE/00_setup.sql"

PG_BIN="${PG_BIN:?set PG_BIN to a PostgreSQL 17 bin directory}"
PORT="${PG_PORT:-55440}"
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
info() { echo "  INFO  $1"; }
check() { # check "name" command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi
}

# q: psql against the rehearsal database as the superuser, stopping on the first error.
q() { "$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }
# qv: like q, but prints only the last line of output (drops the SET lines psql prints for set role).
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

# Snapshot of everything the migration must NOT change except anon's own rows: table, sequence and
# function privileges for anon, authenticated and service_role; RLS flags; policy definitions;
# synthetic row data; and the migration-history table.
SNAPSHOT_SQL="$WORK/snapshot.sql"
cat > "$SNAPSHOT_SQL" <<'SQL'
select 'tbl|'||c.relname||'|'||r.r||'|'||p.p||'|'||has_table_privilege(r.r, c.oid, p.p)::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'),('authenticated'),('service_role'),('synthetic_reporting'),('synthetic_member')) as r(r)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) as p(p)
where n.nspname = 'public' and c.relkind in ('r','v','p','m')
union all
select 'seq|'||c.relname||'|'||r.r||'|'||has_sequence_privilege(r.r, c.oid, 'USAGE')::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'),('authenticated'),('service_role'),('synthetic_reporting'),('synthetic_member')) as r(r)
where n.nspname = 'public' and c.relkind = 'S'
union all
select 'fn|'||p.oid::regprocedure::text||'|'||r.r||'|'||has_function_privilege(r.r, p.oid, 'EXECUTE')::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'),('authenticated'),('service_role'),('synthetic_reporting'),('synthetic_member')) as r(r)
where n.nspname = 'public'
union all
select 'rls|'||c.relname||'|'||c.relrowsecurity::text
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all
select 'pol|'||coalesce(md5(string_agg(polrelid::regclass::text||'|'||polname||'|'||polcmd::text||'|'||coalesce(pg_get_expr(polqual, polrelid),'')||'|'||coalesce(pg_get_expr(polwithcheck, polrelid),''), ';' order by polrelid::regclass::text, polname)), 'none')
from pg_policy
union all
select 'data|fellowship_map|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.fellowship_map t
union all select 'data|class_options|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.class_options t
union all select 'data|batches|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.batches t
union all select 'data|bcrs|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.batch_campus_registration_settings t
union all select 'data|teachers|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.teachers t
union all select 'data|applicants|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.applicants t
union all select 'data|error_submissions|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.error_submissions t
union all select 'data|audit_logs|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.audit_logs t
union all select 'data|moodle_enrollment_sync|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.moodle_enrollment_sync t
union all select 'data|email_queue|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.email_queue t
union all select 'data|config|'||coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from public.config t
union all
select 'hist|'||coalesce(md5(string_agg(version||'|'||name, ';' order by version)), 'none') from supabase_migrations.schema_migrations
order by 1;
SQL

echo "== anon privilege hardening rehearsal (PostgreSQL 17, synthetic data) =="
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
q -d postgres -qc "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='synthetic_reporting') then create role synthetic_reporting nologin; end if;
  if not exists (select 1 from pg_roles where rolname='synthetic_member') then create role synthetic_member nologin; end if;
end \$\$;
grant authenticated to synthetic_member;" >/dev/null
q -q -f "$(native "$SETUP")" >/dev/null && ok "synthetic schema and seed data loaded" || { bad "setup failed"; exit 1; }

# --- before the migration: reproduce the exposure -------------------------------
check "BEFORE: anon holds TRUNCATE on teachers (gap reproduced)" \
  test "$(qv -c "select has_table_privilege('anon', 'public.teachers', 'TRUNCATE')::text")" = "true"
check "BEFORE: anon holds SELECT on moodle_enrollment_sync (gap reproduced)" \
  test "$(qv -c "select has_table_privilege('anon', 'public.moodle_enrollment_sync', 'SELECT')::text")" = "true"
check "BEFORE: anon may EXECUTE public.admin_secret() via PUBLIC (gap reproduced)" \
  test "$(qv -c "select has_function_privilege('anon', 'public.admin_secret()', 'EXECUTE')::text")" = "true"
check "BEFORE: synthetic_reporting may EXECUTE public.admin_secret() via PUBLIC" \
  test "$(qv -c "select has_function_privilege('synthetic_reporting', 'public.admin_secret()', 'EXECUTE')::text")" = "true"

q -tA -f "$SNAPSHOT_SQL" > "$WORK/pre.txt"
check "pre-snapshot captured" test -s "$WORK/pre.txt"

# --- forward migration ----------------------------------------------------------
check "migration applies cleanly" q -q -f "$(native "$MIGRATION")"
check "migration re-applies cleanly (idempotent)" q -q -f "$(native "$MIGRATION")"

q -tA -f "$SNAPSHOT_SQL" > "$WORK/post.txt"

# --- snapshot diff: only anon rows may differ ----------------------------------
# Both snapshots must be non-empty and contain the history and data lines, or the diff proves nothing.
snapshot_complete() { # 11 data lines and 1 history line in each snapshot
  for f in pre post; do
    [ "$(grep -c '^data|' "$WORK/$f.txt")" = "11" ] || return 1
    [ "$(grep -c '^hist|' "$WORK/$f.txt")" = "1" ] || return 1
  done
}
check "pre and post snapshots are complete (11 data lines, 1 history line each)" snapshot_complete
diff "$WORK/pre.txt" "$WORK/post.txt" > "$WORK/diff.txt"
NON_ANON="$(grep '^[<>]' "$WORK/diff.txt" | grep -v '|anon|' || true)"
if [ -z "$NON_ANON" ]; then ok "only anon rows changed in privilege, RLS, policy, data and history snapshots"
else bad "changes outside anon rows (data, policies, RLS, history or another role's privilege)"; echo "$NON_ANON" | sed 's/^/        /' | head -20; fi
check "authenticated and service_role privileges unchanged (table, sequence, function)" \
  test -z "$(grep '^[<>]' "$WORK/diff.txt" | grep -E '\|(authenticated|service_role|synthetic_reporting|synthetic_member)\|' || true)"
check "migration history table unchanged (hist| line identical)" \
  test "$(grep '^hist|' "$WORK/pre.txt")" = "$(grep '^hist|' "$WORK/post.txt")"
check "RLS flags and policy definitions unchanged" \
  test "$(grep -E '^(rls|pol)\|' "$WORK/pre.txt")" = "$(grep -E '^(rls|pol)\|' "$WORK/post.txt")"
check "anon holds no TRUNCATE, REFERENCES, TRIGGER, UPDATE or DELETE on any public relation" \
  test "$(qv -c "select count(*) from (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m')) t where has_table_privilege('anon', t.oid, 'TRUNCATE') or has_table_privilege('anon', t.oid, 'REFERENCES') or has_table_privilege('anon', t.oid, 'TRIGGER') or has_table_privilege('anon', t.oid, 'UPDATE') or has_table_privilege('anon', t.oid, 'DELETE')")" = "0"
check "anon holds no sequence privilege in public" \
  test "$(qv -c "with s as materialized (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S') select count(*) from s where has_sequence_privilege('anon', s.oid, 'USAGE')")" = "0"
check "anon holds no EXECUTE on any public function" \
  test "$(qv -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')")" = "0"

# --- legitimate anonymous registration path (must still work) ----------------
check "anon reads active fellowship_map (registration columns)" \
  test "$(qv -c "set role anon" -c "select count(*) from (select fellowship_code, campus_name, group_id, subgroup_id, timezone from public.fellowship_map where active = true order by campus_name) x")" = "1"
check "anon reads open class options (registration form query)" \
  test "$(qv -c "set role anon" -c "select count(*) from (select class_option_id, class_id, fellowship_codes, teacher_id, teacher_name, day, class_time, active, is_online, confirmed_start_date from public.class_options where active = true and enrollment_open = true and deleted_at is null) r")" = "1"
check "anon reads open batches (registration form query)" \
  test "$(qv -c "set role anon" -c "select count(*) from (select batch_id from public.batches where status = 'Active' and registration_open = true) r")" = "1"
check "anon reads closed-campus settings (fellowship_code only)" \
  test "$(qv -c "set role anon" -c "select count(*) from (select fellowship_code from public.batch_campus_registration_settings where registration_open = false and batch_id in ('B-SYN-1')) r")" = "1"
check "anon self-registers a PENDING, inactive teacher (teacher-register.html path)" \
  q -q -c "set role anon" -c "insert into public.teachers (teacher_id, full_name, email, fellowship_code, status, active, created_at, updated_at) values ('T-SYN-ANON-1', 'Synthetic Applicant Teacher', 'synthetic-anon@example.test', 'SYN-A', 'PENDING', false, now(), now())"
check "self-registered row is visible to staff (row written)" \
  test "$(qv -c "select count(*) from public.teachers where teacher_id = 'T-SYN-ANON-1'")" = "1"
expect_fail "anon self-registration as ACTIVE is refused by RLS" 'row-level security' \
  q -q -c "set role anon" -c "insert into public.teachers (teacher_id, full_name, status, active) values ('T-SYN-ANON-2', 'x', 'ACTIVE', true)"

# --- prohibited operations (must fail) ---------------------------------------
expect_fail "anon cannot TRUNCATE teachers" 'permission denied' \
  q -q -c "set role anon" -c "truncate public.teachers"
expect_fail "anon cannot TRUNCATE applicants" 'permission denied' \
  q -q -c "set role anon" -c "truncate public.applicants"
expect_fail "anon cannot read applicants" 'permission denied' \
  q -tA -c "set role anon" -c "select count(*) from public.applicants"
expect_fail "anon cannot read audit_logs" 'permission denied' \
  q -tA -c "set role anon" -c "select count(*) from public.audit_logs"
expect_fail "anon cannot read moodle_enrollment_sync (temp_password column)" 'permission denied' \
  q -tA -c "set role anon" -c "select temp_password from public.moodle_enrollment_sync"
expect_fail "anon cannot read email_queue" 'permission denied' \
  q -tA -c "set role anon" -c "select count(*) from public.email_queue"
expect_fail "anon cannot read config" 'permission denied' \
  q -tA -c "set role anon" -c "select count(*) from public.config"
expect_fail "anon cannot read teachers" 'permission denied' \
  q -tA -c "set role anon" -c "select count(*) from public.teachers"
expect_fail "anon cannot read staff-only bcrs columns (closed_by)" 'permission denied' \
  q -tA -c "set role anon" -c "select closed_by from public.batch_campus_registration_settings"
expect_fail "anon cannot read an ungranted class_options column (created_by)" 'permission denied' \
  q -tA -c "set role anon" -c "select created_by from public.class_options"
expect_fail "anon cannot insert into applicants (no direct write path)" 'permission denied' \
  q -q -c "set role anon" -c "insert into public.applicants (full_name, email) values ('x', 'x@example.test')"
expect_fail "anon cannot insert into error_submissions" 'permission denied' \
  q -q -c "set role anon" -c "insert into public.error_submissions (error_message) values ('x')"
expect_fail "anon cannot update fellowship_map" 'permission denied' \
  q -q -c "set role anon" -c "update public.fellowship_map set active = true"
expect_fail "anon cannot delete class_options" 'permission denied' \
  q -q -c "set role anon" -c "delete from public.class_options"
expect_fail "anon cannot draw from audit_logs_id_seq" 'permission denied' \
  q -tA -c "set role anon" -c "select nextval('public.audit_logs_id_seq')"
expect_fail "anon cannot execute a SECURITY DEFINER function" 'permission denied' \
  q -tA -c "set role anon" -c "select public.admin_secret()"
expect_fail "anon cannot execute an ordinary public function" 'permission denied' \
  q -tA -c "set role anon" -c "select public.is_admin()"

# --- other roles keep working --------------------------------------------------
check "authenticated staff can still read applicants" \
  test "$(qv -c "set role authenticated" -c "select count(*) from public.applicants")" = "1"
check "authenticated staff can still update fellowship_map" \
  q -q -c "set role authenticated" -c "update public.fellowship_map set timezone = 'America/Winnipeg' where fellowship_code = 'SYN-B'"
check "role reached only via PUBLIC keeps EXECUTE on admin_secret after migration" \
  test "$(qv -c "select has_function_privilege('synthetic_reporting', 'public.admin_secret()', 'EXECUTE')::text")" = "true"
check "role inheriting authenticated keeps EXECUTE on is_admin after migration" \
  test "$(qv -c "select has_function_privilege('synthetic_member', 'public.is_admin()', 'EXECUTE')::text")" = "true"
check "role reached only via PUBLIC can actually call admin_secret" \
  test "$(qv -c "set role synthetic_reporting" -c "select public.admin_secret()")" = "synthetic"
check "authenticated can still execute public.is_admin()" \
  test "$(qv -c "set role authenticated" -c "select public.is_admin()::text")" = "true"
check "service_role can still insert into applicants (edge-function path)" \
  q -q -c "set role service_role" -c "insert into public.applicants (full_name, email) values ('Synthetic Service', 'synthetic-service@example.test')"

# --- default privileges: objects created after the migration -----------------
q -q -c "create table public.future_synthetic (id int)" -c "create sequence public.future_synthetic_seq" >/dev/null 2>&1
check "new table created after migration gives anon no privilege" \
  test "$(qv -c "select has_table_privilege('anon', 'public.future_synthetic', 'SELECT')::text || has_table_privilege('anon', 'public.future_synthetic', 'INSERT')::text")" = "falsefalse"
check "new table still grants authenticated its default privileges" \
  test "$(qv -c "select has_table_privilege('authenticated', 'public.future_synthetic', 'SELECT')::text")" = "true"
check "new sequence created after migration gives anon no usage" \
  test "$(qv -c "select has_sequence_privilege('anon', 'public.future_synthetic_seq', 'USAGE')::text")" = "false"

# Known, accepted gap (risk R4 in the design doc): a function created later is still executable by anon
# through the PUBLIC default. This is reported, not failed, until the owner decides on R4.
q -q -c "create function public.future_synthetic_fn() returns int language sql as \$\$ select 1 \$\$" >/dev/null 2>&1
FUTURE_FN="$(qv -c "select has_function_privilege('anon', 'public.future_synthetic_fn()', 'EXECUTE')::text")"
if [ "$FUTURE_FN" = "true" ]; then info "KNOWN GAP R4: a function created after the migration is executable by anon via PUBLIC (owner decision pending)"
else info "R4 closed: a function created after the migration is not executable by anon ($FUTURE_FN)"; fi

# --- result --------------------------------------------------------------------
echo
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
