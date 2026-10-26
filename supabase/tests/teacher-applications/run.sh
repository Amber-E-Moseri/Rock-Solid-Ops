#!/usr/bin/env bash
# Teacher-application authorization tests.
#
# Creates a throwaway database, loads the Supabase-shaped stubs, the hardened teacher-link candidate
# and the new migrations, then runs tests.sql. Exits non-zero when any check fails.
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

DB="teacher_apps_test_$$"
PSQL=("$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -q -d "$DB")

cleanup() { "$PG_BIN/dropdb" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cd "$HERE"
"$PG_BIN/createdb" "$DB"
"${PSQL[@]}" -f stubs.sql
"${PSQL[@]}" -f tests.sql

FAILED="$("$PG_BIN/psql" -X -tA -d "$DB" -c "select count(*) from test_harness.results where not ok")"
if [ "$FAILED" != "0" ]; then
  echo "teacher-applications: $FAILED check(s) failed" >&2
  exit 1
fi
echo "teacher-applications: all checks passed"
