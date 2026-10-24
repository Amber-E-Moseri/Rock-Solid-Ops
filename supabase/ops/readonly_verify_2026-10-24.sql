-- =============================================================================
-- READ-ONLY verification: migration history and audit_logs pre-state
-- Date: 2026-10-24. Supports docs/MIGRATION_RECONCILIATION_2026-10-24.md section 2 and
-- docs/AUDIT_LOGS_GUARD_RECOVERY.md section 1.
-- =============================================================================
-- Runs inside a READ ONLY transaction. Nothing here writes, grants, or alters history.
-- Run by an authorized operator against ONE target at a time (staging, then production).
-- Save the full output as evidence. Do not paste credentials into the file or the output.
--
--   psql "<connection string supplied by the operator>" -X -f supabase/ops/readonly_verify_2026-10-24.sql
-- =============================================================================

\set ON_ERROR_STOP 1
begin transaction read only;

\echo '== 1. Migration history, versions >= 202609231000'
select version, name
from supabase_migrations.schema_migrations
where version >= '202609231000'
order by version;

\echo '== 2. Migration history: latest version recorded'
select max(version) as latest_version, count(*) as total_versions
from supabase_migrations.schema_migrations;

\echo '== 3. Does schema_migrations keep a statements column? (digest query in step 4 only runs if yes)'
select column_name, data_type
from information_schema.columns
where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
order by ordinal_position;

-- 4. Statement digest. Uncomment ONLY if step 3 lists a column named "statements".
-- select version, md5(array_to_string(statements, E'\n')) as statements_md5
-- from supabase_migrations.schema_migrations
-- where version in ('202609231000','202609231100','202609231200','202609240001','202609240002',
--                    '202610030001','202610030002','202610030003','202610030004')
-- order by version;

\echo '== 5. Schema effects of the nine versions (catalog only)'
select to_regclass('public.failed_syncs') is not null as failed_syncs_exists;
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'failed_syncs' and column_name = 'updated_at';
select to_regclass('public.rocksolid_task_links') is not null as rocksolid_task_links_exists;
select to_regprocedure('public.claim_nexus_task(text,text,text,uuid)') as claim_nexus_task_sig;
select to_regprocedure('public.claim_notification_batch(integer)') as claim_notification_batch_sig;
select indexname from pg_indexes
where schemaname = 'public' and indexname in (
  'email_queue_source_notification_uq',
  'idx_rocksolid_task_links_reconcile_due',
  'idx_rocksolid_task_links_claim_token'
) order by indexname;

\echo '== 6. claim_nexus_task EXECUTE by role (expect: service_role only)'
select r.rolname,
       has_function_privilege(r.rolname, 'public.claim_nexus_task(text,text,text,uuid)', 'EXECUTE') as can_execute
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
order by r.rolname;

\echo '== 7. audit_logs pre-state: table privileges by grantee'
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'audit_logs'
group by grantee order by grantee;

\echo '== 8. audit_logs pre-state: policies'
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'audit_logs'
order by policyname;

\echo '== 9. audit_logs pre-state: triggers (none expected before PR #32)'
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.audit_logs'::regclass and not tgisinternal
order by tgname;

\echo '== 10. audit_logs pre-state: RLS'
select relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public.audit_logs'::regclass;

rollback;
