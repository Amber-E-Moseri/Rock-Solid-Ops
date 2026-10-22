# Production backup and recovery runbook (2026-10-22)

Project: `foundation-school` (Supabase project ref `xelpsttqhrcqmttmjory`, PostgreSQL 17.6).
Organisation plan: **Free**. Supabase managed backups and PITR are not available (verified in the dashboard on 2026-10-22: "Free Plan does not include project backups", "Point in Time Recovery is a Pro Plan add-on", PITR DISABLED).

**This runbook is the only recovery path for production data until the owner upgrades the plan or approves another mechanism.** Read the limitations in section 7 before relying on it.

## 1. Scope

| Included | Excluded (platform-managed or sensitive) |
|---|---|
| Schema `public`: tables with data, sequences, functions, views, triggers, indexes, RLS policies, constraints | Schema `auth` (user accounts and credential hashes) |
| Schema `supabase_migrations` is **not** in the dump (the CLI role cannot read it). Migration history is exported separately (section 3, step 6). | Schema `storage` and stored files |
| | Schema `vault` (secrets) |
| | Schemas `cron`, `extensions`, `realtime`, `graphql`, `pgsodium`, `supabase_functions`, `net` and other platform schemas |
| | Roles, grants and owners (`--no-owner --no-privileges`) |
| | Edge Function source and secrets (managed outside the database) |

Consistency: one `pg_dump` snapshot (`--serializable-deferrable`). The dump is consistent to its snapshot time. It is not point-in-time.

## 2. Tooling and access

- PostgreSQL client tools, version 18.x from Scoop (`pg_dump` 18 reads PostgreSQL 17 servers). Installed under the operator profile.
- Supabase CLI logged in as the operator. Access uses the CLI's **temporary login role** (`cli_login_postgres`). The CLI creates it when it connects. It expires after a short period, and the role may remain in the database (see section 7).
- Connection settings are read at run time from the CLI's own dry-run script. Values are assigned to variables and never printed or written to disk.
- Encryption: `gpg` symmetric AES-256 with a random passphrase file that lives outside every Git repository.

## 3. Backup procedure

Run from the repository's `scripts/backup/` folder, with a directory that is linked to `xelpsttqhrcqmttmjory` (never the repository itself, which is linked to staging):

```bash
# Placeholders only. Substitute the operator's paths. Do not add secrets to this file.
export PROJECT_REF=xelpsttqhrcqmttmjory
export BACKUP_DIR="<folder outside every Git repository>"
export PASS_FILE="<passphrase file outside every Git repository>"
export PG_BIN="<folder containing pg_dump>"
export CLI_DIR="<directory linked to $PROJECT_REF>"
bash scripts/backup/backup-prod-logical.sh
```

The script:
1. Refuses if `BACKUP_DIR` is inside a Git work tree, or if `CLI_DIR` is not linked to `PROJECT_REF`.
2. Runs `pg_dump --format=custom --compress=6 --serializable-deferrable --no-owner --no-privileges --role=postgres --schema=public`.
3. Encrypts the dump with gpg (AES-256) and deletes the plaintext.
4. Writes a SHA-256 checksum file next to the encrypted backup.

Migration history export (run from the CLI directory; read-only):

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version;
```

Save the rows as JSON, encrypt the file the same way, delete the plaintext, and write its checksum.

**Never** write a plaintext dump or export into a repository, a chat, a log or a shared folder.

## 4. Storage

- Location: a folder on the operator's local system drive, outside every Git repository (not under the user profile, which is itself a Git repository).
- Access: restricted to the operator account (ACL). The passphrase file is stored in a separate `keys` folder with the same restriction.
- Contents after a backup: encrypted dump, encrypted history export, and their checksum files. No plaintext.
- Capacity checked on 2026-10-22: the system drive had about 268 GB free. The backup is about 2.2 MB.

## 5. Verification (performed 2026-10-22)

| Check | Result |
|---|---|
| Backup created (encrypted dump) | PASS. Snapshot time 2026-10-22 04:33:51 UTC. |
| Checksum of encrypted dump | PASS (`sha256sum -c`) |
| Decrypt to a temporary folder outside any repository | PASS |
| Archive table of contents | PASS. 134 tables (56 with data), 60 functions, 155 policies, 38 triggers. |
| Migration history export | PASS. 159 rows. Checksum identical to production's current history. |
| Restore into an isolated **PostgreSQL 17.6** server (private port, separate data directory) | PASS with stated limits (section 6) |
| Verification items compared with production after restore | 62 items. **61 identical.** The one difference is `audit_logs` (60,939 restored vs 60,942 live), 3 rows written after the snapshot. |
| Items compared | Row counts for every public table, `class_options` row count (13) and checksum of its original columns, function count (60), policy count (155), trigger count (38), index count (268). |
| Foreign keys | 57 restored vs 60 in production. The 3 missing constraints reference `auth.users`, which is excluded from the backup (section 6). |
| Temporary plaintext | Removed (dump, restore data directory, restore logs). The restore logs were removed because they can contain row values. |

Restore rehearsal method: `pg_restore --no-owner --no-privileges --disable-triggers`, after creating rehearsal-only stand-ins for `anon`, `authenticated`, `service_role`, the `auth` functions, the `extensions` schema with `pgcrypto`, `auth.users`, and `supabase_functions.http_request`. These stand-ins are not production objects.

## 6. Restore procedure (for a real recovery)

Do not restore over production. Restore into a **new** database or project first, verify it, and only then decide what to move.

```bash
# Decrypt to a folder outside every repository. Never leave the plaintext behind.
gpg --batch --pinentry-mode loopback --passphrase-file "$PASS_FILE" --decrypt --output "$TMP/restore.dump" "$BACKUP_DIR/<dump>.gpg"
# Create the platform stand-ins needed by the public schema (roles, auth functions, auth.users, extensions, supabase_functions).
# Then restore:
"$PG_BIN/pg_restore" --no-owner --no-privileges --exit-on-error=false -v -d "<target database URL, supplied at run time>" "$TMP/restore.dump"
# Shred the plaintext when finished:
rm -f "$TMP/restore.dump"
```

Post-restore checks: row counts per table; `class_options` checksum of original columns; policy, function and trigger counts; the migration history export checksum.

## 7. Limitations (read before relying on this backup)

1. **Not a platform backup.** Supabase daily backups and PITR are not available on the Free plan. This dump is the only copy and is a snapshot at its own time. Writes after that time are not recoverable from it.
2. **Auth users are not included.** `auth` contains user accounts and credential hashes. Restoring `public` without `auth.users` leaves 3 foreign keys (`admin_users`, `profiles`, `teachers` to `auth.users`) unrestored. Recovering user accounts needs a separate, approved export of `auth`.
3. **Storage, Vault, cron, extensions and Edge Function secrets are not included.** The cron schedule (14 active jobs) and the `attendance-reminder-daily` status are recorded in `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md`.
4. **Roles and grants are not included.** Policies reference `anon`, `authenticated` and `service_role`. The target must create them first.
5. **Not automated.** No schedule exists. A backup exists only when an operator runs the procedure.
6. **Temporary CLI role.** The CLI creates `cli_login_postgres` in production to connect. Its validity ended at 04:23 UTC on 2026-10-22, and the role was still present in `pg_roles` afterwards. Removing it is a production role change and needs owner approval.
7. **Personal data.** The dump contains applicant, teacher and student records. It is encrypted and local. It must not be copied to chat, logs or external services.
8. **Rehearsal limits.** PostgreSQL 17.6 was used, with stand-ins for platform objects. The rehearsal does not prove a restore into a real Supabase project.

## 8. Backup gate status (2026-10-22)

| Requirement | Status |
|---|---|
| Recent verified logical backup of `public` (with data) | **SATISFIED** (section 5) |
| Restore rehearsal in PostgreSQL 17 | **SATISFIED** (section 5, with limits) |
| Supabase managed daily backup or PITR | **NOT AVAILABLE** (Free plan) |
| Migration history backed up | **SATISFIED** (encrypted export, checksum verified) |
| Auth users recoverable | **NOT COVERED** (section 7, item 2) |

**Conclusion:** the logical backup gate is satisfied for the `public` schema. Platform-level recovery is not available. The owner must decide whether to accept this, upgrade the plan, or require another mechanism before any production change.

## 9. Unrelated items observed during this work (not changed)

- The shared temporary folder `C:\Users\moser\AppData\Local\Temp\pg17\` contains files from an earlier PostgreSQL 17 rehearsal (a stopped cluster and `repair.sql` and `rollback.sql`). They were not created by this procedure and were left untouched.
- Several PostgreSQL server processes are running under a Windows service session. They were not started by this procedure.
- The main checkout `supabase_foundation` has uncommitted edits to `docs/BRANCH_HOLDS.md`, `docs/C6_EDGE_SECURITY_RECONCILIATION_2026-10-03.md` and `docs/migration-log.md`. They were not made by this procedure.
