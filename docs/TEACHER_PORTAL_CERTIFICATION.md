# Teacher portal certification — status

Branch: `fix/teacher-portal-signout` (from `origin/main` `8de0948`).
Scope: teacher portal at `foundation/teacher/index.html`.
Environment: Rock Solid Staging only (project ref `hblahcaozlttknkzvkib`). Production data and credentials were not used.

## Status by area

| Area | Status | Evidence |
|---|---|---|
| Teacher sign-in and landing | PASS (staging) | Teacher test account signs in and lands on `teacher/index.html` |
| Teacher access gate (needs active `teachers` row) | PASS | Unlinked account is refused with the "not yet linked" message; after linking, access is granted |
| Visible Sign Out control | **FIXED on this branch** | `#signOutBtn` in the header, wired to the existing `logout()` in `foundation/auth/logout.js` |
| Sign Out on desktop (browser) | PASS | Session keys cleared, profile cache cleared, redirected to login with `next` preserved; revisiting the portal redirects to login |
| Sign Out on mobile 375px (browser) | PASS | Control is on screen, 40px tall; click clears session and redirects to login |
| Session persistence across reload | PASS (staging) | Reload keeps the teacher session |
| Teacher navigation (My classes, My availability, Student progress tabs) | PASS (staging) | Tabs switch; "No classes assigned yet" and "No students found" are the correct empty states for this account |
| Server-side logout (`/auth/v1/logout`) | PASS | Returns 204 and the protected page then redirects to login |
| Regression test for UI logout | PASS | `tests/teacher-signout.test.mjs`, 5/5 |
| Deno edge-function unit tests (`scripts/test-unit.sh`) | PASS | 101 passed, 0 failed |
| SPA Vitest suite | PASS | 22 files, 148 tests |
| SPA production build | PASS | `vite build` exit 0 |
| Static publish build (allowlist) | PASS | 104 files, allowlist verified |

## Not yet certified (remaining tests)

These write records or need test data, so they stay open until run deliberately on staging:

1. **Class selection and class times.** Needs fake applicants with class options. Check triggers that enqueue email (waitlist notify, enrolment counters) before inserting data.
2. **Teacher attendance submission.** Writes attendance rows. Check the attendance write path and RLS for the teacher role.
3. **Availability submission.** Writes `teacher_availability` rows (self-service path added in the teacher-portal UX branch, not in this branch).
4. **Student progress and profile views** with a class that has students.
5. **Sign Out on the other teacher pages** (`teacher-attendance.html`, `teacher-availability.html`, `teacher-progress.html`). Only `index.html` was changed here.
6. **Staff-side views of teacher data** (teacher management, attendance reports).

## Known gaps outside this change

- The staging schema is behind this repository. `get_registrations_by_week` and `get_stale_queue_items` are missing, so some staff dashboard panels fail with HTTP 400 or 404.
- The teacher tabs strip scrolls sideways on phones. That predates this change and is not fixed here.

## Test-data cleanup procedure (staging only)

Run in this order. Never run it against the production project `xelpsttqhrcqmttmjory`.

1. Remove test attendance, availability and class-selection rows that were created for testing. Filter by the test emails or test name prefixes, and check each table's row count before and after.
2. Remove the test applicants (fake students) and their class selections.
3. Remove the test teacher row:

   ```sql
   delete from public.teachers where teacher_id = 'RSO-TEST-TEACHER';
   ```

4. Remove the test auth users in **Authentication → Users** for `rso-test-staff@example.com` and `rso-test-teacher@example.com`. Deleting the auth user also removes its profile (`profiles.user_id` cascades from `auth.users`).
5. Confirm with read-only checks: no `rso-test-%` emails in `auth.users` or `profiles`, and no `RSO-TEST-TEACHER` row in `teachers`.

The staging pre-existing accounts (`staging-*@test.local`) are not part of this cleanup.
