import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ROUTE_ACCESS } from '../routing/routeRoles.js';

// Renders the real App route tree. Only auth, the shell and the page modules are replaced.
const state = vi.hoisted(() => ({ profile: null }));

vi.mock('../context/AuthContext.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    AuthProvider: ({ children }) => children,
    useAuth: () => ({
      user: state.profile ? { id: 'user-1' } : null,
      profile: state.profile,
      loading: false,
      error: null,
      signOut: vi.fn(),
    }),
  };
});

vi.mock('../components/layout/Shell.jsx', () => ({
  default: ({ children }) => children,
}));

vi.mock('../components/pwa/PWAInstallPrompt.jsx', () => ({ PWAInstallPrompt: () => null }));
vi.mock('../components/pwa/OfflineIndicator.jsx', () => ({ OfflineIndicator: () => null }));

vi.mock('../features/auth/LoginPage.jsx', () => ({
  default: function LoginStub() {
    const { search } = useLocation();
    return <p>LOGIN PAGE{search}</p>;
  },
}));
vi.mock('../features/teacher-attendance/TeacherAttendancePage.jsx', () => ({
  default: () => <p>TEACHER ATTENDANCE PAGE</p>,
}));
vi.mock('../features/attendance/AttendancePage.jsx', () => ({
  default: () => <p>STAFF ATTENDANCE PAGE</p>,
}));

import App from '../App.jsx';

const ALL_ROLES = ['teacher', 'admin', 'superadmin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary'];

function renderAt(path, role) {
  state.profile = { role, full_name: 'Test User', email: 'user@example.test', is_active: true };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('teacher attendance route guard (App.jsx)', () => {
  afterEach(() => {
    cleanup();
    state.profile = null;
  });

  it('denies an admin and sends them to login as unauthorized', async () => {
    renderAt('/teacher/attendance', 'admin');
    expect(await screen.findByText(/LOGIN PAGE/)).toBeTruthy();
    expect(screen.getByText(/LOGIN PAGE/).textContent).toContain('error=unauthorized');
    expect(screen.queryByText('TEACHER ATTENDANCE PAGE')).toBeNull();
  });

  it('allows a teacher', async () => {
    renderAt('/teacher/attendance', 'teacher');
    expect(await screen.findByText('TEACHER ATTENDANCE PAGE')).toBeTruthy();
  });

  it.each(ALL_ROLES)('matches the routeRoles policy for role %s', async (role) => {
    const allowed = ROUTE_ACCESS['/teacher/attendance'].includes(role);
    renderAt('/teacher/attendance', role);
    if (allowed) {
      expect(await screen.findByText('TEACHER ATTENDANCE PAGE')).toBeTruthy();
    } else {
      expect(await screen.findByText(/LOGIN PAGE/)).toBeTruthy();
      expect(screen.getByText(/LOGIN PAGE/).textContent).toContain('error=unauthorized');
    }
  });

  it('keeps the staff attendance route open to an admin', async () => {
    renderAt('/staff/attendance', 'admin');
    expect(await screen.findByText('STAFF ATTENDANCE PAGE')).toBeTruthy();
  });

  it('keeps the staff attendance route open to a regional secretary', async () => {
    renderAt('/staff/attendance', 'regional_secretary');
    expect(await screen.findByText('STAFF ATTENDANCE PAGE')).toBeTruthy();
  });
});
