# Teacher application review, communication, Turnstile and recovery (P2 candidate)

Branch: `feature/teacher-onboarding-experience`, local only, based on `origin/integration/teacher-onboarding-candidate` (`773eb69`).
Depends on PR #22 (`feature/teacher-onboarding-foundation`, `a67e950`) for the database contract. This branch does not contain PR #22's files.
Not pushed. No PR opened. No migration, edge function or Auth setting changed. Nothing sent.

Not touched, by design: `App.jsx`, `AuthContext.jsx`, `releaseHolds.js`, `components/layout/Shell.jsx`, `routing/routeRoles.js`, PR #20, PR #22, PR #14, PR #19, the integration branch.

## 1. What this branch delivers

| Area | Files |
|---|---|
| Review data layer (reviewer view, decision RPC, roster, notifications, history, error mapping) | `foundation-spa/src/features/teacher-applications/lib/reviewApi.js` |
| Email and status contract, display labels | `foundation-spa/src/features/teacher-applications/lib/communications.js` |
| Date helpers | `foundation-spa/src/features/teacher-applications/lib/format.js` |
| Review page (queue, search, filters, detail, decisions) | `foundation-spa/src/features/teacher-applications/TeacherApplicationsPage.jsx` |
| Detail pane and decision dialog | `.../teacher-applications/components/ApplicationDetail.jsx`, `.../components/DecisionDialog.jsx` |
| Staff route (lazy, `ProtectedRoute` admin and superadmin) | `.../teacher-applications/routes.jsx` |
| Styles (tokens only) | `.../teacher-applications/teacherApplications.css` |
| Turnstile gate and loader | `foundation-spa/src/components/security/turnstile.js` |
| Turnstile widget and states | `foundation-spa/src/components/security/TurnstileField.jsx`, `turnstile.css` |
| Turnstile wired into sign-up, resend and reset | `teacher-onboarding/pages/TeacherRegisterPage.jsx`, `CheckEmailPage.jsx`, `ForgotPasswordPage.jsx` |
| Applicant copy: submit outcomes, activation states | `teacher-onboarding/lib/messages.js`, `teacher-onboarding/pages/ApplicationPage.jsx` |
| Env documentation | `foundation-spa/.env.example` (`VITE_TURNSTILE_SITE_KEY`, empty) |
| Shared test helper (additive: `ilike`, `contains`) | `foundation-spa/src/tests/teacherOnboardingHarness.js` |
| New tests | `teacherApplicationsLib.test.js`, `teacherApplicationsPage.test.jsx`, `teacherApplicationsRoute.test.jsx`, `teacherOnboardingTurnstile.test.jsx`, `teacherRecoveryAndCopy.test.jsx` |
| Hold record | `docs/BRANCH_HOLDS.md` (new section above "Resolved") |

## 2. Integration instructions for Agent 1

Do these after PR #22 is merged or deployed to staging. They are not on this branch because they edit shared files.

1. **Route.** In `foundation-spa/src/App.jsx`, add
   `import { teacherApplicationsRoute } from './features/teacher-applications/routes.jsx';`
   and insert `{teacherApplicationsRoute}` inside `<Routes>`, directly after `{TEACHER_ONBOARDING_CERTIFIED && teacherOnboardingRoutes}`.
   Verified: this exact edit builds, and the lazy chunk `TeacherApplicationsPage-*.js` is produced. It was then reverted.
2. **Navigation.** In `foundation-spa/src/components/layout/Shell.jsx`, add `UserCheck` to the lucide import, and add to the System group:
   `{ key: 'teacherapps', label: 'Teacher Applications', path: '/staff/teacher-applications', Icon: UserCheck, roles: ['admin', 'superadmin'] }`.
3. **Access matrix.** In `foundation-spa/src/routing/routeRoles.js`, add `'/staff/teacher-applications': Object.freeze(['admin', 'superadmin']),` under System. This is a permission entry, so review it as one.
4. **Environment.** Set `VITE_TURNSTILE_SITE_KEY` for the production build only after Turnstile is enabled in Supabase Auth (section 5). Leaving it empty keeps public account forms unavailable in production.
5. **Merge order and conflicts.** This branch must merge after PR #22, or be rebased onto it. Expected conflict: `docs/BRANCH_HOLDS.md`, because PR #22 also edits that file. Keep both sections.
6. **Keep the holds.** Do not change `TEACHER_ONBOARDING_CERTIFIED`, `APPROVAL_CERTIFIED`, `MOODLE_RETRY_CERTIFIED` or `ATTENDANCE_SUBMIT_CERTIFIED`.

## 3. Review screen behaviour

- Reads come only from `teacher_applications_review`. The base table is never queried.
- Writes come only from `review_teacher_application` with `REQUEST_INFO` or `REJECT`. The browser never calls approve, never writes `teachers`, `profiles`, or `audit_logs`, and never inserts or updates. A test asserts this.
- Approve is always disabled. `APPROVAL_CONTRACT_AVAILABLE` is `false` in `reviewApi.js`, and there is no approve function to call. The disabled control explains the hold.
- Decision dialog: a message is required (1 to 1000 characters). `REQUEST_INFO` says the message is shown in the applicant's portal. `REJECT` labels the reason as internal and says it is never shown to the applicant.
- Version conflict (`VERSION_CONFLICT`), not-found, and invalid-transition errors show a specific message and reload the queue. The draft message stays in the dialog. Nothing is resubmitted automatically.
- Unknown server text is never shown. Only known codes map to copy.
- Roster check: one live `teachers` record with the same email shows a warning that approval must link it. Several show an ambiguity warning. A failed check says not to decide. This is advisory and does not block the two decisions.
- Email delivery panel: reads `email_queue` rows where `metadata.application_id` matches. A `Failed` row links to the Retry Center. There is no resend control on this screen.
- Review history: reads `audit_logs` (`entity_type = teacher_application`) and shows readable labels, never raw action names.
- Own application: decision controls are disabled with a message. The database still refuses it.
- Role gate: `ProtectedRoute` with admin and superadmin, and the page checks the same role. The database reviewer gate is the enforcement point.

## 4. Email contract

Template keys are database identifiers. `email-sender` renders only from `notification_templates`. Only "exists" keys are in the database today (PR #22). "Proposed" keys are not sent until P1's transactions are certified. Bodies never contain reviewer text. No message says an account is active unless the backend has activated it.

| Event | Template key | Source | State |
|---|---|---|---|
| Application received | `teacher_application_received` | `submit_teacher_application` (first submission) | exists (PR #22) |
| Email verification required | none | Supabase Auth confirmation email | Auth template |
| Information requested | `teacher_application_info_requested` | `review_teacher_application` REQUEST_INFO | exists (PR #22) |
| Application updated | none | `submit_teacher_application` returns `UPDATED`. No email by design. | no email |
| Approved, activation pending | `teacher_application_approved_pending` | P1 approval transaction | **proposed, not created** |
| Teacher account activated | `teacher_account_activated` | P1 activation transaction | **proposed, not created** |
| Application not approved | `teacher_application_rejected` | `review_teacher_application` REJECT | exists (PR #22) |
| Confirmation link resent | none | Supabase Auth resend (signup), rate-limited | Auth template |
| Delivery failure and retry | none | `email_queue` `Failed`. `retry-worker` runs hourly. Operators retry in the Retry Center. | operator retry |

Applicant copy (`messages.js`, `ApplicationPage.jsx`):

- Submit notices: `SUBMITTED` says a receipt is on its way by email. `UPDATED` says no email was sent. `RESUBMITTED` says the updated application was sent. `UNCHANGED` says it is already up to date.
- Approved says the account "is being activated". It does not say active.
- A teacher role says "Your teacher account is active." This relies on P1 setting `profiles.role = 'teacher'` only inside the activation transaction (dependency P1-3).
- Rejection is generic. The internal reason is never selected by the applicant views.

Proposed template bodies for P1 to review (not created):

- `teacher_application_approved_pending`: "Your teacher application has been approved. Your teacher account is being activated. We will email you again when you can sign in to the teacher portal."
- `teacher_account_activated`: "Your teacher account is now active. Sign in to the teacher portal to continue." Send only after the activation transaction commits.

## 5. Turnstile

- The site key (`VITE_TURNSTILE_SITE_KEY`) is public. The Turnstile secret is never in this repository or the browser. A test scans the new files for secret assignments.
- Each token is passed as `captchaToken` to `auth.signUp`, `auth.resend` and `auth.resetPasswordForEmail`. Supabase Auth validates the token server-side when CAPTCHA protection is enabled with the Turnstile secret in the Supabase dashboard. That server check is the enforcement point. The widget alone is not.
- Production build without a key: sign-up, resend and reset are unavailable, with a clear message, and no Auth call is made (tested).
- Development build without a key: forms work with no token, and a note says verification is not configured (tested).
- Key configured: submit stays disabled until a token exists. The token is single use, so each attempt remounts the widget. Expired, timed-out, errored and failed-load states each show copy and offer a retry (tested).
- `captcha_failed` from Auth maps to retry copy, not the raw message (tested).
- Limits: client-side resend cooldown is 60 seconds (existing). Server-side limits for signup, resend and recovery are owner decisions (D9 in `TEACHER_APPLICATION_FOUNDATION.md`). Recommended values: set per-address and per-IP limits in Auth. Nothing here sets them.
- The SPA sign-in page's own "Forgot password?" request (`src/features/auth/LoginPage.jsx`, line 75) does not send a captcha token. Once Supabase CAPTCHA protection is enabled, that request will fail. Route it to `/auth/forgot-password` (the protected form) before enabling protection. Recorded as a known gap; not changed here.

## 6. Password recovery verification

| Brief item | Evidence | Status |
|---|---|---|
| Generic response for known and unknown addresses | existing `teacherOnboardingPasswords.test.jsx`; `teacherRecoveryAndCopy.test.jsx` | verified with mocks |
| Approved redirect allowlist | `teacherOnboardingLib.test.js` (25); `teacherRecoveryAndCopy.test.jsx` | verified with mocks |
| Expired and invalid links | existing password and registration tests | verified with mocks |
| Recovery session establishment | existing tests (`exchangeCodeForSession` once); session-only path below | verified with mocks |
| Token removed from the address bar | existing tests | verified with mocks |
| Password validation | existing tests | verified with mocks |
| Normal session not treated as recovery | existing test (`amr: password` refused) | verified with mocks |
| Safe repeat requests | cooldown after success, one Auth call (new test) | verified with mocks |
| No auth loops | one session check on load (new test) | verified with mocks |
| Replayed code | second load offers no form and no `updateUser` (new test) | verified with mocks |
| Session-only recovery via `amr` claim | the code accepts `amr` containing `recovery` | **UNVERIFIED** against Supabase. Test documents the mechanism, not the claim. Verify with a real recovery link in staging. Fails closed if the claim is absent. |

Real recovery-link verification requires staging and is not done.

## 7. Tests and build (local)

- Full frontend suite: **72 files, 541 tests pass** (baseline on the candidate: 67 files, 452 tests).
- New and changed onboarding and review suites: 12 files, 182 tests pass.
- Production build (`vite build`): passes. Without the temporary route wiring, the review page is not in the bundle, as expected.
- Route wiring verified by temporary build only: lazy chunk produced, then reverted.
- Layout check (headless Chromium, real build, mocked Supabase REST and session, layout only): at 320, 390 and 1280 px there is no horizontal overflow on the queue, detail or decision dialog, and the dialog fits the viewport. Screenshots were taken at each width. The backend is mocked, so this does not verify authorization or data.
- Found and fixed during this check: at 320 px, the page grid sized to the widest child, causing 20 px overflow. Fixed with explicit `minmax(0, 1fr)` tracks. Also: the mobile card's applicant name is now a real button, so keyboard and screen-reader users can select it.

Not verified: a real Supabase project, real Auth emails, real Turnstile, a real reviewer account, staging.

## 8. Dependencies for P1 (approval and activation)

P1-1. **Approval RPC.** Provide the approved contract for approving an application. It should return `ok`, `status = 'APPROVED'`, `version` and `approved_teacher_id`, and write an audit row with action `TEACHER_APPLICATION_APPROVED` and `entity_type = teacher_application`. When certified, the UI change is: set `APPROVAL_CONTRACT_AVAILABLE = true`, add the call next to `reviewApplication`, and enable the button. Until then the button stays disabled.

P1-2. **Link.** Use `link_teacher_to_auth_user` (per PR #22 section 6). The UI does not link. Approval must reuse the hardened exact-email gate.

P1-3. **Role on activation only.** The UI treats `profiles.role = 'teacher'` as "account active". Set this only inside the activation transaction, after the roster link commits.

P1-4. **Templates and sending.** Create `teacher_application_approved_pending` and `teacher_account_activated` (section 4) with `ON CONFLICT DO NOTHING`, and send only through the existing enqueue helper with a dedupe key. Do not send before activation for the second template.

P1-5. **Reviewer reads.** Confirm these reads work for admin and superadmin, and not for other roles: `teachers` (roster check), `email_queue` (delivery panel), `audit_logs` (history). If `audit_logs` or `email_queue` are denied, the panels say "not available"; nothing else breaks.

P1-6. **Audit labels.** The labels in `communications.js` expect `TEACHER_APPLICATION_SUBMITTED`, `_UPDATED`, `_RESUBMITTED`, `_INFO_REQUESTED`, `_REJECTED`, `_WITHDRAWN`, `_APPROVED`. Other actions show "Recorded event".

## 9. Existing issues found (outside this scope, not changed)

- **High.** The existing Teacher Management page (`foundation-spa/src/features/teacher-management/lib/teacherManagement.js`, `performAction`) writes `teachers` directly from the browser. "Approve" sets `status = 'ACTIVE'` and `active = true`, and "Reject" and "Suspend" write the same table. This bypasses the approval hold and conflicts with the brief's rule against browser writes to `teachers`. Recommend P1 or the owner review it before any pilot. Not changed here.
- Modal title font renders as the system default on the review dialog. This comes from shared modal CSS, not this feature. Not changed.

## 10. Remaining blockers

1. PR #22 is still a draft and not deployed. The review screen cannot run without it.
2. P1 approval and activation contract (section 8). Approve stays held.
3. Supabase Auth: CAPTCHA protection with Turnstile, redirect allowlist, rate limits, confirmation and recovery templates. Owner-run, dashboard only.
4. Recovery-link `amr` claim verification in staging.
5. Read policies for the three panels (P1-5).
6. The existing direct-write path in Teacher Management (section 9).

## 11. GO / NO-GO

- **GO** for a draft PR, labelled "NOT READY FOR MERGE", after PR #22 is reviewed and before any deployment. The frontend builds, and tests pass with mocked backends.
- **NO-GO** for merge until: PR #22 is merged and staging-verified; the Auth settings in section 5 are confirmed; the `amr` claim is verified in staging; P1's approval contract is certified (or the Approve control stays held and the owner accepts that); and the Teacher Management direct-write path has an owner decision.
- **NO-GO** for public use until Turnstile is enabled and verified in Supabase Auth.
