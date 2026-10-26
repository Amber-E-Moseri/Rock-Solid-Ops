// Release-gate tests with the gate on. Proves the entry points appear only when the gate is released,
// and that the existing login and reset paths keep working.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { makeClient } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));
vi.mock('../releaseHolds.js', async (importOriginal) => ({
  ...(await importOriginal()),
  TEACHER_ONBOARDING_CERTIFIED: true,
}));

import App from '../App.jsx';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('teacher onboarding gate: on', () => {
  beforeEach(() => {
    mock.client = makeClient();
    mock.client.auth.onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } }));
  });

  it('registers the registration route', async () => {
    renderAt('/auth/teacher/register');
    expect(await screen.findByRole('heading', { name: 'Apply to teach' })).toBeInTheDocument();
  });

  it('registers the forgot-password route', async () => {
    renderAt('/auth/forgot-password');
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('registers the confirmation and application routes', async () => {
    renderAt('/auth/teacher/confirm');
    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  });

  it('shows the application sign-in prompt to a signed-out visitor', async () => {
    renderAt('/auth/teacher/application');
    expect(await screen.findByText(/Sign in to view or submit/)).toBeInTheDocument();
  });

  it('adds the register entry point to the login page', async () => {
    renderAt('/auth/login');
    expect(await screen.findByRole('button', { name: 'New teacher? Apply to teach' })).toBeInTheDocument();
  });

  it('keeps the existing login route', async () => {
    renderAt('/auth/login');
    expect(await screen.findByText('Sign in to your account')).toBeInTheDocument();
  });

  it('keeps the existing login route unchanged for unknown auth paths', async () => {
    renderAt('/auth/not-a-real-page');
    expect(await screen.findByText('Sign in to your account')).toBeInTheDocument();
  });
});
