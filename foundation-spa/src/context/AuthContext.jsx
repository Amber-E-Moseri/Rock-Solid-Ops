import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase.js';

// ── Role constants (mirrors auth-client.js) ──────────────────────────────────

export const ROLES = Object.freeze({
  SUPERADMIN:         'superadmin',
  ADMIN:              'admin',
  SUBGROUP_ADMIN:     'subgroup_admin',
  PASTOR:             'pastor',
  PRINCIPAL:          'principal',
  REGIONAL_SECRETARY: 'regional_secretary',
  TEACHER:            'teacher',
  PENDING:            'pending',
});

const ADMIN_ROLES = new Set([
  ROLES.SUPERADMIN,
  ROLES.ADMIN,
  ROLES.SUBGROUP_ADMIN,
  ROLES.PASTOR,
  ROLES.PRINCIPAL,
]);

const STAFF_ROLES = new Set([
  ...ADMIN_ROLES,
  ROLES.REGIONAL_SECRETARY,
  ROLES.TEACHER,
]);

const DASHBOARD_ROLES = new Set([...STAFF_ROLES]);

// Dev-only bypass (localhost only)
const BYPASS_ROLE =
  import.meta.env.VITE_BYPASS_ROLE &&
  import.meta.env.MODE !== 'test' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? String(import.meta.env.VITE_BYPASS_ROLE).trim().toLowerCase()
    : '';

if (BYPASS_ROLE) {
  console.warn('[AuthContext] BYPASS_ROLE active — all role checks bypassed. Dev only.');
}

// ── Profile cache (sessionStorage, 5-min TTL) ────────────────────────────────

const PROFILE_CACHE_KEY = 'fs_profile_cache_v1';
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

function readCachedProfile(userId) {
  try {
    const entry = JSON.parse(sessionStorage.getItem(PROFILE_CACHE_KEY) || 'null');
    if (!entry || entry.user_id !== userId) return null;
    if (Date.now() - entry.ts > PROFILE_CACHE_TTL_MS) return null;
    return entry.profile || null;
  } catch {
    return null;
  }
}

function writeCachedProfile(userId, profile) {
  try {
    sessionStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ user_id: userId, ts: Date.now(), profile })
    );
  } catch {
    /* storage unavailable */
  }
}

export function clearCachedProfile() {
  try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeRole(rawRole, fallback = 'user') {
  const r = String(rawRole || '').trim();
  return r ? r.toLowerCase() : fallback;
}

function resolveActiveState(row, fallback = true) {
  const status = String(row?.status || '').trim().toLowerCase();
  if (row?.is_active === false || row?.active === false) return false;
  if (status === 'suspended' || status === 'inactive' || status === 'disabled') return false;
  if (row?.is_active === true || row?.active === true) return true;
  return fallback;
}

function normalizeProfileRecord(source, row, user, opts = {}) {
  const role = normalizeRole(
    row?.role || user?.user_metadata?.role || user?.app_metadata?.role,
    opts.defaultRole || 'user'
  );
  return {
    user_id: row?.id || row?.auth_user_id || user?.id || null,
    email: row?.email || user?.email || null,
    full_name:
      row?.full_name ||
      row?.name ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      'User',
    role,
    is_active: resolveActiveState(row, opts.defaultActive !== false),
    source,
  };
}

function isAuthError(error) {
  const msg = String(error?.message || '').toLowerCase();
  const code = String(error?.code || error?.status || '');
  return (
    code === '401' ||
    code === 'PGRST301' ||
    msg.includes('jwt') ||
    msg.includes('not authenticated') ||
    msg.includes('token is expired') ||
    msg.includes('invalid session')
  );
}

function isMissingTableError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('relation');
}

// ── Profile resolution (mirrors getCurrentProfile in auth-client.js) ─────────

const PROJECTIONS = [
  'user_id,email,full_name,role,is_active',
  'user_id,email,full_name,role',
  'user_id,email,role',
  'user_id,role',
];

async function resolveProfile(user) {
  const cached = readCachedProfile(user.id);
  if (cached) return cached;

  for (const projection of PROJECTIONS) {
    const { data, error } = await supabase
      .from('profiles')
      .select(projection)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!error && data) {
      const profile = normalizeProfileRecord('profiles', data, user, {
        defaultRole: 'user',
        defaultActive: true,
      });
      writeCachedProfile(user.id, profile);
      return profile;
    }
    if (error) {
      if (isAuthError(error)) throw error;
      if (!isMissingTableError(error)) {
        console.warn('[AuthContext] profiles projection failed', { projection, error });
      }
    }
  }

  const metadataProfile = normalizeProfileRecord('auth', {}, user, {
    defaultRole: 'user',
    defaultActive: true,
  });
  console.warn('[AuthContext] falling back to auth metadata profile', {
    user_id: metadataProfile.user_id,
    email: metadataProfile.email,
    role: metadataProfile.role,
  });
  return metadataProfile;
}

// ── Role helpers (exported so Shell and ProtectedRoute can use them) ──────────

export function canonicalRole(rawRole) {
  if (BYPASS_ROLE) return BYPASS_ROLE;
  return normalizeRole(rawRole, 'user');
}

export const isSuperadmin         = (r) => canonicalRole(r) === ROLES.SUPERADMIN;
export const isAdmin              = (r) => ADMIN_ROLES.has(canonicalRole(r));
export const isStaff              = (r) => STAFF_ROLES.has(canonicalRole(r));
export const isTeacher            = (r) => canonicalRole(r) === ROLES.TEACHER;
export const isRegionalSecretary  = (r) => canonicalRole(r) === ROLES.REGIONAL_SECRETARY;
export const isPending            = (r) => canonicalRole(r) === ROLES.PENDING;
export const canManageSubgroup    = (r) => ADMIN_ROLES.has(canonicalRole(r));
export const canManageTeacher     = (r) => ADMIN_ROLES.has(canonicalRole(r));
export const canViewDashboard     = (r) => DASHBOARD_ROLES.has(canonicalRole(r));

export function isRoleAllowed(role, allowedRoles) {
  if (!allowedRoles) return false;
  const normalized = canonicalRole(role);
  const allowed = allowedRoles instanceof Set
    ? allowedRoles
    : new Set(Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]);
  return allowed.has(normalized);
}

// Teacher record validation (mirrors auth-client.js requireAuth teacher branch)
export async function getLinkedTeacherRecord(userEmail) {
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return null;
  const { data } = await supabase
    .from('teachers')
    .select('teacher_id,email,full_name,status,active,deleted_at')
    .ilike('email', email)
    .is('deleted_at', null)
    .eq('active', true)
    .eq('status', 'ACTIVE')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const loadProfile = useCallback(async (sessionUser) => {
    if (!sessionUser) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const resolved = await resolveProfile(sessionUser);
      setUser(sessionUser);
      setProfile(resolved);
    } catch (err) {
      console.error('[AuthContext] profile load error', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (BYPASS_ROLE) {
      const fakeUser = { id: 'dev-bypass', email: 'dev@localhost' };
      setUser(fakeUser);
      setProfile({ user_id: 'dev-bypass', email: 'dev@localhost', role: BYPASS_ROLE, is_active: true, full_name: 'Dev Bypass' });
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      loadProfile(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') {
        clearCachedProfile();
        setUser(null);
        setProfile(null);
        setLoading(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        loadProfile(session?.user ?? null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    clearCachedProfile();
    await supabase.auth.signOut();
  }, []);

  const value = {
    user,
    profile,
    loading,
    error,
    signOut,
    // role helpers bound to the current profile's role
    role: profile?.role ?? null,
    isSuperadmin:        () => isSuperadmin(profile?.role),
    isAdmin:             () => isAdmin(profile?.role),
    isStaff:             () => isStaff(profile?.role),
    isTeacher:           () => isTeacher(profile?.role),
    isRegionalSecretary: () => isRegionalSecretary(profile?.role),
    isPending:           () => isPending(profile?.role),
    canManageSubgroup:   () => canManageSubgroup(profile?.role),
    canManageTeacher:    () => canManageTeacher(profile?.role),
    canViewDashboard:    () => canViewDashboard(profile?.role),
    hasRole:             (roles) => isRoleAllowed(profile?.role, roles),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
