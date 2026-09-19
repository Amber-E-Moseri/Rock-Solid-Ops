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
#
# SUPABASE_PROJECT_DIR (optional): path to the Supabase project root that owns the
# running local stack. Defaults to this script's repo root. Override locally when
# the Supabase stack is tied to a different worktree (e.g. the main checkout).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPABASE_PROJECT_DIR="${SUPABASE_PROJECT_DIR:-$ROOT}"

if [ "${LOCAL_INTEGRATION_TEST:-}" != "true" ]; then
  echo "ERROR: Set LOCAL_INTEGRATION_TEST=true to run migration tests."
  echo "This test destroys and recreates the local database."
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
export DATABASE_URL

# DB_CONTAINER: run SQL via docker exec when psql is not on the host PATH.
DB_CONTAINER="${DB_CONTAINER:-supabase_db_supabase_foundation}"
run_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -t -A -c "$1" 2>&1
  else
    docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -t -A -c "$1" 2>&1
  fi
}

echo "========================================"
echo "TEST:MIGRATION — db reset from zero"
echo "========================================"
cd "$SUPABASE_PROJECT_DIR"
supabase db reset --local
echo "  db reset: OK"

echo ""
echo "========================================"
echo "TEST:MIGRATION — Wave 1 schema invariants"
echo "========================================"

# Invariant 1: anon must NOT have EXECUTE on override_graduation_eligibility
echo -n "  [1] anon EXECUTE on override_graduation_eligibility: "
RESULT=$(run_sql "SELECT has_function_privilege('anon', 'public.override_graduation_eligibility(uuid,text,boolean,text)', 'EXECUTE');" | tr -d '[:space:]')
if [ "$RESULT" = "f" ]; then
  echo "REVOKED (PASS)"
else
  echo "GRANTED (FAIL)"
  FAIL=1
fi

# Invariant 2: anon must NOT have EXECUTE on admin_create_teacher_direct
echo -n "  [2] anon EXECUTE on admin_create_teacher_direct: "
RESULT=$(run_sql "SELECT has_function_privilege('anon', 'public.admin_create_teacher_direct(text,text,text,text,text,text,text,text)', 'EXECUTE');" | tr -d '[:space:]')
if [ "$RESULT" = "f" ]; then
  echo "REVOKED (PASS)"
else
  echo "GRANTED (FAIL)"
  FAIL=1
fi

# Invariant 3: stale audit_log_staff_select policy must be absent
echo -n "  [3] stale policy audit_log_staff_select absent: "
COUNT=$(run_sql "SELECT COUNT(*) FROM pg_policies WHERE policyname='audit_log_staff_select' AND tablename='audit_logs';" | tr -d '[:space:]')
if [ "$COUNT" = "0" ]; then
  echo "ABSENT (PASS)"
else
  echo "PRESENT (FAIL)"
  FAIL=1
fi

# Invariant 4: audit_logs table has RLS enabled
echo -n "  [4] audit_logs RLS enabled: "
RLS=$(run_sql "SELECT relrowsecurity FROM pg_class WHERE relname='audit_logs' AND relnamespace='public'::regnamespace;" | tr -d '[:space:]')
if [ "$RLS" = "t" ]; then
  echo "ENABLED (PASS)"
else
  echo "DISABLED (FAIL)"
  FAIL=1
fi

# Invariant 5: service_role has SELECT on profiles (Supabase default ACL — verified present without user migrations)
echo -n "  [5] service_role SELECT on profiles: "
RESULT=$(run_sql "SELECT has_table_privilege('service_role', 'public.profiles', 'SELECT');" | tr -d '[:space:]')
if [ "$RESULT" = "t" ]; then
  echo "GRANTED (PASS)"
else
  echo "DENIED (FAIL — Supabase roles.sql initialization did not apply expected DEFAULT PRIVILEGES)"
  FAIL=1
fi

# Invariant 6: every known email_queue producer has both the canonical
# notification_templates row and the legacy email_templates FK row.
echo -n "  [6] email_queue template FK seed durable: "
MISSING=$(run_sql "
WITH required(template_key) AS (
  VALUES
    ('attendance_escalation'),
    ('attendance_reminder'),
    ('batch_rollover_notice'),
    ('campaign'),
    ('class_assigned'),
    ('class_assigned_confirmation'),
    ('class_reassignment_notice'),
    ('class_slot_cancelled'),
    ('class_time_changed'),
    ('classes_now_available'),
    ('direct_message'),
    ('duplicate_registration'),
    ('foundation_welcome'),
    ('missed_class_checkin'),
    ('moodle_credentials'),
    ('moodle_login_reminder'),
    ('registration_status_update'),
    ('registration_under_review_checkin'),
    ('report'),
    ('teacher_status_negative'),
    ('teacher_status_positive')
)
SELECT string_agg(r.template_key, ', ' ORDER BY r.template_key)
FROM required r
LEFT JOIN public.notification_templates nt
  ON nt.template_key = r.template_key
LEFT JOIN public.email_templates et
  ON et.template_key = r.template_key
WHERE nt.template_key IS NULL
   OR et.template_key IS NULL;
" | tr -d '\r')
MISSING=$(echo "$MISSING" | xargs)
if [ -z "$MISSING" ]; then
  echo "PRESENT (PASS)"
else
  echo "MISSING: $MISSING (FAIL)"
  FAIL=1
fi

echo ""
if [ "${FAIL:-0}" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: ALL PASS"
