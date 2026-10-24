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
  "supabase/functions/admin-api/role-boundary-matrix.test.ts"
  "supabase/functions/teacher-portal-api/class-ownership.test.ts"
  "supabase/functions/teacher-portal-api/teacher-auth.test.ts"
  "supabase/functions/waitlist-processor/waitlist-dedup.test.ts"
  "supabase/functions/registration-processor/registration-processor.test.ts"
  "supabase/functions/nexus-users-search/nexus-cors.test.ts"
  # Caller authorization: shared helper, per-function policy and a static wiring guard that reads index.ts.
  "supabase/functions/_shared/function-auth.test.ts"
  "supabase/functions/_shared/auth-wiring.test.ts"
  "supabase/functions/waitlist-processor/auth-policy.test.ts"
  "supabase/functions/moodle-sync/auth-policy.test.ts"
  # moodle-sync/moodle-sync.test.ts excluded: pre-existing type errors +
  # top-level Deno.serve() in index.ts prevents import (tracked separately)
)

cd "$ROOT"
# --allow-read is needed only by the static wiring guard (auth-wiring.test.ts).
deno test --allow-env --allow-read --no-prompt --no-check --node-modules-dir=auto "${DENO_UNIT_TESTS[@]}"
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
