#!/usr/bin/env bash
# test-migration: Verify the migration chain is reproducible from zero.
#
# Runs `supabase db reset --local` to replay all migrations in order, then
# spot-checks that the Wave 1 security invariants are present in the resulting
# schema. This is the "clean-from-zero migration gate."
#
# Requires:
#   - Docker running
#   - Supabase CLI on PATH
#   - local Supabase running (supabase start) — reset does not restart the stack
#   - LOCAL_INTEGRATION_TEST=true
#
# WARNING: db reset drops and recreates the local database. All local data is lost.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${LOCAL_INTEGRATION_TEST:-}" != "true" ]; then
  echo "ERROR: Set LOCAL_INTEGRATION_TEST=true to run migration tests."
  echo "This test destroys and recreates the local database."
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
export DATABASE_URL

echo "========================================"
echo "TEST:MIGRATION — db reset from zero"
echo "========================================"
cd "$ROOT"
supabase db reset --local
echo "  db reset: OK"

echo ""
echo "========================================"
echo "TEST:MIGRATION — Wave 1 schema invariants"
echo "========================================"

# Invariant 1: anon must NOT have EXECUTE on override_graduation_eligibility
echo -n "  [1] anon EXECUTE on override_graduation_eligibility: "
RESULT=$(psql "$DATABASE_URL" -t -c \
  "SELECT has_function_privilege('anon', 'public.override_graduation_eligibility(uuid,text,boolean,text)', 'EXECUTE');" \
  2>&1 | tr -d '[:space:]')
if [ "$RESULT" = "f" ]; then
  echo "REVOKED (PASS)"
else
  echo "GRANTED (FAIL)"
  FAIL=1
fi

# Invariant 2: anon must NOT have EXECUTE on admin_create_teacher_direct
echo -n "  [2] anon EXECUTE on admin_create_teacher_direct: "
RESULT=$(psql "$DATABASE_URL" -t -c \
  "SELECT has_function_privilege('anon', 'public.admin_create_teacher_direct(text,text,text,text,text,text,text,text)', 'EXECUTE');" \
  2>&1 | tr -d '[:space:]')
if [ "$RESULT" = "f" ]; then
  echo "REVOKED (PASS)"
else
  echo "GRANTED (FAIL)"
  FAIL=1
fi

# Invariant 3: stale audit_log_staff_select policy must be absent
echo -n "  [3] stale policy audit_log_staff_select absent: "
COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT COUNT(*) FROM pg_policies WHERE policyname='audit_log_staff_select' AND tablename='audit_logs';" \
  2>&1 | tr -d '[:space:]')
if [ "$COUNT" = "0" ]; then
  echo "ABSENT (PASS)"
else
  echo "PRESENT (FAIL)"
  FAIL=1
fi

# Invariant 4: audit_logs table has RLS enabled
echo -n "  [4] audit_logs RLS enabled: "
RLS=$(psql "$DATABASE_URL" -t -c \
  "SELECT relrowsecurity FROM pg_class WHERE relname='audit_logs' AND relnamespace='public'::regnamespace;" \
  2>&1 | tr -d '[:space:]')
if [ "$RLS" = "t" ]; then
  echo "ENABLED (PASS)"
else
  echo "DISABLED (FAIL)"
  FAIL=1
fi

# Invariant 5: service_role has SELECT on profiles (Wave 2A grants applied)
echo -n "  [5] service_role SELECT on profiles: "
RESULT=$(psql "$DATABASE_URL" -t -c \
  "SELECT has_table_privilege('service_role', 'public.profiles', 'SELECT');" \
  2>&1 | tr -d '[:space:]')
if [ "$RESULT" = "t" ]; then
  echo "GRANTED (PASS)"
else
  echo "DENIED (FAIL — wave2a grants migration missing or failed)"
  FAIL=1
fi

echo ""
if [ "${FAIL:-0}" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: ALL PASS"
