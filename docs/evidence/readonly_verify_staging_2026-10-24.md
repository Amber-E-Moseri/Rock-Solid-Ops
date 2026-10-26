# Read-only verification: Rock Solid Staging, 2026-10-24

Target: Supabase project **Rock Solid Staging**, reference `hblahcaozlttknkzvkib` (the project linked in the repo's Supabase CLI config, and listed by `supabase projects list` as "Rock Solid Staging").
Production was NOT checked.
Method: `supabase/ops/readonly_verify_2026-10-24.sql` (revision 2, commit `9e73424`), split into ten single-check files. Each file ran in `begin transaction read only; ... rollback;` through `supabase db query --linked`. The session reported `transaction_read_only = on` and role `postgres`.
No connection strings, tokens, or credentials are recorded here. No row data was read beyond migration names, catalog metadata, and policy text.

## 1. Migration history

- `supabase_migrations.schema_migrations`: 159 versions. Latest `202610030004`.
- All nine versions present: `202609231000`, `202609231100`, `202609231200`, `202609240001`, `202609240002`, `202610030001`, `202610030002`, `202610030003`, `202610030004`.
- Statement digest: each version has a `statements` array. Stored text compared to repo files after normalization (lowercase, comments removed, whitespace collapsed, semicolons and `begin`/`commit` wrappers removed). **All nine MATCH.**
- Caveat: the normalization is lenient. The CLI stores statements split and without terminators, so byte-identical proof is not possible from this data. The match confirms the content is the same apart from terminators and wrappers.

## 2. Schema effects

| Object | Present |
|---|---|
| table `public.failed_syncs` | yes |
| table `public.rocksolid_task_links` | yes |
| function `claim_nexus_task(text,text,text,uuid)` | yes |
| function `claim_notification_batch(integer)` | yes |
| index `email_queue_source_notification_uq` | yes |
| index `idx_rocksolid_task_links_reconcile_due` | yes |
| index `idx_rocksolid_task_links_claim_token` | yes |
| column `failed_syncs.updated_at` | yes |

`claim_nexus_task` EXECUTE: `service_role` true; `anon` false; `authenticated` false. Matches file `202610030004`.

## 3. audit_logs pre-state (before PR #32)

- Grants: `anon`, `authenticated`, `postgres`, `service_role` each hold `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`.
- Policies: `audit_log_admin_all` and `audit_logs_admin_all`, both `ALL` to `authenticated`, using and check `is_admin()`.
- Triggers on `audit_logs`: **none**. The guard triggers are absent, as expected.
- RLS: enabled, not forced.

This matches `docs/AUDIT_LOGS_GUARD_RECOVERY.md` section 1 and the local replay. PR #32 is not applied on staging.

## 4. Errors and discrepancies

- No query errors. All ten checks exited 0.
- Revision 2 of the script was needed because the Management API returns only the last statement's result for a multi-statement file. The first attempt returned only the `audit_logs_rls` row. Per-check files fixed this.
- The script as committed in `6a5fa40` used psql meta-commands and could not run through the CLI. Revision 2 (`9e73424`) replaces it. This is a change to the script the owner accepted, and it needs re-acceptance.

## 5. Script safety review

1. Read-only: every statement is a SELECT or a read-only catalog helper (`to_regclass`, `to_regprocedure`, `has_function_privilege`). No mutating function is called.
2. Read-only mode: explicit in the file, and confirmed by `transaction_read_only = on` at runtime.
3. Missing objects: shown as `present = false`. A `NULL` `can_execute` means the function is missing. A missing migration table raises an error. No row that looks like a PASS is produced.
4. Secrets and student data: nothing printed beyond migration names, catalog metadata, and policy text.
5. Privilege: the script needs only SELECT on catalogs and `supabase_migrations.schema_migrations`. **This run used the `postgres` role** through the CLI's management connection, which is elevated. The check does not demonstrate that a read-only account is enough. Production should use a read-only role if one exists.

## 6. Not verified

- Production. Not run.
- Whether the staging `attendance_records` policies named in the 2026-10-22 inventory match the live state. The fork that reported this did not check the live catalog. Not in this scope.
- Byte-identical migration content. See the caveat in section 1.

## 7. Recommendation

Staging check passed. Running the same check on production is reasonable as a read-only step, provided:
- the owner names the production reference explicitly (the repo does not record it in this session),
- it runs under the same read-only transaction, and
- ideally with a read-only role, not `postgres`.
No migration, grant, or history change should follow from this check alone.
