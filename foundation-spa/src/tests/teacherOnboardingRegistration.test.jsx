import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StrictMode } from 'react';
import { makeClient } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import TeacherRegisterPage from '../features/teacher-onboarding/pages/TeacherRegisterPage.jsx';
import CheckEmailPage from '../features/teacher-onboarding/pages/CheckEmailPage.jsx';
import ConfirmEmailPage from '../features/teacher-onboarding/pages/ConfirmEmailPage.jsx';

function renderAt(path, state, { strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/auth/teacher/register" element={<TeacherRegisterPage />} />
        <Route path="/auth/teacher/check-email" element={<CheckEmailPage />} />
        <Route path="/auth/teacher/confirm" element={<ConfirmEmailPage />} />
        <Route path="/auth/teacher/application" element={<p>APPLICATION PAGE</p>} />
        <Route path="/auth/login" element={<p>LOGIN PAGE</p>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function fillRegistration(user, overrides = {}) {
  const values = { fullName: 'Ada Lovelace', email: 'Ada@Example.org', password: 'longenough', confirm: 'longenough', ...overrides };
  // Sequential on purpose: concurrent typing into different fields interleaves keystrokes.
  return (async () => {
    await user.type(screen.getByLabelText(/^Full name/), values.fullName);
    await user.type(screen.getByLabelText(/^Email/), values.email);
    await user.type(screen.getByLabelText(/^Password/), values.password);
    await user.type(screen.getByLabelText(/^Confirm password/), values.confirm);
  })();
}

describe('TeacherRegisterPage', () => {
  beforeEach(() => {
    mock.client = makeClient();
    window.history.replaceState(null, '', '/auth/teacher/register');
  });

  it('shows field errors and does not call Auth when the form is invalid', async () => {
    const user = userEvent.setup();
    renderAt('/auth/teacher/register');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/Enter your full name/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid email address|Enter your email address/)).toBeInTheDocument();
    expect(mock.client.auth.signUp).not.toHaveBeenCalled();
  });

  it('sends only the name as metadata and the allowlisted confirmation redirect, with no role or status', async () => {
    const user = userEvent.setup();
    renderAt('/auth/teacher/register');
    await fillRegistration(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mock.client.auth.signUp).toHaveBeenCalledTimes(1));
    const arg = mock.client.auth.signUp.mock.calls[0][0];
    expect(arg.email).toBe('ada@example.org');
    expect(arg.options.data).toEqual({ full_name: 'Ada Lovelace' });
    expect(arg.options.emailRedirectTo).toBe(`${window.location.origin}/auth/teacher/confirm`);
    // Metadata and options carry no role, status or approval fields of any kind.
    expect(Object.keys(arg.options).sort()).toEqual(['data', 'emailRedirectTo']);
    expect(Object.keys(arg.options.data)).toEqual(['full_name']);
    expect(Object.keys(arg)).toEqual(['email', 'password', 'options']);
  });

  it('guards double submission so one click sends one request', async () => {
    const user = userEvent.setup();
    let release;
    mock.client.auth.signUp.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderAt('/auth/teacher/register');
    await fillRegistration(user);
    const button = screen.getByRole('button', { name: 'Create account' });
    await user.dblClick(button);
    expect(mock.client.auth.signUp).toHaveBeenCalledTimes(1);
    await act(async () => release({ data: { user: {}, session: null }, error: null }));
  });

  it('moves to the check-email step on success, carrying the email in router state, not the URL', async () => {
    const user = userEvent.setup();
    renderAt('/auth/teacher/register');
    await fillRegistration(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('gives an existing address the same response as a new one (no account disclosure)', async () => {
    const user = userEvent.setup();
    mock.client.auth.signUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [] }, session: null }, error: null });
    renderAt('/auth/teacher/register');
    await fillRegistration(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.queryByText(/already|exists|registered/i)).not.toBeInTheDocument();
  });

  it('shows safe copy for a weak password and generic copy for any other failure', async () => {
    const user = userEvent.setup();
    mock.client.auth.signUp.mockResolvedValueOnce({ data: null, error: { code: 'weak_password', status: 422, message: 'Password is too weak: contains common words' } });
    renderAt('/auth/teacher/register');
    await fillRegistration(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a stronger password');

    mock.client.auth.signUp.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'smtp relay mail.internal refused' } });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/smtp|internal/i);
  });

  it('sends a signed-in user to their application instead of registering again', async () => {
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    renderAt('/auth/teacher/register');
    expect(await screen.findByText('APPLICATION PAGE')).toBeInTheDocument();
  });
});

describe('CheckEmailPage', () => {
  beforeEach(() => {
    mock.client = makeClient();
    window.history.replaceState(null, '', '/auth/teacher/check-email');
  });

  it('resends a signup link to the allowlisted confirm URL and starts a cooldown', async () => {
    const user = userEvent.setup();
    renderAt('/auth/teacher/check-email', { email: 'ada@example.org' });
    await user.click(screen.getByRole('button', { name: 'Resend confirmation link' }));
    await waitFor(() => expect(mock.client.auth.resend).toHaveBeenCalledTimes(1));
    expect(mock.client.auth.resend.mock.calls[0][0]).toMatchObject({
      type: 'signup',
      email: 'ada@example.org',
      options: { emailRedirectTo: `${window.location.origin}/auth/teacher/confirm` },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/If that address is waiting/);
    expect(screen.getByRole('button', { name: /Resend available in/ })).toBeDisabled();
  });

  it('validates the address before calling Auth', async () => {
    const user = userEvent.setup();
    renderAt('/auth/teacher/check-email', {});
    await user.click(screen.getByRole('button', { name: 'Resend confirmation link' }));
    expect(await screen.findByText(/Enter your email address|valid email/)).toBeInTheDocument();
    expect(mock.client.auth.resend).not.toHaveBeenCalled();
  });

  it('reports rate limits without revealing anything about the address', async () => {
    const user = userEvent.setup();
    mock.client.auth.resend.mockResolvedValue({ data: null, error: { status: 429, message: 'over limit' } });
    renderAt('/auth/teacher/check-email', { email: 'ada@example.org' });
    await user.click(screen.getByRole('button', { name: 'Resend confirmation link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });
});

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    mock.client = makeClient();
  });

  it('exchanges a PKCE code exactly once, even under StrictMode, and removes it from the URL first', async () => {
    let searchAtExchange = null;
    mock.client.auth.exchangeCodeForSession.mockImplementation(async () => {
      searchAtExchange = window.location.search;
      return { data: { session: {} }, error: null };
    });
    window.history.replaceState(null, '', '/auth/teacher/confirm?code=one-time-code&type=signup#frag');
    renderAt('/auth/teacher/confirm', undefined, { strict: true });

    expect(await screen.findByText(/Your email address is confirmed/)).toBeInTheDocument();
    expect(mock.client.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mock.client.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(searchAtExchange).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('offers a new link for an expired confirmation', async () => {
    window.history.replaceState(null, '', '/auth/teacher/confirm#error=access_denied&error_code=otp_expired');
    renderAt('/auth/teacher/confirm');
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or has already been used/);
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/auth/teacher/check-email');
  });

  it('refuses a recovery-type token on the confirmation page', async () => {
    window.history.replaceState(null, '', '/auth/teacher/confirm?token_hash=h&type=recovery');
    renderAt('/auth/teacher/confirm');
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/);
    expect(mock.client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('treats a session already established by the client as confirmed', async () => {
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    window.history.replaceState(null, '', '/auth/teacher/confirm');
    renderAt('/auth/teacher/confirm');
    expect(await screen.findByText(/Your email address is confirmed/)).toBeInTheDocument();
  });
});
