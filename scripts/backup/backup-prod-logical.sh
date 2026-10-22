#!/usr/bin/env bash
# Encrypted logical backup of the Supabase production database:
#   - schema public (tables with data, functions, triggers, policies, constraints)
#   - schema supabase_migrations (migration history), in the same consistent snapshot
#
# Fail-safe streaming:
#   pg_dump | gpg  ->  <name>.dump.gpg.partial  ->  <name>.dump.gpg only after every check passes.
#   No plaintext dump is ever written to disk.
#   Any failure (pg_dump, gpg, validation, checksum) removes the .partial file and exits non-zero.
#
# Passphrase: the owner types it at the gpg prompt. It is never stored, read from a file, or logged.
#
# Logs and metadata contain status lines, counts, sizes and checksums only. Connection settings are
# read at run time from the Supabase CLI and assigned to variables; they are never printed.
#
# Required environment (no secrets):
#   PROJECT_REF   Supabase project reference. Must be xelpsttqhrcqmttmjory for production runs.
#   BACKUP_DIR    destination folder: outside every Git repository and outside cloud-synced folders.
#   PG_BIN        folder containing pg_dump and psql (PostgreSQL 17 or newer).
#   CLI_DIR       directory linked to PROJECT_REF with `supabase link` (never the repository).
#
# BACKUP_TEST_MODE=1 is for the synthetic test harness only (scripts/backup/test-backup-synthetic.sh).
# It relaxes the project-reference check and enables GPG_EXTRA_ARGS. Operators must never set it.
set -euo pipefail

: "${PROJECT_REF:?set PROJECT_REF}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${PG_BIN:?set PG_BIN}"
: "${CLI_DIR:?set CLI_DIR}"

PRODUCTION_REF="xelpsttqhrcqmttmjory"
TEST_MODE="${BACKUP_TEST_MODE:-0}"
GPG_EXTRA="${GPG_EXTRA_ARGS:-}"
if [ "$TEST_MODE" != "1" ]; then
  if [ "$PROJECT_REF" != "$PRODUCTION_REF" ]; then
    echo "refusing: PROJECT_REF must be $PRODUCTION_REF" >&2
    exit 1
  fi
  GPG_EXTRA=""
fi

# --- destination checks ------------------------------------------------------
mkdir -p "$BACKUP_DIR"
if git -C "$BACKUP_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "refusing: BACKUP_DIR is inside a Git repository" >&2
  exit 1
fi
case "$(printf '%s' "$BACKUP_DIR" | tr '[:upper:]' '[:lower:]')" in
  *onedrive*|*dropbox*|*"google drive"*|*icloud*)
    echo "refusing: BACKUP_DIR looks cloud-synchronised" >&2
    exit 1 ;;
esac
if command -v icacls >/dev/null 2>&1 && [ "$TEST_MODE" != "1" ]; then
  acl="$(icacls "$(cygpath -w "$BACKUP_DIR")" 2>/dev/null || true)"
  if printf '%s' "$acl" | grep -qi -E 'Everyone|BUILTIN\\Users|Authenticated Users'; then
    echo "refusing: BACKUP_DIR grants access to broad groups; restrict it to the operator account" >&2
    exit 1
  fi
fi

# A run that was hard-killed (for example, by a power loss) cannot run its cleanup trap, so remove any
# stale partial output from earlier runs. A partial file is never a valid backup.
stale="$(ls "$BACKUP_DIR"/*.dump.gpg.partial 2>/dev/null || true)"
if [ -n "$stale" ]; then
  rm -f $stale
  echo "removed stale partial output from an earlier run" >&2
fi

# --- CLI link check ----------------------------------------------------------
linked="$(cat "$CLI_DIR/supabase/.temp/project-ref" 2>/dev/null || true)"
if [ "$linked" != "$PROJECT_REF" ]; then
  echo "refusing: CLI_DIR is linked to '$linked', expected '$PROJECT_REF'" >&2
  exit 1
fi

# --- connection settings (assigned, never echoed) ----------------------------
conn_exports="$(cd "$CLI_DIR" && supabase db dump --linked --dry-run 2>/dev/null | sed -n 's/^export \(PGHOST\|PGPORT\|PGUSER\|PGPASSWORD\|PGDATABASE\)=\(.*\)$/export \1=\2/p')"
if [ -z "$conn_exports" ]; then
  echo "could not read connection settings from the Supabase CLI" >&2
  exit 1
fi
eval "$conn_exports"
unset conn_exports

PSQL="$PG_BIN/psql"
PGDUMP="$PG_BIN/pg_dump"
[ -x "$PGDUMP" ] || [ -x "$PGDUMP.exe" ] || { echo "pg_dump not found in PG_BIN" >&2; exit 1; }

# --- pre-flight: the role must read the history and the public data -----------
history_rows=""
if ! history_rows="$("$PSQL" -X -q -tA -v ON_ERROR_STOP=1 -c 'select count(*) from supabase_migrations.schema_migrations' 2>/dev/null | tr -d '\r')"; then
  echo "refusing: the connected role cannot read supabase_migrations.schema_migrations. No backup written." >&2
  exit 1
fi
public_tables="$("$PSQL" -X -q -tA -v ON_ERROR_STOP=1 -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" 2>/dev/null | tr -d '\r')"
server_version="$("$PSQL" -X -q -tA -c 'show server_version' 2>/dev/null | tr -d '\r')"

# --- streamed, encrypted backup ----------------------------------------------
ts="$(date -u +%Y%m%dT%H%M%SZ)"
base="$BACKUP_DIR/${PROJECT_REF}-${ts}"
final="${base}.dump.gpg"
partial="${final}.partial"
meta="${base}.metadata.txt"
log="${base}.run.log"

cat > "$meta" <<EOF
started_utc=$ts
project_ref=$PROJECT_REF
scope=public (schema and data) + supabase_migrations (migration history), one pg_dump snapshot
format=pg_dump custom, compress=6, serializable-deferrable, no owner, no privileges
encryption=gpg symmetric AES256, passphrase entered by the owner (not stored)
server_version=$server_version
preflight_public_base_tables=$public_tables
preflight_migration_history_rows=$history_rows
pg_dump_version=$("$PGDUMP" --version | tr -d '\r')
EOF

finish() {
  local rc=$?
  if [ $rc -ne 0 ]; then
    rm -f "$partial"
    echo "status=FAILED" >> "$meta"
  fi
  echo "exit_code=$rc" >> "$meta"
  exit $rc
}
trap finish EXIT

set +e
"$PGDUMP" --format=custom --compress=6 --serializable-deferrable --no-owner --no-privileges \
  --schema=public --schema=supabase_migrations 2>>"$log" \
  | gpg --yes --symmetric --cipher-algo AES256 $GPG_EXTRA --output "$partial" 2>>"$log"
statuses=("${PIPESTATUS[@]}")
set -e

if [ "${statuses[0]}" -ne 0 ]; then
  echo "pg_dump failed (exit ${statuses[0]}); partial output removed" >&2
  exit 1
fi
if [ "${statuses[1]}" -ne 0 ]; then
  echo "gpg failed or was cancelled (exit ${statuses[1]}); partial output removed" >&2
  exit 1
fi
if [ ! -s "$partial" ]; then
  echo "encrypted output is empty; nothing kept" >&2
  exit 1
fi
# Structural check without a passphrase prompt. `gpg --list-packets` would ask for the passphrase on
# symmetric data and hang, so check the first OpenPGP packet byte instead: symmetric-key-encrypted
# session key packet, old format 0x8c or new format 0xc3. Full readability is verified after decryption.
first_byte="$(od -An -tx1 -N1 "$partial" | tr -d ' \n')"
case "$first_byte" in
  8c|c3) ;;
  *) echo "output does not start with an OpenPGP symmetric packet; nothing kept" >&2; exit 1 ;;
esac

# Publish only now, after every check above.
mv "$partial" "$final"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256" )
( cd "$BACKUP_DIR" && sha256sum -c "$(basename "$final").sha256" >/dev/null ) || { echo "checksum verification failed" >&2; rm -f "$final"; exit 1; }

{
  echo "status=OK"
  echo "file=$(basename "$final")"
  echo "bytes=$(wc -c < "$final" | tr -d ' ')"
  echo "sha256=$(cut -d' ' -f1 "$final.sha256")"
} >> "$meta"
echo "backup written: $(basename "$final")"
echo "checksum file:  $(basename "$final").sha256"
