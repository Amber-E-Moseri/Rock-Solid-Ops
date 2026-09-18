#!/usr/bin/env bash
# test-ci: Run the full local CI suite in order.
#
# Mirrors what the GitHub Actions workflow runs:
#   1. Unit tests     (no live DB required)
#   2. Migration gate (supabase db reset + schema invariants)
#   3. Security tests (wave1-regression + nexus isolation)
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

echo "========================================"
echo "CI SUITE — Foundation School Wave 2A"
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

echo "========================================"
echo "CI SUITE SUMMARY"
echo "  unit:      $([ $UNIT_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "  migration: $([ $MIGRATION_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "  security:  $([ $SECURITY_EXIT -eq 0 ] && echo PASS || echo FAIL)"
echo "========================================"

if [ $UNIT_EXIT -ne 0 ] || [ $MIGRATION_EXIT -ne 0 ] || [ $SECURITY_EXIT -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: ALL PASS"
