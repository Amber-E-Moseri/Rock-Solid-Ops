#!/usr/bin/env bash
# Local replay for the Needs Attention RPC authorization matrix.
# Creates a throwaway database on a cluster you already run, applies the Supabase shim,
# replays every migration in supabase/migrations in filename order, then runs matrix.sql.
# NEVER point PGHOST/PGPORT at staging or production. The database is dropped afterwards.
# Example: PGPORT=55432 PSQL_BIN=/path/to/psql bash scripts/attention-rpc-replay.sh
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGUSER:=postgres}"
: "${PSQL_BIN:=psql}"
# No default port: the replay must target a throwaway cluster you named explicitly.
: "${PGPORT:?set PGPORT to the throwaway replay cluster port}"
DB="attention_rpc_replay_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=("$PSQL_BIN" -X -q -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER")

"${PSQL[@]}" -d postgres -c "create database $DB"
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null' EXIT

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/security/attention-rpc/00_shim.sql" >/dev/null

applied=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  if ! "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1; then
    echo "REPLAY FAILED at $(basename "$f")" >&2
    exit 1
  fi
  applied=$((applied + 1))
done
echo "replayed $applied migrations"

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/security/attention-rpc/matrix.sql"
