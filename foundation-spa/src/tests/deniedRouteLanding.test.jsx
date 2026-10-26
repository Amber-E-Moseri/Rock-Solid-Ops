// A signed-in user denied a route by role goes to their authorized landing with one notice.
// Real ProtectedRoute, real toast provider and real route-role matrix. Only auth state is replaced.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const state = vi.hoisted(() => ({ auth: null }));

vi.mock('../context/AuthContext.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => state.auth };
});

import ProtectedRoute from '../components/layout/ProtectedRoute.jsx';
import { useAccessNotice, UNAUTHORIZED_MESSAGE } from '../components/layout/useAccessNotice.js';
import { ToastProvider } from '../context/ToastContext.jsx';
import { OPERATIONAL_ROLES } from '../routing/routeRoles.js';

// Stands in for Shell, which calls the same hook.
function LandingShell({ children }) {
  useAccessNotice();
  return <div>{children}</div>;
}

function LoginStub() {
  const { search } = useLocation();
  return <p>LOGIN SCREEN{search}</p>;
}

function Probe({ visited }) {
  const location = useLocation();
  if (visited[visited.length - 1] !== location.pathname) visited.push(location.pathname);
  return <div data-testid="state">{JSON.stringify({ path: location.pathname, notice: location.state?.notice ?? null })}</div>;
}

function signedInAs(role, overrides = {}) {
  state.auth = {
    user: { id: 'user-1' },
    profile: { role, is_active: true, ...overrides },
    loading: false,
    error: null,
    signOut: vi.fn(),
  };
}

function renderAt(path, visited = [], { strictTeacherLanding = false } = {}) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Probe visited={visited} />
        <Routes>
          <Route path="/auth/login" element={<LoginStub />} />
          <Route
            path="/staff/audit-log"
            element={<ProtectedRoute roles={['superadmin']}><LandingShell><p>AUDIT PAGE</p></LandingShell></ProtectedRoute>}
          />
          <Route
            path="/staff/dashboards"
            element={<ProtectedRoute roles={OPERATIONAL_ROLES}><LandingShell><p>DASHBOARD PAGE</p></LandingShell></ProtectedRoute>}
          />
          <Route
            path="/teacher/index"
            element={
              <ProtectedRoute roles={strictTeacherLanding ? ['admin'] : [...OPERATIONAL_ROLES, 'teacher']}>
                <LandingShell><p>TEACHER PAGE</p></LandingShell>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('denied route landing', () => {
  beforeEach(() => {
    state.auth = null;
  });

  it('sends an admin denied a superadmin route to the staff dashboard with one notice', async () => {
    signedInAs('admin');
    const visited = [];
    renderAt('/staff/audit-log', visited);

    expect(await screen.findByText('DASHBOARD PAGE')).toBeInTheDocument();
    expect(screen.queryByText('AUDIT PAGE')).not.toBeInTheDocument();
    expect(screen.queryByText(/LOGIN SCREEN/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(UNAUTHORIZED_MESSAGE)).toHaveLength(1));
    expect(visited).toEqual(['/staff/audit-log', '/staff/dashboards']);
    expect(state.auth.signOut).not.toHaveBeenCalled();
  });

  it('sends a teacher denied a staff route to the teacher portal with one notice', async () => {
    signedInAs('teacher');
    const visited = [];
    renderAt('/staff/dashboards', visited);

    expect(await screen.findByText('TEACHER PAGE')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD PAGE')).not.toBeInTheDocument();
    expect(screen.queryByText(/LOGIN SCREEN/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(UNAUTHORIZED_MESSAGE)).toHaveLength(1));
    expect(visited).toEqual(['/staff/dashboards', '/teacher/index']);
    expect(state.auth.signOut).not.toHaveBeenCalled();
  });

  it('clears the notice from history once it is shown, so it is not repeated', async () => {
    signedInAs('teacher');
    renderAt('/staff/dashboards');

    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent).notice).toBeNull());
    expect(JSON.parse(screen.getByTestId('state').textContent).path).toBe('/teacher/index');
    expect(screen.getAllByText(UNAUTHORIZED_MESSAGE)).toHaveLength(1);
  });

  it('does not loop when the landing route itself refuses the role', async () => {
    signedInAs('teacher');
    const visited = [];
    renderAt('/staff/dashboards', visited, { strictTeacherLanding: true });

    expect(await screen.findByText(/LOGIN SCREEN/)).toBeInTheDocument();
    expect(screen.getByText(/LOGIN SCREEN/).textContent).toContain('error=unauthorized');
    expect(visited).toEqual(['/staff/dashboards', '/teacher/index', '/auth/login']);
  });

  it('sends a signed-out visitor to sign-in with a return path and no notice', async () => {
    state.auth = { user: null, profile: null, loading: false, error: null, signOut: vi.fn() };
    renderAt('/staff/dashboards');

    expect(await screen.findByText(/LOGIN SCREEN\?next=%2Fstaff%2Fdashboards$/)).toBeInTheDocument();
    expect(screen.queryByText(UNAUTHORIZED_MESSAGE)).not.toBeInTheDocument();
  });

  it('keeps a pending account on the sign-in screen with the pending reason', async () => {
    signedInAs('pending');
    renderAt('/staff/dashboards');

    expect(await screen.findByText(/LOGIN SCREEN/)).toBeInTheDocument();
    expect(screen.getByText(/LOGIN SCREEN/).textContent).toContain('error=pending');
    expect(screen.queryByText(UNAUTHORIZED_MESSAGE)).not.toBeInTheDocument();
  });

  it('keeps an inactive account on the sign-in screen with the inactive reason', async () => {
    signedInAs('admin', { is_active: false });
    renderAt('/staff/dashboards');

    expect(await screen.findByText(/LOGIN SCREEN/)).toBeInTheDocument();
    expect(screen.getByText(/LOGIN SCREEN/).textContent).toContain('error=inactive');
    expect(screen.queryByText(UNAUTHORIZED_MESSAGE)).not.toBeInTheDocument();
  });

  it('fails closed for an unknown role, which has no landing', async () => {
    signedInAs('viewer');
    renderAt('/staff/dashboards');

    expect(await screen.findByText(/LOGIN SCREEN/)).toBeInTheDocument();
    expect(screen.getByText(/LOGIN SCREEN/).textContent).toContain('error=unauthorized');
    expect(screen.queryByText('DASHBOARD PAGE')).not.toBeInTheDocument();
    expect(screen.queryByText(UNAUTHORIZED_MESSAGE)).not.toBeInTheDocument();
  });
});
