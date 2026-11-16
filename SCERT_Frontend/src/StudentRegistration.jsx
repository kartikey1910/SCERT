import { useState } from 'react';
import { post } from './apiClient.js';

const SAFE_NAME_REGEX = /^[\p{L}\s.'-]+$/u;

function validateNameInput(label, value, { required = false } = {}) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return required ? `${label} is required.` : '';
  }
  if (/[<>]/.test(normalized) || /<\/?[a-z][^>]*>/i.test(normalized)) {
    return `${label} contains invalid characters.`;
  }
  if (!SAFE_NAME_REGEX.test(normalized) || !/[\p{L}]/u.test(normalized)) {
    return `${label} may contain only letters, spaces, dots, apostrophes, and hyphens.`;
  }
  return '';
}

export function StudentRegistration({ onSuccess, onBack }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    gender: '',
    udise_code: '',
    father_name: '',
    mother_name: '',
    date_of_birth: '',
    aadhaar_number: '',
    mobile_number: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});

  const validateField = (name, value, data = formData) => {
    const v = typeof value === 'string' ? value.trim() : value;

    switch (name) {
      case 'email': {
        if (!v) return 'Email is required.';
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v));
        return ok ? '' : 'Please enter a valid email address.';
      }
      case 'full_name': {
        return validateNameInput('Full name', v, { required: true });
      }
      case 'father_name': {
        return validateNameInput("Father's name", v);
      }
      case 'mother_name': {
        return validateNameInput("Mother's name", v);
      }
      case 'password': {
        if (!value) return 'Password is required.';
        if (String(value).length < 8) return 'Password must be at least 8 characters.';
        return '';
      }
      case 'confirmPassword': {
        if (!data.password) return 'Please enter your password first.';
        if (!value) return 'Please confirm your password.';
        return String(value) === String(data.password) ? '' : 'Passwords do not match.';
      }
      case 'udise_code': {
        if (!v) return 'School UDISE code is required.';
        const str = String(v);
        const ok = /^\d{5,11}$/.test(str);
        return ok ? '' : 'UDISE code should be 5–11 digits.';
      }
      case 'mobile_number': {
        if (!v) return '';
        const str = String(v);
        const ok = /^\d{10}$/.test(str);
        return ok ? '' : 'Mobile number must be 10 digits.';
      }
      case 'aadhaar_number': {
        if (!v) return '';
        const str = String(v).replace(/\s/g, '');
        const ok = /^\d{12}$/.test(str);
        return ok ? '' : 'Aadhaar number must be 12 digits.';
      }
      default:
        return '';
    }
  };

  const validateAll = (data = formData) => {
    const next = {
      email: validateField('email', data.email, data),
      full_name: validateField('full_name', data.full_name, data),
      password: validateField('password', data.password, data),
      father_name: validateField('father_name', data.father_name, data),
      mother_name: validateField('mother_name', data.mother_name, data),
      confirmPassword: validateField('confirmPassword', data.confirmPassword, data),
      udise_code: validateField('udise_code', data.udise_code, data),
      mobile_number: validateField('mobile_number', data.mobile_number, data),
      aadhaar_number: validateField('aadhaar_number', data.aadhaar_number, data),
    };

    // Remove empty messages
    Object.keys(next).forEach((k) => {
      if (!next[k]) delete next[k];
    });

    return next;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const uppercaseFields = new Set(['full_name', 'father_name', 'mother_name']);
    const normalizedValue = uppercaseFields.has(name) ? String(value).toUpperCase() : value;
    setFormData((prev) => {
      const next = { ...prev, [name]: normalizedValue };

      // live re-validate touched fields
      setFieldErrors((prevErrors) => {
        const copy = { ...prevErrors };
        if (touched[name]) {
          const msg = validateField(name, normalizedValue, next);
          if (msg) copy[name] = msg;
          else delete copy[name];
        }

        // if password changes, revalidate confirmPassword if touched
        if (name === 'password' && touched.confirmPassword) {
          const msg = validateField('confirmPassword', next.confirmPassword, next);
          if (msg) copy.confirmPassword = msg;
          else delete copy.confirmPassword;
        }

        return copy;
      });

      return next;
    });
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    setFieldErrors((prevErrors) => {
      const copy = { ...prevErrors };
      const msg = validateField(name, value, formData);
      if (msg) copy[name] = msg;
      else delete copy[name];
      return copy;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const nextErrors = validateAll(formData);
    setFieldErrors(nextErrors);
    setTouched({
      email: true,
      full_name: true,
      password: true,
      confirmPassword: true,
      father_name: true,
      mother_name: true,
      udise_code: true,
      mobile_number: true,
      aadhaar_number: true,
    });

    if (Object.keys(nextErrors).length > 0) {
      setError('Please correct the highlighted fields and try again.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: formData.email.trim(),
        password: formData.password,
        full_name: formData.full_name.trim(),
        gender: formData.gender || null,
        udise_code: String(formData.udise_code).trim(),
        father_name: formData.father_name.trim() || null,
        mother_name: formData.mother_name.trim() || null,
        date_of_birth: formData.date_of_birth || null,
        aadhaar_number: formData.aadhaar_number.trim() || null,
        mobile_number: formData.mobile_number.trim() || null,
      };

      await post('/api/student/register', payload);
      onSuccess?.();
    } catch (err) {
      setError(err.message || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-form-wrap">
      <div className="auth-modal-form-header">
        <div className="auth-modal-form-header-row">
          <h3 className="auth-modal-form-title">Student Registration</h3>
          {onBack ? (
            <button type="button" className="auth-modal-link-button" onClick={onBack} disabled={loading}>
              ← Back to sign in
            </button>
          ) : null}
        </div>
        <p className="auth-modal-form-subtitle">Create your account to access the scholarship portal.</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form auth-modal-register-form" noValidate>
        <div className="form-row">
          <div className="form-field">
            <label className="form-label" htmlFor="email">
              Email <span className="required">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className={`form-input ${touched.email && fieldErrors.email ? 'input-error' : ''}`}
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(touched.email && fieldErrors.email)}
              disabled={loading}
              style={{ textTransform: "none" }}
            />
            {touched.email && fieldErrors.email && <div className="field-error-text">{fieldErrors.email}</div>}
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="full_name">
              Full Name <span className="required">*</span>
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              className={`form-input ${touched.full_name && fieldErrors.full_name ? 'input-error' : ''}`}
              placeholder="Enter your full name"
              value={formData.full_name}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(touched.full_name && fieldErrors.full_name)}
              disabled={loading}
            />
            {touched.full_name && fieldErrors.full_name && (
              <div className="field-error-text">{fieldErrors.full_name}</div>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label" htmlFor="password">
              Password <span className="required">*</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className={`form-input ${touched.password && fieldErrors.password ? 'input-error' : ''}`}
              placeholder="Min 8 characters"
              value={formData.password}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(touched.password && fieldErrors.password)}
              disabled={loading}
            />
            {touched.password && fieldErrors.password ? (
              <div className="field-error-text">{fieldErrors.password}</div>
            ) : (
              <div className="field-helper-text">Minimum 8 characters.</div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="confirmPassword">
              Confirm Password <span className="required">*</span>
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              className={`form-input ${touched.confirmPassword && fieldErrors.confirmPassword ? 'input-error' : ''}`}
              placeholder="Re-enter password"
              value={formData.confirmPassword}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(touched.confirmPassword && fieldErrors.confirmPassword)}
              disabled={loading}
            />
            {touched.confirmPassword && fieldErrors.confirmPassword && (
              <div className="field-error-text">{fieldErrors.confirmPassword}</div>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label" htmlFor="gender">
              Gender
            </label>
            <select
              id="gender"
              name="gender"
              className="form-input"
              value={formData.gender}
              onChange={handleChange}
              disabled={loading}
            >
              <option value="">Select gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="udise_code">
            School UDISE Code <span className="required">*</span>
          </label>
          <input
            id="udise_code"
            name="udise_code"
            type="text"
            className={`form-input ${touched.udise_code && fieldErrors.udise_code ? 'input-error' : ''}`}
            placeholder="Enter your school's UDISE code"
            value={formData.udise_code}
            onChange={handleChange}
            onBlur={handleBlur}
            aria-invalid={Boolean(touched.udise_code && fieldErrors.udise_code)}
            disabled={loading}
          />
          {touched.udise_code && fieldErrors.udise_code && (
            <div className="field-error-text">{fieldErrors.udise_code}</div>
          )}
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label" htmlFor="father_name">
              Father's Name
            </label>
            <input
              id="father_name"
              name="father_name"
              type="text"
              className={`form-input ${touched.father_name && fieldErrors.father_name ? 'input-error' : ''}`}
              placeholder="Enter father's name"
              value={formData.father_name}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={loading}
              aria-invalid={Boolean(touched.father_name && fieldErrors.father_name)}
            />
            {touched.father_name && fieldErrors.father_name && <div className="field-error-text">{fieldErrors.father_name}</div>}
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="mother_name">
              Mother's Name
            </label>
            <input
              id="mother_name"
              name="mother_name"
              type="text"
              className={`form-input ${touched.mother_name && fieldErrors.mother_name ? 'input-error' : ''}`}
              placeholder="Enter mother's name"
              value={formData.mother_name}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={loading}
              aria-invalid={Boolean(touched.mother_name && fieldErrors.mother_name)}
            />
            {touched.mother_name && fieldErrors.mother_name && <div className="field-error-text">{fieldErrors.mother_name}</div>}
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label" htmlFor="date_of_birth">
              Date of Birth
            </label>
            <input
              id="date_of_birth"
              name="date_of_birth"
              type="date"
              className="form-input"
              value={formData.date_of_birth}
              onChange={handleChange}
              disabled={loading}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="mobile_number">
              Mobile Number
            </label>
            <input
              id="mobile_number"
              name="mobile_number"
              type="tel"
              className={`form-input ${touched.mobile_number && fieldErrors.mobile_number ? 'input-error' : ''}`}
              placeholder="10-digit mobile number"
              value={formData.mobile_number}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={Boolean(touched.mobile_number && fieldErrors.mobile_number)}
              disabled={loading}
              maxLength="10"
            />
            {touched.mobile_number && fieldErrors.mobile_number && (
              <div className="field-error-text">{fieldErrors.mobile_number}</div>
            )}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="aadhaar_number">
            Aadhaar Number
          </label>
          <input
            id="aadhaar_number"
            name="aadhaar_number"
            type="text"
            className={`form-input ${touched.aadhaar_number && fieldErrors.aadhaar_number ? 'input-error' : ''}`}
            placeholder="12-digit Aadhaar number"
            value={formData.aadhaar_number}
            onChange={handleChange}
            onBlur={handleBlur}
            aria-invalid={Boolean(touched.aadhaar_number && fieldErrors.aadhaar_number)}
            disabled={loading}
            maxLength="12"
          />
          {touched.aadhaar_number && fieldErrors.aadhaar_number && (
            <div className="field-error-text">{fieldErrors.aadhaar_number}</div>
          )}
        </div>

        {error && <div className="form-error form-alert">{error}</div>}

        <button type="submit" className="login-button" disabled={loading}>
          {loading ? 'Registering...' : 'Register'}
        </button>

        {onBack ? (
          <div className="register-link-container" style={{ marginTop: '0.75rem' }}>
            <span>Already registered? </span>
            <button type="button" className="register-link" onClick={onBack} disabled={loading}>
              Sign in
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
