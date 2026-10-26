import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const mock = vi.hoisted(() => ({ auth: null }));

vi.mock('../context/AuthContext.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => mock.auth };
});
vi.mock('../components/layout/Shell.jsx', () => ({
  default: ({ children }) => <div data-testid="shell">{children}</div>,
}));
vi.mock('../features/teacher-applications/TeacherApplicationsPage.jsx', () => ({
  default: () => <p>REVIEW SCREEN</p>,
}));

import { teacherApplicationsRoute, TEACHER_APPLICATIONS_PATH } from '../features/teacher-applications/routes.jsx';

function LoginProbe() {
  const location = useLocation();
  return <p>LOGIN {location.search}</p>;
}

function renderAt(path = TEACHER_APPLICATIONS_PATH) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {teacherApplicationsRoute}
        <Route path="/auth/login" element={<LoginProbe />} />
        <Route path="/staff/dashboards" element={<p>DASHBOARD LANDING</p>} />
        <Route path="/teacher/index" element={<p>TEACHER LANDING</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function signedInAs(role, overrides = {}) {
  mock.auth = {
    user: { id: 'u-1' },
    profile: { role, is_active: true, ...overrides },
    loading: false,
    error: null,
  };
}

describe('teacher application review route', () => {
  beforeEach(() => {
    mock.auth = null;
  });

  it('is registered at the staff path', () => {
    expect(TEACHER_APPLICATIONS_PATH).toBe('/staff/teacher-applications');
    expect(teacherApplicationsRoute.props.path).toBe('/staff/teacher-applications');
  });

  it.each(['admin', 'superadmin'])('opens for %s', async (role) => {
    signedInAs(role);
    renderAt();
    expect(await screen.findByText('REVIEW SCREEN')).toBeInTheDocument();
    expect(screen.getByTestId('shell')).toBeInTheDocument();
  });

  it.each(['pastor', 'principal', 'subgroup_admin', 'regional_secretary'])(
    'sends %s to the staff landing, and never renders the screen',
    async (role) => {
      signedInAs(role);
      renderAt();
      expect(await screen.findByText('DASHBOARD LANDING')).toBeInTheDocument();
      expect(screen.queryByText('REVIEW SCREEN')).not.toBeInTheDocument();
    },
  );

  it('sends a teacher to the teacher landing, and never renders the screen', async () => {
    signedInAs('teacher');
    renderAt();
    expect(await screen.findByText('TEACHER LANDING')).toBeInTheDocument();
    expect(screen.queryByText('REVIEW SCREEN')).not.toBeInTheDocument();
  });

  it('sends a pending account to the pending notice, not the review screen', async () => {
    signedInAs('pending');
    renderAt();
    expect(await screen.findByText(/error=pending/)).toBeInTheDocument();
    expect(screen.queryByText('REVIEW SCREEN')).not.toBeInTheDocument();
  });

  it('refuses an inactive admin account', async () => {
    signedInAs('admin', { is_active: false });
    renderAt();
    expect(await screen.findByText(/error=inactive/)).toBeInTheDocument();
    expect(screen.queryByText('REVIEW SCREEN')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign-in with a return path', async () => {
    mock.auth = { user: null, profile: null, loading: false, error: null };
    renderAt();
    expect(await screen.findByText(/LOGIN \?next=%2Fstaff%2Fteacher-applications/)).toBeInTheDocument();
  });
});
