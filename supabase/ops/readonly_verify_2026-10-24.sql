-- =============================================================================
-- READ-ONLY verification: migration history and audit_logs pre-state
-- Date: 2026-10-24. Supports docs/MIGRATION_RECONCILIATION_2026-10-24.md section 2 and
-- docs/AUDIT_LOGS_GUARD_RECOVERY.md section 1.
-- =============================================================================
-- Revision 2 (2026-10-24): psql meta-commands removed so the file runs through
-- `supabase db query --linked -f`. Every check now returns a labelled row with an explicit
-- present / absent or expected / actual value. Nothing writes, grants, or alters history.
--
-- Mutating functions: none are called. Only SELECT on catalogs and the migration table,
-- plus to_regclass / to_regprocedure / has_function_privilege, which are read-only.
-- A missing object shows as present = false. A missing migration table raises an error that
-- stops the batch. It does not produce a row that looks like a PASS.
-- =============================================================================

begin transaction read only;

-- 1. Migration history, versions >= 202609231000 (expect the nine versions in section 2 of the plan).
select 'migration_history' as check_name, version, name
from supabase_migrations.schema_migrations
where version >= '202609231000'
order by version;

-- 2. Latest version recorded and total count.
select 'migration_history_summary' as check_name,
       max(version) as latest_version,
       count(*) as total_versions
from supabase_migrations.schema_migrations;

-- 3. Columns of the migration table (step 4 of the plan needs a statements column; confirm it).
select 'migration_table_columns' as check_name, column_name, data_type
from information_schema.columns
where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
order by ordinal_position;

-- 4. Schema effects, one labelled row per object. present = false means the object is missing.
select 'object' as check_name, obj, present
from (values
  ('table public.failed_syncs',                 to_regclass('public.failed_syncs') is not null),
  ('table public.rocksolid_task_links',         to_regclass('public.rocksolid_task_links') is not null),
  ('function claim_nexus_task(text,text,text,uuid)',
                                                to_regprocedure('public.claim_nexus_task(text,text,text,uuid)') is not null),
  ('function claim_notification_batch(integer)',
                                                to_regprocedure('public.claim_notification_batch(integer)') is not null),
  ('index email_queue_source_notification_uq',
     exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'email_queue_source_notification_uq')),
  ('index idx_rocksolid_task_links_reconcile_due',
     exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_rocksolid_task_links_reconcile_due')),
  ('index idx_rocksolid_task_links_claim_token',
     exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_rocksolid_task_links_claim_token'))
) as t(obj, present);

-- 5. Column present on failed_syncs (file 202609231100 adds it).
select 'column' as check_name, 'failed_syncs.updated_at' as obj,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'failed_syncs' and column_name = 'updated_at') as present;

-- 6. claim_nexus_task EXECUTE by role. Expected per file 202610030004: service_role true; anon, authenticated, PUBLIC false.
--    A NULL can_execute means the function is missing, not a pass.
select 'execute_privilege' as check_name, r.rolname as role_name,
       has_function_privilege(r.rolname, to_regprocedure('public.claim_nexus_task(text,text,text,uuid)'), 'EXECUTE') as can_execute
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role')
order by r.rolname;

-- 7. audit_logs pre-state: table privileges by grantee (expect the state in AUDIT_LOGS_GUARD_RECOVERY.md section 1 before PR #32).
select 'audit_logs_privileges' as check_name, grantee,
       string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'audit_logs'
group by grantee
order by grantee;

-- 8. audit_logs pre-state: policies. Policy expressions are catalog text, no row data.
select 'audit_logs_policy' as check_name, policyname, cmd, roles::text as roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'audit_logs'
order by policyname;

-- 9. audit_logs pre-state: triggers (none expected before PR #32).
select 'audit_logs_trigger' as check_name, tgname, tgenabled
from pg_trigger
where tgrelid = 'public.audit_logs'::regclass and not tgisinternal
order by tgname;

-- 10. audit_logs pre-state: RLS flags.
select 'audit_logs_rls' as check_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where oid = 'public.audit_logs'::regclass;

rollback;
