# Production logical backup plan (Supabase Free plan) — 2026-10-22

**Status:** plan and tooling rehearsal. **No production backup has been taken by this document.** The owner runs the production steps, from a machine the owner controls, after approval.

## 1. Why this plan exists

- The production project `foundation-school` (`xelpsttqhrcqmttmjory`) is on the **Supabase Free plan**. The dashboard states that the Free plan does not include managed project backups, and it offers no point-in-time recovery.
- Without a logical backup taken by the owner, no production change can be undone by the platform.
- A rollback SQL file is not a backup. It drops columns; it does not keep data.

## 2. Tooling

- **PostgreSQL 17 client tools** (`pg_dump`, `pg_restore`). Use version 17, matching the server (17.x). Older client versions refuse or mis-dump.
- **Connection:** the owner copies the connection string from the Supabase dashboard (Connect). The password stays on the owner's machine. Store it in an environment variable such as `PROD_DB_URL` in the owner's shell. **Never paste it into chat, a file in the repo, a ticket, or a log.**

## 3. What to back up

| Scope | Included | Why |
|---|---|---|
| `public` schema (tables, data, sequences, functions, triggers, policies) | Yes | Application data and the objects this repair touches |
| `supabase_migrations` schema | Yes | Migration history, needed to explain any mismatch |
| `auth` schema | **Separate, owner decision** | Contains credential hashes and identities. It is personal data. Back it up only with an explicit decision, to its own encrypted file. |
| `storage`, `realtime`, extension-owned schemas | No (Supabase-managed) | Not part of the repair. Recover them through Supabase support if ever needed, and note the limit. |

## 4. Consistency

Use a single snapshot taken with `--serializable-deferrable`. It waits for a safe snapshot, so the dump is consistent across all tables.

The dump is a point in time. Anything written after it starts is not in the dump.

## 5. Procedure (owner runs; production)

1. **Confirm the approval** for the backup itself. Note the time, and pause any planned production change until the backup is verified.
2. **Dump the data and objects in one file** (custom format, compressed):

   ```bash
   pg_dump "$PROD_DB_URL" \
     --format=custom --compress=9 \
     --schema=public --schema=supabase_migrations \
     --serializable-deferrable \
     --no-owner --no-privileges \
     --file="rso_prod_YYYYMMDD_HHMM.dump" --verbose
   ```

3. **Dump the schema as plain SQL** for human review (no data):

   ```bash
   pg_dump "$PROD_DB_URL" --schema-only --schema=public --schema=supabase_migrations \
     --no-owner --no-privileges --file="rso_prod_schema_YYYYMMDD_HHMM.sql"
   ```

4. **Record row counts** per table at dump time, with read-only queries in the same session as the dump, or as a separate read-only snapshot. Store them next to the dump.
5. **Record a checksum** of each file: `sha256sum rso_prod_*.dump rso_prod_schema_*.sql > backup.sha256`. Store the checksum file separately from the dump.

## 6. Secure storage

- **Encrypt** the dump at rest before it leaves the owner's machine (for example `age` or `gpg`, with a key the owner controls).
- **Two copies** in two separate locations the owner controls. Neither copy goes into the Git repository, a Netlify build, a shared drive, or a chat.
- **Restrict access** to the owner and named operators. The dump contains applicant personal data and must be handled under the privacy rules in `CLAUDE.md`.
- **Retention:** keep at least until the repair is validated and the next backup is verified. Then keep per the owner's retention policy.
- **Log** who holds each copy and when it was created.

## 7. Verify the backup is readable (no database needed)

```bash
sha256sum -c backup.sha256
pg_restore --list "rso_prod_YYYYMMDD_HHMM.dump" > toc.txt   # must exit 0
grep -c "TABLE DATA" toc.txt                                 # expect the number of tables recorded in step 4
grep "class_options" toc.txt                                 # class_options must be present
```

Pass criteria: checksum matches; `pg_restore --list` exits 0; table-data entries match the recorded table count; `class_options` is listed.

## 8. Restore rehearsal (isolated database, never production)

Restore into an isolated PostgreSQL 17 database. The owner may use a fresh Supabase **test** project, or a local PostgreSQL 17 cluster. Never restore into `foundation-school`.

```bash
createdb "rso_restore_check"   # or create a fresh test project and get its URL
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname "$RESTORE_DB_URL" "rso_prod_YYYYMMDD_HHMM.dump"
```

`--clean --if-exists` is required. A fresh database already has an empty `public` schema, and without `--clean` the restore fails with `schema "public" already exists`. This was found by the rehearsal in `supabase/tests/class-options-repair/backup_rehearsal.sh`. The flag drops the target's objects first, so **`$RESTORE_DB_URL` must be a dedicated, empty, throwaway database. It must never be the production project.**

Then compare with the counts recorded in step 4, and the same checksum over `class_options` used in the repair runbook. Also run the registration query (as the anon role) to confirm it fails before the repair and succeeds after it, in that order.

Pass criteria: `pg_restore` exits 0 with `--exit-on-error`; row counts match step 4 for every table; the `class_options` checksum matches the dump-time value.

## 9. Tooling rehearsal (done in this PR)

This PR does **not** contain a production dump. It rehearses the tooling on a **synthetic** database, to prove that the commands and the pass criteria in sections 7–8 work with PostgreSQL 17. The rehearsal used the local harness approach, on a throwaway cluster on a private port:

- a synthetic `public.class_options` table with 13 rows;
- `pg_dump` in custom format with `--serializable-deferrable`;
- `pg_restore --list` and checksum verification;
- `pg_restore --exit-on-error` into a second, empty database;
- the same checksum compared before and after the restore.

Results are recorded in section 10. They prove the mechanics. They are not a production backup.

## 10. Rehearsal results (synthetic data, PostgreSQL 17.11)

Reproducible with `supabase/tests/class-options-repair/backup_rehearsal.sh` (`PG_BIN` set to a PostgreSQL 17 bin directory). Result on 2026-10-22, PostgreSQL 17.11, synthetic data: **12 passed, 0 failed.**

| Check | Result |
|---|---|
| Server and `pg_dump` are both version 17 | PASS |
| Synthetic source loaded (13 class options) | PASS |
| `pg_dump --format=custom --serializable-deferrable` completes | PASS |
| Dump checksum recorded and verifies | PASS (2 checks) |
| `pg_restore --list` reads the dump; `class_options` data listed | PASS (2 checks) |
| Table-data entries match the source table count | PASS |
| `pg_restore --clean --if-exists --exit-on-error` into a dedicated empty database | PASS |
| Restored row count and `class_options` checksum match the source | PASS (2 checks) |

**Defect found and fixed by this rehearsal.** The first version of section 8 used `pg_restore` without `--clean --if-exists`. A fresh database already has an empty `public` schema, so the restore failed with `schema "public" already exists`. Section 8 now includes the flags, and says the target must be a dedicated throwaway database.

The rehearsal proves the tooling and the checks. It is not a production backup, and it does not prove any production dump.

## 11. Limitations

- **No platform restore on Free.** If production is damaged, recovery depends on the owner's dump and the owner's ability to apply it. Supabase support is not a backup.
- **Point in time = dump time.** Writes after the dump starts are lost if a restore is needed.
- **Restoring into production is a separate, approved operation** with a maintenance window. It is not covered by this plan.
- **`auth` is excluded by default.** Restoring users and identities needs its own plan.
- **Managed schemas are excluded.** Storage objects are not in the dump.
- **Client version must match:** use PostgreSQL 17 tools for a 17.x server.

## 12. Go / no-go for production SQL (from this plan)

**NO-GO** until all of the following are true, recorded by the owner:

1. A production dump exists, with the checksum recorded and stored in two places.
2. `pg_restore --list` and checksum verification passed (section 7).
3. A restore rehearsal into an isolated database passed (section 8), with row counts and the `class_options` checksum matching.
4. The owner has reviewed the schema dump for the affected objects.
