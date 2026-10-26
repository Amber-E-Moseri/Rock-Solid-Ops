#!/usr/bin/env bash
# Request Access Phase 3 tests: intake, visibility, scoped review, transitions and the approval boundary.
#
# Creates a throwaway database, loads the Supabase-shaped baseline shared with the teacher-applications
# suite, then runs tests.sql, which applies the Phase 1, PR #22, Phase 2 and Phase 3 migrations in order.
# Exits non-zero when any check fails or when no checks were recorded.
#
# Environment (all optional):
#   PG_BIN   directory holding psql, createdb, dropdb        (default: /usr/lib/postgresql/16/bin)
#   PGHOST   server host or unix socket directory            (default: /var/run/postgresql)
#   PGPORT   server port                                     (default: 5432)
#   PGUSER   a superuser role that can create databases      (default: postgres)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"

DB="access_requests_test_$$"
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q -d "$DB")

cleanup() { "$PG_BIN/dropdb" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cd "$HERE"
"$PG_BIN/createdb" "$DB"
"${PSQL[@]}" -f "$HERE/../teacher-applications/stubs.sql"
"${PSQL[@]}" -f "$HERE/tests.sql"

TOTAL="$("$PG_BIN/psql" -X -tA -d "$DB" -c "select count(*) from test_harness.results")"
FAILED="$("$PG_BIN/psql" -X -tA -d "$DB" -c "select count(*) from test_harness.results where not ok")"

if [ "$TOTAL" = "0" ]; then
  echo "access-requests: no checks were recorded" >&2
  exit 1
fi
if [ "$FAILED" != "0" ]; then
  "$PG_BIN/psql" -X -d "$DB" -c "select name, detail from test_harness.results where not ok" >&2
  echo "access-requests: $FAILED of $TOTAL check(s) failed" >&2
  exit 1
fi
echo "access-requests: all $TOTAL checks passed"
