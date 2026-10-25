#!/usr/bin/env bash
# Request Access Phase 1 tests: org_subgroups and staff scope assignments.
#
# Creates a throwaway database, loads the Supabase-shaped baseline shared with the
# teacher-applications suite, applies the two Phase 1 migrations in order, then runs tests.sql.
# Exits non-zero when any check fails or when no checks were recorded.
#
# Environment (all optional):
#   PG_BIN   directory holding psql, createdb, dropdb        (default: /usr/lib/postgresql/16/bin)
#   PGHOST   server host or unix socket directory            (default: /var/run/postgresql)
#   PGPORT   server port                                     (default: 5432)
#   PGUSER   a superuser role that can create databases      (default: postgres)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../../migrations"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"

DB="request_access_scope_test_$$"
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q -d "$DB")

cleanup() { "$PG_BIN/dropdb" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cd "$HERE"
"$PG_BIN/createdb" "$DB"
"${PSQL[@]}" -f "$HERE/../teacher-applications/stubs.sql"
"${PSQL[@]}" -f "$MIGRATIONS/202610250100_org_subgroups.sql"
"${PSQL[@]}" -f "$MIGRATIONS/202610250200_staff_scope_assignments.sql"
"${PSQL[@]}" -f "$HERE/tests.sql"

TOTAL="$("$PG_BIN/psql" -X -tA -d "$DB" -c "select count(*) from test_harness.results")"
FAILED="$("$PG_BIN/psql" -X -tA -d "$DB" -c "select count(*) from test_harness.results where not ok")"

if [ "$TOTAL" = "0" ]; then
  echo "request-access-scope: no checks were recorded" >&2
  exit 1
fi
if [ "$FAILED" != "0" ]; then
  "$PG_BIN/psql" -X -d "$DB" -c "select name, detail from test_harness.results where not ok" >&2
  echo "request-access-scope: $FAILED of $TOTAL check(s) failed" >&2
  exit 1
fi
echo "request-access-scope: all $TOTAL checks passed"
