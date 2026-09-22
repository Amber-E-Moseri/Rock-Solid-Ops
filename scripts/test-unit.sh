#!/usr/bin/env bash
# test-unit: Run all unit tests that require no running Supabase or Docker.
#
# Two suites:
#   1. Deno edge-function unit tests (all use mock clients, no live DB)
#   2. foundation-spa Vitest suite (jsdom, all mocked)
#
# Fails on first suite failure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================"
echo "TEST:UNIT — Deno edge function units"
echo "========================================"

DENO_UNIT_TESTS=(
  "supabase/functions/_shared/lib/assign-applicant.test.ts"
  "supabase/functions/_shared/push-notify.test.ts"
  "supabase/functions/_shared/webpush.test.ts"
  "supabase/functions/admin-api/create-staff-direct.test.ts"
  "supabase/functions/admin-api/invoke-moodle-sync.test.ts"
  "supabase/functions/admin-api/role-boundary-matrix.test.ts"
  "supabase/functions/teacher-portal-api/class-ownership.test.ts"
  "supabase/functions/teacher-portal-api/teacher-auth.test.ts"
  "supabase/functions/waitlist-processor/waitlist-dedup.test.ts"
  "supabase/functions/registration-processor/registration-processor.test.ts"
  "supabase/functions/nexus-users-search/nexus-cors.test.ts"
  "supabase/functions/moodle-sync/handler.test.ts"
)

cd "$ROOT"
deno test --allow-env --no-prompt --no-check --node-modules-dir=auto "${DENO_UNIT_TESTS[@]}"
DENO_EXIT=$?

echo ""
echo "========================================"
echo "TEST:UNIT — foundation-spa Vitest"
echo "========================================"

cd "$ROOT/foundation-spa"
npm run test
SPA_EXIT=$?

cd "$ROOT"

echo ""
if [ $DENO_EXIT -ne 0 ] || [ $SPA_EXIT -ne 0 ]; then
  echo "RESULT: FAIL (deno=$DENO_EXIT spa=$SPA_EXIT)"
  exit 1
fi
echo "RESULT: ALL PASS"
