import { LoginForm } from './LoginForm.jsx';
import { LoginModalLayout } from './LoginModalLayout.jsx';

export function SchoolLoginPage() {
  return (
    <LoginModalLayout
      title="School / Institute Sign in"
      subtitle="Access your School dashboard using your assigned UDISE code."
      brandTitle="SCERT Scholarship Portal"
      brandSubtitle="School Login"
      brandImageSrc="/scert-logo.png"
    >
      <LoginForm
        title=""
        subtitle=""
        loginIdPlaceholder="School UDISE code"
        roleHints={["School → UDISE Code"]}
        redirectPath="/school/dashboard"
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
