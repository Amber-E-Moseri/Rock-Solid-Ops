import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Fake Supabase client shaped like @supabase/auth-js: signInWithPassword awaits
// every onAuthStateChange subscriber before it resolves, and profile queries can
// be held open by the test to simulate a slow profile fetch.
const harness = vi.hoisted(() => {
  const h = {
    accounts: {},
    session: null,
    listeners: new Set(),
    profileGate: null,
    profileError: null,
    profileCalls: 0,
  };
  h.notify = async (event, session) => {
    await Promise.all([...h.listeners].map((cb) => cb(event, session)));
  };
  h.supabase = {
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: (cb) => {
        h.listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => h.listeners.delete(cb) } } };
      },
      signInWithPassword: async ({ email, password }) => {
        const acct = h.accounts[email];
        if (!acct || acct.password !== password) {
          return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        }
        h.session = { user: acct.user, access_token: 'token' };
        await h.notify('SIGNED_IN', h.session);
        return { data: { user: acct.user, session: h.session }, error: null };
      },
      signOut: async () => {
        h.session = null;
        await h.notify('SIGNED_OUT', null);
        return { error: null };
      },
      resetPasswordForEmail: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: (_column, userId) => ({
          maybeSingle: async () => {
            h.profileCalls += 1;
            if (h.profileGate) await h.profileGate;
            if (h.profileError) return { data: null, error: h.profileError };
            const acct = Object.values(h.accounts).find((a) => a.user.id === userId);
            return { data: acct ? acct.profile : null, error: null };
          },
        }),
      }),
    }),
  };
  return h;
});

vi.mock('../supabase.js', () => ({ supabase: harness.supabase }));

import { AuthProvider, useAuth } from '../context/AuthContext.jsx';
import ProtectedRoute from '../components/layout/ProtectedRoute.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';

const ADMIN_ROLES = ['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal'];

const ADMIN = {
  password: 'admin-pass',
  user: { id: 'uid-admin', email: 'admin@rso.test', user_metadata: {}, app_metadata: {} },
  profile: { user_id: 'uid-admin', email: 'admin@rso.test', full_name: 'Admin', role: 'admin', is_active: true },
};

const TEACHER = {
  password: 'teacher-pass',
  user: { id: 'uid-teacher', email: 'teacher@rso.test', user_metadata: {}, app_metadata: {} },
  profile: { user_id: 'uid-teacher', email: 'teacher@rso.test', full_name: 'Teacher', role: 'teacher', is_active: true },
};

let visited = [];

function LocationProbe() {
  const location = useLocation();
  const path = location.pathname;
  if (visited[visited.length - 1] !== path) visited.push(path);
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function SignOutButton() {
  const { signOut } = useAuth();
  return <button type="button" onClick={() => signOut()}>Sign out</button>;
}

function renderApp(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <LocationProbe />
        <SignOutButton />
        <Routes>
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/auth/reset-password" element={<div>Reset page</div>} />
          <Route
            path="/staff/dashboards"
            element={<ProtectedRoute roles={ADMIN_ROLES}><div>Admin dashboard</div></ProtectedRoute>}
          />
          <Route
            path="/teacher/index"
            element={<ProtectedRoute roles={['teacher']}><div>Teacher portal</div></ProtectedRoute>}
          />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function submitLogin(email, password) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

// Holds profile queries open until release() is called.
function holdProfile() {
  let release;
  harness.profileGate = new Promise((resolve) => { release = resolve; });
  return () => release();
}

describe('first-login race', () => {
  beforeEach(() => {
    sessionStorage.clear();
    harness.accounts = { [ADMIN.user.email]: ADMIN, [TEACHER.user.email]: TEACHER };
    harness.session = null;
    harness.listeners = new Set();
    harness.profileGate = null;
    harness.profileError = null;
    harness.profileCalls = 0;
    visited = [];
  });

  it('admin lands on the dashboard on the first attempt when the profile loads late', async () => {
    renderApp('/auth/login?next=%2Fstaff%2Fdashboards');
    const release = holdProfile();

    await submitLogin(ADMIN.user.email, ADMIN.password);
    await new Promise((r) => setTimeout(r, 30));
    release();

    await waitFor(() => expect(screen.getByText('Admin dashboard')).toBeInTheDocument(), { timeout: 2000 });
    expect(visited).toEqual(['/auth/login', '/staff/dashboards']);
  });

  it('teacher lands in the teacher portal on the first attempt when the profile loads late', async () => {
    renderApp('/auth/login?next=%2Fteacher%2Findex');
    const release = holdProfile();

    await submitLogin(TEACHER.user.email, TEACHER.password);
    await new Promise((r) => setTimeout(r, 30));
    release();

    await waitFor(() => expect(screen.getByText('Teacher portal')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('a single sign-in loads the profile once', async () => {
    renderApp('/auth/login?next=%2Fstaff%2Fdashboards');

    await submitLogin(ADMIN.user.email, ADMIN.password);
    await waitFor(() => expect(screen.getByText('Admin dashboard')).toBeInTheDocument(), { timeout: 2000 });

    expect(harness.profileCalls).toBe(1);
  });

  it('a teacher denied an admin route is sent to login with an unauthorized message (restored session)', async () => {
    harness.session = { user: TEACHER.user, access_token: 'token' };
    renderApp('/staff/dashboards');

    await waitFor(() => {
      expect(screen.getByText('You do not have permission to access that page.')).toBeInTheDocument();
    }, { timeout: 2000 });
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('a failed profile fetch shows an explicit message instead of a silent login form', async () => {
    harness.profileError = { message: 'network unreachable' };
    renderApp('/auth/login?next=%2Fstaff%2Fdashboards');

    await submitLogin(ADMIN.user.email, ADMIN.password);

    await waitFor(() => {
      expect(screen.getByText('We could not load your account. Please sign in again.')).toBeInTheDocument();
    }, { timeout: 2000 });
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('a teacher who signs in and targets an admin route gets the unauthorized message on the first attempt', async () => {
    renderApp('/auth/login?next=%2Fstaff%2Fdashboards');
    const release = holdProfile();

    await submitLogin(TEACHER.user.email, TEACHER.password);
    await new Promise((r) => setTimeout(r, 30));
    release();

    await waitFor(() => {
      expect(screen.getByText('You do not have permission to access that page.')).toBeInTheDocument();
    }, { timeout: 2000 });
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
    expect(visited).toEqual(['/auth/login', '/staff/dashboards', '/auth/login']);
  });

  it('a profile failure on a restored session sends the user to login once with the session message', async () => {
    harness.session = { user: ADMIN.user, access_token: 'token' };
    harness.profileError = { message: 'network unreachable' };
    renderApp('/staff/dashboards');

    await waitFor(() => {
      expect(screen.getByText('We could not load your account. Please sign in again.')).toBeInTheDocument();
    }, { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
    expect(visited).toEqual(['/staff/dashboards', '/auth/login']);
  });

  it('a restored session after refresh loads the dashboard without bouncing through login', async () => {
    harness.session = { user: ADMIN.user, access_token: 'token' };
    renderApp('/staff/dashboards');

    await waitFor(() => expect(screen.getByText('Admin dashboard')).toBeInTheDocument(), { timeout: 2000 });
    expect(visited).toEqual(['/staff/dashboards']);
  });

  it('sign-out returns the user to login and a protected route then stays closed', async () => {
    harness.session = { user: ADMIN.user, access_token: 'token' };
    renderApp('/staff/dashboards');
    await waitFor(() => expect(screen.getByText('Admin dashboard')).toBeInTheDocument(), { timeout: 2000 });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(), { timeout: 2000 });
    expect(harness.session).toBeNull();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('an unauthenticated deep link redirects once and does not loop', async () => {
    renderApp('/staff/dashboards');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 100));

    expect(visited).toEqual(['/staff/dashboards', '/auth/login']);
  });

  it('a wrong password keeps the user on the form with the auth error', async () => {
    renderApp('/auth/login');

    await submitLogin(ADMIN.user.email, 'wrong-password');

    await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
