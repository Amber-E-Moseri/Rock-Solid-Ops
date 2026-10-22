#!/usr/bin/env bash
# Logical backup of the production Supabase database: public schema (schema and data)
# plus the migration-history table. Platform-managed schemas are excluded.
#
# Safety:
#   - Credentials are read in-process from the Supabase CLI and are never printed or written to disk.
#   - Read-only: pg_dump takes one consistent snapshot. No DDL, no writes.
#   - The output is encrypted (AES-256, gpg) before it is kept. The plaintext dump is deleted.
#   - Refuses to write anywhere inside a Git repository.
#
# Required environment (set by the operator; no secrets):
#   PROJECT_REF   Supabase project reference (for example xelpsttqhrcqmttmjory)
#   BACKUP_DIR    destination folder, outside every Git repository
#   PASS_FILE     passphrase file for gpg, outside every Git repository
#   PG_BIN        folder containing pg_dump (PostgreSQL 17 or newer)
#   CLI_DIR       directory linked to PROJECT_REF with `supabase link` (NOT the repository)
set -euo pipefail

: "${PROJECT_REF:?set PROJECT_REF}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${PASS_FILE:?set PASS_FILE}"
: "${PG_BIN:?set PG_BIN}"
: "${CLI_DIR:?set CLI_DIR}"

# Refuse destinations inside any Git work tree.
if git -C "$BACKUP_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "refusing: BACKUP_DIR is inside a Git repository" >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"

# The CLI must be linked to the production project, and only to it.
linked="$(cat "$CLI_DIR/supabase/.temp/project-ref" 2>/dev/null || true)"
if [ "$linked" != "$PROJECT_REF" ]; then
  echo "refusing: CLI_DIR is linked to '$linked', expected '$PROJECT_REF'" >&2
  exit 1
fi

# Read connection settings from the CLI's own dump script. Values are assigned, never echoed.
conn_exports="$(cd "$CLI_DIR" && supabase db dump --linked --dry-run 2>/dev/null | sed -n 's/^export \(PGHOST\|PGPORT\|PGUSER\|PGPASSWORD\|PGDATABASE\)=\(.*\)$/export \1=\2/p')"
if [ -z "$conn_exports" ]; then
  echo "could not read connection settings from the Supabase CLI" >&2
  exit 1
fi
eval "$conn_exports"
unset conn_exports

ts="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/${PROJECT_REF}-public-${ts}.dump"

"$PG_BIN/pg_dump" \
  --format=custom \
  --compress=6 \
  --serializable-deferrable \
  --no-owner \
  --no-privileges \
  --role=postgres \
  --schema=public \
  --file="$dump_file"

gpg --batch --yes --pinentry-mode loopback \
  --passphrase-file "$PASS_FILE" \
  --symmetric --cipher-algo AES256 \
  --output "${dump_file}.gpg" "$dump_file"
rm -f "$dump_file"

sha256sum "${dump_file}.gpg" | sed "s#  .*/#  #" > "${dump_file}.gpg.sha256"
echo "backup written: $(basename "${dump_file}.gpg")"
echo "checksum file:  $(basename "${dump_file}.gpg.sha256")"
