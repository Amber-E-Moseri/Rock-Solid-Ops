#!/usr/bin/env bash
# Synthetic test harness for scripts/backup/backup-prod-logical.sh.
#
# SYNTHETIC DATA ONLY. Creates a throwaway PostgreSQL 17 cluster on a private port, a fake Supabase CLI,
# a test passphrase file, and a temporary backup folder. Never connects to a real project.
#
#   PG_BIN="/c/Program Files/PostgreSQL/17/bin" bash scripts/backup/test-backup-synthetic.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/backup-prod-logical.sh"
PG_BIN="${PG_BIN:?set PG_BIN to a PostgreSQL 17 bin directory}"
PORT="${PG_PORT:-55460}"
W="/c/rso-synth-backup-test.$$"; mkdir -p "$W"
DATA="$W/data"
TESTREF="synthtestref000000000"
PASS="synthetic-test-passphrase"

exe() { if [ -x "$PG_BIN/$1.exe" ]; then echo "$PG_BIN/$1.exe"; else echo "$PG_BIN/$1"; fi; }
PSQL="$(exe psql)"; INITDB="$(exe initdb)"; PGCTL="$(exe pg_ctl)"; REAL_PGDUMP="$(exe pg_dump)"
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

PASSED=0; FAILED=0
ok()  { PASSED=$((PASSED + 1)); echo "  PASS  $1"; }
bad() { FAILED=$((FAILED + 1)); echo "  FAIL  $1"; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }

q() { "$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$@"; }
qv() { local db="$1"; shift; q "$db" -q -tA "$@" | tr -d '\r' | tail -n 1; }

cleanup() {
  "$PGCTL" -D "$(native "$DATA")" -m fast -w stop >/dev/null 2>&1
  rm -rf "$W"
}
trap cleanup EXIT

# --- fake Supabase CLI: prints the connection exports the real CLI would print --------------
make_cli() { # make_cli <pguser> <dir>
  mkdir -p "$2/bin" "$W/cli/supabase/.temp"
  printf '%s' "$TESTREF" > "$W/cli/supabase/.temp/project-ref"
  cat > "$2/bin/supabase" <<EOF
#!/usr/bin/env bash
if [ "\$*" = "db dump --linked --dry-run" ]; then
  echo "export PGHOST=127.0.0.1"
  echo "export PGPORT=$PORT"
  echo "export PGUSER=$1"
  echo "export PGPASSWORD="
  echo "export PGDATABASE=synth"
  exit 0
fi
echo "stub: unsupported" >&2; exit 1
EOF
  chmod +x "$2/bin/supabase"
}

run_backup() { # run_backup <bin-dir-first-in-PATH> <pg_bin> <outdir>
  env PATH="$1:$PATH" PROJECT_REF="$TESTREF" BACKUP_DIR="$3" PG_BIN="$2" CLI_DIR="$W/cli" \
    BACKUP_TEST_MODE=1 GPG_EXTRA_ARGS="--batch --pinentry-mode loopback --passphrase-file $(native "$W/pass.txt")" \
    bash "$SCRIPT" > "$W/run.out" 2>&1
}

echo "== backup script synthetic tests (PostgreSQL 17, synthetic data) =="
"$INITDB" -D "$(native "$DATA")" -U postgres --auth=trust -E UTF8 >"$W/initdb.log" 2>&1 || { echo "initdb failed"; exit 1; }
"$PGCTL" -D "$(native "$DATA")" -o "-p $PORT -h 127.0.0.1" -l "$(native "$W/server.log")" -w start >"$W/start.log" 2>&1 || { echo "start failed"; exit 1; }
case "$(qv postgres -c 'show server_version')" in 17.*) ok "server is PostgreSQL 17" ;; *) bad "server is not PostgreSQL 17"; exit 1 ;; esac

q postgres -q -c "create database synth" -c "create database synth_restore" >/dev/null
q synth -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create table public.class_options (class_option_id text primary key, class_id text not null, active boolean not null);
insert into public.class_options select 'SYN-' || g, 'CLASS-' || (g % 4), true from generate_series(1, 13) g;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
insert into supabase_migrations.schema_migrations values ('SYN-000001','synthetic_a',null),('SYN-000002','synthetic_b',null),('SYN-000003','synthetic_c',null);
create role backup_reader login;
grant connect on database synth to backup_reader;
grant usage on schema public to backup_reader;
grant select on public.class_options to backup_reader;
SQL
ok "synthetic source loaded (13 class options, 3 migration-history rows)"

mkdir -p "$W/out" "$W/badbin" "$W/badgpg" "$W/pgbin_ok"
printf '%s\n' "$PASS" > "$W/pass.txt"
make_cli postgres "$W/cli_ok"
make_cli backup_reader "$W/cli_reader"
# The script's CLI_DIR is $W/cli, linked to the test reference, with the postgres stub on its bin path.
cp -r "$W/cli_ok/bin" "$W/cli/bin"

# ---- S1: success ----
echo "-- S1 success path"
run_backup "$W/cli/bin" "$PG_BIN" "$W/out"; rc=$?; [ "$rc" -ne 0 ] && { echo "--- S1 script output:"; tail -15 "$W/run.out"; }
check "script exits 0 on success" test "$rc" -eq 0
final="$(ls "$W/out"/*.dump.gpg 2>/dev/null | head -1)"
check "final encrypted file exists" test -n "$final" -a -s "$final"
check "no .partial file remains" test -z "$(ls "$W/out"/*.partial 2>/dev/null)"
check "no plaintext dump on disk (no PGDMP header anywhere in the folder)" bash -c "! grep -l -a -r 'PGDMP' '$W/out'"
check "checksum file written and verifies" bash -c "cd '$W/out' && sha256sum -c \"\$(ls *.dump.gpg.sha256)\" >/dev/null"
check "metadata records status=OK" grep -q '^status=OK' "$(ls "$W/out"/*.metadata.txt)"
check "run output and logs do not contain the passphrase" bash -c "! grep -q -r '$PASS' '$W/out' '$W/run.out'"
toc="$W/toc.txt"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$(native "$W/pass.txt")" --decrypt "$final" 2>/dev/null | "$(exe pg_restore)" -l > "$toc" 2>/dev/null
check "archive is readable: table of contents lists class_options" grep -q 'TABLE DATA public class_options' "$toc"
check "archive is readable: table of contents lists migration history" grep -q 'TABLE DATA supabase_migrations schema_migrations' "$toc"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$(native "$W/pass.txt")" --decrypt "$final" 2>/dev/null \
  | "$(exe pg_restore)" --clean --if-exists --no-owner --no-privileges --exit-on-error -h 127.0.0.1 -p "$PORT" -U postgres -d synth_restore >/dev/null 2>&1
check "restore completes with --exit-on-error" test $? -eq 0
check "restored class_options row count = 13" test "$(qv synth_restore -c 'select count(*) from public.class_options')" = "13"
check "restored migration-history row count = 3" test "$(qv synth_restore -c 'select count(*) from supabase_migrations.schema_migrations')" = "3"
check "restored class_options checksum equals source" test \
  "$(qv synth_restore -c "select md5(string_agg(row_to_json(c)::text,'|' order by class_option_id)) from public.class_options c")" = \
  "$(qv synth -c "select md5(string_agg(row_to_json(c)::text,'|' order by class_option_id)) from public.class_options c")"

# checksum detects corruption
cp "$final" "$W/corrupt.dump.gpg"; printf 'X' | dd of="$W/corrupt.dump.gpg" bs=1 seek=100 conv=notrunc status=none
check "checksum verification detects a corrupted copy" bash -c "cd '$W' && printf '%s  corrupt.dump.gpg\n' \"\$(sha256sum '$final' | cut -d' ' -f1)\" > c.sha256 && ! sha256sum -c c.sha256 >/dev/null 2>&1"

# ---- S2: pg_dump failure ----
echo "-- S2 pg_dump failure"
cat > "$W/badbin/pg_dump" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.0 (synthetic stub)"; exit 0; fi
printf 'PGDMP-synthetic-partial-bytes'
echo "pg_dump: synthetic failure" >&2
exit 1
EOF
chmod +x "$W/badbin/pg_dump"
# psql wrapper: the script also needs psql from PG_BIN; delegate to the real one.
printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$PSQL" > "$W/badbin/psql"
chmod +x "$W/badbin/psql"
mkdir -p "$W/out2"
run_backup "$W/cli/bin" "$W/badbin" "$W/out2"; rc=$?
check "pg_dump failure: script exits non-zero" test "$rc" -ne 0
check "pg_dump failure: no final file" test -z "$(ls "$W/out2"/*.dump.gpg 2>/dev/null)"
check "pg_dump failure: partial file removed" test -z "$(ls "$W/out2"/*.partial 2>/dev/null)"
check "pg_dump failure: metadata records FAILED" grep -q '^status=FAILED' "$(ls "$W/out2"/*.metadata.txt)"

# ---- S3: gpg failure or cancellation ----
echo "-- S3 gpg failure or cancellation"
cat > "$W/badgpg/gpg" <<'EOF'
#!/usr/bin/env bash
head -c 16 >/dev/null
echo "gpg: operation cancelled (synthetic stub)" >&2
exit 2
EOF
chmod +x "$W/badgpg/gpg"
mkdir -p "$W/out3"
run_backup "$W/badgpg:$W/cli/bin" "$PG_BIN" "$W/out3"; rc=$?
check "gpg failure: script exits non-zero" test "$rc" -ne 0
check "gpg failure: no final file" test -z "$(ls "$W/out3"/*.dump.gpg 2>/dev/null)"
check "gpg failure: partial file removed" test -z "$(ls "$W/out3"/*.partial 2>/dev/null)"
check "gpg failure: metadata records FAILED" grep -q '^status=FAILED' "$(ls "$W/out3"/*.metadata.txt)"

# ---- S4: missing migration-history permission ----
echo "-- S4 missing migration-history permission"
mkdir -p "$W/out4"
env PATH="$W/cli_reader/bin:$PATH" PROJECT_REF="$TESTREF" BACKUP_DIR="$W/out4" PG_BIN="$PG_BIN" CLI_DIR="$W/cli" \
  BACKUP_TEST_MODE=1 GPG_EXTRA_ARGS="--batch --pinentry-mode loopback --passphrase-file $(native "$W/pass.txt")" \
  bash "$SCRIPT" > "$W/run4.out" 2>&1; rc=$?
check "missing history permission: script refuses (non-zero)" test "$rc" -ne 0
check "missing history permission: message names the history table" grep -q 'cannot read supabase_migrations' "$W/run4.out"
check "missing history permission: no output files written" test -z "$(ls -A "$W/out4" 2>/dev/null)"

# ---- S5: partial-file cleanup across all failure runs ----
echo "-- S5 cleanup"
check "no .partial files remain in any output folder" bash -c "! ls '$W'/out*/*.partial >/dev/null 2>&1"
check "no plaintext dump in any output folder" bash -c "! grep -l -a -r 'PGDMP' '$W'/out*/ 2>/dev/null | grep -q ."

echo
echo "== result: $PASSED passed, $FAILED failed =="
[ "$FAILED" -eq 0 ]
