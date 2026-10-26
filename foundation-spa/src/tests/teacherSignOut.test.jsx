import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Shell is rendered for a teacher. Only the auth hook is replaced; the sign-out
// path under test is Shell.handleSignOut -> useAuth().signOut -> navigate('/auth/login').
const signOut = vi.fn().mockResolvedValue(undefined);

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    profile: { role: 'teacher', full_name: 'Test Teacher', email: 'teacher@example.test' },
    signOut,
  }),
}));

vi.mock('../components/pwa/PushToggle.jsx', () => ({
  PushToggle: () => null,
}));

import Shell from '../components/layout/Shell.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTeacherShell() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/teacher/index']}>
        <Routes>
          <Route
            path="/teacher/index"
            element={<Shell pageTitle="Teacher Portal"><p>content</p></Shell>}
          />
          <Route path="/auth/login" element={<div>login page</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe('teacher sign-out', () => {
  beforeEach(() => {
    signOut.mockClear();
  });

  it('shows a Sign Out control to a teacher', () => {
    renderTeacherShell();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });

  it('signs out and returns the teacher to the login page', async () => {
    renderTeacherShell();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/auth/login'));
    expect(screen.getByText('login page')).toBeTruthy();
  });
});
