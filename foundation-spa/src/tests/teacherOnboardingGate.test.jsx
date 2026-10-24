// Release-gate tests with the gate off (the shipped default). The public onboarding routes must not be
// reachable: unknown /auth paths fall through to the existing login catch-all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { makeClient } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import App from '../App.jsx';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('teacher onboarding gate: off (shipped default)', () => {
  beforeEach(() => {
    mock.client = makeClient();
    mock.client.auth.onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } }));
  });

  it.each([
    ['/auth/teacher/register'],
    ['/auth/teacher/check-email'],
    ['/auth/teacher/confirm'],
    ['/auth/teacher/application'],
  ])('%s is not registered and falls through to the login screen', async (path) => {
    renderAt(path);
    expect(await screen.findByText('Sign in to your account')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Apply to teach' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reset your password' })).not.toBeInTheDocument();
  });

  it('serves the protected forgot-password screen while onboarding is off, so recovery never uses the login page', async () => {
    renderAt('/auth/forgot-password');
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(screen.queryByText('Sign in to your account')).not.toBeInTheDocument();
  });

  it('keeps the login page free of onboarding entry points', async () => {
    renderAt('/auth/login');
    expect(await screen.findByText('Sign in to your account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply to teach/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('serves the hardened reset page on the existing reset path', async () => {
    renderAt('/auth/reset-password');
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/);
  });

  it('keeps the held workflows held', async () => {
    const holds = await import('../releaseHolds.js');
    expect(holds.APPROVAL_CERTIFIED).toBe(false);
    expect(holds.MOODLE_RETRY_CERTIFIED).toBe(false);
    expect(holds.ATTENDANCE_SUBMIT_CERTIFIED).toBe(false);
    expect(holds.TEACHER_ONBOARDING_CERTIFIED).toBe(false);
  });
});
