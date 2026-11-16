import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudentAccessPublic } from './api/studentAccess.api.js';
import { LoginModalLayout } from './LoginModalLayout.jsx';
import { LoginForm } from './LoginForm.jsx';
import { StudentRegistration } from './StudentRegistration.jsx';
import { useToast } from './ToastContext.jsx';

export function StudentLoginPage() {
  const [view, setView] = useState('login');
  const toast = useToast();
  const navigate = useNavigate();
  // null while checking, then true / false. Closed also covers a failed check.
  const [accessOpen, setAccessOpen] = useState(null);

  useEffect(() => {
    let mounted = true;
    // Always asked fresh here: someone who arrives by link (or by a stale
    // button) must not see a form that cannot work.
    getStudentAccessPublic({ fresh: true }).then((status) => {
      if (mounted) setAccessOpen(status.enabled === true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (accessOpen !== true) {
    return (
      <LoginModalLayout
        title={accessOpen === null ? 'Student Sign in' : 'Student access is closed'}
        subtitle={
          accessOpen === null
            ? 'Checking availability...'
            : 'Student sign in and registration are not open right now. Please check back later or contact your school.'
        }
        brandTitle="SCERT Scholarship Portal"
        brandSubtitle="Student Services"
        brandImageSrc="/scert-logo.png"
      >
        {accessOpen === false ? (
          <button type="button" className="scert-btn-secondary" onClick={() => navigate('/', { replace: true })}>
            Back to Home
          </button>
        ) : null}
      </LoginModalLayout>
    );
  }

  return (
    <>
      <LoginModalLayout
        title={view === 'register' ? 'Student Registration' : 'Student Sign in'}
        subtitle={
          view === 'register'
            ? 'Create your account to access the scholarship portal.'
            : 'Access your scholarship dashboard using your registered email and password.'
        }
        brandTitle="SCERT Scholarship Portal"
        brandSubtitle="Student Services"
        brandImageSrc="/scert-logo.png"
      >
        {view === 'register' ? (
          <StudentRegistration
            onSuccess={() => {
              toast.success('Please sign in using your registered email and password.', {
                title: 'Registration successful',
                durationMs: 5000,
              });
              setView('login');
            }}
            onBack={() => setView('login')}
          />
        ) : (
          <LoginForm
            title=""
            subtitle=""
            loginIdPlaceholder="Registered email address"
            roleHints={["Student → Registered Email"]}
            redirectPath="/student/dashboard"
            loginIdInputType="email"
            loginIdValidator={(value) => {
              const email = String(value || '').trim();
              const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
              return ok ? '' : 'Please enter a valid registered email address.';
            }}
            passwordMinLength={8}
            onRegisterClick={() => setView('register')}
            showRegisterLink={true}
          />
        )}
      </LoginModalLayout>
    </>
  );
}
