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

// Where a user lands after a successful sign-in. Teachers always get their own
// portal, matching the static login. Everyone else gets a validated `next`, then
// their role landing. Roles with no landing fall back to the staff dashboard so
// ProtectedRoute can show the pending, inactive or unauthorized notice.
export function postLoginPath({ role, next }) {
  const canonical = String(role ?? '').trim().toLowerCase();
  if (canonical === 'teacher') return TEACHER_LANDING;
  const safe = safeNextPath(next);
  if (safe) return safe;
  return landingPathForRole(canonical) ?? STAFF_LANDING;
}
