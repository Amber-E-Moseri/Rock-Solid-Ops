import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, isRoleAllowed } from '../../context/AuthContext.jsx';
import { landingPathForRole } from '../../routing/routeRoles.js';

/**
 * Wraps a route with role-based access control.
 *
 * Props:
 *   roles  — string[] of allowed roles. Omit to allow any authenticated user.
 *   children
 *
 * Behavior:
 *   - Loading  → render null (Shell spinner handles global loading)
 *   - Profile load failed → redirect to /auth/login?error=session (explicit message)
 *   - No user  → redirect to /auth/login with ?next= return URL
 *   - Inactive / pending profile → redirect to /auth/login?error=inactive|pending
 *   - Role not in `roles`, active session with a role landing → redirect to that landing with a notice
 *   - Role not in `roles`, no landing (or already redirected here) → redirect to /auth/login?error=unauthorized
 */
export default function ProtectedRoute({ roles, children }) {
  const { user, profile, loading, error } = useAuth();
  const location = useLocation();

  if (loading) return null;

  const next = encodeURIComponent(location.pathname + location.search);

  if (!user && error) {
    return <Navigate to={`/auth/login?next=${next}&error=session`} replace />;
  }

  if (!user) {
    return <Navigate to={`/auth/login?next=${next}`} replace />;
  }

  if (!profile || profile.is_active === false) {
    return <Navigate to={`/auth/login?next=${next}&error=inactive`} replace />;
  }

  if (profile.role === 'pending') {
    return <Navigate to={`/auth/login?next=${next}&error=pending`} replace />;
  }

  if (roles && roles.length > 0 && !isRoleAllowed(profile.role, roles)) {
    const landing = landingPathForRole(profile.role);
    const redirectedHere = location.state?.notice === 'unauthorized';
    if (landing && landing !== location.pathname && !redirectedHere) {
      return <Navigate to={landing} replace state={{ notice: 'unauthorized' }} />;
    }
    return <Navigate to={`/auth/login?next=${next}&error=unauthorized`} replace />;
  }

  return children;
}
