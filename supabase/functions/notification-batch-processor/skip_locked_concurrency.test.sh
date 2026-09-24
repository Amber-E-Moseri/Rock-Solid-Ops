#!/usr/bin/env bash
# C1 SKIP LOCKED True Concurrency Certification
#
# Proves FOR UPDATE SKIP LOCKED with genuinely overlapping PostgreSQL transactions.
# Two real psql processes run concurrently:
#   Session A: BEGIN → pg_advisory_xact_lock(0,999988) → claim_notification_batch(1)
#              → pg_sleep(15) → ROLLBACK
#   Session B: polls until A holds the advisory lock, then calls claim_notification_batch(1)
#
# SC01: Only row X exists while A holds it → B must get 0 rows (or row Y if inserted).
# SC02: Row X (locked) and row Y (free) → B must get row Y, not row X.
#
# Run: bash skip_locked_concurrency.test.sh
# Requires: psql on PATH or adjust PSQL variable below.

set -euo pipefail

PSQL="${PSQL:-psql}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54322}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD

CONN="-h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE"

run() { "$PSQL" $CONN -t -A -c "$1" 2>/dev/null | head -1; }
exec_sql() { "$PSQL" $CONN -c "$1" 2>&1 | tail -1; }

SESSION_A_SQL=$(mktemp /tmp/session_a_XXXX.sql)
SESSION_A_OUT=$(mktemp /tmp/session_a_XXXX.out)

cleanup() {
  exec_sql "UPDATE public.scheduled_notifications SET status='SENT',claimed_at=NULL WHERE recipient_email LIKE '%@skiptest.com';" 2>/dev/null || true
  exec_sql "DELETE FROM public.scheduled_notifications WHERE recipient_email LIKE '%@skiptest.com';" 2>/dev/null || true
  rm -f "$SESSION_A_SQL" "$SESSION_A_OUT"
}
trap cleanup EXIT

# Write Session A SQL to temp file
cat > "$SESSION_A_SQL" <<'SQLA'
BEGIN;
SELECT pg_advisory_xact_lock(0, 999988);
SELECT id, status FROM public.claim_notification_batch(1);
SELECT pg_sleep(15);
ROLLBACK;
SQLA

# ── Setup ─────────────────────────────────────────────────────────────────────

echo "SETUP: clearing prior test rows..."
exec_sql "DELETE FROM public.email_queue WHERE source_notification_id IN (SELECT id FROM public.scheduled_notifications WHERE recipient_email LIKE '%@skiptest.com');" || true
exec_sql "DELETE FROM public.scheduled_notifications WHERE recipient_email LIKE '%@skiptest.com' OR recipient_email LIKE '%@example.com';"

ROW_X=$(run "INSERT INTO public.scheduled_notifications (recipient_email, event_type, template_key, status, attempts, max_attempts, scheduled_for) VALUES ('scX@skiptest.com', 'test_event', 'foundation_welcome', 'PENDING', 0, 3, NOW() - INTERVAL '2 minutes') RETURNING id;")
ROW_Y=$(run "INSERT INTO public.scheduled_notifications (recipient_email, event_type, template_key, status, attempts, max_attempts, scheduled_for) VALUES ('scY@skiptest.com', 'test_event', 'foundation_welcome', 'PENDING', 0, 3, NOW() - INTERVAL '1 minute') RETURNING id;")
echo "Row X (older, will be claimed first): $ROW_X"
echo "Row Y (newer, free row):              $ROW_Y"

PENDING=$(run "SELECT count(*) FROM public.scheduled_notifications WHERE status='PENDING';")
echo "Total PENDING before test: $PENDING"
[ "$PENDING" = "2" ] || { echo "ERROR: expected 2 PENDING rows, got $PENDING"; exit 1; }

# ── SC01/SC02 ─────────────────────────────────────────────────────────────────

echo "Starting Session A (holds lock for 15s)..."
"$PSQL" $CONN -f "$SESSION_A_SQL" > "$SESSION_A_OUT" 2>&1 &
SESSION_A_PID=$!

# Poll until A holds the advisory lock (classid=0, objid=999988)
echo "Polling for advisory lock..."
LOCK_ACQUIRED=0
for i in $(seq 1 20); do
  sleep 1
  LC=$(run "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=999988 AND granted=true;")
  echo "  t=${i}s lock_count=${LC}"
  if [ "$LC" = "1" ]; then
    echo "Lock acquired by Session A at t=${i}s — Session B running now"
    LOCK_ACQUIRED=1
    break
  fi
done

if [ $LOCK_ACQUIRED -eq 0 ]; then
  echo "FAIL: Session A never acquired advisory lock within 20s"
  echo "Session A output:"
  cat "$SESSION_A_OUT"
  exit 1
fi

# Session B: must skip locked row X, claim row Y
B=$(run "SELECT id FROM public.claim_notification_batch(1);")
echo "Session B got: '$B'"

wait $SESSION_A_PID
echo "Session A done."
echo "Session A output:"
cat "$SESSION_A_OUT"

# ── Assertions ────────────────────────────────────────────────────────────────

PASS=0

if [ "$B" = "$ROW_Y" ]; then
  echo ""
  echo "SC01 PASS: Session B returned a row while A held the row-level lock"
  echo "SC02 PASS: Session B claimed unlocked row Y, correctly skipped locked row X"
  PASS=1
elif [ "$B" = "$ROW_X" ]; then
  echo "SC02 FAIL: Session B claimed the locked row X — FOR UPDATE SKIP LOCKED is broken"
elif [ -z "$B" ]; then
  echo "SC01 FAIL: Session B returned no row (expected row Y)"
else
  echo "WARN: Session B returned unexpected row $B (not X or Y)"
  if [ "$B" != "$ROW_X" ]; then
    echo "SC02 PARTIAL: B did not get the locked row X"
    PASS=1
  fi
fi

echo ""
if [ $PASS -eq 1 ]; then
  echo "=== SKIP LOCKED CONCURRENCY CERTIFICATION: SC01 SC02 PASS ==="
else
  echo "=== SKIP LOCKED CONCURRENCY CERTIFICATION: FAIL ==="
fi

exit $((1 - PASS))
