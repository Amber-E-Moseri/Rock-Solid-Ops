// Development-only switches. Every helper returns the disabled value unless
// the build is a development build (import.meta.env.DEV). Production builds
// therefore cannot enable the role bypass, the synthetic fixture client or the
// showcase route, whatever the environment variables say.
//
// The functions take the env object as an argument so they can be unit-tested
// with a production-shaped environment.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname || ''));
}

// Role bypass: dev build + explicit opt-in + local host + not under tests.
export function resolveDevBypassRole(env, hostname) {
  if (!env || !env.DEV) return '';
  if (env.MODE === 'test') return '';
  if (String(env.VITE_ENABLE_DEV_BYPASS || '').trim() !== 'true') return '';
  if (!isLocalHost(hostname)) return '';
  return String(env.VITE_BYPASS_ROLE || '').trim().toLowerCase();
}

// Synthetic fixture client: dev build + explicit opt-in + local host.
export function resolveFixturesEnabled(env, hostname) {
  if (!env || !env.DEV) return false;
  if (env.MODE === 'test') return false;
  if (String(env.VITE_PREVIEW_FIXTURES || '').trim() !== 'true') return false;
  return isLocalHost(hostname);
}

// Build-time alias decision for vite.config.js. Only the dev server
// (command === 'serve') may swap the Supabase module, and only when the
// fixture opt-in is set. Builds never get an alias.
export function resolveFixtureAlias({ command, env }) {
  if (command !== 'serve') return null;
  if (String(env?.VITE_PREVIEW_FIXTURES || '').trim() !== 'true') return null;
  return 'fixtures';
}
