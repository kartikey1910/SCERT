import { useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { put } from './apiClient.js';

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

export function StudentProfileEditForm({ initialProfile, onSuccess, onClose }) {
  const { auth } = useAuth();

  const initial = useMemo(
    () => ({
      full_name: initialProfile?.full_name || '',
      age: initialProfile?.age ?? '',
      gender: initialProfile?.gender || '',
      school_name: initialProfile?.school_name || '',
      login_id: initialProfile?.login_id || '',
      father_name: initialProfile?.father_name || '',
      mother_name: initialProfile?.mother_name || '',
      date_of_birth: initialProfile?.date_of_birth ? initialProfile.date_of_birth.slice(0, 10) : '',
      aadhaar_number: initialProfile?.aadhaar_number || '',
      mobile_number: initialProfile?.mobile_number || '',
    }),
    [initialProfile]
  );

  const [formData, setFormData] = useState({
    full_name: initial.full_name,
    age: initial.age,
    gender: initial.gender,
    father_name: initial.father_name,
    mother_name: initial.mother_name,
    date_of_birth: initial.date_of_birth,
    aadhaar_number: initial.aadhaar_number,
    mobile_number: initial.mobile_number,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const nextFieldErrors = {
      full_name: validateNameInput('Full name', formData.full_name, { required: true }),
      father_name: validateNameInput("Father's name", formData.father_name),
      mother_name: validateNameInput("Mother's name", formData.mother_name),
    };

    Object.keys(nextFieldErrors).forEach((key) => {
      if (!nextFieldErrors[key]) delete nextFieldErrors[key];
    });

    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError('Please correct the highlighted fields and try again.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        full_name: formData.full_name.trim(),
        gender: formData.gender || null,
        age: formData.age === '' ? null : Number(formData.age),
        father_name: formData.father_name.trim() || null,
        mother_name: formData.mother_name.trim() || null,
        date_of_birth: formData.date_of_birth || null,
        aadhaar_number: formData.aadhaar_number.trim() || null,
        mobile_number: formData.mobile_number.trim() || null,
      };

      await put('/api/student/profile/edit', payload, { token: auth?.token });
      onSuccess?.();
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!loading) onClose?.();
      }}
    >
      <div
        className="modal-content profile-modal scert-violet-modal student-profile-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div>
              <h2 className="modal-title scert-violet-modal-title">Edit Your Student Profile</h2>
              <p className="modal-subtitle">Update your details and save changes.</p>
            </div>
            {onClose && (
              <button
                type="button"
                className="auth-password-close"
                onClick={onClose}
                aria-label="Close"
                disabled={loading}
              >
                x
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form profile-form">
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Login ID</label>
              <input
                type="text"
                className="form-input"
                value={initial.login_id || '-'}
                disabled
                readOnly
              />
            </div>
            <div className="form-field">
              <label className="form-label">School Name</label>
              <input
                type="text"
                className="form-input"
                value={initial.school_name || '—'}
                disabled
                readOnly
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="full_name">
                Full Name <span className="required">*</span>
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                className={`form-input ${fieldErrors.full_name ? 'input-error' : ''}`}
                placeholder="Enter your full name"
                value={formData.full_name}
                onChange={(e) => setFormData((p) => ({ ...p, full_name: e.target.value }))}
                disabled={loading}
                aria-invalid={Boolean(fieldErrors.full_name)}
              />
              {fieldErrors.full_name && <div className="field-error-text">{fieldErrors.full_name}</div>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="age">
                Age
              </label>
              <input
                id="age"
                name="age"
                type="number"
                min="1"
                className="form-input"
                placeholder="Age"
                value={formData.age}
                onChange={(e) => setFormData((p) => ({ ...p, age: e.target.value }))}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="gender">
              Gender
            </label>
            <select
              id="gender"
              name="gender"
              className="form-input"
              value={formData.gender}
              onChange={(e) => setFormData((p) => ({ ...p, gender: e.target.value }))}
              disabled={loading}
            >
              <option value="">Select</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
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
                className={`form-input ${fieldErrors.father_name ? 'input-error' : ''}`}
                placeholder="Enter father's name"
                value={formData.father_name}
                onChange={(e) => setFormData((p) => ({ ...p, father_name: e.target.value }))}
                disabled={loading}
                aria-invalid={Boolean(fieldErrors.father_name)}
              />
              {fieldErrors.father_name && <div className="field-error-text">{fieldErrors.father_name}</div>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="mother_name">
                Mother's Name
              </label>
              <input
                id="mother_name"
                name="mother_name"
                type="text"
                className={`form-input ${fieldErrors.mother_name ? 'input-error' : ''}`}
                placeholder="Enter mother's name"
                value={formData.mother_name}
                onChange={(e) => setFormData((p) => ({ ...p, mother_name: e.target.value }))}
                disabled={loading}
                aria-invalid={Boolean(fieldErrors.mother_name)}
              />
              {fieldErrors.mother_name && <div className="field-error-text">{fieldErrors.mother_name}</div>}
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
                onChange={(e) => setFormData((p) => ({ ...p, date_of_birth: e.target.value }))}
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
                className="form-input"
                placeholder="10-digit mobile number"
                value={formData.mobile_number}
                onChange={(e) => setFormData((p) => ({ ...p, mobile_number: e.target.value }))}
                disabled={loading}
                maxLength="10"
              />
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
              className="form-input"
              placeholder="12-digit Aadhaar number"
              value={formData.aadhaar_number}
              onChange={(e) => setFormData((p) => ({ ...p, aadhaar_number: e.target.value }))}
              disabled={loading}
              maxLength="50"
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="password-form-actions" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


