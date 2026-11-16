import { LoginForm } from './LoginForm.jsx';
import { LoginModalLayout } from './LoginModalLayout.jsx';

export function DistrictLoginPage() {
  return (
    <LoginModalLayout
      title="District Sign in"
      brandTitle="SCERT Scholarship Portal"
      brandSubtitle="District Login"
      brandImageSrc="/scert-logo.png"
    >
      <LoginForm
        title=""
        subtitle=""
        loginIdPlaceholder="District Unit ID / Email"
        roleHints={["District → Unit ID"]}
        redirectPath="/district/dashboard"
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
