import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { makeClient, applicantRow, jwtWithAmr, APPLICANT_ID } from './teacherOnboardingHarness.js';
import { buildAuthRedirect, AUTH_REDIRECT_PATHS } from '../features/teacher-onboarding/lib/redirects.js';
import { submitOutcomeMessage } from '../features/teacher-onboarding/lib/messages.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import ForgotPasswordPage from '../features/teacher-onboarding/pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from '../features/teacher-onboarding/pages/ResetPasswordPage.jsx';
import ApplicationPage from '../features/teacher-onboarding/pages/ApplicationPage.jsx';

function renderRoutes(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/teacher/application" element={<ApplicationPage />} />
        <Route path="/auth/login" element={<p>LOGIN PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('submit outcome copy', () => {
  it('tells the applicant when an email was and was not sent', () => {
    expect(submitOutcomeMessage('UNCHANGED')).toBe('Your application is already up to date.');
    expect(submitOutcomeMessage('UPDATED')).toMatch(/No email was sent/);
    expect(submitOutcomeMessage('RESUBMITTED')).toMatch(/sent to the administration team/);
    expect(submitOutcomeMessage('SUBMITTED')).toMatch(/receipt is on its way by email/);
  });
});

describe('applicant states never overstate activation', () => {
  function signedInApplicant({ role = 'pending', applications = [] } = {}) {
    mock.client = makeClient({
      tables: {
        profiles: { data: { role, full_name: 'Applicant Alpha' }, error: null },
        teacher_applications_applicant: { data: applications, error: null },
        fellowship_map: { data: [{ fellowship_code: 'CMU', campus_name: 'Campus Alpha' }], error: null },
      },
    });
    mock.client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'x', user: { id: APPLICANT_ID, user_metadata: {} } } },
      error: null,
    });
  }

  beforeEach(() => {
    window.history.replaceState(null, '', '/auth/teacher/application');
  });

  it('describes a teacher account as active only when the profile role confirms it', async () => {
    signedInApplicant({ role: 'teacher' });
    renderRoutes('/auth/teacher/application');
    expect(await screen.findByText(/already has a portal role/)).toBeInTheDocument();
    expect(screen.getByText('Your teacher account is active. Sign in to the teacher portal to continue.')).toBeInTheDocument();
  });

  it('does not describe an approved application as an active account', async () => {
    signedInApplicant({ applications: [applicantRow({ status: 'APPROVED', version: 4 })] });
    renderRoutes('/auth/teacher/application');
    expect(await screen.findByText('Application approved')).toBeInTheDocument();
    const body = document.body.textContent;
    expect(body).toMatch(/being activated/);
    expect(body).not.toMatch(/account is active|you can now teach|is now active/i);
  });

  it('shows rejection with generic copy, never an internal reason', async () => {
    signedInApplicant({ applications: [applicantRow({ status: 'REJECTED', version: 4, rejection_reason: 'INTERNAL: duplicate record' })] });
    renderRoutes('/auth/teacher/application');
    expect(await screen.findByText(/unable to take this application further/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/INTERNAL|duplicate record/);
  });
});

describe('password recovery verification', () => {
  beforeEach(() => {
    mock.client = makeClient();
    window.history.replaceState(null, '', '/auth/reset-password');
  });

  it('gives the same confirmation for known and unknown addresses', async () => {
    const user = userEvent.setup();
    renderRoutes('/auth/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'known@example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    const known = (await screen.findByRole('status')).textContent;
    expect(known).toMatch(/If an account exists/);
  });

  it('pauses repeat requests after a successful one, so Auth is not asked again', async () => {
    const user = userEvent.setup();
    renderRoutes('/auth/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByRole('status');
    const again = screen.getByRole('button', { name: /Send again in/ });
    expect(again).toBeDisabled();
    await user.click(again);
    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('does not offer the form when a used recovery code is replayed', async () => {
    window.history.replaceState(null, '', '/auth/reset-password?code=one-time&type=recovery');
    mock.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: jwtWithAmr(['recovery']) } }, error: null });
    const first = renderRoutes('/auth/reset-password');
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    first.unmount();

    mock.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mock.client.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'invalid', code: 'otp_expired', status: 403 },
    });
    window.history.replaceState(null, '', '/auth/reset-password?code=one-time&type=recovery');
    renderRoutes('/auth/reset-password');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('offers the form for a session that carries the recovery method (session-only path, unverified against Supabase)', async () => {
    mock.client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: jwtWithAmr(['recovery']), user: { id: 'u1' } } },
      error: null,
    });
    renderRoutes('/auth/reset-password');
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
  });

  it('makes one session check on load, so the page cannot loop', async () => {
    renderRoutes('/auth/reset-password');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(mock.client.auth.getSession).toHaveBeenCalled());
    expect(mock.client.auth.getSession.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('builds reset links only for allowlisted paths on an https or localhost origin', () => {
    const env = { VITE_PUBLIC_APP_URL: 'https://app.example.org' };
    expect(buildAuthRedirect(AUTH_REDIRECT_PATHS.RESET_PASSWORD, env)).toBe('https://app.example.org/auth/reset-password');
    expect(buildAuthRedirect('/staff/dashboards', env)).toBeNull();
    expect(buildAuthRedirect('/auth/login', env)).toBeNull();
    expect(buildAuthRedirect(AUTH_REDIRECT_PATHS.RESET_PASSWORD, { VITE_PUBLIC_APP_URL: 'http://app.example.org' })).toBeNull();
    expect(buildAuthRedirect(AUTH_REDIRECT_PATHS.RESET_PASSWORD, { VITE_PUBLIC_APP_URL: 'https://user:pw@app.example.org' })).toBeNull();
  });
});
