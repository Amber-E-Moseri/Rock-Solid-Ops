import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  canonicalRole, isSuperadmin, isAdmin, isStaff, isTeacher,
  isRegionalSecretary, isPending, canManageSubgroup, canManageTeacher,
  canViewDashboard, isRoleAllowed, ROLES,
} from '../context/AuthContext.jsx';

// ── Role helpers ─────────────────────────────────────────────────────────────

describe('role helpers', () => {
  it('isSuperadmin', () => {
    expect(isSuperadmin('superadmin')).toBe(true);
    expect(isSuperadmin('admin')).toBe(false);
    expect(isSuperadmin('')).toBe(false);
  });

  it('isAdmin — includes ADMIN_ROLES', () => {
    expect(isAdmin('superadmin')).toBe(true);
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('subgroup_admin')).toBe(true);
    expect(isAdmin('pastor')).toBe(true);
    expect(isAdmin('principal')).toBe(true);
    expect(isAdmin('regional_secretary')).toBe(false);
    expect(isAdmin('teacher')).toBe(false);
  });

  it('isStaff — includes all staff roles', () => {
    expect(isStaff('superadmin')).toBe(true);
    expect(isStaff('regional_secretary')).toBe(true);
    expect(isStaff('teacher')).toBe(true);
    expect(isStaff('pending')).toBe(false);
    expect(isStaff('user')).toBe(false);
  });

  it('isTeacher', () => {
    expect(isTeacher('teacher')).toBe(true);
    expect(isTeacher('admin')).toBe(false);
  });

  it('isRegionalSecretary', () => {
    expect(isRegionalSecretary('regional_secretary')).toBe(true);
    expect(isRegionalSecretary('admin')).toBe(false);
  });

  it('isPending', () => {
    expect(isPending('pending')).toBe(true);
    expect(isPending('admin')).toBe(false);
  });

  it('canManageSubgroup / canManageTeacher — ADMIN_ROLES only', () => {
    expect(canManageSubgroup('superadmin')).toBe(true);
    expect(canManageSubgroup('regional_secretary')).toBe(false);
    expect(canManageSubgroup('teacher')).toBe(false);
    expect(canManageTeacher('admin')).toBe(true);
    expect(canManageTeacher('teacher')).toBe(false);
  });

  it('canViewDashboard — all STAFF_ROLES', () => {
    expect(canViewDashboard('superadmin')).toBe(true);
    expect(canViewDashboard('teacher')).toBe(true);
    expect(canViewDashboard('regional_secretary')).toBe(true);
    expect(canViewDashboard('pending')).toBe(false);
  });

  it('isRoleAllowed — array', () => {
    expect(isRoleAllowed('superadmin', ['superadmin', 'admin'])).toBe(true);
    expect(isRoleAllowed('teacher', ['superadmin', 'admin'])).toBe(false);
  });

  it('isRoleAllowed — Set', () => {
    const s = new Set(['superadmin']);
    expect(isRoleAllowed('superadmin', s)).toBe(true);
    expect(isRoleAllowed('admin', s)).toBe(false);
  });

  it('canonicalRole normalizes case', () => {
    expect(canonicalRole('SUPERADMIN')).toBe('superadmin');
    expect(canonicalRole('  Admin  ')).toBe('admin');
    expect(canonicalRole(null)).toBe('user');
    expect(canonicalRole('')).toBe('user');
  });

  it('ROLES constants match expected values', () => {
    expect(ROLES.SUPERADMIN).toBe('superadmin');
    expect(ROLES.TEACHER).toBe('teacher');
    expect(ROLES.PENDING).toBe('pending');
  });
});

// ── ProtectedRoute ────────────────────────────────────────────────────────────

vi.mock('../supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({}),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

import { AuthProvider } from '../context/AuthContext.jsx';
import ProtectedRoute from '../components/layout/ProtectedRoute.jsx';

function renderWithRouter(ui, { initialPath = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('redirects to /auth/login when no session', async () => {
    const { supabase } = await import('../supabase.js');
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    renderWithRouter(
      <Routes>
        <Route path="/" element={<ProtectedRoute><div>Protected</div></ProtectedRoute>} />
        <Route path="/auth/login" element={<div>Login page</div>} />
      </Routes>,
      { initialPath: '/' }
    );

    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });

  it('renders children when session and role matches', async () => {
    const { supabase } = await import('../supabase.js');
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'uid-1', email: 'admin@test.com', user_metadata: {}, app_metadata: {} },
        },
      },
    });
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { user_id: 'uid-1', email: 'admin@test.com', full_name: 'Admin', role: 'superadmin', is_active: true },
        error: null,
      }),
    });

    renderWithRouter(
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute roles={['superadmin']}>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth/login" element={<div>Login page</div>} />
      </Routes>,
      { initialPath: '/' }
    );

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
  });

  it('redirects unauthorized role to /auth/login?error=unauthorized', async () => {
    const { supabase } = await import('../supabase.js');
    supabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'uid-2', email: 'teacher@test.com', user_metadata: {}, app_metadata: {} },
        },
      },
    });
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { user_id: 'uid-2', email: 'teacher@test.com', full_name: 'Teacher', role: 'teacher', is_active: true },
        error: null,
      }),
    });

    renderWithRouter(
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute roles={['superadmin']}>
              <div>Superadmin only</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth/login" element={<div data-testid="login">Login page</div>} />
      </Routes>,
      { initialPath: '/' }
    );

    await waitFor(() => {
      expect(screen.getByTestId('login')).toBeInTheDocument();
      expect(screen.queryByText('Superadmin only')).not.toBeInTheDocument();
    });
  });
});
