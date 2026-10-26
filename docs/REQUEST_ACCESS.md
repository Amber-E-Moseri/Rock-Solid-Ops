# Request Access (Phase 3)

Status: implemented on `claude/funny-hamilton-cx3ak3` (PR #45, draft, not merged). Approval records a decision only. Nothing in Phase 3 creates an account, changes a role, grants scope, creates a teacher record, or sends email.

Builds on Phase 1 (`org_subgroups`, `staff_scope_assignments`) and Phase 2 (`teacher_applications` scope). Teacher requests reuse PR #22's `teacher_applications` workflow. General requests (pastor, subgroup admin, other) use the new `access_requests` tables.

## Applicant flow (`/auth/request-access`, public)

1. **Account first.** The page offers sign-in or account creation. Creation sends a confirmation link to the new address. The link returns to `/auth/request-access`.
2. **Confirm email.** A signed-in account whose email is not confirmed sees a confirmation step with a resend action. The form is not shown until the email is confirmed.
3. **Form.** Fields: full name (required), email (read-only, from the account, never sent), phone (optional), requested role, group, subgroup, fellowship or campus, additional note (optional, 1000 characters).
   - Requested role offers exactly four choices: Teacher, Pastor, Subgroup Admin, Other. There is no Group Admin.
   - Group → subgroup → fellowship are dependent. Changing a group clears the subgroup and fellowship. A subgroup is listed only under its own group. A fellowship is listed only under the chosen group and subgroup.
   - Codes come from `access_request_org_options()` (active rows only), never typed by the applicant. The server checks the group, subgroup and fellowship combination again on submit.
4. **Submit.** Teacher requests call `submit_teacher_application`. Other requests call `submit_access_request`. The server reads the applicant's identity and verified email from `auth.users`. The client's group, subgroup and role choices are requested scope only. They grant nothing.
5. **Duplicates.** One open request per applicant. Resubmitting an unchanged open request returns `UNCHANGED`. A different applicant's open request for the same person is refused with `DUPLICATE_OPEN_REQUEST` and is never overwritten.
6. **After submit.** The page shows the open request and its status. A `SUBMITTED` request can be withdrawn. An `INFO_REQUESTED` request shows the reviewer's question and a prefilled form to send an update. `APPROVAL_PENDING_PROVISIONING` shows that access is not active until setup is complete, and offers no withdrawal.

## Staff flow (`/staff/access-requests`)

- Route roles: superadmin, regional secretary, pastor, subgroup admin. Admin and principal have no approval authority in this workflow. The server decides what each role sees and may decide.
- Queue tabs: Pending (`SUBMITTED`), Needs information (`INFO_REQUESTED`), Awaiting provisioning (`APPROVAL_PENDING_PROVISIONING`), Rejected, All. Search, requested-role and group filters apply within a tab.
- Drawer: applicant details, status, history (general requests), message to the applicant, internal reviewer note (general requests only), and the actions the server allows.
- Actions:
  - **Request information** needs a message. The applicant sees the message.
  - **Reject** needs a reason. The reason is internal. The applicant sees a generic outcome.
  - **Approve…** opens a confirmation that states approval records the decision and changes nothing else. Recording approval moves the request to `APPROVAL_PENDING_PROVISIONING`.
- Every decision sends the version the reviewer saw. A stale version returns `VERSION_CONFLICT` and the reviewer is asked to reload.
- Teacher approvals call `review_teacher_application` with no note. Its approve path stores no note, so the note field is disabled for teacher requests.

## Authorization

Authority is decided on the server, at the time of the decision, by `access_request_can_decide(request_id)` for general requests and `teacher_application_can_decide(application_id)` for teacher applications. The client only displays the result.

| Actor | Teacher application | Subgroup admin request | Pastor request | Other request |
|---|---|---|---|---|
| superadmin | decide | decide | decide | decide |
| regional_secretary | decide | decide | decide | decide |
| pastor with an active assignment in the subgroup | decide, in its subgroups | decide, in its subgroups | none | none |
| subgroup_admin with an active assignment in the subgroup | decide, in its subgroups | none | none | none |
| admin, principal, teacher, pending, inactive | none | none | none | none |
| the applicant | never their own | never | never | never |

Rules that hold in every path:

- A decision by the applicant is refused by user id and by normalized email (`FORBIDDEN: reviewers cannot decide their own request`).
- Assignments are read from `staff_scope_assignments`. Pastor and subgroup admin scope never extends by group name, by role alone, or by membership.
- A revoked, deactivated or role-changed actor loses authority on the next call.
- Views return only rows the caller may decide. `reviewer_note` and `rejection_reason` never reach applicant views.
- No `service_role` or privileged function is callable from the browser. Scope grant and revoke functions remain service-role only.

## Data

| Object | Purpose |
|---|---|
| `access_requests` | General requests. One open request per applicant and per open email (partial unique indexes). Composite foreign key `(subgroup_id, group_id)` to `org_subgroups`, so a subgroup must belong to its group. Version column for optimistic concurrency. RLS enabled. |
| `access_request_events` | Decision history. Written only by the decision function. Clients have no grant on the table, and reviewers read it through `access_request_events_review`. |
| `access_request_org_options()` | Read-only organization options for the form. Anonymous and authenticated, active rows only. |
| `submit_access_request` | Applicant submit (7 arguments). |
| `withdraw_access_request` | Applicant withdraw from `SUBMITTED` or `INFO_REQUESTED`. |
| `decide_access_request` | Reviewer decision (5 arguments): `REQUEST_INFO`, `REJECT`, `APPROVE`. |
| `access_requests_applicant`, `access_requests_review`, `access_request_events_review` | Views. |

Migration: `supabase/migrations/202610250400_access_request_intake_and_review.sql`. Additive. Idempotent (`create or replace`, `if not exists`).

## Tests

| Suite | Result |
|---|---|
| `supabase/tests/access-requests/run.sh` | 101 of 101 (intake, duplicates, applicant visibility, authority matrix, self-decision by id and email, transitions, revocation, teacher flow, privileges and the approval boundary) |
| `supabase/tests/teacher-applications/run.sh` | 132 of 132 (unchanged by Phase 3) |
| `supabase/tests/request-access-scope/run.sh` | 75 of 75 (unchanged by Phase 3) |
| `foundation-spa` Vitest | 421 of 421 across 63 files. Request Access: `accessRequestForm.test.js`, `accessRequestPage.test.jsx`, `accessRequestsInbox.test.jsx`, `accessRequestRoutes.test.js` (69 checks) |
| `npm run build` | Exit 0 |

The database suites ran on PostgreSQL 16 against a Supabase-shaped stub baseline (`stubs.sql`). They do not replace the CI migration gate, which replays the full schema.

## Known limits and Phase 4 blockers

- **Provisioning is not built.** Approved requests stay in `APPROVAL_PENDING_PROVISIONING`. There is no provisioning queue, worker, account linking or role change. The owner's hold keeps them there.
- **Auth-first activation** (linking an approved request to an account and assigning scope) needs its own verified-JWT edge wrapper and the provisioning state machine.
- **Scope grant and revoke** (`grant_staff_scope`, `revoke_staff_scope`) remain service-role only. Nothing in the SPA calls them.
- **Supabase sign-up and confirmation settings** are not verified here. The confirmation step assumes email confirmation is required.
- **Teacher approval notes** are not stored. Teacher applications have no event trail; the history panel says so.
- **Signed-in screens** (form, inbox) were not captured as screenshots. Only the signed-out page was captured.
- **D4** (teacher role assignment) remains owner-deferred, as recorded in `docs/TEACHER_APPLICATION_FOUNDATION.md`.
- **PR #14 ordering and production drift checks** are still outstanding, as recorded in `docs/BRANCH_HOLDS.md`.
