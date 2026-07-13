import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, isRoleAllowed } from '../../context/AuthContext.jsx';

/**
 * Wraps a route with role-based access control.
 *
 * Props:
 *   roles  — string[] of allowed roles. Omit to allow any authenticated user.
 *   children
 *
 * Behavior:
 *   - Loading  → render null (Shell spinner handles global loading)
 *   - No user  → redirect to /auth/login with ?next= return URL
 *   - Inactive / pending profile → redirect to /auth/login?error=inactive|pending
 *   - Role not in `roles` → redirect to /auth/login?error=unauthorized
 */
export default function ProtectedRoute({ roles, children }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  const next = encodeURIComponent(location.pathname + location.search);

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
    return <Navigate to={`/auth/login?next=${next}&error=unauthorized`} replace />;
  }

  return children;
}
