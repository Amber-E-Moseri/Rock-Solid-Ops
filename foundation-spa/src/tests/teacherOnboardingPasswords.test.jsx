import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { makeClient, jwtWithAmr } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import ForgotPasswordPage from '../features/teacher-onboarding/pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from '../features/teacher-onboarding/pages/ResetPasswordPage.jsx';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/login" element={<p>LOGIN PAGE</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    mock.client = makeClient();
  });

  it('validates the address before calling Auth', async () => {
    const user = userEvent.setup();
    renderAt('/auth/forgot-password');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/Enter your email address/)).toBeInTheDocument();
    expect(mock.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('requests a reset with an absolute allowlisted redirect', async () => {
    const user = userEvent.setup();
    renderAt('/auth/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'Ada@Example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1));
    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledWith('ada@example.org', {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
  });

  it('gives the same response for a registered and an unregistered address', async () => {
    const user = userEvent.setup();
    renderAt('/auth/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'nobody@example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    const unknown = await screen.findByRole('status');
    const unknownText = unknown.textContent;
    expect(unknownText).toMatch(/If an account exists/);
    expect(screen.queryByText(/not found|no account|unknown/i)).not.toBeInTheDocument();
    expect(unknownText.length).toBeGreaterThan(0);
  });

  it('keeps system failures generic and does not claim the email was sent', async () => {
    const user = userEvent.setup();
    mock.client.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 500, message: 'SMTP relay unreachable at 10.0.0.4' } });
    renderAt('/auth/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/10\.0\.0\.4|SMTP/);
    expect(screen.queryByText(/If an account exists/)).not.toBeInTheDocument();
  });

  it('shows rate-limit copy and starts a cooldown on the button', async () => {
    const user = userEvent.setup();
    mock.client.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 429, message: 'rate' } });
    renderAt('/auth/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(screen.getByRole('button', { name: /Send again in/ })).toBeDisabled();
  });
});

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mock.client = makeClient();
    window.history.replaceState(null, '', '/auth/reset-password');
  });

  it('offers no form and a new-link path when there is no recovery link or session', async () => {
    renderAt('/auth/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/auth/forgot-password');
  });

  it('does not treat an ordinary signed-in session as proof of a recovery link', async () => {
    mock.client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: jwtWithAmr(['password']), user: { id: 'u1' } } },
      error: null,
    });
    renderAt('/auth/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('shows the expired state for an expired recovery link and removes the fragment', async () => {
    window.history.replaceState(null, '', '/auth/reset-password#error=access_denied&error_code=otp_expired');
    renderAt('/auth/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or has already been used/);
    expect(window.location.hash).toBe('');
  });

  it('offers the form after a valid recovery exchange, with the token removed from the address bar', async () => {
    window.history.replaceState(null, '', '/auth/reset-password?code=one-time&type=recovery');
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: jwtWithAmr(['recovery']) } }, error: null });
    renderAt('/auth/reset-password');
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    expect(mock.client.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time');
    expect(window.location.search).toBe('');
  });

  it('validates length and confirmation before calling updateUser', async () => {
    const user = userEvent.setup();
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: jwtWithAmr(['recovery']) } }, error: null });
    renderAt('/auth/reset-password');
    await screen.findByLabelText('New password');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password, ends the recovery session locally, and asks the user to sign in again', async () => {
    const user = userEvent.setup();
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: jwtWithAmr(['recovery']) } }, error: null });
    renderAt('/auth/reset-password');
    await screen.findByLabelText('New password');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/Your password has been updated/)).toBeInTheDocument();
    expect(mock.client.auth.updateUser).toHaveBeenCalledWith({ password: 'brand-new-pass' });
    expect(mock.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('shows a safe message when the password update fails, without echoing server text', async () => {
    const user = userEvent.setup();
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: jwtWithAmr(['recovery']) } }, error: null });
    mock.client.auth.updateUser.mockResolvedValue({ data: null, error: { status: 500, message: 'db timeout at pg-primary' } });
    renderAt('/auth/reset-password');
    await screen.findByLabelText('New password');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Request a new link');
    expect(alert).not.toHaveTextContent(/pg-primary|timeout/);
  });

  it('guards double submission of the password update', async () => {
    const user = userEvent.setup();
    let release;
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: jwtWithAmr(['recovery']) } }, error: null });
    mock.client.auth.updateUser.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderAt('/auth/reset-password');
    await screen.findByLabelText('New password');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-pass');
    const submit = screen.getByRole('button', { name: 'Update password' });
    await user.dblClick(submit);
    expect(mock.client.auth.updateUser).toHaveBeenCalledTimes(1);
    await act(async () => release({ data: {}, error: null }));
  });
});
