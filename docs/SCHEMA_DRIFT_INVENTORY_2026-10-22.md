# Production schema drift inventory (2026-10-22)

> **Snapshot date: October 22, 2026.** The findings below describe production as observed on that date. They are a historical record and are not edited to reflect later changes.

Read-only inventory. No production change was made. Nothing here authorises replaying old migrations.

## 1. Method

- **Catalog check:** all 843 schema objects created by the 152 migration files on `origin/main` (columns, tables, functions, indexes, policies, triggers) were checked against `public` in production (`xelpsttqhrcqmttmjory`, PostgreSQL 17.6) using read-only SELECTs. The same check was run against `rocksolid-staging` (`hblahcaozlttknkzvkib`).
- **Classification:** each missing non-baseline object was checked for later migrations on `main` that drop it (`drop policy|trigger|function|index|column|table`) or recreate the same name. The remainder were classed by kind and name. Automated classes are a first pass. Each row needs a human check before action.
- **Cron:** job names defined in migrations were compared with the production `cron.job` list (names and active flags only).

## 2. Totals

| Set | Count |
|---|---:|
| Objects checked (all migrations on `main`) | 843 |
| Missing in production | 202 |
| of which `000_baseline_squash` (replaced by later migrations in many cases) | 142 |
| **Missing in production, non-baseline** | **60 across 22 migrations** |
| Non-baseline missing in production but present in staging | 47 |
| Non-baseline missing in both | 13 |
| Missing in staging but present in production | 11 |
| Migration versions recorded as applied in production but not in `main` (remote-only) | 9 |
| Repo cron job defined by migrations | `attendance-reminder-daily` (absent in production) |

## 3. Non-baseline missing objects, by class

Classes:

- **A. Intentionally removed or replaced later:** a later migration drops the object, or a later migration defines the live equivalent under a new name.
- **B. Missing security control:** RLS policies, role or audit triggers, or security-relevant functions.
- **C. Missing operational trigger or cron:** notification, waitlist or cron behaviour.
- **D. Genuine production omission:** schema objects that have no later replacement.

| Class | Count | Where it stands |
|---|---:|---|
| A. Removed or replaced later | 3 (plus 2 recreated-later index names) | See section 4 |
| B. Missing security control | 28 | Needs review per policy. Several are shared gaps with staging. See section 5 |
| C. Missing operational trigger or cron | 2 triggers plus 1 cron | See section 6 |
| D. Genuine production omission | 27 | See the table below |

### Full inventory

Ordered by class, then migration. "Present in staging: yes" means the object exists in staging, so the gap is production-only.

| # | Class | Migration | Kind | Object | Present in staging |
|--:|---|---|---|---|:-:|
| 1 | removed-later | 202605061400_rls_hardening | policy | audit_log.audit_log_admin_all | no |
| 2 | recreated-later | 202605191210_applicants_subgroup_id_backfill | index | idx_applicants_subgroup_id | yes |
| 3 | recreated-later | 202605191240_applicants_group_subgroup_backfill | index | idx_applicants_subgroup_id | yes |
| 4 | operational-trigger | 202605191920_waitlist_class_available_auto_notify | trigger | trg_notify_waitlisted_on_class_slot_available | yes |
| 5 | operational-trigger | 202605191920_waitlist_class_available_auto_notify | trigger | trg_notify_waitlisted_on_class_option_available | yes |
| 6 | security-control | 202605061400_rls_hardening | policy | moodle_courses.moodle_courses_admin_all | no |
| 7 | security-control | 202605071800_audit_logs_canonicalization | column | audit_logs.actor_id | yes |
| 8 | security-control | 202605071800_audit_logs_canonicalization | function | audit_log_insert_redirect | yes |
| 9 | security-control | 202605071800_audit_logs_canonicalization | trigger | audit_log_insert_redirect_trigger | no |
| 10 | security-control | 202605071980_pending_onboarding_hardening | trigger | trg_profiles_protect_self_role_update | yes |
| 11 | security-control | 202605071980_pending_onboarding_hardening | trigger | trg_teacher_status_audit | yes |
| 12 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | milestones.milestones_admin_read | no |
| 13 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | milestones.milestones_superadmin_write | no |
| 14 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | clickup_escalations.clickup_escalations_admin_select | no |
| 15 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | clickup_escalations.clickup_escalations_admin_insert | no |
| 16 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | clickup_escalations.clickup_escalations_admin_update | no |
| 17 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | clickup_watchers.clickup_watchers_admin_select | no |
| 18 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | clickup_watchers.clickup_watchers_admin_insert | no |
| 19 | security-control | 202605121130_security3_rls_coverage_new_tables | policy | clickup_watchers.clickup_watchers_admin_update | no |
| 20 | security-control | 202605121320_security4_legacy_broad_rls_hardening | policy | audit_log.audit_log_admin_all | no |
| 21 | security-control | 202605150000_create_attendance_records | policy | attendance_records.attendance_records_teacher_select_own | yes |
| 22 | security-control | 202605150000_create_attendance_records | policy | attendance_records.attendance_records_teacher_insert_own | yes |
| 23 | security-control | 202605150000_create_attendance_records | policy | attendance_records.attendance_records_teacher_update_own | yes |
| 24 | security-control | 202605150000_create_attendance_records | policy | attendance_records.attendance_records_admin_all | yes |
| 25 | security-control | 202605150000_create_attendance_records | policy | attendance_records.attendance_records_pastor_select_subgroup | yes |
| 26 | security-control | 202605180001_capacity_applicant_count_escalation_details | function | get_escalation_details | yes |
| 27 | security-control | 202605182000_email_templates_table | policy | email_templates.email_templates_authenticated_read | yes |
| 28 | security-control | 202605191130_fellowship_management_hardening | policy | fellowship_map.fellowship_map_authenticated_active_read | yes |
| 29 | security-control | 202605191130_fellowship_management_hardening | policy | fellowship_map.fellowship_map_admin_insert | yes |
| 30 | security-control | 202605191130_fellowship_management_hardening | policy | fellowship_map.fellowship_map_admin_update | yes |
| 31 | security-control | 202605192000_batches_admin_write_superadmin_delete | policy | batches.batches_admin_insert | yes |
| 32 | security-control | 202605192000_batches_admin_write_superadmin_delete | policy | batches.batches_admin_update | yes |
| 33 | security-control | 202605192000_batches_admin_write_superadmin_delete | trigger | trg_batches_audit_delete | yes |
| 34 | genuine-omission | 202605071960_teacher_user_ownership_hardening | index | idx_teachers_teacher_user_id | yes |
| 35 | genuine-omission | 202605071980_pending_onboarding_hardening | function | log_teacher_status_change | yes |
| 36 | genuine-omission | 202605122100_batches_subgroup_id | column | batches.subgroup_id | yes |
| 37 | genuine-omission | 202605122100_batches_subgroup_id | index | idx_batches_subgroup_id | yes |
| 38 | genuine-omission | 202605150000_create_attendance_records | column | students.enrollment_start_session | yes |
| 39 | genuine-omission | 202605150000_create_attendance_records | function | handle_updated_at | yes |
| 40 | genuine-omission | 202605150000_create_attendance_records | index | attendance_records_dedupe | yes |
| 41 | genuine-omission | 202605150000_create_attendance_records | index | attendance_records_guest_dedupe | yes |
| 42 | genuine-omission | 202605150000_create_attendance_records | trigger | attendance_records_updated_at | yes |
| 43 | genuine-omission | 202605190900_class_options_online_multicampus | column | class_options.is_online | yes |
| 44 | genuine-omission | 202605190900_class_options_online_multicampus | column | class_options.confirmed_start_date | yes |
| 45 | genuine-omission | 202605190930_attendance_late_start_status | column | attendance_log.session_status | yes |
| 46 | genuine-omission | 202605190930_attendance_late_start_status | column | class_options.confirmed_start_date | yes |
| 47 | genuine-omission | 202605190930_attendance_late_start_status | index | idx_attendance_log_session_status | yes |
| 48 | genuine-omission | 202605191250_registration_regional_fellowship_support | index | idx_applicants_subgroup_id | yes |
| 49 | genuine-omission | 202605191330_safe_teacher_auth_linking | function | unlink_teacher_from_auth_user | yes |
| 50 | genuine-omission | 202605191330_safe_teacher_auth_linking | index | uq_teachers_teacher_user_id_not_null | yes |
| 51 | genuine-omission | 202605191700_multicampus_teacher_availability_hardening | function | validate_teacher_availability_campuses | yes |
| 52 | genuine-omission | 202605191700_multicampus_teacher_availability_hardening | function | validate_class_option_fellowship_codes | yes |
| 53 | genuine-omission | 202605191700_multicampus_teacher_availability_hardening | trigger | trg_validate_teacher_availability_campuses | yes |
| 54 | genuine-omission | 202605191700_multicampus_teacher_availability_hardening | trigger | trg_validate_class_option_fellowship_codes | yes |
| 55 | genuine-omission | 202605191920_waitlist_class_available_auto_notify | function | trg_notify_waitlisted_on_class_slot_available | yes |
| 56 | genuine-omission | 202605191920_waitlist_class_available_auto_notify | function | trg_notify_waitlisted_on_class_option_available | yes |
| 57 | genuine-omission | 202605191930_dashboard_teacher_kpis | function | get_active_teacher_count | yes |
| 58 | genuine-omission | 202605192000_batches_admin_write_superadmin_delete | function | log_batch_delete | yes |
| 59 | genuine-omission | 202607090001_email_claim_and_perf_indexes | index | idx_email_queue_processing_updated_at | yes |
| 60 | genuine-omission | 202607090001_email_claim_and_perf_indexes | index | idx_student_milestone_status_applicant_completed | no |

## 4. Class A: intentionally removed or replaced later

- `audit_log.audit_log_admin_all` (from `202605061400`): dropped by `202605121320_security4_legacy_broad_rls_hardening.sql`. Treat as intentional. Confirm no live dependency.
- `profiles.trg_profiles_protect_self_role_update` (from `202605071980`): superseded by `trg_profiles_enforce_role_assignment`, created by `202607131500_profiles_role_assignment_boundary.sql`. The live function `profiles_enforce_role_assignment` is present and matches the repo's current design (superuser-only role change, SECURITY DEFINER, `search_path` set). This is name drift, not missing protection. It is therefore excluded from class B. Keep this classification.
- `idx_applicants_subgroup_id` (from `202605191210`, `202605191240`, `202605191250`): recreated under the same name by later migrations, so this is a recreated-later classification. Live presence is not confirmed. Verify before any change.

## 5. Class B: missing security controls

These need individual review before any production change. Several are shared gaps (also missing in staging). Adding policies or triggers is a security-relevant change and needs its own approval.

Groups:

- **`attendance_records`** (from `202605150000`): the teacher-scoped and admin policies are absent. Production currently has broad `auth_read` and `auth_write` policies (from `202606160001` on `main`), which let any authenticated user read and write every row. This is the most important security finding in the inventory. It is a repo-level weakness, not caused by drift, so it needs its own RLS review.
- **`clickup_escalations`, `clickup_watchers`, `milestones`** (from `202605121130`): admin and superadmin policies absent in both environments. Confirm whether these tables are reachable by the anon or authenticated roles.
- **`moodle_courses`** (from `202605061400`): admin policy absent. Confirm RLS status.
- **`fellowship_map`, `batches`, `email_templates`** (from `202605191130`, `202605192000`, `202605182000`): admin write and read policies absent. These affect who can edit fellowship and batch data.
- **Audit:** `audit_log_insert_redirect` trigger and function (from `202605071800`) and `trg_teacher_status_audit` and `log_teacher_status_change` (from `202605071980`) are absent. CLAUDE.md lists the audit canonicalization migration as a priority. Audit events may therefore not be redirected or recorded as the repo designs. Verify against live audit rows before concluding.
- **Functions:** `get_escalation_details` (from `202605180001`) and `unlink_teacher_from_auth_user` (from `202605191330`) are absent. Their callers need checking.

## 6. Class C: operational triggers and cron

- **Waitlist notifications:** `trg_notify_waitlisted_on_class_option_available` and `trg_notify_waitlisted_on_class_slot_available` (from `202605191920`), with their functions. Absent in production. Waitlisted applicants are not notified automatically when a class opens. Already logged on 2026-07 (the earlier waitlist finding).
- **Class validation:** `trg_validate_class_option_fellowship_codes`, `trg_validate_teacher_availability_campuses` and their functions (from `202605191700`). Absent. Fellowship-code and campus validation is not enforced at the database level.
- **Cron:** `attendance-reminder-daily` (from `202605190950`) is not scheduled in production. The reminder function therefore does not run automatically. Scheduling it is a behaviour change and needs approval, and it depends on the `confirmed_start_date` repair.

## 7. Class D: genuine production omissions (no later replacement)

| Object | Notes |
|---|---|
| `class_options.is_online`, `class_options.confirmed_start_date` | The registration repair. PR #6. |
| `attendance_log.session_status` (+ constraint and index) | From `202605190930`. Read with fallback in `applicant-directory.js`. Not written by repo code. |
| `audit_logs.actor_id` | From `202605071800`. Part of audit canonicalization. |
| `batches.subgroup_id` (+ index) | From `202605122100`. |
| `students.enrollment_start_session` | From `202605150000`. |
| `get_active_teacher_count`, `log_batch_delete`, `handle_updated_at` | Functions from `202605191930`, `202605192000`, `202605150000`. Check callers. |
| Indexes: `idx_attendance_log_session_status`, `idx_email_queue_processing_updated_at`, `idx_student_milestone_status_applicant_completed`, `idx_teachers_teacher_user_id`, `uq_teachers_teacher_user_id_not_null`, `idx_batches_subgroup_id`, `attendance_records_dedupe`, `attendance_records_guest_dedupe` | Performance and integrity. `attendance_records_dedupe` and `attendance_records_guest_dedupe` appear to be dedupe guards. Verify their definitions. If they are unique indexes, their absence would allow duplicate attendance rows. Class B priority. |

## 8. Remote-only migration versions (recorded in production, not on `main`)

| Version | Branch source | Objects (summary) | Touches registration or attendance? |
|---|---|---|---|
| `202609231000` | `4bc6c0e` | Moodle sync next-retry column | No |
| `202609231100` | `31f7391` | `failed_syncs` table, trigger, index, policy | No |
| `202609231200` | `5297320` | Notification batch claim function and index (C1) | No |
| `202609240001` | `ce730d3` | Nexus task claim indexes and `claim_nexus_task` (C6) | No |
| `202609240002` | `ce730d3` | `claim_nexus_task` replacement (C6) | No |
| `202610030001` | `8312718` | Reconciliation index and functions (C6) | No |
| `202610030002` | `70849be` | `claim_nexus_task` replacement, conflict-safe (C6) | No |
| `202610030003` | `e68c22a` | Constraint or invariant only, no statements (C6) | No |
| `202610030004` | `59d16cb` | `claim_nexus_task` replacement, terminal assignee (C6) | No |

These versions were reviewed without modification. None touches `class_options`, registration or attendance tables. They are C1 and C6 code, which is unmerged and not certified. They are not replayed or altered by this inventory.

## 9. Cron comparison

Repo cron job names found in migrations: `attendance-reminder-daily`. Production has 14 active cron jobs (`audit-log-cleanup`, `moodle-sync`, `moodle-grade-sync`, `email-sender`, `report-monthly-regional`, `student-engagement-monitor`, `report-weekly-pastor-digest`, `review-checkin-daily`, `attention-flag-push-sweep`, `notification-batch-processor`, `report-monthly-pastor-digest`, `waitlist-processor`, `report-weekly-regional`, `retry-worker`). Only `attendance-reminder-daily` is missing.

## 10. Rule for any future remediation

- Each class needs its own migration, its own review and its own approval.
- Do not replay `000_baseline_squash` or other historical migrations to fill gaps.
- Do not change recorded history rows. The reconciliation proposal from the 2026-10-22 execution plan is not carried forward to `main`. It remains on branch `docs/registration-execution-plan-and-drift` (PR #8) in `docs/REGISTRATION_REPAIR_PRODUCTION_EXECUTION_2026-10-22.md`.
- Class B changes are security changes. They need an RLS review before they are written.
