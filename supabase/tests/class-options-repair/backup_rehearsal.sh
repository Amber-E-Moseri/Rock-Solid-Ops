#!/usr/bin/env bash
# Rehearses the logical-backup tooling from docs/PRODUCTION_BACKUP_AND_RECOVERY_2026-10-22.md (PR #9)
# on SYNTHETIC data only, using a throwaway PostgreSQL 17 cluster on a private port.
#
# It never connects to a real database. It proves: pg_dump (custom format, serializable-deferrable)
# produces a dump that is readable (pg_restore --list), restores with --exit-on-error into an empty
# database, and reproduces the same class_options checksum and row counts.
#
#   PG_BIN="/c/Program Files/PostgreSQL/17/bin" bash supabase/tests/class-options-repair/backup_rehearsal.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_BIN="${PG_BIN:?set PG_BIN to a PostgreSQL 17 bin directory}"
PORT="${PG_PORT:-55448}"
WORK="$(mktemp -d)"
DATA="$WORK/data"

exe() { if [ -x "$PG_BIN/$1.exe" ]; then echo "$PG_BIN/$1.exe"; else echo "$PG_BIN/$1"; fi; }
PSQL="$(exe psql)"; INITDB="$(exe initdb)"; PGCTL="$(exe pg_ctl)"; PGDUMP="$(exe pg_dump)"; PGRESTORE="$(exe pg_restore)"
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }

SRC=rso_src; DST=rso_restore_check
q() { local db="$1"; shift; "$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
qv() { local db="$1"; shift; q "$db" -tA "$@" | tail -n 1; }
CHECKSUM="select md5(string_agg(row_to_json(c)::text, '|' order by class_option_id)) from public.class_options c"

cleanup() {
  "$PGCTL" -D "$(native "$DATA")" -m fast -w stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== backup tooling rehearsal (PostgreSQL 17, synthetic data) =="
"$INITDB" -D "$(native "$DATA")" -U postgres --auth=trust -E UTF8 >"$WORK/initdb.log" 2>&1 || { echo "initdb failed"; exit 1; }
"$PGCTL" -D "$(native "$DATA")" -o "-p $PORT -h 127.0.0.1" -l "$(native "$WORK/server.log")" -w start >"$WORK/start.log" 2>&1 || { echo "start failed"; exit 1; }

VERSION="$("$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'show server_version')"
case "$VERSION" in 17.*) ok "server is PostgreSQL 17 ($VERSION)" ;; *) bad "server is not PostgreSQL 17 ($VERSION)"; exit 1 ;; esac
case "$("$PGDUMP" --version)" in *" 17."*) ok "pg_dump is version 17" ;; *) bad "pg_dump is not version 17"; exit 1 ;; esac

q postgres -qc "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end \$\$;" >/dev/null
q postgres -qc "create database $SRC" >/dev/null
q postgres -qc "create database $DST" >/dev/null
q "$SRC" -q -f "$(native "$HERE/00_setup.sql")" >/dev/null && ok "synthetic source database loaded (13 class options)" || { bad "setup failed"; exit 1; }

SRC_CHECKSUM="$(qv "$SRC" -c "$CHECKSUM")"
SRC_ROWS="$(qv "$SRC" -c "select count(*) from public.class_options")"
SRC_TABLES="$(qv "$SRC" -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "   source: rows=$SRC_ROWS tables=$SRC_TABLES checksum=$SRC_CHECKSUM"

DUMP="$WORK/rso_synthetic.dump"
"$PGDUMP" -h 127.0.0.1 -p "$PORT" -U postgres -d "$SRC" \
  --format=custom --compress=9 --schema=public --schema=supabase_migrations \
  --serializable-deferrable --no-owner --no-privileges --file="$(native "$DUMP")" >"$WORK/dump.log" 2>&1 \
  && ok "pg_dump completes (custom format, --serializable-deferrable)" || { bad "pg_dump failed"; cat "$WORK/dump.log"; exit 1; }

sha256sum "$DUMP" > "$WORK/dump.sha256" 2>/dev/null && ok "checksum recorded for the dump file" || bad "checksum step failed"
sha256sum -c "$WORK/dump.sha256" >/dev/null 2>&1 && ok "checksum verifies" || bad "checksum does not verify"

"$PGRESTORE" --list "$(native "$DUMP")" > "$WORK/toc.txt" 2>"$WORK/toc.err" && ok "pg_restore --list reads the dump (readable)" || { bad "pg_restore --list failed"; cat "$WORK/toc.err"; }
grep -q "TABLE DATA public class_options" "$WORK/toc.txt" && ok "class_options data is present in the table of contents" || bad "class_options missing from the table of contents"
TABLE_DATA="$(grep -c 'TABLE DATA public' "$WORK/toc.txt")"
[ "$TABLE_DATA" = "$SRC_TABLES" ] && ok "table-data entries ($TABLE_DATA) match the source table count" || bad "table-data entries ($TABLE_DATA) differ from source tables ($SRC_TABLES)"

# A fresh database already has an empty public schema, so the restore must clean it first.
# --clean --if-exists is only safe because $DST is a dedicated throwaway database.
"$PGRESTORE" --clean --if-exists --no-owner --no-privileges --exit-on-error -h 127.0.0.1 -p "$PORT" -U postgres -d "$DST" "$(native "$DUMP")" >"$WORK/restore.log" 2>&1 \
  && ok "pg_restore --clean --if-exists --exit-on-error into a dedicated throwaway database completes" || { bad "restore failed"; tail -5 "$WORK/restore.log"; }

DST_CHECKSUM="$(qv "$DST" -c "$CHECKSUM")"
DST_ROWS="$(qv "$DST" -c "select count(*) from public.class_options")"
[ "$DST_ROWS" = "$SRC_ROWS" ] && ok "restored row count matches ($DST_ROWS)" || bad "restored row count $DST_ROWS != $SRC_ROWS"
[ "$DST_CHECKSUM" = "$SRC_CHECKSUM" ] && ok "restored class_options checksum matches the source" || bad "restored checksum differs"

echo
echo "== result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
