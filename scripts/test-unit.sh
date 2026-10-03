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
  "supabase/functions/_shared/auth.test.ts"
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

# Offline suites that need read/net (in-process handlers on an unroutable SUPABASE_URL, local Deno.serve
# fakes, source/migration reads): auth regression, cron contract, C6 Nexus/reconciliation, E2 auth, Moodle.
# nexus-upstream.test.ts is deliberately excluded: it needs LOCAL_INTEGRATION_TEST + a local Supabase stack.
deno test --allow-env --allow-net --allow-read --no-prompt --no-check --node-modules-dir=auto \
  supabase/functions/_shared/caller-auth.test.ts \
  supabase/functions/_shared/auth-regression.test.ts \
  supabase/functions/cron-contract.test.ts \
  supabase/functions/deploy-inventory.test.ts \
  supabase/functions/_shared/nexus-assignment.test.ts \
  supabase/functions/_shared/nexus-idempotency.test.ts \
  supabase/functions/_shared/nexus-persistence.test.ts \
  supabase/functions/_shared/c6-migrations.test.ts \
  supabase/functions/_shared/nexus-assignee-policy.test.ts \
  supabase/functions/_shared/nexus-reconcile.test.ts \
  supabase/functions/_shared/nexus-tasks.test.ts \
  supabase/functions/clickup-sync/retired.test.ts \
  supabase/functions/e2-wave1-cron-auth.test.ts \
  supabase/functions/e2-wave2-mixed-auth.test.ts \
  supabase/functions/email-sender/timeout.test.ts \
  supabase/functions/missed-class-detector/internal-nexus.test.ts \
  supabase/functions/missed-class-detector/db-failure.test.ts \
  supabase/functions/moodle-sync/failure-persistence.test.ts \
  supabase/functions/moodle-sync/moodle-abort.test.ts \
  supabase/functions/moodle-sync/moodle-sync.test.ts \
  supabase/functions/moodle-sync/selector.test.ts \
  supabase/functions/nexus-users-search/timeout.test.ts \
  supabase/functions/notification-batch-processor/notification-batch-processor.test.ts \
  supabase/functions/notification-dispatcher/retired.test.ts \
  supabase/functions/registration-processor/internal-waitlist.test.ts \
  supabase/functions/retired-health.test.ts \
  supabase/functions/moodle-grade-sync/builder-catch.test.ts \
  supabase/functions/retry-worker/internal-nexus.test.ts \
  supabase/functions/retry-worker/moodle-retry.test.ts \
  supabase/functions/waitlist-processor/internal-auth.test.ts

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
