import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './profile-nav-styles.css'
import './scorecard.css'
import App from './App.jsx'
import { AuthProvider } from './AuthContext.jsx'
import { ToastProvider } from './ToastContext.jsx'

if (typeof window !== 'undefined') {
  window.getDisplayApplicationId = (entity) => {
    const displayId =
      entity?.application_display_id ??
      entity?.application?.application_display_id ??
      null;
    if (displayId !== null && displayId !== undefined && String(displayId).trim() !== '') {
      return String(displayId);
    }
    return '—';
  };

  window.getSubmissionRoleRowClass = (entity) => {
    const role = entity?.submitted_by_role ?? entity?.application?.submitted_by_role;
    if (role === 'SCHOOL') return 'row-submitted-school';
    if (role === 'STUDENT') return 'row-submitted-student';
    return '';
  };

  window.getSubmissionRoleBadgeHtml = (entity) => {
    const role = entity?.submitted_by_role ?? entity?.application?.submitted_by_role;
    if (role === 'SCHOOL') return `<span class="badge-submitted badge-submitted-school">School</span>`;
    if (role === 'STUDENT') return `<span class="badge-submitted badge-submitted-student">Student</span>`;
    return '';
  };

  window.renderSubmissionRoleBadge = (entity) => {
    const role = entity?.submitted_by_role ?? entity?.application?.submitted_by_role;
    if (role === 'SCHOOL') return <span className="badge-submitted badge-submitted-school">School</span>;
    if (role === 'STUDENT') return <span className="badge-submitted badge-submitted-student">Student</span>;
    return null;
  };


}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
