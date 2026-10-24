# Teacher onboarding UI (candidate)

Branch: `feature/teacher-onboarding-ui`, based on `origin/main` (`3ab00a2`). Local only. Not pushed.
Depends on the application API in PR #22 (`feature/teacher-onboarding-foundation`). Nothing in PR #22 is modified.

## Screens and routes

| Route | Screen | Access |
|---|---|---|
| `/auth/teacher/register` | Create account (verified-email signup) | Public. Signed-in users go to the application. |
| `/auth/teacher/check-email` | Confirmation pending, with resend and cooldown | Public |
| `/auth/teacher/confirm` | Confirmation result (ok, expired, invalid) | Public. Callback tokens are removed from the URL first. |
| `/auth/teacher/application` | Applicant status and application form | Signed-in applicants. Other roles are refused without data calls. |
| `/auth/forgot-password` | Request a reset link | Public |
| `/auth/reset-password` | Set a new password (replaces the existing element) | Only after a recovery callback, or a recovery-method session |

Application states: apply, pending (SUBMITTED), information requested (INFO_REQUESTED, with the applicant-visible message), rejected (generic copy, no reason), approved and awaiting activation (APPROVED), withdrawn (apply again).

## Security behaviour

- Signup sends only `full_name` as metadata. No role, status or approval field is sent. Accounts start as `pending` through the existing profile trigger.
- Signup, resend and reset responses are the same for registered and unregistered addresses. Rate limits and system failures get their own generic copy and never reveal an address.
- Email redirects use an allowlist (`/auth/reset-password`, `/auth/teacher/confirm`) on an https origin, or localhost in development. `VITE_PUBLIC_APP_URL` can pin the origin.
- Callback tokens and codes are removed from the address bar before any network call. Expired and invalid callbacks are classified before any session is used.
- Applicant reads go only through `teacher_applications_applicant`. The base table is never queried. Rejection reasons and reviewer fields are never selected.
- Writes go only through `submit_teacher_application`, `withdraw_teacher_application`. No direct inserts to `teachers`. No role or approval change.
- Server error text is never shown. Only known codes map to copy; anything else becomes generic copy.
- A failed profile check shows an error state, not the applicant form.

## Integration with Agent 1 (exact steps; these files are not edited on this branch)

1. **`src/App.jsx`** (PR #20 touches this file). Add:
   - Import: `import { teacherOnboardingRoutes, ResetPasswordPage as OnboardingResetPasswordPage } from './features/teacher-onboarding/routes.jsx';`
   - Replace `<Route path="/auth/reset-password" element={<ResetPasswordPage />} />` with `element={<OnboardingResetPasswordPage />}`.
   - Insert `{teacherOnboardingRoutes}` immediately before `<Route path="/auth/*" element={<Navigate to="/auth/login" replace />} />`.
   - Verified: this exact edit builds (`vite build`), then was reverted; the branch leaves App.jsx untouched.
2. **`src/features/auth/LoginPage.jsx`** (PR #20 touches this file). Replace the inline "Forgot password?" request with a link to `/auth/forgot-password`. Add a "Apply to teach" link to `/auth/teacher/register`. The existing inline flow still works with the new reset page, but it does not add the hardening.
3. **`src/context/AuthContext.jsx`** (PR #20 touches this file). **Blocking.** `normalizeProfileRecord` falls back to `user_metadata.role` and `app_metadata.role`. Users can write `user_metadata`. Remove that fallback so the role comes only from the `profiles` row, otherwise the signup path is a privilege-escalation route if a profile read fails.
4. **Post-login routing** (`postLoginPath.js` in PR #20). Pending accounts with no portal role should land on `/auth/teacher/application`, not on a portal route.
5. **Release holds** (`releaseHolds.js`, PR #20). Not touched. The three flags stay as they are.

## Backend and Auth settings required before any real use

- **PR #22 deployed**, including `teacher_applications`, both views, and the three functions. The UI does not work without them.
- **Fellowship reads:** `fellowship_map` needs an `authenticated` read policy for `active = true` rows. Drift inventory row 28 lists this policy as absent in production. Without it the application form shows "fellowships unavailable" and cannot submit.
- **Confirm email: enabled.** Site URL set to the app origin.
- **Redirect allow-list** contains exactly `https://<app>/auth/teacher/confirm` and `https://<app>/auth/reset-password` (plus localhost for development).
- **Confirmation and recovery templates** use the `{{ .ConfirmationURL }}` link, and copy that makes no account or role claim.
- **Password policy:** minimum 8 characters, to match the UI.
- **Auth rate limits** set for signup, resend and recovery.
- **Recovery sessions** must carry the `recovery` method in their `amr` claim. The reset page depends on this when a session arrives without a callback in the URL. Verify in staging with a real recovery link.
- **Turnstile is not provisioned.** Signup, resend and recovery are open to automated abuse until a captcha is added to Auth and the UI. This is a launch blocker for public use.
- **Email delivery** goes through the existing outbox and `email-sender`, which is covered by the foundation work.

## Tests and build (this branch, local)

- `npx vitest run`: 28 files, **232 of 232 pass**. That is the 154 existing tests plus 78 new ones.
  - `teacherOnboardingLib.test.js` (25): redirect allowlist, callback parsing, URL clearing, token-type checks, recovery-session detection, validation, error copy, applicant view states.
  - `teacherOnboardingRegistration.test.jsx` (14): validation, double-submit guard, signup payload (no role), allowlisted redirect, existing-address response, weak-password and generic errors, signed-in redirect, resend cooldown and rate limit, PKCE exchange once under StrictMode, expired and recovery-type callbacks.
  - `teacherOnboardingPasswords.test.jsx` (13): forgot-password redirect and generic responses, system-error copy, reset states (missing, signed-in-only session refused, expired, ready), validation, token removal, single-submit guard, safe failure copy.
  - `teacherOnboardingApplication.test.jsx` (17): applicant-only access, applicant view only (never the base table), error state on profile failure, every status state, rejection reason never shown, submit parameters, double-submit guard, server-code mapping, withdraw with confirmation and version.
  - `teacherOnboardingRoutes.test.jsx` (9): routes mount, paths stay outside `/teacher` and `/staff`, redirects allowlisted, responsive CSS rules, no hard-coded colours.
- `npx vite build`: **passes**. The new files are only reachable after integration, so the build check was repeated with the integration applied and then reverted (see integration step 1).
- Mobile layout (Playwright, Chromium, temporary harness, removed afterwards): all six screens at 320, 390 and 1280 px show **no horizontal overflow**, the card stays within the viewport, phone inputs are 16px, and there are no page errors. The registration screen was reviewed visually at 390 and 1280 px; the other screens were checked by measurement only.

## Not covered

- No run against a real Supabase Auth project. Email delivery, confirmation and recovery flows are tested with mocks only.
- No real emails sent. No staging or production contact.
- Reviewer UI (approve, reject, request information) is out of scope. Approval and linking are not implemented.
- The old `ResetPasswordPage` file on `main` is left in place. App.jsx stops using it once integration step 1 is applied.

## GO / NO-GO

- **GO** for a draft UI PR, marked "NOT READY FOR MERGE", after PR #22 is deployed to staging and the Auth settings above are confirmed there.
- **NO-GO** for merge until: integration with PR #20 is done, the AuthContext metadata-role fallback is removed (step 3), the fellowship read policy is confirmed, and a real recovery session has been tested in staging.
- **NO-GO** for public use until Turnstile is provisioned on signup, resend and recovery.
