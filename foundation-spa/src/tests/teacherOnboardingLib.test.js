import { describe, it, expect, vi } from 'vitest';
import { buildAuthRedirect, resolveAppOrigin, safeInternalPath, AUTH_REDIRECT_PATHS } from '../features/teacher-onboarding/lib/redirects.js';
import { readAuthCallback, clearAuthParams, consumeAuthCallback, isRecoverySession } from '../features/teacher-onboarding/lib/authCallback.js';
import { validateRegistration, validateApplication, validatePassword, validateEmail, normalizeEmail } from '../features/teacher-onboarding/lib/validation.js';
import { applicationErrorMessage, authErrorMessage, GENERIC_ERROR, isRateLimit, RATE_LIMIT } from '../features/teacher-onboarding/lib/messages.js';
import { currentApplicationView } from '../features/teacher-onboarding/lib/applicationApi.js';
import { jwtWithAmr } from './teacherOnboardingHarness.js';

describe('safeInternalPath', () => {
  it('accepts same-origin absolute paths', () => {
    expect(safeInternalPath('/auth/teacher/application')).toBe('/auth/teacher/application');
    expect(safeInternalPath('/auth/login?x=1#top')).toBe('/auth/login?x=1#top');
  });

  it('rejects protocol-relative, absolute, backslash and control-character targets', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/a\u0000b', 'relative', '', null, 42]) {
      expect(safeInternalPath(bad, '/fallback')).toBe('/fallback');
    }
  });
});

describe('redirect origin and allowlist', () => {
  it('uses the configured https origin when set', () => {
    expect(resolveAppOrigin({ VITE_PUBLIC_APP_URL: 'https://app.example.org/' }, { origin: 'https://other.example' })).toBe('https://app.example.org');
  });

  it('allows http only for localhost', () => {
    expect(resolveAppOrigin({}, { origin: 'http://localhost:5174' })).toBe('http://localhost:5174');
    expect(resolveAppOrigin({}, { origin: 'http://staff.example.org' })).toBeNull();
  });

  it('refuses origins with credentials or malformed values', () => {
    expect(resolveAppOrigin({ VITE_PUBLIC_APP_URL: 'https://user:pw@app.example.org' })).toBeNull();
    expect(resolveAppOrigin({ VITE_PUBLIC_APP_URL: 'not a url' })).toBeNull();
  });

  it('builds redirects only for allowlisted paths', () => {
    const env = { VITE_PUBLIC_APP_URL: 'https://app.example.org' };
    expect(buildAuthRedirect(AUTH_REDIRECT_PATHS.RESET_PASSWORD, env)).toBe('https://app.example.org/auth/reset-password');
    expect(buildAuthRedirect(AUTH_REDIRECT_PATHS.CONFIRM_EMAIL, env)).toBe('https://app.example.org/auth/teacher/confirm');
    expect(buildAuthRedirect('/teacher/attendance', env)).toBeNull();
    expect(buildAuthRedirect('/auth/reset-password/../../staff', env)).toBeNull();
  });
});

describe('readAuthCallback', () => {
  it('reads a PKCE code', () => {
    expect(readAuthCallback({ search: '?code=abc&type=signup', hash: '' })).toEqual({ kind: 'pkce', code: 'abc', type: 'signup' });
  });

  it('reads a token hash and its type', () => {
    expect(readAuthCallback({ search: '?token_hash=th&type=recovery', hash: '' })).toEqual({ kind: 'token_hash', tokenHash: 'th', type: 'recovery' });
  });

  it('classifies expired and invalid error callbacks', () => {
    expect(readAuthCallback({ search: '', hash: '#error=access_denied&error_code=otp_expired' }).kind).toBe('expired');
    expect(readAuthCallback({ search: '', hash: '#error=access_denied&error_code=bad' }).kind).toBe('invalid');
    expect(readAuthCallback({ search: '?error=server_error', hash: '' }).kind).toBe('invalid');
  });

  it('reads implicit-flow tokens and returns none for a plain page', () => {
    expect(readAuthCallback({ search: '', hash: '#access_token=t&type=recovery' })).toEqual({ kind: 'implicit', type: 'recovery' });
    expect(readAuthCallback({ search: '', hash: '' })).toEqual({ kind: 'none', type: '' });
  });
});

describe('clearAuthParams', () => {
  it('removes every query and fragment parameter from the address bar', () => {
    window.history.replaceState(null, '', '/auth/reset-password?code=secret&type=recovery#access_token=t');
    clearAuthParams(window);
    expect(window.location.pathname).toBe('/auth/reset-password');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});

describe('consumeAuthCallback', () => {
  it('refuses a recovery token for a signup link (type mismatch)', async () => {
    const client = { auth: { verifyOtp: vi.fn() } };
    const outcome = await consumeAuthCallback(client, { kind: 'token_hash', tokenHash: 'h', type: 'recovery' }, ['signup', 'email']);
    expect(outcome).toBe('invalid');
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('maps exchange failures to expired', async () => {
    const client = { auth: { exchangeCodeForSession: vi.fn(async () => ({ error: new Error('bad') })) } };
    expect(await consumeAuthCallback(client, { kind: 'pkce', code: 'c' }, ['recovery'])).toBe('expired');
  });

  it('returns none when there is nothing to consume', async () => {
    expect(await consumeAuthCallback({ auth: {} }, { kind: 'none' }, ['recovery'])).toBe('none');
  });
});

describe('isRecoverySession', () => {
  it('is true only for a recovery amr method', () => {
    expect(isRecoverySession({ access_token: jwtWithAmr(['recovery']) })).toBe(true);
    expect(isRecoverySession({ access_token: jwtWithAmr(['password']) })).toBe(false);
    expect(isRecoverySession({ access_token: 'not-a-jwt' })).toBe(false);
    expect(isRecoverySession(null)).toBe(false);
  });
});

describe('validation', () => {
  it('normalizes email', () => {
    expect(normalizeEmail('  Ada@Example.ORG ')).toBe('ada@example.org');
  });

  it('validates email shape', () => {
    expect(validateEmail('')).toMatch(/Enter your email/);
    expect(validateEmail('no-at-sign')).toMatch(/valid email/);
    expect(validateEmail('ok@example.org')).toBeNull();
  });

  it('enforces password length and confirmation', () => {
    expect(validatePassword('short', 'short')).toMatch(/at least 8/);
    expect(validatePassword('longenough', 'different')).toMatch(/do not match/);
    expect(validatePassword('x'.repeat(73), 'x'.repeat(73))).toMatch(/no more than 72/);
    expect(validatePassword('longenough', 'longenough')).toBeNull();
  });

  it('validates registration fields together', () => {
    expect(validateRegistration({ fullName: 'A', email: 'bad', password: 'short', confirm: 'short' })).toEqual({
      fullName: expect.any(String),
      email: expect.any(String),
      password: expect.any(String),
    });
    expect(validateRegistration({ fullName: 'Ada Lovelace', email: 'ada@example.org', password: 'longenough', confirm: 'longenough' })).toEqual({});
  });

  it('validates application fields to the server limits', () => {
    expect(validateApplication({ fullName: 'Ada', phone: '1'.repeat(33), fellowshipCode: '', notes: '' })).toEqual({
      phone: expect.any(String),
      fellowshipCode: expect.any(String),
    });
    expect(validateApplication({ fullName: 'Ada', phone: '', fellowshipCode: 'CMU', notes: 'n'.repeat(1001) })).toEqual({
      notes: expect.any(String),
    });
  });
});

describe('error copy', () => {
  it('maps known application codes to safe copy', () => {
    expect(applicationErrorMessage({ message: 'EMAIL_NOT_VERIFIED: confirm your email address before applying' })).toMatch(/Confirm your email/);
    expect(applicationErrorMessage({ message: 'VERSION_CONFLICT: the application changed. Reload and try again' })).toMatch(/changed elsewhere/);
  });

  it('never echoes unknown server text', () => {
    expect(applicationErrorMessage({ message: 'duplicate key value violates unique constraint "uq_secret"' })).toBe(GENERIC_ERROR);
  });

  it('detects rate limits and keeps other auth errors generic', () => {
    expect(isRateLimit({ status: 429 })).toBe(true);
    expect(authErrorMessage({ status: 429 })).toBe(RATE_LIMIT);
    expect(authErrorMessage({ status: 500, message: 'SMTP failure at mail.internal' })).toBe(GENERIC_ERROR);
    expect(authErrorMessage({ code: 'weak_password' })).toMatch(/stronger password/);
  });
});

describe('currentApplicationView', () => {
  it('derives the applicant state from the most recent application', () => {
    expect(currentApplicationView([]).view).toBe('apply');
    expect(currentApplicationView([{ status: 'WITHDRAWN' }]).view).toBe('apply');
    expect(currentApplicationView([{ status: 'SUBMITTED' }]).view).toBe('pending');
    expect(currentApplicationView([{ status: 'INFO_REQUESTED' }]).view).toBe('info');
    expect(currentApplicationView([{ status: 'REJECTED' }]).view).toBe('rejected');
    expect(currentApplicationView([{ status: 'APPROVED' }]).view).toBe('approved');
    expect(currentApplicationView([{ status: 'UNKNOWN' }]).view).toBe('error');
  });

  it('ignores older history rows', () => {
    expect(currentApplicationView([{ status: 'WITHDRAWN' }, { status: 'REJECTED' }]).view).toBe('apply');
  });
});
