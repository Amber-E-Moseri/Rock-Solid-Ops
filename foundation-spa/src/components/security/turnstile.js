// Cloudflare Turnstile for public account entry points (sign-up, confirmation resend, password reset).
// The site key is public and may ship in the bundle. The secret never does: Supabase Auth verifies each
// token server-side once CAPTCHA protection is enabled in the Auth settings with the Turnstile secret.
// A widget on this page is not enforcement by itself.
export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// A production build keeps public account forms unavailable until a site key is configured.
// Development and test builds run without a key and send no token.
export function turnstileStatus(env = {}) {
  const siteKey = String(env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
  const configured = siteKey.length > 0;
  const production = env.PROD === true;
  return { siteKey, configured, available: configured || !production };
}

export function captchaReady(status, token) {
  if (!status.available) return false;
  return !status.configured || Boolean(token);
}

export function captchaOptions(status, token) {
  return status.configured && token ? { captchaToken: token } : {};
}

let scriptPromise = null;

export function loadTurnstile(win = globalThis.window) {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = win.document.createElement('script');
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (win.turnstile) resolve(win.turnstile);
        else reject(new Error('turnstile-unavailable'));
      };
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('turnstile-load-failed'));
      };
      win.document.head.appendChild(script);
    });
  }
  return scriptPromise;
}
