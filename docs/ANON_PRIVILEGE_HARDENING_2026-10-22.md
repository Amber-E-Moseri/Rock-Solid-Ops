# Anon privilege hardening: proposal (2026-10-22)

**Status: DRAFT FOR REVIEW. NOT APPLIED.** No migration has been run against production or staging. No merge, push or deployment. Apply needs the owner's separate approval (section 10).

Files in this proposal (branch `brief/anon-privilege-hardening`, uncommitted):

| File | Purpose |
|---|---|
| `supabase/migrations/20261022120000_anon_privilege_hardening.sql` | The forward migration (draft) |
| `supabase/tests/anon-privileges/00_setup.sql` | Synthetic PostgreSQL 17 schema with Supabase-style default grants and production-shaped anon policies |
| `supabase/tests/anon-privileges/run.sh` | Rehearsal harness: before/after snapshots, allowed and prohibited operations, default privileges |
| `docs/ANON_PRIVILEGE_HARDENING_2026-10-22.md` | This document |

---

## 1. Inventory

**Tables (live, read-only, captured under the earlier audit approval):** the `anon` role holds `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on every one of the 56 base tables in `public`. Row access is limited by RLS, but the RLS policies name `anon` for only these operations:

| Table | Anon policy (live) | Used by a public path? |
|---|---|---|
| `fellowship_map` | SELECT where `active` | Yes: registration form |
| `class_options` | SELECT where `active` and `deleted_at is null` | Yes: registration form |
| `batches` | SELECT where `registration_open` | Yes: registration form |
| `batch_campus_registration_settings` | SELECT using `true` | Yes: registration form (closed-campus check) |
| `teachers` | SELECT where `active` and `deleted_at is null` | No anon reader found in the repo |
| `teachers` | INSERT with check `status='PENDING' and active=false` (anon and authenticated) | Yes: `foundation/auth/teacher-register.html` |
| `batch_moodle_courses` | SELECT where `active` | No anon reader found |
| `config` | SELECT using `true` | No anon reader found on public pages |
| `applicants` | INSERT with check `true` | **No direct anon writer in the repo.** Submissions go through the edge function. |
| `error_submissions` | INSERT with check `true` | **No anon writer.** `phase2-processor` writes with the service role. |

**Sequences and functions (not verified live):** no explicit `anon` grant on sequences or functions appears anywhere in `supabase/migrations/` (the only `anon` mentions are `REVOKE`s). Anon's access therefore comes from the platform defaults: `ALL` on sequences, and `EXECUTE` on functions through the `PUBLIC` default. The owner asked for no further SQL against production or staging, so the live sequence, function and default-ACL inventory is still open. It is a pre-apply check (section 10, item 1).

## 2. What public registration and login actually use

Source: `foundation/registration/registration-form.html`, `foundation/registration/class-selection.html`, `foundation/auth/teacher-register.html`, `supabase/functions/registration-processor/index.ts`.

| Path | Anon operation | Evidence |
|---|---|---|
| Load fellowship list | SELECT `fellowship_map` (`fellowship_code, campus_name, group_id, subgroup_id, timezone`; filter `active`) | `registration-form.html` line 1636 |
| Load open classes | SELECT `class_options` (12 columns; filters `active, enrollment_open, deleted_at`) | `registration-form.html` line 1715 |
| Check open batches | SELECT `batches` (`batch_id`; filters `status, registration_open`) | `registration-form.html` line 1744 |
| Check closed campuses | SELECT `batch_campus_registration_settings` (`fellowship_code`; filters `registration_open, batch_id`) | `registration-form.html` line 1752 |
| Submit registration | POST to `functions/v1/registration-processor` (service role inside the function) | `registration-form.html` line 1894; `registration-processor/index.ts` line 40 |
| Class selection | POST to `functions/v1/class-selection` | `class-selection.html` line 54 |
| Teacher self-registration | INSERT `teachers` (no returned row, so no SELECT needed) | `teacher-register.html` line 131 |
| Login | Supabase Auth endpoints, then `profiles`/`teachers` as `authenticated` | `AuthContext.jsx` |
| Registration function's auth check | `auth.getUser()` with the anon key (no table access) | `registration-processor/index.ts` line 85 |

**Direct table operation or SECURITY DEFINER RPC?** The public path uses direct table operations for reads (four tables), and one direct table insert (teachers, self-registration). The submission itself uses an edge function with the service role. No anon call goes to an RPC. The one RPC test in the repo (`supabase/tests/registration/live-registration.ts`, section 6) expects anon to be refused, so revoking anon EXECUTE matches its expectation.

**Column scope.** Anon gets column-level grants, not table-wide SELECT. The PostgREST filters in the form (`enrollment_open`, `deleted_at`, `registration_open`, `status`) reference columns, so those columns are granted too. `batch_campus_registration_settings` holds `closed_by`, `reopened_by` and timestamps, which are staff data, and the anon policy is `using (true)`, so those columns are excluded.

## 3. Migration (summary)

Full text: `supabase/migrations/20261022120000_anon_privilege_hardening.sql`.

1. `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`.
2. Column grants back to anon: `fellowship_map` (6 columns), `class_options` (12 columns), `batches` (3), `batch_campus_registration_settings` (3). `INSERT` on `teachers`.
3. `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon`.
4. Functions: for each public function, grant `EXECUTE` explicitly to every other role in the cluster (every row of `pg_roles` except `anon`) that can execute it today, including roles that get it only through membership, then revoke `PUBLIC` and `anon`. Each role keeps exactly the `EXECUTE` it had before. An earlier draft listed the roles by name; that would have silently removed access for any role not on the list, so the loop now covers every role. This is the step that matters most, because anon's `EXECUTE` comes from `PUBLIC`, not from an explicit anon grant. A plain `REVOKE ... FROM anon` would do nothing.
5. Fail-closed post-checks: the migration aborts if anon can still execute any public function, or holds `TRUNCATE`, `REFERENCES`, `TRIGGER`, `UPDATE` or `DELETE` anywhere, or `INSERT` on anything but `teachers`.
6. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE ALL ON TABLES / SEQUENCES FROM anon`, so tables and sequences created by later migrations do not reintroduce anon grants.

What it does not change: row data, RLS enablement, RLS policies (they stay in place, and the anon ones become inert where the grant is gone), `supabase_migrations.schema_migrations`, and the privileges of `authenticated` and `service_role`.

## 4. Before and after privilege matrix

"Before" is the live table state captured earlier. "After" is what the migration grants. Sequences and functions "before" are the platform default (not live-verified).

| Object | Anon before | Anon after |
|---|---|---|
| `fellowship_map` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER (all) | SELECT on 6 columns |
| `class_options` | all seven | SELECT on 12 columns |
| `batches` | all seven | SELECT on 3 columns |
| `batch_campus_registration_settings` | all seven | SELECT on 3 columns |
| `teachers` | all seven | INSERT only |
| `applicants` | all seven | none (policy `applicants_anon_insert` now inert) |
| `error_submissions` | all seven | none (policy `error_submissions_anon_insert` now inert) |
| `email_queue`, `moodle_enrollment_sync`, `audit_logs`, `config`, `batch_moodle_courses`, and 44 other public tables | all seven | none |
| Sequences in `public` | USAGE, SELECT, UPDATE (default) | none |
| Functions in `public` | EXECUTE via PUBLIC (default) | none |
| `authenticated`, `service_role` | unchanged | unchanged (verified by snapshot, section 6) |

## 5. Expected effect on public registration

- **Registration form:** the same four reads, with the same columns and filters. The form loads its class list and fellowship list as before. Submission is unchanged, because it runs in the edge function.
- **Teacher self-registration:** unchanged. The insert still works, and RLS still forces `PENDING` and inactive.
- **Behavior change for anon:** a request by anon to any table or column not in the grant list now fails with `permission denied` (HTTP 401 or 403) instead of returning an empty result. Any anon page that tolerates an empty array and was never intended to read those tables would show an error. The repo shows no such page, but live anon traffic must confirm it (section 10, item 2).
- **Any new anon column:** a column added later to one of the four tables is not visible to anon until it is granted. That is intended.

## 6. Test results

**Rehearsal (run locally, PostgreSQL 17.6 binaries, synthetic data, throwaway cluster):**

```
PG_BIN="C:/Users/moser/AppData/Local/Temp/pg17/pgsql/bin" bash supabase/tests/anon-privileges/run.sh
== 51 passed, 0 failed ==
  INFO  KNOWN GAP R4: a function created after the migration is executable by anon via PUBLIC
```

What the 51 checks cover:

- **Reproduced before the migration:** anon holds TRUNCATE on `teachers`, SELECT on `moodle_enrollment_sync`, and EXECUTE on a SECURITY DEFINER function.
- **Migration:** applies cleanly, and re-applies cleanly (idempotent).
- **No collateral change:** full before/after snapshot of table, sequence and function privileges for `anon`, `authenticated` and `service_role`; RLS flags; policy definitions; the synthetic row data of all 11 tables; and the migration-history table. The only differences allowed are rows where the role is `anon`. An early harness run had a snapshot query error that left the snapshot empty, so the diff passed for the wrong reason. The harness now requires complete snapshots (11 data lines, 1 history line each) before it trusts the diff.
- **Legitimate anonymous path:** the four registration reads (with the form's exact columns and filters), and the PENDING teacher self-registration. ACTIVE self-registration is refused by RLS.
- **Prohibited operations (each must fail):** TRUNCATE on `teachers` and `applicants`; reads of `applicants`, `audit_logs`, `moodle_enrollment_sync`, `email_queue`, `config`, `teachers`; the staff-only `closed_by` column; an ungranted `class_options` column (`created_by`); inserts into `applicants` and `error_submissions`; update of `fellowship_map`; delete from `class_options`; `nextval` on a sequence; EXECUTE on a SECURITY DEFINER function and on an ordinary function.
- **Other roles keep working:** authenticated reads and updates, authenticated EXECUTE on `is_admin()`, and service_role inserts.
- **Roles that depend on PUBLIC:** a role with no explicit grant (`synthetic_reporting`) can call a SECURITY DEFINER function before and after the migration; a role that inherits `authenticated` (`synthetic_member`) keeps EXECUTE on `is_admin()`.
- **Default privileges:** a table and a sequence created after the migration give anon nothing, and authenticated keeps its defaults.

**Mutation tests (to confirm the harness can fail):**

| Mutant | Result |
|---|---|
| Migration without the `PUBLIC` EXECUTE revoke | 7 failures; the fail-closed check aborts the migration |
| Migration without `GRANT INSERT ON teachers TO anon` | 3 failures, all in the self-registration path |
| Function loop limited to `authenticated` and `service_role` (the earlier draft) | 4 failures, including the diff of `synthetic_reporting` and the PUBLIC-only call |

**Verified permission preservation (synthetic schema: 11 tables, 2 functions, 1 sequence, 5 roles).** The harness snapshots table privileges (7 kinds), sequence USAGE, and function EXECUTE for every role below before and after the migration. The diff is empty for each non-anon role.

| Role | How it gets access | Tables, sequences, functions before vs after |
|---|---|---|
| `authenticated` | explicit grants and PUBLIC | identical |
| `service_role` | explicit grants and PUBLIC | identical |
| `synthetic_reporting` | PUBLIC only, no explicit grant | identical; still calls `admin_secret()` |
| `synthetic_member` | inherits `authenticated` | identical; still executes `is_admin()` |
| `anon` | PUBLIC and platform default grants | changed as designed (section 4) |

Scope limit: this covers the synthetic schema and five roles. Production has more roles and objects (for example `supabase_admin`, `cli_login_postgres`, `pgbouncer`, and any functions created outside migrations). For those, preservation depends on the all-roles loop logic and the fail-closed checks, not on a test. Section 8, R10 and R11.

**CI gates (not run here):** the repo's CI has a Migration gate and a Security regression job. Both start a local Supabase stack, which needs Docker. Docker is not running on this machine, so **neither gate has run.** Those are the Docker-dependent certification gates. The existing security suite (`supabase/tests/security/wave1-regression.ts`) asserts that anon has no EXECUTE on the teacher and graduation functions, which the migration satisfies. The live-registration suite expects anon to be refused on `insert_applicant_reserve_slot`, which also holds.

## 7. Default privileges

- **Tables and sequences:** covered by the migration. Without this, every new table would again grant anon everything.
- **Functions:** not covered (risk R4). Postgres grants `EXECUTE` on new functions to `PUBLIC`, so a function created by a future migration is callable by anon until that migration revokes `PUBLIC`. The fix is a default-privilege change, but it would also stop any future function from being callable by `authenticated` unless it is granted explicitly. That affects how every future migration is written, so it is an owner decision. The migration includes the statement commented out.

## 8. Remaining security risks

| # | Risk | Severity | Note |
|---|---|---|---|
| R1 | **`authenticated` still holds TRUNCATE, REFERENCES and TRIGGER on every public table.** TRUNCATE bypasses RLS, so any logged-in staff or teacher account could truncate `email_queue` or `applicants`. | High | Not in this draft, because the request was anon-scoped. Recommend a follow-up migration with the same pattern: revoke TRUNCATE, REFERENCES, TRIGGER from `authenticated`, and confirm no client code uses them. |
| R2 | Anon can still insert teacher rows (PENDING) with no rate limit or CAPTCHA visible in the repo. | Medium | Spam or pending-row flooding. Outside privilege hardening; the policy is intentional. |
| R3 | `applicants_anon_insert` and `error_submissions_anon_insert` remain in place, but are inert. | Low | Drop in a later cleanup, once the owner confirms no legacy writer. |
| R4 | Functions created later are executable by anon through `PUBLIC`. | Medium | Owner decision (section 7). The harness reports it. |
| R5 | Live sequence, function and default-ACL inventory not yet verified. | Medium | Pre-apply check (section 10, item 1). |
| R6 | `teachers_anon_select` (active rows) is no longer usable by anon, but the policy stays. If someone re-grants SELECT on `teachers`, names and contact columns become readable to anon. | Low | Consider dropping the policy in the follow-up. |
| R7 | `batch_moodle_courses` anon policy (SELECT where active) is dormant. | Low | Same follow-up. |
| R8 | Anon-key calls to unknown or legacy pages will now get `permission denied`. | Medium until live traffic is checked | Section 10, item 2. |
| R9 | CI gates have not run (Docker). | High for certification | Section 9. |
| R10 | Production roles beyond the five in the harness (for example `supabase_admin`, `cli_login_postgres`, `pgbouncer`) are not tested. Their preservation rests on the loop logic. | Medium | Enumerate `pg_roles` and each role's effective EXECUTE on staging before apply (section 10, item 1). |
| R11 | Objects created outside migrations (prod drift) may call public functions as anon, for example a trigger on `teachers`. The repo has no trigger on `teachers`, but production may differ: the earlier audit found drift. | Medium to high | Check triggers and defaults on `teachers` and the other granted tables in staging (section 10, item 1). |

## 9. GO / NO-GO for staging certification

**NO-GO now. GO for staging application once the items in section 10 are complete.**

Reasons: the migration and its behavior are verified in a rehearsal, and it does what the brief asked, but (a) the live sequence, function and default-ACL state has not been checked, (b) no live anon traffic has been reviewed for pages that depend on the current broad grants, and (c) the two CI gates that certify the migration have not run, because Docker is not available here.

Staging order: CI gates on a branch (requires Docker or CI), then apply to the staging project only after owner approval, then run the registration form end to end on staging with test data, then the security suite against staging. Production only after the staging run is clean and the owner approves.

## 10. Apply gate (owner approval required)

Nothing below has been done. Each item needs the owner's explicit approval.

1. **Read-only pre-apply inventory** on staging first (owner approval for read-only SQL): sequences in `public` with anon privileges; functions in `public` with anon EXECUTE; `pg_default_acl` entries for anon; the column definitions of the four granted tables (confirm each granted column exists).
2. **Anon traffic review:** a count of anon requests per table and per function over the last 30 days, from the Supabase API logs. Confirm no request targets a table or column outside the grant list. Any hit changes the plan.
3. **Legacy writers:** confirm no deployed page or script inserts into `applicants` or `error_submissions` with the anon key.
4. **CI gates:** Migration gate and Security regression run on the branch (Docker or CI).
5. **Decisions:** R1 (authenticated TRUNCATE follow-up), R4 (default privileges for functions), R2 (teacher insert rate limit).
6. **Staging rehearsal** with the real migration on the staging project, then the end-to-end registration test with test data.

Rollback: this migration removes privileges, so it is not additive in the sense CLAUDE.md uses for schema changes. It changes no schema objects, but it does change grants. No rollback script exists yet. A correct one restores the captured pre-migration ACLs for each object (the same snapshot the harness takes), not a blanket `GRANT ... TO anon` or `GRANT EXECUTE ... TO PUBLIC`. A blanket re-grant would also restore PUBLIC EXECUTE on any function that an earlier migration deliberately restricted. The rollback needs owner approval and its own rehearsal.

## 11. Verification limits

- The live state of sequences, functions and default ACLs has not been read (owner instruction: no further SQL against production or staging).
- The rehearsal uses a synthetic schema written from the production inventory. It is not a copy of production, so the migration's behavior on real data (for example, the exact `class_options` columns) must be confirmed on staging.
- Nothing has been committed. The branch `brief/anon-privilege-hardening` holds the uncommitted files in the worktree `C:/Users/moser/Downloads/rso-anon-privilege-hardening`.
