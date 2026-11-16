import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function RequireScert({ children }) {
  const { auth } = useAuth();
  const location = useLocation();

  // On logout/no auth, always go to landing page (no login modal).
  if (!auth) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  // Backend login response returns `role` (role_name) but not role_id.
  // SCERT role_name is expected to be 'SCERT'.
  if (auth.role !== 'SCERT') {
    return <Navigate to="/login/scert" replace state={{ from: location }} />;
  }

  return children;
}
