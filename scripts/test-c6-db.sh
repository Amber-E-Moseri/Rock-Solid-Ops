#!/usr/bin/env bash
# test-c6-db: C6 database certification against a live local Supabase.
#
# Runs, in order:
#   1. supabase/tests/c6/rpc-certification.sql  real claim / reconcile / resolve RPC semantics, fencing, privileges
#   2. supabase/tests/c6/concurrency.sh         parallel psql sessions: atomic claim, SKIP LOCKED, stale recovery
#   3. supabase/tests/c6/rls-http.ts            RLS + service-only RPC authorization over real HTTP, by role
#
# Requires: local Supabase running, psql on PATH, deno, docker, LOCAL_INTEGRATION_TEST=true, and
#   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / DB_CONTAINER (see test-security.sh).
# ADMIN_URL: a superuser connection (the helper schema it creates needs one). Defaults to supabase_admin.
# Never run against production.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if [ "${LOCAL_INTEGRATION_TEST:-}" != "true" ]; then
  echo "ERROR: Set LOCAL_INTEGRATION_TEST=true (these tests write to a local database)."
  exit 1
fi
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY must be set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY must be set}"
export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
export ADMIN_URL="${ADMIN_URL:-postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "========================================"
echo "TEST:C6-DB — RPC certification (real Postgres)"
echo "========================================"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -X -q -f supabase/tests/c6/rpc-certification.sql

echo ""
echo "========================================"
echo "TEST:C6-DB — concurrency (atomic claim, SKIP LOCKED, stale recovery)"
echo "========================================"
bash supabase/tests/c6/concurrency.sh

echo ""
echo "========================================"
echo "TEST:C6-DB — RLS / RPC authorization over HTTP"
echo "========================================"
deno run --allow-net --allow-env --allow-run=docker supabase/tests/c6/rls-http.ts

echo ""
echo "RESULT: C6 DB CERTIFICATION ALL PASS"
