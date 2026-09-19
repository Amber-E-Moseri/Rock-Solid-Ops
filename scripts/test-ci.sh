#!/usr/bin/env bash
# test-ci: Run the full local CI suite in order.
#
# Mirrors what the GitHub Actions workflow runs:
#   1. Unit tests          (no live DB required)
#   2. Migration gate      (supabase db reset + schema invariants)
#   3. Security tests      (wave1-regression + nexus isolation)
#   4. Registration gate   (Wave 3 live integration: slot reservation, concurrency)
#
# Requires everything that each sub-suite requires. See individual scripts
# for their specific prerequisites.
#
# Usage:
#   LOCAL_INTEGRATION_TEST=true \
#     eval "$(supabase status --output env)" && \
#     ./scripts/test-ci.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

UNIT_EXIT=0
MIGRATION_EXIT=0
SECURITY_EXIT=0
REGISTRATION_EXIT=0

echo "========================================"
echo "CI SUITE — Foundation School Wave 2A + Wave 3"
echo "========================================"
echo ""

# Phase 1: Unit tests (always run — no DB required)
echo "--- Phase 1: Unit ---"
bash "$SCRIPT_DIR/test-unit.sh"
UNIT_EXIT=$?
echo ""

# Phase 2: Migration gate (requires LOCAL_INTEGRATION_TEST=true + Docker)
echo "--- Phase 2: Migration ---"
bash "$SCRIPT_DIR/test-migration.sh"
MIGRATION_EXIT=$?
echo ""

# Phase 3: Security regression (requires live local Supabase + env keys)
echo "--- Phase 3: Security ---"
bash "$SCRIPT_DIR/test-security.sh"
SECURITY_EXIT=$?
echo ""

# Phase 4: Registration gate (Wave 3 — requires live local Supabase + env keys)
echo "--- Phase 4: Registration ---"
bash "$SCRIPT_DIR/test-registration.sh"
REGISTRATION_EXIT=$?
echo ""

echo "========================================"
echo "CI SUITE SUMMARY"
echo "  unit:         $([ $UNIT_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "  migration:    $([ $MIGRATION_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "  security:     $([ $SECURITY_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "  registration: $([ $REGISTRATION_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "========================================"

if [ $UNIT_EXIT -ne 0 ] || [ $MIGRATION_EXIT -ne 0 ] || [ $SECURITY_EXIT -ne 0 ] || [ $REGISTRATION_EXIT -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: ALL PASS"
