-- RLS coverage gap closed: public.attention_flags (created 202605220011) had no RLS
-- enabled and no policies, despite being written to directly by needs-attention.html
-- (select, insert, update) in addition to being read via the SECURITY DEFINER RPCs
-- get_student_attention_flags / get_teacher_attention_flags / get_system_attention_flags.
--
-- Follows the same admin-only pattern used for sibling operational tables in
-- 202605121130_security3_rls_coverage_new_tables.sql (moodle_enrollment_sync,
-- clickup_task_links, student_milestone_status, etc.): select/insert/update gated by
-- public.is_admin(), no delete policy (none of the current call sites delete rows).
-- public.is_admin() already includes regional_secretary (202605220030), matching the
-- role set both the legacy needs-attention.html page and the SPA needs-attention route
-- require.

begin;

alter table public.attention_flags enable row level security;

drop policy if exists attention_flags_admin_select on public.attention_flags;
create policy attention_flags_admin_select on public.attention_flags
  for select to authenticated using (public.is_admin());

drop policy if exists attention_flags_admin_insert on public.attention_flags;
create policy attention_flags_admin_insert on public.attention_flags
  for insert to authenticated with check (public.is_admin());

drop policy if exists attention_flags_admin_update on public.attention_flags;
create policy attention_flags_admin_update on public.attention_flags
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

commit;
