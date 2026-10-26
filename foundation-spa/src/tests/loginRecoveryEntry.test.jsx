import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { makeClient } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: null, profile: null, loading: false, error: null }),
}));

import LoginPage from '../features/auth/LoginPage.jsx';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/auth/login']}>
      <Routes>
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/forgot-password" element={<p>PROTECTED RESET SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('login recovery entry point', () => {
  beforeEach(() => {
    mock.client = makeClient();
  });

  it('sends "Forgot password?" to the protected reset screen without calling Auth', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/email/i), 'ada@example.org');
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(await screen.findByText('PROTECTED RESET SCREEN')).toBeInTheDocument();
    expect(mock.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('never calls the unprotected reset request from the login page, however often it is used', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await screen.findByText('PROTECTED RESET SCREEN');
    expect(mock.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('keeps the unprotected request out of the login source', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/auth/LoginPage.jsx'), 'utf8');
    expect(source).not.toMatch(/resetPasswordForEmail/);
    expect(source).not.toMatch(/handleForgotPassword/);
    expect(source).toMatch(/navigate\('\/auth\/forgot-password'\)/);
  });
});
