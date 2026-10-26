// Regression tests: user-writable metadata must never grant a role or active state.
// The real AuthProvider and ProtectedRoute run against a mocked Supabase client.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { makeClient, queryChain } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null, authListener: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import { AuthProvider, useAuth } from '../context/AuthContext.jsx';
import ProtectedRoute from '../components/layout/ProtectedRoute.jsx';

const USER_ID = '00000000-0000-4000-8000-0000000000aa';

// A session user as Supabase returns it. user_metadata and app_metadata are fully
// controlled by whoever holds the session, which is exactly what the tests model.
function forgedUser(metadata = {}, appMetadata = {}) {
  return {
    id: USER_ID,
    email: 'applicant@example.org',
    user_metadata: { full_name: 'Applicant', ...metadata },
    app_metadata: appMetadata,
  };
}

// profileOutcome: { row } for a row, { error } for a failed query, or {} for no row.
function setup({ user, profileOutcome = {}, session = true }) {
  const client = makeClient();
  client.auth.getSession = vi.fn(async () => ({ data: { session: session ? { user, access_token: 'x' } : null }, error: null }));
  client.auth.onAuthStateChange = vi.fn((cb) => {
    mock.authListener = cb;
    return { data: { subscription: { unsubscribe() {} } } };
  });
  client.from = vi.fn(() => queryChain({
    data: profileOutcome.row ?? null,
    error: profileOutcome.error ?? null,
  }));
  mock.client = client;
  return client;
}

function Probe() {
  const { user, profile, loading, error } = useAuth();
  return (
    <div data-testid="state">
      {JSON.stringify({
        loading,
        signedIn: Boolean(user),
        role: profile?.role ?? null,
        active: profile?.is_active ?? null,
        error: error?.name ?? null,
      })}
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderGuarded(roles) {
  return render(
    <MemoryRouter initialEntries={['/staff/secret']}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/login" element={<p>LOGIN SCREEN</p>} />
          <Route
            path="/staff/secret"
            element={<ProtectedRoute roles={roles}><p>SECRET PAGE</p></ProtectedRoute>}
          />
        </Routes>
        <Probe />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  );
}

async function settled() {
  await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent).loading).toBe(false));
}

describe('forged metadata cannot grant access', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mock.client = null;
    mock.authListener = null;
  });

  it('ignores forged superadmin in user_metadata when the profile says pending', async () => {
    setup({ user: forgedUser({ role: 'superadmin' }), profileOutcome: { row: { user_id: USER_ID, email: 'applicant@example.org', role: 'pending', is_active: true } } });
    renderGuarded(['superadmin']);
    await settled();
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state.role).toBe('pending');
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/error=pending/));
  });

  it('ignores forged admin in app_metadata when the profile says teacher', async () => {
    setup({ user: forgedUser({}, { role: 'admin' }), profileOutcome: { row: { user_id: USER_ID, role: 'teacher', is_active: true } } });
    renderGuarded(['admin', 'superadmin']);
    await settled();
    expect(JSON.parse(screen.getByTestId('state').textContent).role).toBe('teacher');
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/error=unauthorized/));
  });

  it('fails closed when no profile row exists, even with forged superadmin metadata', async () => {
    setup({ user: forgedUser({ role: 'superadmin' }, { role: 'superadmin' }), profileOutcome: {} });
    renderGuarded(['superadmin']);
    await settled();
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state.signedIn).toBe(false);
    expect(state.role).toBeNull();
    expect(state.error).toBe('ProfileMissingError');
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/error=session/));
  });

  it('fails closed on a failed profiles query, even with forged admin metadata', async () => {
    setup({
      user: forgedUser({ role: 'admin' }),
      profileOutcome: { error: { code: '42501', message: 'permission denied for table profiles' } },
    });
    renderGuarded(undefined);
    await settled();
    const state = JSON.parse(screen.getByTestId('state').textContent);
    expect(state.signedIn).toBe(false);
    expect(state.role).toBeNull();
    expect(state.error).toBe('ProfileLoadError');
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
  });

  it('ignores forged active metadata when the profile row is inactive', async () => {
    setup({
      user: forgedUser({ role: 'admin', is_active: true }, { active: true }),
      profileOutcome: { row: { user_id: USER_ID, role: 'admin', is_active: false } },
    });
    renderGuarded(['admin']);
    await settled();
    expect(JSON.parse(screen.getByTestId('state').textContent).active).toBe(false);
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/error=inactive/));
  });

  it('treats a profile row with no role as pending, never as elevated', async () => {
    setup({ user: forgedUser({ role: 'superadmin' }), profileOutcome: { row: { user_id: USER_ID, role: null, is_active: true } } });
    renderGuarded(['superadmin']);
    await settled();
    expect(JSON.parse(screen.getByTestId('state').textContent).role).toBe('pending');
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
  });

  it('does not accept a poisoned session cache entry that was not written from a profile lookup', async () => {
    sessionStorage.setItem('fs_profile_cache_v1', JSON.stringify({
      user_id: USER_ID,
      ts: Date.now(),
      profile: { user_id: USER_ID, role: 'superadmin', is_active: true, source: 'auth' },
    }));
    setup({ user: forgedUser({ role: 'superadmin' }), profileOutcome: { row: { user_id: USER_ID, role: 'pending', is_active: true } } });
    renderGuarded(['superadmin']);
    await settled();
    expect(JSON.parse(screen.getByTestId('state').textContent).role).toBe('pending');
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
  });

  it('re-reads the server profile on token refresh, and clears it when that read fails', async () => {
    const client = setup({
      user: forgedUser(),
      profileOutcome: { row: { user_id: USER_ID, role: 'teacher', is_active: true } },
    });
    renderGuarded(['teacher']);
    await settled();
    expect(screen.getByText('SECRET PAGE')).toBeInTheDocument();

    // The role is revoked server-side and the refresh read now fails.
    client.from = vi.fn(() => queryChain({ data: null, error: { code: '42501', message: 'permission denied' } }));
    mock.authListener('TOKEN_REFRESHED', { user: forgedUser(), access_token: 'x' });
    await waitFor(() => expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument());
    expect(JSON.parse(screen.getByTestId('state').textContent).signedIn).toBe(false);
  });

  it('applies a server-side role change on token refresh, not the cached one', async () => {
    const client = setup({
      user: forgedUser(),
      profileOutcome: { row: { user_id: USER_ID, role: 'teacher', is_active: true } },
    });
    renderGuarded(['teacher']);
    await settled();
    client.from = vi.fn(() => queryChain({ data: { user_id: USER_ID, role: 'pending', is_active: true }, error: null }));
    mock.authListener('TOKEN_REFRESHED', { user: forgedUser(), access_token: 'x' });
    await waitFor(() => expect(JSON.parse(screen.getByTestId('state').textContent).role).toBe('pending'));
    expect(screen.queryByText('SECRET PAGE')).not.toBeInTheDocument();
  });

  it('keeps a legitimate admin working (positive control)', async () => {
    setup({ user: forgedUser(), profileOutcome: { row: { user_id: USER_ID, role: 'admin', is_active: true } } });
    renderGuarded(['admin', 'superadmin']);
    await settled();
    expect(screen.getByText('SECRET PAGE')).toBeInTheDocument();
  });

  it('keeps a legitimate superadmin working even with no metadata role set', async () => {
    setup({ user: forgedUser(), profileOutcome: { row: { user_id: USER_ID, role: 'superadmin', is_active: true } } });
    renderGuarded(['superadmin']);
    await settled();
    expect(screen.getByText('SECRET PAGE')).toBeInTheDocument();
  });
});
