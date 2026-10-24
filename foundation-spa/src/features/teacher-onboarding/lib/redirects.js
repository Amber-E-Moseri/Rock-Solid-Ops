// Redirect targets for Supabase Auth emails. Only these app paths may be requested as
// emailRedirectTo / redirectTo, and the origin must be https (or localhost during development).
// Every value must also be registered in the Supabase Auth redirect allow-list (see the UI doc).

export const AUTH_REDIRECT_PATHS = Object.freeze({
  RESET_PASSWORD: '/auth/reset-password',
  CONFIRM_EMAIL: '/auth/teacher/confirm',
});

const ALLOWED_PATHS = new Set(Object.values(AUTH_REDIRECT_PATHS));
const DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

// Returns the app origin to use in email links, or null when it is not safe to use.
export function resolveAppOrigin(env = {}, location = globalThis.location) {
  const configured = String(env?.VITE_PUBLIC_APP_URL || '').trim();
  const candidate = configured || location?.origin || '';
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && DEV_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password) return null;
  return url.origin;
}

// Builds an absolute redirect URL for an allowlisted auth path, or null when unsafe.
export function buildAuthRedirect(path, env = {}, location = globalThis.location) {
  if (!ALLOWED_PATHS.has(path)) return null;
  const origin = resolveAppOrigin(env, location);
  return origin ? `${origin}${path}` : null;
}

// Accepts only same-origin, absolute-path values such as "/auth/teacher/application".
// Anything else (protocol-relative, backslash tricks, control characters, absolute URLs) falls back.
export function safeInternalPath(raw, fallback = '/') {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  const base = 'https://internal.invalid';
  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
