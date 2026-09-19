#!/usr/bin/env bash
# test-security: Run Wave 1 security regression against a live local Supabase.
#
# Requires:
#   - local Supabase running (supabase start)
#   - SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY set in env
#     (run: eval "$(supabase status --output env)" to populate them)
#   - docker available on PATH (psql is invoked inside the Supabase container)
#   - LOCAL_INTEGRATION_TEST=true set (confirms intent to run live tests)
#
# Also runs the Nexus upstream isolation test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${LOCAL_INTEGRATION_TEST:-}" != "true" ]; then
  echo "ERROR: Set LOCAL_INTEGRATION_TEST=true to run security tests."
  echo "These tests modify a local database and must not run against production."
  exit 1
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set."
  echo "  Run: eval \"\$(supabase status --output env)\""
  exit 1
fi

export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

echo "========================================"
echo "TEST:SECURITY — Wave 1 regression"
echo "========================================"
cd "$ROOT"
deno run \
  --allow-net \
  --allow-env \
  --allow-run=docker \
  supabase/tests/security/wave1-regression.ts
SECURITY_EXIT=$?

echo ""
echo "========================================"
echo "TEST:SECURITY — Nexus upstream isolation"
echo "========================================"
deno run \
  --allow-net \
  --allow-env \
  --allow-run=deno \
  supabase/functions/nexus-users-search/nexus-upstream.test.ts
NEXUS_EXIT=$?

echo ""
if [ $SECURITY_EXIT -ne 0 ] || [ $NEXUS_EXIT -ne 0 ]; then
  echo "RESULT: FAIL (security=$SECURITY_EXIT nexus=$NEXUS_EXIT)"
  exit 1
fi
echo "RESULT: ALL PASS"
