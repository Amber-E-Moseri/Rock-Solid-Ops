#!/usr/bin/env bash
# test-registration: Wave 3 live registration integration gate.
#
# Runs the Deno live integration test that verifies atomic slot reservation,
# counter integrity, concurrency safety, and RPC boundary enforcement.
#
# Requires:
#   - LOCAL_INTEGRATION_TEST=true
#   - Local Supabase stack running (supabase start)
#   - SUPABASE_SERVICE_ROLE_KEY set (from supabase status --output env)
#   - SUPABASE_ANON_KEY set (from supabase status --output env)
#
# Usage:
#   LOCAL_INTEGRATION_TEST=true \
#     eval "$(supabase status --output env)" && \
#     ./scripts/test-registration.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${LOCAL_INTEGRATION_TEST:-}" != "true" ]; then
  echo "ERROR: Set LOCAL_INTEGRATION_TEST=true to run registration integration tests."
  echo "These tests require a live local Supabase stack."
  exit 1
fi

echo "========================================"
echo "TEST:REGISTRATION — Wave 3 Live Gate"
echo "========================================"
echo ""

cd "$ROOT"
deno run \
  --allow-net \
  --allow-env \
  supabase/tests/registration/live-registration.ts

REG_EXIT=$?

echo ""
if [ $REG_EXIT -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
