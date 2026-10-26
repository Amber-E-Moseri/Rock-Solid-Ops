import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabase.js';
import { resolveDevBypassRole } from '../lib/devFlags.js';

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

// Dev-only bypass: requires a development build, an explicit opt-in and a local host.
const BYPASS_ROLE = import.meta.env.DEV ? resolveDevBypassRole(import.meta.env, window.location.hostname) : '';

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
    // Only profiles produced by a server lookup are trusted. Anything else in the
    // cache (for example a value written by an older build) is ignored.
    const profile = entry.profile;
    if (!profile || profile.source !== 'profiles' || profile.user_id !== userId) return null;
    return profile;
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

// Builds the profile used for every authorization decision. It reads only the
// server-side profiles row. user_metadata and app_metadata are writable by the
// signed-in user (signUp data, updateUser), so they never supply the role or the
// active state. The display name may still come from metadata because it grants
// no access. A missing role falls back to the non-elevated 'pending' role.
function normalizeProfileRecord(source, row, user) {
  return {
    user_id: row?.user_id || row?.id || user?.id || null,
    email: row?.email || user?.email || null,
    full_name:
      row?.full_name ||
      row?.name ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      'User',
    role: normalizeRole(row?.role, 'pending'),
    is_active: resolveActiveState(row, true),
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

// Thrown when the profiles query itself fails. It is not an authorization
// decision: the user is not treated as unauthorized and no fallback role is used.
class ProfileLoadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ProfileLoadError';
    this.cause = cause;
  }
}

// Thrown when the query succeeds but no profiles row exists. Fails closed.
class ProfileMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileMissingError';
  }
}

// `fresh` skips the session cache so a role change or revocation is seen on the next
// token refresh instead of after the cache TTL.
async function resolveProfile(user, { fresh = false } = {}) {
  const cached = fresh ? null : readCachedProfile(user.id);
  if (cached) return cached;

  let queryFailed = null;
  for (const projection of PROJECTIONS) {
    const { data, error } = await supabase
      .from('profiles')
      .select(projection)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!error && data) {
      const profile = normalizeProfileRecord('profiles', data, user);
      writeCachedProfile(user.id, profile);
      return profile;
    }
    if (error) {
      if (isAuthError(error)) throw error;
      if (!isMissingTableError(error)) {
        queryFailed = queryFailed || error;
        console.warn('[AuthContext] profiles projection failed', { projection, error });
      }
    }
  }

  if (queryFailed) {
    throw new ProfileLoadError('The profiles query failed.', queryFailed);
  }

  // No profile row. There is no fallback: user-writable metadata must never grant a role.
  throw new ProfileMissingError('No profile exists for this account.');
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

  // Id of the latest session application. A profile result that finishes after a
  // newer session change (for example a sign-out) is dropped instead of applied.
  const sessionRequestRef = useRef(0);
  // The profile load in progress, shared by concurrent callers for the same user.
  const inflightRef = useRef({ userId: null, promise: null });

  const fetchProfileOnce = useCallback((sessionUser, options) => {
    const current = inflightRef.current;
    if (current.promise && current.userId === sessionUser.id) return current.promise;
    const promise = resolveProfile(sessionUser, options).finally(() => {
      if (inflightRef.current.promise === promise) {
        inflightRef.current = { userId: null, promise: null };
      }
    });
    inflightRef.current = { userId: sessionUser.id, promise };
    return promise;
  }, []);

  // Applies a session to state. When `blocking`, `loading` stays true until the
  // profile has resolved, so the route guard waits instead of treating the user
  // as signed out. A failed profile load is recorded in `error`; it is never
  // reported as an authorization decision.
  const applySession = useCallback((sessionUser, { blocking = true, fresh = false } = {}) => {
    const requestId = ++sessionRequestRef.current;

    if (!sessionUser) {
      inflightRef.current = { userId: null, promise: null };
      setUser(null);
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (blocking) setLoading(true);
    fetchProfileOnce(sessionUser, { fresh }).then(
      (resolved) => {
        if (requestId !== sessionRequestRef.current) return;
        setUser(sessionUser);
        setProfile(resolved);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (requestId !== sessionRequestRef.current) return;
        console.error('[AuthContext] profile load error', err);
        // Fail closed: a failed trusted lookup never keeps the previous profile.
        setUser(null);
        setProfile(null);
        setError(err);
        setLoading(false);
      }
    );
  }, [fetchProfileOnce]);

  useEffect(() => {
    if (BYPASS_ROLE) {
      const fakeUser = { id: 'dev-bypass', email: 'dev@localhost' };
      setUser(fakeUser);
      setProfile({ user_id: 'dev-bypass', email: 'dev@localhost', role: BYPASS_ROLE, is_active: true, full_name: 'Dev Bypass' });
      setLoading(false);
      return;
    }

    // The initial snapshot is older than any auth event that arrived while it was
    // loading (for example a sign-in), so it is dropped in that case.
    const initialRequest = sessionRequestRef.current;
    supabase.auth.getSession().then(({ data }) => {
      if (sessionRequestRef.current !== initialRequest) return;
      applySession(data.session?.user ?? null);
    });

    // The listener does not await the profile load. The auth client awaits its
    // subscribers, and the profile query runs through that same client.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') {
        clearCachedProfile();
        applySession(null);
      } else if (event === 'SIGNED_IN') {
        applySession(session?.user ?? null, { blocking: true });
      } else if (event === 'TOKEN_REFRESHED') {
        applySession(session?.user ?? null, { blocking: false, fresh: true });
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [applySession]);

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
