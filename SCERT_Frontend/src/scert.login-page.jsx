import { LoginForm } from './LoginForm.jsx';
import { LoginModalLayout } from './LoginModalLayout.jsx';

export function ScertLoginPage() {
  return (
    <LoginModalLayout
      title="SCERT Sign in"
      subtitle="SCERT administrators can manage scholarships, forms and roles from this console."
      brandTitle="SCERT Scholarship Portal"
      brandSubtitle="Administration Login"
      brandImageSrc="/scert-logo.png"
    >
      <LoginForm
        title=""
        subtitle=""
        loginIdPlaceholder="Official SCERT email ID"
        roleHints={["SCERT → Official Email"]}
        redirectPath="/scert/dashboard"
        loginIdInputType="email"
        loginIdSanitizer={(value) => String(value || '').replace(/[^a-zA-Z0-9@._]/g, '')}
        loginIdValidator={(value) => {
          const email = String(value || '').trim();
          const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
          return ok ? '' : 'Please enter a valid official email address.';
        }}
        passwordMinLength={8}
      />
    </LoginModalLayout>
  );
}
