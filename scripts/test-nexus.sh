#!/usr/bin/env bash
# test-nexus: Run the Nexus upstream isolation regression test standalone.
#
# This is the Wave 1 permanent regression test for nexus-users-search.
# It verifies that the Nexus edge function enforces admin/superadmin RBAC
# and rejects unauthorized roles and unauthenticated callers.
#
# Requires:
#   - local Supabase running (supabase start)
#   - SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY set in env
#     (run: eval "$(supabase status --output env)" to populate them)
#   - LOCAL_INTEGRATION_TEST=true
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${LOCAL_INTEGRATION_TEST:-}" != "true" ]; then
  echo "ERROR: Set LOCAL_INTEGRATION_TEST=true to run Nexus tests."
  exit 1
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set."
  echo "  Run: eval \"\$(supabase status --output env)\""
  exit 1
fi

export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"

echo "========================================"
echo "TEST:NEXUS — upstream isolation"
echo "========================================"
cd "$ROOT"
deno run \
  --allow-net \
  --allow-env \
  supabase/functions/nexus-users-search/nexus-upstream.test.ts
EXIT=$?

echo ""
if [ $EXIT -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: ALL PASS"
