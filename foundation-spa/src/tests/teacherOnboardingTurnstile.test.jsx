import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { makeClient } from './teacherOnboardingHarness.js';
import {
  captchaOptions,
  captchaReady,
  turnstileStatus,
  TURNSTILE_SCRIPT_SRC,
} from '../components/security/turnstile.js';
import TurnstileField from '../components/security/TurnstileField.jsx';
import { VERIFICATION_UNAVAILABLE, authErrorMessage, VERIFICATION_FAILED } from '../features/teacher-onboarding/lib/messages.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import TeacherRegisterPage from '../features/teacher-onboarding/pages/TeacherRegisterPage.jsx';
import CheckEmailPage from '../features/teacher-onboarding/pages/CheckEmailPage.jsx';
import ForgotPasswordPage from '../features/teacher-onboarding/pages/ForgotPasswordPage.jsx';

function installTurnstile() {
  const api = { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() };
  window.turnstile = api;
  return api;
}

function callbackOf(api, name = 'callback', call = 0) {
  return api.render.mock.calls[call][1][name];
}

function cleanupTurnstile() {
  delete window.turnstile;
  document.head.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`).forEach((node) => node.remove());
}

afterEach(() => {
  cleanupTurnstile();
  vi.unstubAllEnvs();
});

describe('turnstile configuration', () => {
  it('treats a missing or blank site key as unconfigured', () => {
    expect(turnstileStatus({}).configured).toBe(false);
    expect(turnstileStatus({ VITE_TURNSTILE_SITE_KEY: '   ' }).configured).toBe(false);
    expect(turnstileStatus({ VITE_TURNSTILE_SITE_KEY: ' key-1 ' })).toMatchObject({ configured: true, siteKey: 'key-1' });
  });

  it('keeps public forms unavailable in production until a key is configured', () => {
    expect(turnstileStatus({ PROD: true }).available).toBe(false);
    expect(turnstileStatus({ PROD: true, VITE_TURNSTILE_SITE_KEY: 'key-1' }).available).toBe(true);
    expect(turnstileStatus({ PROD: false }).available).toBe(true);
  });

  it('requires a token only when a key is configured', () => {
    const dev = turnstileStatus({});
    expect(captchaReady(dev, '')).toBe(true);
    expect(captchaOptions(dev, 'tok')).toEqual({});

    const configured = turnstileStatus({ VITE_TURNSTILE_SITE_KEY: 'key-1' });
    expect(captchaReady(configured, '')).toBe(false);
    expect(captchaReady(configured, 'tok')).toBe(true);
    expect(captchaOptions(configured, 'tok')).toEqual({ captchaToken: 'tok' });

    const prodMissing = turnstileStatus({ PROD: true });
    expect(captchaReady(prodMissing, '')).toBe(false);
    expect(captchaReady(prodMissing, 'tok')).toBe(false);
  });

  it('never embeds a secret in the browser code', async () => {
    const { readFileSync } = await import('node:fs');
    const source = ['../components/security/turnstile.js', '../components/security/TurnstileField.jsx']
      .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/TURNSTILE_SECRET|secret\s*[:=]/i);
  });
});

describe('TurnstileField', () => {
  it('shows the unavailable copy and loads no script in production without a key', () => {
    render(<TurnstileField status={turnstileStatus({ PROD: true })} onToken={() => {}} unavailableText={VERIFICATION_UNAVAILABLE} />);
    expect(screen.getByRole('alert')).toHaveTextContent(VERIFICATION_UNAVAILABLE);
    expect(document.head.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)).toBeNull();
  });

  it('shows a development note without a key outside production', () => {
    render(<TurnstileField status={turnstileStatus({})} onToken={() => {}} unavailableText="x" />);
    expect(screen.getByText('Verification is not configured in this environment.')).toBeInTheDocument();
  });

  it('renders the widget, reports the token, and removes the widget on unmount', async () => {
    const api = installTurnstile();
    const onToken = vi.fn();
    const { unmount } = render(<TurnstileField status={turnstileStatus({ VITE_TURNSTILE_SITE_KEY: 'key-1' })} onToken={onToken} />);
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(api.render.mock.calls[0][1].sitekey).toBe('key-1');
    expect(onToken).toHaveBeenLastCalledWith('');

    act(() => callbackOf(api)('token-1'));
    expect(onToken).toHaveBeenLastCalledWith('token-1');
    expect(screen.getByRole('status')).toHaveTextContent('Verification complete.');

    unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('clears the token and asks for verification again when the challenge expires', async () => {
    const api = installTurnstile();
    const onToken = vi.fn();
    render(<TurnstileField status={turnstileStatus({ VITE_TURNSTILE_SITE_KEY: 'key-1' })} onToken={onToken} />);
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    act(() => callbackOf(api)('token-1'));
    act(() => callbackOf(api, 'expired-callback')());
    expect(onToken).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('status')).toHaveTextContent('Verification expired. Complete it again.');
  });

  it('offers a retry after a verification error, and renders the widget again', async () => {
    const api = installTurnstile();
    const onToken = vi.fn();
    const user = userEvent.setup();
    render(<TurnstileField status={turnstileStatus({ VITE_TURNSTILE_SITE_KEY: 'key-1' })} onToken={onToken} />);
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));

    act(() => callbackOf(api, 'error-callback')());
    expect(onToken).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('status')).toHaveTextContent('did not load or failed');

    await user.click(screen.getByRole('button', { name: 'Try verification again' }));
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  });

  it('reports a failed script load as an error with a retry, without exposing the URL or cause', async () => {
    delete window.turnstile;
    const onToken = vi.fn();
    render(<TurnstileField status={turnstileStatus({ VITE_TURNSTILE_SITE_KEY: 'key-1' })} onToken={onToken} />);
    const script = await waitFor(() => {
      const node = document.head.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
      expect(node).not.toBeNull();
      return node;
    });
    fireEvent.error(script);
    expect(await screen.findByRole('status')).toHaveTextContent('did not load or failed');
    expect(screen.getByRole('status').textContent).not.toMatch(/cloudflare|http/i);
    expect(onToken).toHaveBeenLastCalledWith('');
  });
});

describe('sign-up with verification', () => {
  beforeEach(() => {
    mock.client = makeClient();
    window.history.replaceState(null, '', '/auth/teacher/register');
  });

  it('stays disabled until verified, then sends the token with the sign-up request', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key-1');
    const api = installTurnstile();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/auth/teacher/register']}>
        <Routes>
          <Route path="/auth/teacher/register" element={<TeacherRegisterPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-1');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse-1');

    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mock.client.auth.signUp).not.toHaveBeenCalled();

    act(() => callbackOf(api)('token-signup'));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(mock.client.auth.signUp).toHaveBeenCalledTimes(1));
    const args = mock.client.auth.signUp.mock.calls[0][0];
    expect(args.options.captchaToken).toBe('token-signup');
    expect(args.options.data).toEqual({ full_name: 'Ada Lovelace' });
  });

  it('sends no captcha field when verification is not configured in development', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/auth/teacher/register']}>
        <Routes>
          <Route path="/auth/teacher/register" element={<TeacherRegisterPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-1');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mock.client.auth.signUp).toHaveBeenCalledTimes(1));
    expect(mock.client.auth.signUp.mock.calls[0][0].options).not.toHaveProperty('captchaToken');
  });

  it('blocks sign-up in production without a key, with no Auth call', async () => {
    vi.stubEnv('PROD', true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/auth/teacher/register']}>
        <Routes>
          <Route path="/auth/teacher/register" element={<TeacherRegisterPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(VERIFICATION_UNAVAILABLE);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(mock.client.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('resend and reset with verification', () => {
  beforeEach(() => {
    mock.client = makeClient();
  });

  it('resends the confirmation only with a verified token, and passes the token to Auth', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key-1');
    const api = installTurnstile();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/auth/teacher/check-email', state: { email: 'ada@example.org' } }]}>
        <Routes>
          <Route path="/auth/teacher/check-email" element={<CheckEmailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const resend = screen.getByRole('button', { name: 'Resend confirmation link' });
    expect(resend).toBeDisabled();
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    act(() => callbackOf(api)('token-resend'));
    expect(resend).toBeEnabled();
    await user.click(resend);

    await waitFor(() => expect(mock.client.auth.resend).toHaveBeenCalledTimes(1));
    const args = mock.client.auth.resend.mock.calls[0][0];
    expect(args.type).toBe('signup');
    expect(args.options.captchaToken).toBe('token-resend');
  });

  it('requests a password reset only with a verified token, and passes the token to Auth', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key-1');
    const api = installTurnstile();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/auth/forgot-password']}>
        <Routes>
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    const send = screen.getByRole('button', { name: 'Send reset link' });
    expect(send).toBeDisabled();
    act(() => callbackOf(api)('token-reset'));
    await user.click(send);

    await waitFor(() => expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1));
    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledWith('ada@example.org', {
      redirectTo: `${window.location.origin}/auth/reset-password`,
      captchaToken: 'token-reset',
    });
  });

  it('makes password reset unavailable in production without a key, with no Auth call', async () => {
    vi.stubEnv('PROD', true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/auth/forgot-password']}>
        <Routes>
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    expect(screen.getByRole('alert')).toHaveTextContent(VERIFICATION_UNAVAILABLE);
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(mock.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('Auth captcha errors', () => {
  it('maps a failed verification to retry copy and never echoes the server text', () => {
    const copy = authErrorMessage({ code: 'captcha_failed', message: 'captcha verification process failed', status: 400 });
    expect(copy).toBe(VERIFICATION_FAILED);
    expect(copy).not.toMatch(/process failed/);
  });
});
