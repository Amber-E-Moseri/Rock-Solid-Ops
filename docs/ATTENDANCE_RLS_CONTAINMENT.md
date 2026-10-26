# Attendance RLS containment: evidence, migration and certification

Migration: `supabase/migrations/20261024130000_attendance_rls_containment.sql` (version reserved here; not used on any ref as of 2026-10-24)
Regression test: `supabase/tests/security/attendance-rls-containment.sql`
Status: DRAFT, HOLD. Local only. Not applied to staging or production. Not merged.

## 1. Catalog evidence (read-only, SELECT only)

Queries: the SELECT-only attendance pack, run via `supabase db query --linked` against the staging project `hblahcaozlttknkzvkib` (Rock Solid Staging) and production `xelpsttqhrcqmttmjory` (foundation-school). Raw output is kept in the agent scratch directory, not in the repository.

### Staging (`hblahcaozlttknkzvkib`)

| Table | Policy | Cmd | Roles | Predicate |
|---|---|---|---|---|
| attendance_records | auth_read | SELECT | public | `auth.role() = 'authenticated'` |
| attendance_records | auth_write | ALL | public | `auth.role() = 'authenticated'` (no separate WITH CHECK) |
| attendance_records | attendance_records_admin_all | ALL | authenticated | superadmin or admin |
| attendance_records | attendance_records_pastor_select_subgroup | SELECT | authenticated | pastor, same subgroup |
| attendance_records | attendance_records_teacher_select_own / _insert_own / _update_own | | authenticated | teacher owns class option |
| attendance_log | attendance_log_staff_select | SELECT | authenticated | `true` |
| attendance_log | attendance_log_staff_insert | INSERT | authenticated | WITH CHECK `true` |
| attendance_log | attendance_log_staff_update | UPDATE | authenticated | `true` |
| attendance_log | attendance_admin_all | ALL | authenticated | `is_admin()` |
| attendance_log | attendance_log_teacher_select/insert/update_assigned | | authenticated | assigned teacher or `is_admin()` |

Table privileges: `anon`, `authenticated` and `service_role` each hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on both tables. RLS enabled, not forced.

Staging `count_consecutive_misses()` selects `attended` from `attendance_log`, but that column does not exist. `trg_at_risk_attendance` runs on every attendance_log INSERT and UPDATE, so those statements are expected to fail on staging with `column "attended" does not exist`. The repository migration `202605180004_at_risk_trigger.sql` contains the same body. Not verified by a write, which is prohibited.

### Production (`xelpsttqhrcqmttmjory`, foundation-school)

| Table | Policy | Cmd | Roles | Predicate |
|---|---|---|---|---|
| attendance_records | auth_read | SELECT | public | `auth.role() = 'authenticated'` |
| attendance_records | auth_write | ALL | public | `auth.role() = 'authenticated'` |
| attendance_log | attendance_admin_all | ALL | authenticated | `is_admin_like()` |
| attendance_log | attendance_log_read | SELECT | authenticated | superadmin, or subgroup in `get_admin_subgroups()` |
| attendance_log | attendance_log_write | INSERT | authenticated | superadmin, or subgroup |
| attendance_log | attendance_log_update | UPDATE | authenticated | superadmin, or subgroup |
| attendance_log | attendance_log_teacher_select/insert/update_assigned | | authenticated | assigned teacher or `is_admin()` |
| attendance_log | attendance_teacher_rw_assigned | ALL | authenticated | teacher email match |

- `attendance_records` on production has no teacher, admin or pastor policy. Only `auth_read` and `auth_write` remain, so every signed-in user can read and write every row. This matches the 2026-10-22 drift inventory and is confirmed by catalog.
- `attendance_log` on production has no broad `_staff_*` policy. Its reads and writes are scoped to subgroup or superadmin, or to the assigned teacher. The broad staging policies are absent. Production `attendance_log` is not broadly open to authenticated users.
- Production table shape: `attendance_records` has the `applicant_id` shape (`202606160001`), with no `student_id`, `class_number` or `attendance_type`. `attendance_log` lacks the staging-only columns and has `present`, `class_date`, `session_status` and the other production columns.
- Production `count_consecutive_misses()` reads `present` and `class_date`, so the at-risk defect is not present on production. Staging is not a faithful reference for production.
- Production helpers exist: `current_profile_role()`, `is_admin()`, `is_admin_like()`, `current_teacher_id()`, `get_admin_role()`, `get_admin_subgroups()`.

## 2. Exposure assessment

| Table | Operation | Who, on staging | Who, on production | Basis |
|---|---|---|---|---|
| attendance_records | SELECT | any authenticated user, all rows | any authenticated user, all rows | Catalog: `auth_read` |
| attendance_records | INSERT / UPDATE / DELETE | any authenticated user, all rows | any authenticated user, all rows | Catalog: `auth_write` ALL |
| attendance_log | SELECT / INSERT / UPDATE | any authenticated user, all rows | not broadly open; scoped | Catalog |
| attendance_log | DELETE | blocked by RLS | blocked by RLS | Catalog: no DELETE policy |
| either | anon | RLS denies (policies require `authenticated`); anon grants still full | same | Catalog |

Catalog-confirmed: the staging and production `attendance_records` rows above.
Behavior requiring JWT/PostgREST tests (not run; prohibited without authorization): whether a pending or unapproved account can obtain an authenticated JWT.

## 3. Migration (`20261024130000`)

1. Drop `attendance_records.auth_write` and `auth_read`.
2. Add `attendance_records_staff_select` (superadmin, admin, principal, regional_secretary).
3. Add `attendance_records_teacher_select_assigned`: the same predicate as the existing `_teacher_select_own` under a new name. This keeps teacher reads on production, which has no teacher policy today. On staging it is a harmless duplicate.
4. Drop `attendance_log_staff_select`, `_insert`, `_update`. These exist on staging only; on production the drops are no-ops.

Not changed: grants, table structure, indexes, constraints, triggers, `attendance_admin_all`, the teacher and pastor policies, or any production policy.

## 4. Local test results

Replay: origin/main lineage (`8510e81`) with the shim. Pre-state policies were compared with the staging catalog and match for the attendance tables.

| Run | Result |
|---|---|
| Post-containment (lineage + migration) | 37 PASS, exit 0 |
| Pre-containment (negative control) | Fails on the first check: teacher A reads 2 rows, not 1 (`auth_read`). The test stops at the first failure, so later pre-state failures are not shown. |
| Migration re-apply | exit 0 |
| Unrelated policies byte-identical before and after | md5 match |

Covered by the test: anonymous denial; ordinary and pending users (no cross-teacher read, no insert, no update, no delete); assigned teacher (own class allowed, other class refused); admin and superadmin; principal and regional_secretary read and insert refusal; pastor and subgroup_admin not widened; exact policy sets; service-role not refused by RLS; trigger inventory.

Not covered locally:
- Live PostgREST and JWT behavior. Requires authorized test accounts and is out of scope here.
- The at-risk defect. Positive attendance_log writes are classified as "admitted by RLS" because they fail later in the trigger. The known defect is printed as a notice.
- A production-shaped replay. The production DDL is not in the repository, so the test runs only on the staging-shaped lineage. Production needs its own fixture.

## 5. Owner decisions before any application

1. Subgroup_admin read. After containment, subgroup_admin has no `attendance_records` read on either environment. Options: (a) add a subgroup-scoped policy, (b) accept the loss, (c) full read like `is_admin()`. Recommend (a), as a separate change.
2. Pastor read on production. Production has no pastor policy. After containment, pastors read nothing. Decide whether pastors need the subgroup-scoped read on production, and add it if so.
3. Migration ownership. Version `20261024130000` is reserved here. Agent 4 coordination could not be performed from this session. Owner or coordinator must confirm the reservation and record it in the release ledger.
4. At-risk defect on staging. Attendance_log writes on staging probably fail today. Decide whether to fix `count_consecutive_misses()` (a function-body change, separate PR) before or after containment. The containment does not depend on it.
5. Production application window. Production currently exposes `attendance_records`. Decide whether containment is applied to production first, as an urgent change, or only after staging certification.

## 6. Staging certification requirements

- Run the same SELECT-only catalog pack on staging after the migration. Expect: `auth_read`, `auth_write`, `attendance_log_staff_*` absent; the three new policies present.
- JWT/PostgREST tests with authorized test accounts, one per role: pending, teacher A, teacher B, admin, superadmin, pastor, principal, regional_secretary, subgroup_admin, plus anon. Each must match section 1 expectations.
- Makeup path: an admin's `attendance_log` update in `makeupManagement.js` still succeeds. Cannot be tested until the at-risk defect is fixed or the trigger is confirmed to fire cleanly.
- Confirm service-role edge functions still write `attendance_log` (blocked by the at-risk defect until fixed).

## 7. Production verification (read-only, done)

Catalog state recorded in section 1. The production exposure on `attendance_records` is confirmed. No mutation or PostgREST probe was run.

Recommendation: an owner-authorized change for production is justified on `attendance_records` alone. The smallest step is removing `auth_write`, which closes write and delete for all signed-in users. Removing `auth_read` requires the staff and teacher replacements in the migration to be in place first. Do not apply the migration to production until owner decisions 1 to 3 are settled.

## 8. Dependencies

- PR #32 (`brief/security-authz-audit-provenance`): `audit_logs` only. No attendance changes. Its base is `35b4953`, but `origin/main` is now `8510e81`. Rebase is needed before PR #32 can merge.
- Teacher-workflows branches (`feature/teacher-onboarding-experience-p2`, `integration/teacher-onboarding-candidate`): not inspected for policy changes.
- `releaseHolds.js` keeps attendance submission on hold (`ATTENDANCE_SUBMIT_CERTIFIED = false`).
