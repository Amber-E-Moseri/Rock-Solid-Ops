import { landingPathForRole, TEACHER_LANDING, STAFF_LANDING } from '../../routing/routeRoles.js';

// Characters that must never appear in a redirect target: C0 controls, space,
// DEL and backslash. Browsers strip tabs and newlines inside URLs and treat a
// backslash like a slash, so "/\t/host" and "/\/host" would otherwise become
// protocol-relative redirects.
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f\\]/;
const APP_ORIGIN = 'https://app.invalid';

// Returns `raw` when it is a same-origin, app-local path, otherwise null. Both
// the raw value and one percent-decoded copy are checked, so encoded bypasses
// such as "%2F%2Fhost", "%5C" and "%09" are rejected.
export function safeNextPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (UNSAFE.test(raw)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (UNSAFE.test(decoded)) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || decoded.startsWith('//')) return null;
  let url;
  try {
    url = new URL(raw, APP_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== APP_ORIGIN) return null;
  return raw;
}

// Where a user lands after a successful sign-in. A valid `next` is followed for any
// role, and ProtectedRoute decides whether that role may open it, so a teacher
// who targets a staff route gets the unauthorized notice. With no usable `next`,
// teachers land on their portal and everyone else on their role landing. Roles
// with no landing fall back to the staff dashboard, where ProtectedRoute shows the
// pending, inactive or unauthorized notice.
export const TEACHER_APPLICATION_PATH = '/auth/teacher/application';

// `teacherOnboardingEnabled` is the release gate. While it is off, pending accounts keep the
// existing behaviour: they reach the staff landing, and ProtectedRoute shows the pending notice.
export function postLoginPath({ role, next, teacherOnboardingEnabled = false }) {
  const canonical = String(role ?? '').trim().toLowerCase();
  // A pending account is an applicant. When onboarding is released it belongs on its application,
  // whatever `next` says, so it never bounces off a portal route.
  if (canonical === 'pending' && teacherOnboardingEnabled) return TEACHER_APPLICATION_PATH;
  const safe = safeNextPath(next);
  if (safe) return safe;
  if (canonical === 'teacher') return TEACHER_LANDING;
  return landingPathForRole(canonical) ?? STAFF_LANDING;
}
