import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

function makeGuard(expectedRole) {
  return function RequireRole({ children }) {
    const { auth } = useAuth();
    const location = useLocation();

    // On logout/no auth, always go to landing page (no login modal).
    if (!auth) {
      return <Navigate to="/" replace state={{ from: location }} />;
    }

    if (auth.role?.toLowerCase() !== expectedRole.toLowerCase()) {
      return <Navigate to={`/login/${expectedRole.toLowerCase()}`} replace state={{ from: location }} />;
    }

    return children;
  };
}

// Backend role_name values are case-sensitive and expected to be like 'School', 'BEO', 'District', 'Student'.
export const RequireSchool = makeGuard('School');
export const RequireBeo = makeGuard('BEO');
export const RequireDistrict = makeGuard('District');
export const RequireStudent = makeGuard('Student');
