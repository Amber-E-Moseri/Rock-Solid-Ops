# Teacher application foundation

Branch: `claude/funny-hamilton-cx3ak3`. Stacked on PR #22 (`feature/teacher-onboarding-foundation`, head `a67e950`), with Request Access Phase 1 (org subgroups and staff scope) and Phase 2 (group and subgroup scope for this workflow) on top. Draft PR #45 targets `main`.
Status: implementation, data model and authorization tests. No public UI, no linking or provisioning mutation, no role elevation, no staging or production change. APPROVE records `APPROVAL_PENDING_PROVISIONING` only.

## 1. Scope delivered

| Item | Location |
|---|---|
| Applications table, indexes, constraints, updated-at trigger | `supabase/migrations/202610230100_teacher_applications_foundation.sql` |
| Lifecycle contract (`teacher_application_transition_allowed`) | same |
| Applicant submission, idempotent per applicant, with group and subgroup | `submit_teacher_application` (six-argument form; the four-argument form from the foundation is superseded and revoked) |
| Applicant withdrawal | `withdraw_teacher_application` (same) |
| Scoped review: request information, reject, and approve to `APPROVAL_PENDING_PROVISIONING`. `APPROVED` stays refused. | `review_teacher_application` (same name, replaced in place) |
| Phase 2 scope: `group_id` and `subgroup_id` with a composite FK to `org_subgroups`, `teacher_application_can_decide` (resolved from `auth.uid()`), and the status change | `supabase/migrations/202610250300_teacher_applications_scope.sql` |
| Read surfaces: applicant view, reviewer view | `teacher_applications_applicant`, `teacher_applications_review` (same) |
| Outbox helper with dedupe key | `enqueue_teacher_application_email` (same) |
| Three email templates, plus `email_templates` FK mirror | `supabase/migrations/202610230200_teacher_application_email_templates.sql` |
| Test stubs, harness and 132 checks, including the Phase 2 scope tests J0 to J35 | `supabase/tests/teacher-applications/` (`run.sh`, `stubs.sql`, `tests.sql`) |
| Status enum for `/ai/statuses.md` | `ai/statuses.md` (new section) |

Not delivered, by design: the linking mutation and provisioning (approval is recorded as pending only), the public apply UI, Turnstile, rate limits, the re-application cooldown, and any change to the legacy anon insert policy or the email fallbacks.

## 2. Contract check (Task 1, read against `origin/main` at `3ab00a2`)

| Area | Finding | Consequence for this branch |
|---|---|---|
| Teacher lifecycle | `teachers.status` is `PENDING | ACTIVE | SUSPENDED | INACTIVE` (`202605071600`). `teacher_id` is text. `teachers.email` has **no unique constraint**. | Duplicate protection cannot rely on `teachers`. Applications get their own uniqueness. |
| Teacher-to-Auth link | `teachers.teacher_user_id` (`202605071960`). Hardened candidate `202605191330` adds `uq_teachers_teacher_user_id_not_null`, `unlink_teacher_from_auth_user`, and an exact email-match link function. | See section 6. The candidate is **not confirmed deployed**. |
| Production drift | `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md` lists `unlink_teacher_from_auth_user` and `uq_teachers_teacher_user_id_not_null` as absent in production, and `audit_logs.actor_id` as absent. | Linking must not be wired until the owner verifies production. Applications write `audit_logs.actor_id`, so the column must exist before deployment. |
| Profiles and Auth | `profiles` is keyed on `user_id` (not `id`). `handle_new_auth_user_profile` creates `pending`. `trg_profiles_protect_self_role_update` blocks self-role change. `profiles_enforce_role_assignment` (`202607131600`) removes admin's role-update authority. | Applications never write `profiles`. Privilege is not granted by this branch. |
| Existing registration RLS | `allow public teacher self registration` (`202605171600`) lets `anon` and `authenticated` insert PENDING, inactive `teachers` rows. | **Left in place** (constraint). The new path does not use it. Removal is a later gated batch. |
| Fellowship identity | `fellowship_map.fellowship_code` (text PK) with `active`. `teachers.fellowship_code` is an FK to it. | Applications reference `fellowship_map` directly. Group and subgroup are derived from it, not stored on the application. |
| Email queue | `email_queue` status values include `Pending`, `Processing`, `Sent`, `Failed`, `Retried`. `template_key` FKs `email_templates`. `email-sender` renders only from `notification_templates`. | New keys exist in both tables. Outbox dedupe is an index on `metadata->>'dedupe_key'`. |
| Audit | `public.audit_logs` canonical columns (`202605071800`, restored by `202609180000`). | Every transition writes one row. Actor is `auth.uid()`, never a client value. |
| Attention RPCs | `get_teacher_attention_flags` reads `teachers` and excludes PENDING, inactive rows. | Unaffected. Applications are outside `teachers`. |
| PR #14 (draft, `brief/anon-privilege-hardening`) | Revokes anon table, sequence and function privileges. Keeps anon INSERT on `teachers` for PENDING self-registration. Its migration timestamp `20261022120000` is earlier than this branch's. | No conflict in privileges: this branch grants nothing to anon and revokes explicitly. Ordering: if PR #14 merges after this branch, its earlier timestamp becomes out of order. Merge order must be decided. |
| Phase A branch | Not present in this checkout. The migration log holds Phase A audit notes only. | I could not check Phase A code directly. No overlap is visible in `main`. |

## 3. Lifecycle contract

States: `SUBMITTED`, `INFO_REQUESTED`, `APPROVAL_PENDING_PROVISIONING`, `APPROVED` (reserved), `REJECTED`, `WITHDRAWN`.

| From | To | Actor | Function | Notes |
|---|---|---|---|---|
| (none) | `SUBMITTED` | verified applicant | `submit_teacher_application` | Requires `email_confirmed_at`. Email from Auth, lowercased. |
| `SUBMITTED` | `SUBMITTED` (UPDATED) | applicant | `submit_teacher_application` | Changed content, version +1, no email. |
| `SUBMITTED` | `SUBMITTED` (UNCHANGED) | applicant | `submit_teacher_application` | Identical retry. No version, no audit, no email. |
| `INFO_REQUESTED` | `SUBMITTED` (RESUBMITTED) | applicant | `submit_teacher_application` | Confirmation email for this version. |
| `SUBMITTED` | `INFO_REQUESTED` | scoped reviewer (section 4) | `review_teacher_application` `REQUEST_INFO` | Message required. Applicant-visible. |
| `SUBMITTED` / `INFO_REQUESTED` | `REJECTED` | scoped reviewer (section 4) | `review_teacher_application` `REJECT` | Reason required. Stored internally. Generic email. |
| `SUBMITTED` / `INFO_REQUESTED` | `APPROVAL_PENDING_PROVISIONING` | scoped reviewer (section 4) | `review_teacher_application` `APPROVE` | Records the decision and audits it. No role, roster, account or email change. No email. |
| `SUBMITTED` / `INFO_REQUESTED` | `WITHDRAWN` | applicant | `withdraw_teacher_application` | Owner only. Not from `APPROVAL_PENDING_PROVISIONING`. |
| `SUBMITTED` / `INFO_REQUESTED` | `APPROVED` | **reserved** | not reachable by any action | Only the teacher-link contract may perform this (section 6). P1 hold. |

Terminal states: `REJECTED`, `WITHDRAWN`. `APPROVAL_PENDING_PROVISIONING` is held until provisioning is certified and cannot be reviewed, rejected or withdrawn. A rejected address cannot re-apply (`APPLICATION_NOT_ALLOWED`) until the owner sets a cooldown or override (decision D5). A withdrawn applicant may apply again as a new application.

Every write takes a row lock and checks `version`. A stale version returns `VERSION_CONFLICT`.

Invariants enforced by constraints: normalized email; name 2 to 120 characters; phone and notes length limits; `APPROVED` requires `approved_teacher_id`; decided states require `reviewed_by` and `reviewed_at`; at most one open application per normalized email and per applicant (partial unique indexes).

## 4. Authorization

| Actor | Read | Write |
|---|---|---|
| Anonymous | nothing (`42501`) | nothing |
| Authenticated, unverified | nothing for applications | nothing; submit refused with `EMAIL_NOT_VERIFIED` |
| Verified applicant, any profile state (including `pending` or no profile) | own rows through `teacher_applications_applicant`, applicant-safe columns only | submit, update, withdraw own open application |
| Superadmin or regional secretary (active) | every application through `teacher_applications_review`, including internal fields | REQUEST_INFO, REJECT, APPROVE (to `APPROVAL_PENDING_PROVISIONING`); never their own application |
| Pastor or subgroup admin (active, with an active assignment for the application's group and subgroup) | applications in those subgroups through `teacher_applications_review` | the same actions, for assigned subgroups only; never their own application |
| Admin, principal, teacher, pending, inactive admin, or any profile without scope | nothing for review | nothing |

The base table has **no** direct grant to `anon` or `authenticated`, and no table policy. Reads go through two views whose `WHERE` clauses are the authority, because RLS cannot hide columns. Decision authority is `teacher_application_can_decide(id)`. It reads `auth.uid()` only, so no caller can name a reviewer. It refuses the applicant by user id and by normalized email. Organization-wide authority comes from an active superadmin or regional secretary. Scoped authority comes from an active pastor or subgroup admin with an active assignment for the application's group and subgroup, read from `staff_scope_assignments`. Revoking an assignment, deactivating a profile or changing its role takes effect on the next call.

No function takes an actor, email or role from the client. The helper for the outbox is not executable by any application role.

## 5. Email and verification configuration (owner, Supabase dashboard)

The repo does not contain hosted Auth settings (`supabase/config.toml` has no `[auth]` section). These must be checked in the dashboard, read-only first:

1. **Confirm email: enabled.** Without it, `email_confirmed_at` is never set and no applicant can submit. This is the verification anchor.
2. **Site URL and redirect allow-list** include the applicant sign-in and confirmation URLs. No wildcard.
3. **Confirmation and recovery templates** are customized. Their copy must not claim an account or role.
4. **Auth rate limits** for signup and resend are set to the owner's chosen values.
5. **SMTP / sender domain** has SPF, DKIM and DMARC for the sending domain. Application emails use the existing `email-sender` path, so the same sender applies.
6. **Turnstile** is not in this foundation. Public apply and signup need Turnstile keys before any public UI.

Application emails: `teacher_application_received`, `teacher_application_info_requested`, `teacher_application_rejected`. Bodies contain no reviewer text. Failed sends stay in `email_queue` with `Failed` and appear in the existing Retry Center.

## 6. Dependency on existing teacher-link security

This branch does **not** implement the approval or linking mutation. When it is implemented, it must:

- call `public.link_teacher_to_auth_user(p_teacher_id, p_auth_user_id, p_actor_email, p_allow_relink)` from an admin session, so the hardened exact-email gate, the one-teacher-per-auth-user check and the link audit all apply;
- not write `teachers.teacher_user_id` directly;
- create the roster row (`teachers`, status `ACTIVE`) and the link in one transaction, then set the application to `APPROVED` with `approved_teacher_id`;
- handle the profile role only through a path the trigger allows. Admin sessions can no longer change `profiles.role` (`202607131600`), so this needs a service-role function or a superadmin path. See decision D4.

Tests F3 to F5 prove the current link function refuses an applicant caller, an application-only identity (`TEACHER_NOT_FOUND`) and an unrelated roster row (`EMAIL_MISMATCH`). These run against the real `202605191330` file, loaded unmodified.

The link candidate itself is **not verified deployed**. Its unlink function and unique index are listed as absent in production. Before approval is wired, the owner must confirm the production definition of `link_teacher_to_auth_user` matches `202605191330`.

## 7. Test evidence and limits

Run: `PG_BIN=/usr/lib/postgresql/16/bin PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/teacher-applications/run.sh`

Result on PostgreSQL 16.15, local: **132 of 132 checks passed**. Of these, 85 are PR #22 checks, with some expectations changed to the scoped rules (two pastor and subgroup-admin denials were removed, because those roles now pass by design, and their positive coverage is J3 and J5). The other 47 are the Phase 2 checks J0 to J35.

Coverage, mapped to the brief:

- Pending and no-profile accounts gain no privilege (B12, B13, C3, C4, F2, F5).
- Anonymous users cannot read, insert, submit, review, withdraw, or read either view (A2 to A7, H9, H10).
- Verified applicants see only their own application, with no internal columns (B16, B17, H1 to H3).
- Duplicate open applications: identical retry is UNCHANGED (B8); an edit does not resend mail (B9); a second account with the same email is refused (B10); concurrent-retry handling is code-reviewed, not tested; outbox dedupe (E1).
- Users without decision rights cannot review or approve (C1 to C7, C10, C11, H5 to H7, J7 to J11). Scoped reviewers are tested in section J: multi-subgroup authority (J1, J26, J29), cross-subgroup denial (J4, J24, J28), organization-wide authority (J5, J6), no self-approval by user id and by normalized email (J11, J12a, J13b, J13c, J25), revocation and deactivation (J27 to J31), and invalid group and subgroup pairs (J32 to J35).
- An unapproved application cannot link into the roster (F3 to F5, F1).
- Lifecycle transitions, versioning and audit (C17 to C26, D1 to D6).
- `APPROVAL_PENDING_PROVISIONING`: no role, roster or email change (J14 to J17); no reject, request-information or withdrawal from pending (J18 to J21); `APPROVED` and the link path stay refused (J22, J23).
- Constraints (G1 to G4).

Mutation checks from the foundation were not repeated for Phase 2.

Limits, stated plainly:

- **The CI migration gate is not run locally.** It runs in CI on draft PR #45 for the exact head, because the local Supabase stack cannot pull its images here. `scripts/test-migration.sh` needs Docker and the Supabase CLI. The harness uses Supabase-shaped stubs (`stubs.sql`), copied from the canonical definitions, not a full replay of the 150+ migrations. The gate must run before any merge.
- Supabase Auth itself (confirmation emails, token flow) is not exercised.
- Concurrency is reasoned about (row locks, unique indexes, the unique-violation handler), not stress-tested.
- Role-helper bodies are copies of `main`. A drift between copy and canonical would not be caught here.

## 8. Outstanding decisions (owner)

- **D1.** Keep public self-application, or invite-only first using the existing admin direct-create path?
- **D2.** Resolved by owner: auth-first (applicant creates a confirmed account, then applies) is the future provisioning design.
- **D3.** Resolved by owner: superadmin and regional secretary decide organization-wide. Pastor and subgroup admin decide within their assigned active subgroups. Admin has no review rights.
- **D4.** Teacher profile role after approval. **Owner-deferred on 2026-10-26 to the provisioning phase.** Deferred for the non-provisioning foundation scope: not decided, not implemented, not certified. Admin sessions can no longer write `profiles.role`.
  Requirements before any future role assignment (all required; none is met by this branch):
  - A separate owner gate approves the mechanism (service-role function or superadmin path) before any code exists.
  - Only a service-role function writes `profiles.role`. It verifies the caller's JWT server-side as an active superadmin, refuses self-targeting, and requires the application in `APPROVAL_PENDING_PROVISIONING`.
  - Production verified first: `link_teacher_to_auth_user` matches `202605191330`; `unlink_teacher_from_auth_user` and `uq_teachers_teacher_user_id_not_null` are present or explicitly accepted; the `audit_logs.actor_id` drift is resolved or the actor stays in `details`.
  - One audit row per role change with actor and target in `details`. The change is idempotent and never silently overwrites an existing active role.
  - RLS and grant review of the function, including how `profiles_enforce_role_assignment` (`202607131600`) treats its writes.
  - Activation, email and Moodle remain separate gates. Nothing in this foundation enables them.
- **D5.** Re-application after rejection: cooldown length, or no re-application? Currently blocked.
- **D6.** Should rejection reasons ever be shown to applicants? Currently internal only.
- **D7.** Existing PENDING self-registered `teachers` rows in production: migrate to applications, or archive?
- **D8.** Fellowship: free text, or chosen from `fellowship_map`? The branch validates against active fellowships.
- **D9.** Turnstile provisioning and Auth rate-limit values.
- **D10.** Sender domain, and who receives new-application notices (none in this branch).
- **D11.** Staging: `rocksolid-staging` is under an existing hold (restrict or retire). Certification cannot run there until that decision is made.

## 9. Staging and production requirements before any apply

- Read-only production checks (owner-run): `link_teacher_to_auth_user` definition; `audit_logs.actor_id` present; `fellowship_map.active` present; whether the anon self-registration policy exists; PENDING teacher row count.
- Migration order: this branch's timestamps (`20261023…`) are later than PR #14's (`20261022120000`). Decide merge order before either lands.
- Staging apply only after the CI migration gate passes and the owner approves the security boundary (RLS and grants). This is a gate under the branch-hold rules.

## 10. GO / NO-GO

- **GO for a draft foundation PR** against `main`, labelled as a security-boundary change, with the CI migration gate as a required check.
- **NO-GO for merge** until: the migration gate passes on the exact head; D4 is owner-deferred to the provisioning phase (deferred, not completed or certified; requirements under D4); the production read-only checks in section 9 are recorded; and the staging gate is approved.
- **NO-GO for the approval or linking mutation** until the link candidate is verified deployed and D4 is decided.
- **NO-GO for public UI** until Turnstile (D9) and the Auth settings (section 5) are in place.
