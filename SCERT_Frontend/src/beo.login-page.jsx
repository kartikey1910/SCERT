import { LoginForm } from './LoginForm.jsx';
import { LoginModalLayout } from './LoginModalLayout.jsx';

  const close = () => navigate('/', { replace: true })

export function BeoLoginPage() {
  return (
    <LoginModalLayout
      title="BEO Sign in"
      brandTitle="SCERT Scholarship Portal"
      brandSubtitle="BEO Login"
      brandImageSrc="/scert-logo.png"
    >
      <LoginForm
        title=""
        subtitle=""
        loginIdPlaceholder="Email / Unit ID / Username"
        roleHints={["BEO → Email / Unit ID"]}
        redirectPath="/beo/dashboard"
        loginIdInputType="text"
        loginIdSanitizer={(value) => String(value || '').replace(/[^a-zA-Z0-9@._]/g, '')}
        loginIdValidator={(value) => {
          const v = String(value || '').trim();
          if (!v) return 'Login ID is required.';
          return /^[a-zA-Z0-9@._]+$/.test(v)
            ? ''
            : 'Login ID can contain letters, numbers, @, . and _ only.';
        }}
        passwordMinLength={8}
      />
      
    </LoginModalLayout>
  );
}
