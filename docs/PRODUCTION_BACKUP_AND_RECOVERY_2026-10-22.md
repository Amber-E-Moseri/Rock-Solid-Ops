# Production backup and recovery runbook (2026-10-22, corrected)

Project: `foundation-school` (Supabase project ref `xelpsttqhrcqmttmjory`, PostgreSQL 17.6).
Organisation plan: **Free**. Supabase managed backups and PITR are not available (verified in the dashboard on 2026-10-22: "Free Plan does not include project backups", "Point in Time Recovery is a Pro Plan add-on", PITR DISABLED).

**This runbook is the only recovery path for production data until the owner upgrades the plan or approves another mechanism.** Read the limitations in section 7 before relying on it.

## 1. Scope (explicit)

One encrypted file, from one `pg_dump` snapshot, containing exactly:

| Included | Excluded (platform-managed or sensitive) |
|---|---|
| Schema `public`: tables with data, sequences, functions, triggers, indexes, RLS policies, constraints | Schema `auth` (user accounts, identities and credential hashes). Requires a separate approved export. |
| Schema `supabase_migrations`: migration history (table `schema_migrations`), with data | Schema `storage` and stored files |
| | Schema `vault` (secrets) |
| | Schemas `cron`, `extensions`, `realtime`, `graphql`, `pgsodium`, `supabase_functions`, `net` and other platform schemas |
| | Roles, grants and owners (`--no-owner --no-privileges`) |
| | Edge Function source and secrets (managed outside the database) |

**Consistency.** One snapshot (`--serializable-deferrable`). The file is consistent to its snapshot time. It is not point-in-time.

**Permissions.** The migration history is read in the same snapshot. If the connected role cannot read `supabase_migrations.schema_migrations`, the script refuses before any dump is written. It does not produce a partial backup.

## 2. Tooling, access and passphrase

- PostgreSQL 17 client tools (`pg_dump`, `psql`). Version 17 or later reads PostgreSQL 17 servers.
- Supabase CLI logged in as the operator. The CLI connects with a **temporary login role** (`cli_login_postgres`). It expires after a short period, and the role may remain in the database (section 7).
- Connection settings are read at run time from the CLI's own dry-run script and assigned to variables. They are never printed, logged or written to disk.
- **Passphrase.** The owner types the passphrase at the `gpg` prompt. It is not stored in any file, environment variable or script, and it is never written to logs. It must not be stored alongside the backup.
- Encryption: `gpg --symmetric --cipher-algo AES256`.

## 3. Backup procedure

Run from any folder that is **not** inside a Git repository (see section 4), with a CLI directory that is linked to `xelpsttqhrcqmttmjory`:

```bash
# Placeholders only. Substitute the operator's paths. Do not add secrets to this file.
export PROJECT_REF=xelpsttqhrcqmttmjory
export BACKUP_DIR="<folder outside every Git repository, not cloud-synchronised>"
export PG_BIN="<folder containing pg_dump and psql, PostgreSQL 17 or later>"
export CLI_DIR="<directory linked to $PROJECT_REF>"
bash scripts/backup/backup-prod-logical.sh
```

The script:
1. Refuses unless `PROJECT_REF` is `xelpsttqhrcqmttmjory`.
2. Refuses if `BACKUP_DIR` is inside any Git repository, looks cloud-synchronised (OneDrive, Dropbox, Google Drive, iCloud), or grants access to broad groups (Everyone, Users, Authenticated Users).
3. Refuses if `CLI_DIR` is not linked to `PROJECT_REF`.
4. Removes stale `*.dump.gpg.partial` files left by an earlier hard-killed run.
5. Reads the connection settings from the CLI, and refuses if the connected role cannot read the migration history. It records public table and history row counts in the metadata.
6. Streams one `pg_dump` into `gpg`: `pg_dump --format=custom --compress=6 --serializable-deferrable --no-owner --no-privileges --schema=public --schema=supabase_migrations | gpg --symmetric --cipher-algo AES256`. **No plaintext is written to disk.** The output goes to `<name>.dump.gpg.partial`.
7. Captures the exit status of **both** `pg_dump` and `gpg`. If either fails, it removes the partial file, records `status=FAILED`, and exits non-zero.
8. Checks that the output starts with an OpenPGP symmetric-key packet, and that it is not empty. This check does not decrypt or prompt. Full readability is verified in section 6.
9. Renames the file to `<name>.dump.gpg` only after every check passes. Writes `<name>.dump.gpg.sha256`, verifies it, and records `status=OK`, the size and the checksum in `<name>.metadata.txt`.

Outputs in `BACKUP_DIR`:
- `<PROJECT_REF>-<UTC timestamp>.dump.gpg` (encrypted, one file)
- `<same>.dump.gpg.sha256` (checksum)
- `<same>.metadata.txt` (scope, versions, counts, status, checksum; no secrets, no records)
- `<same>.run.log` (`pg_dump` and `gpg` error output; object names only, no connection settings)

**Never** write a plaintext dump, export or log into a repository, a chat, a shared folder or a cloud-synchronised folder.

## 4. Storage

- **Location.** A folder on the operator's local drive, **outside every Git repository**. The user profile (`C:\Users\<user>`) is itself a Git repository in this environment, so a folder under it does not qualify. Use a folder such as `C:\rso-secure-backups\`, which is not inside a repository. The script enforces this and refuses otherwise.
- **Access.** Restricted to the operator account (ACL: owner-only). No broad group may have access.
- **Cloud sync.** Must be off for the folder. Do not place it in OneDrive, Dropbox, Google Drive or iCloud.
- **Passphrase.** Not stored. The owner enters it at each run and each restore. It is kept separately from the backup, never in the same folder.
- **Contents after a backup.** Encrypted file, checksum, metadata and run log. No plaintext.
- **Capacity.** The backup is about 2.2 MB for the current database.

## 5. Verification

### 5a. Earlier verification (procedure before this correction)

These results were produced on 2026-10-22 by the earlier, non-streaming procedure. They are kept for history. They do not verify the corrected script.

| Check | Result |
|---|---|
| Backup created (encrypted dump of `public`) | PASS. Snapshot time 2026-10-22 04:33:51 UTC. |
| Checksum of encrypted dump | PASS (`sha256sum -c`) |
| Decrypt to a temporary folder outside any repository | PASS |
| Archive table of contents | PASS. 134 tables (56 with data), 60 functions, 155 policies, 38 triggers. |
| Migration history export (separate, earlier method) | PASS. 159 rows. Checksum identical to production's history at the time. |
| Restore into an isolated **PostgreSQL 17.6** server | PASS with stated limits (section 7) |
| Verification items compared with production after restore | 62 items. **61 identical.** The one difference is `audit_logs` (60,939 restored vs 60,942 live), 3 rows written after the snapshot. |
| Foreign keys | 57 restored vs 60 in production. The 3 missing constraints reference `auth.users`, which is excluded (section 7). |

### 5b. Corrected script: synthetic tests (run before merge)

`scripts/backup/test-backup-synthetic.sh` runs the corrected script against a throwaway PostgreSQL 17 cluster with synthetic data and a fake CLI. It never connects to a real project. The test covers: success, readable archive, restore with `--exit-on-error`, row counts and checksum after restore, a corrupted-copy check, pg_dump failure, gpg failure or cancellation, missing history permission, and partial-file cleanup. The results are recorded in the PR.

### 5c. Corrected script: production run

**Not yet run.** A production run with the corrected script is a separate, approved operation. Its results must be recorded here, with the snapshot time, file name, checksum and restore result.

## 6. Restore procedure (for a real recovery)

Do not restore over production. Restore into a **new** database or project first, verify it, and only then decide what to move.

```bash
# Decrypt through a pipe. The plaintext is never written to disk.
gpg --decrypt "$BACKUP_DIR/<file>.dump.gpg" | "$PG_BIN/pg_restore" --clean --if-exists --no-owner --no-privileges --exit-on-error -d "<target database URL, supplied at run time>"
```

Before restoring, create the platform stand-ins that the public schema depends on: the `anon`, `authenticated` and `service_role` roles; the `extensions` schema with `pgcrypto` and `uuid-ossp`; the `supabase_functions` schema with a no-op `http_request()` trigger function; and the `auth` schema with `uid()`, `role()` and `jwt()` functions. The `auth.users` table is needed only for the three foreign keys in section 7. These stand-ins are not production objects, and the target must not be production.

**Readability check** (also run by the synthetic test): `gpg --decrypt <file> | pg_restore -l` must list `TABLE DATA public class_options` and `TABLE DATA supabase_migrations schema_migrations`.

Post-restore checks: row counts per table; the `class_options` checksum of its original columns; policy, function and trigger counts; the migration history row count and version list.

## 7. Limitations (read before relying on this backup)

1. **Not a platform backup.** Supabase daily backups and PITR are not available on the Free plan. This file is the only copy and is a snapshot at its own time. Writes after that time are not recoverable from it.
2. **Auth users are not included.** `auth` contains user accounts, identities and credential hashes. Restoring `public` without `auth.users` leaves 3 foreign keys (`admin_users`, `profiles`, `teachers` to `auth.users`) unrestored. Recovering user accounts needs a separate, approved export of `auth`.
3. **Storage, Vault, cron, extensions and Edge Function secrets are not included.** The cron schedule and the `attendance-reminder-daily` status are recorded in `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md`.
4. **Roles and grants are not included.** Policies reference `anon`, `authenticated` and `service_role`. The target must create them first.
5. **Not automated.** No schedule exists. A backup exists only when an operator runs the procedure.
6. **Temporary CLI role.** The CLI creates `cli_login_postgres` in production to connect. Its validity ended at 04:23 UTC on 2026-10-22, and the role was still present in `pg_roles` afterwards. Removing it is a production role change and needs owner approval.
7. **Personal data.** The file contains applicant, teacher, student and migration-history records. It is encrypted and local. It must not be copied to chat, logs or external services.
8. **Rehearsal limits.** PostgreSQL 17 was used, with stand-ins for platform objects. The rehearsal does not prove a restore into a real Supabase project.
9. **Passphrase loss is unrecoverable.** Without the passphrase, the file cannot be decrypted. Record where the owner keeps it, separately from the backup.

## 8. Backup gate status (2026-10-22)

| Requirement | Status |
|---|---|
| Recent verified logical backup of `public` with history (corrected script, production run) | **NOT YET RUN** with the corrected script. Earlier backup verified under section 5a. |
| Corrected script tested on synthetic data | Run before merge. See section 5b. |
| Restore rehearsal in PostgreSQL 17 | Satisfied for the earlier procedure (section 5a), with limits. |
| Supabase managed daily backup or PITR | **NOT AVAILABLE** (Free plan) |
| Migration history in the backup | Included in the corrected script's single file. Verified earlier as a separate export (section 5a). |
| Auth users recoverable | **NOT COVERED** (section 7, item 2) |

**Conclusion.** The corrected script removes the plaintext-on-disk and history-omission defects. It has not been run against production. Before any production change, run it once, record the results in section 5c, and verify the restore. The owner must also decide whether to accept the Free-plan limits and the Auth exclusion.

## 9. Unrelated items observed during this work (not changed)

- The shared temporary folder `C:\Users\moser\AppData\Local\Temp\pg17\` contains files from an earlier rehearsal. They were not created by this procedure and were left untouched.
- The main checkout `supabase_foundation` has uncommitted edits to `docs/BRANCH_HOLDS.md`, `docs/C6_EDGE_SECURITY_RECONCILIATION_2026-10-03.md` and `docs/migration-log.md`. They were not made by this procedure.
