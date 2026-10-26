// Reads an Auth email callback (confirmation or recovery) from the address bar and turns it into a
// session. Tokens and codes are removed from the URL before any network call, so they stay out of
// history, screenshots and shared links.

const EXPIRED_CODES = new Set(['otp_expired', 'token_expired']);

export function readAuthCallback(location = globalThis.location) {
  const hash = new URLSearchParams(String(location?.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(String(location?.search || '').replace(/^\?/, ''));

  const errorCode = hash.get('error_code') ?? query.get('error_code');
  if (errorCode) {
    return { kind: EXPIRED_CODES.has(errorCode) ? 'expired' : 'invalid', type: '' };
  }
  if (hash.get('error') || query.get('error')) return { kind: 'invalid', type: '' };

  const code = query.get('code');
  if (code) return { kind: 'pkce', code, type: query.get('type') || '' };

  const tokenHash = query.get('token_hash');
  if (tokenHash) return { kind: 'token_hash', tokenHash, type: query.get('type') || '' };

  if (hash.get('access_token')) return { kind: 'implicit', type: hash.get('type') || '' };

  return { kind: 'none', type: '' };
}

// Removes every query and fragment parameter from the address bar, keeping only the path.
export function clearAuthParams(win = globalThis.window) {
  if (!win?.history || !win.location) return;
  win.history.replaceState(null, '', win.location.pathname);
}

// Resolves a callback to 'ok' | 'expired' | 'invalid' | 'none'. `allowedTypes` limits which Auth
// email types may be consumed here, so a recovery link cannot confirm a signup and vice versa.
export async function consumeAuthCallback(client, link, allowedTypes) {
  switch (link.kind) {
    case 'pkce': {
      const { error } = await client.auth.exchangeCodeForSession(link.code);
      return error ? 'expired' : 'ok';
    }
    case 'token_hash': {
      if (!allowedTypes.includes(link.type)) return 'invalid';
      const { error } = await client.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash });
      return error ? 'expired' : 'ok';
    }
    case 'implicit': {
      // supabase-js consumes implicit-flow tokens from the fragment itself during client start-up.
      if (!allowedTypes.includes(link.type)) return 'invalid';
      const { data } = await client.auth.getSession();
      return data?.session ? 'ok' : 'expired';
    }
    case 'expired':
      return 'expired';
    case 'invalid':
      return 'invalid';
    default:
      return 'none';
  }
}

// Decodes the (unverified) payload of an access token, for UI decisions only. The server enforces
// every privileged action itself.
export function decodeTokenPayload(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// True when a session was produced by a password-recovery link (Auth method "recovery").
export function isRecoverySession(session) {
  const payload = decodeTokenPayload(session?.access_token);
  const methods = Array.isArray(payload?.amr) ? payload.amr.map((entry) => entry?.method) : [];
  return methods.includes('recovery');
}
