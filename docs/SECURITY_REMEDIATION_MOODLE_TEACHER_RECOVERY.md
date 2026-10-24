# Security remediation: Moodle retry, legacy teacher activation, legacy password recovery

Branch `security/moodle-hold-teacher-activation`, based on PR #26 at `9db8a96`. Code-only. Nothing here is
deployed, migrated, or enabled. Release flags stay `false`.

## 1. Server-side Moodle retry hold (`supabase/functions/retry-worker`)

The SPA's `releaseHolds.js` only hides and disables UI. It is not an authorization control. The server now has
its own gate in `moodle-hold.ts`.

- **Certification** is read from the function environment variable `MOODLE_RETRY_CERTIFIED`. It defaults to false.
  Only the exact string `true` (surrounding whitespace ignored) lifts the hold. Do not set it outside a recorded
  certification. Nothing in this branch sets it.
- **Direct retry** of `moodle_enrollment_sync` or `moodle_sync` (the legacy alias, canonicalised first) is refused
  with HTTP 423 and code `MOODLE_RETRY_HELD`. This happens before any retry mutation or `moodle-sync` call. The
  refusal is audited (`MOODLE_RETRY_HELD`).
- **Scheduled sweep** is held in full while certification is false. It selects no rows, runs no escalation, and
  invokes no `moodle-sync`. The skipped run is audited (`RETRY_SWEEP_HELD`).
- **Resolve** and every non-Moodle retry are unchanged.
- **Unauthenticated requests** (no `Authorization` header, which the code treats as the scheduler) may only run the
  sweep. A request that names a row or an action from an unauthenticated caller is refused with HTTP 403 `ADMIN_REQUIRED`.
  Before this change, such a request skipped the admin check and could run retry or resolve on any source.

**Assumption to verify before any staging run:** the platform scheduler invokes `retry-worker` without `action` or
`id` in the request. If it sends either, the hourly sweep is refused (fails closed) and must be fixed in the
scheduler configuration, not by loosening this gate.

## 2. Legacy Teacher Management activation (`foundation/js/teacher-activation.js`)

Legacy `teacher-management.html` approved teachers by writing `teachers` and `profiles` from the browser. The
previous code wrote the teacher record first, then updated the profile with its error discarded (`non-fatal`).
An admin's refused role change therefore left the teacher `ACTIVE` with no teacher role, and the UI reported success.

- **Activation** assigns the sign-in role first, and requires that exactly one profile row changed. Only then is the
  teacher record set to `ACTIVE`. If that write fails, the previous role and active flag are restored. If the
  restore also fails, the message names the prior role and asks a superadmin to restore it.
- **No linked account, or no profile row:** activation is refused before any write.
- **Other actions** (suspend, reject, reactivate, inactivate) still write the teacher record and then the profile.
  Profile errors are reported, not dropped.
- **Admin:** the database trigger from migration `202607131600` refuses every role change by a non-superadmin. An
  admin's Approve therefore fails with that message and writes nothing. This is intended. Admin had no role-change
  authority in the migration log.
- **Superadmin:** Approve still works and still bypasses the application workflow. This remains until the P1 contract
  exists (see section 4).
- **`createTeacherDirect`** is not changed. Its server action requires the caller to be admin or superadmin
  (`create-teacher-direct.ts`). It creates a teacher account without an application. The owner must confirm that
  admin-created teachers are intended.

## 3. Legacy password recovery (`foundation/auth/login.html`)

The legacy login sent reset emails directly with `resetPasswordForEmail`. It had no CAPTCHA, and the CAPTCHA state in
Supabase Auth is not visible from the repository.

- The legacy "Forgot password?" link now goes to `/app/auth/forgot-password`, the SPA recovery page. That page calls
  Turnstile and stays unavailable in production until a site key is configured.
- The legacy page no longer calls `resetPasswordForEmail`. No legacy page does.
- Normal sign-in and the PR #21 safe-next redirect are unchanged.
- Reset links already emailed still arrive at the legacy `reset-password.html`, which is unchanged.

## 4. Dependency on the P1 approval/activation contract

The intended design is that approval and activation happen in one backend transition. That transition should set the
role, the teacher status, and the audit record atomically, and only for an authorized reviewer. No such backend action
exists yet. The only approval action (`approveAvailability`) covers availability, not teacher activation.

Until the P1 contract is built and certified:

- The legacy Approve remains, with the fail-closed ordering in section 2. It is not a substitute for the contract.
- A superadmin can still approve a teacher without an application. This is a known residual bypass.
- Do not build a new approval path from browser writes. Replace the legacy activation with the P1 transition when it exists.

## 5. Residual items and staging gates (not closed here)

1. Staging: the scheduler's request shape (section 1 assumption).
2. Staging: `MOODLE_RETRY_CERTIFIED` is unset, so the held behavior applies.
3. Staging: migrations `202607131500` and `202607131600` applied, and the function body checked.
4. Staging: a live admin Approve is refused with no teacher `ACTIVE`. A live superadmin Approve works and is audited.
5. Staging: a password-recovery request from the legacy login goes to the SPA page and no reset email is sent from
   the legacy page. Supabase Auth CAPTCHA settings are checked by the owner.
6. Owner decision: whether `createTeacherDirect` and the superadmin direct approval stay until P1.
7. Live RLS self-read and inactive-account denial, as in the staging preflight.
8. `verify_jwt` for `retry-worker`: the root `supabase/config.toml` sets `true`, and
   `supabase/functions/retry-worker/config.toml` sets `false`. The repository cannot show which one the platform
   applies. If it is `false`, the unauthenticated path in section 1 is reachable from the internet, and this
   branch's refusal is the only control. Confirm in the deployed project.
