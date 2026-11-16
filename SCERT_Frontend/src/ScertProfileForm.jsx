import { useEffect, useState } from 'react';
import { get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

export function ScertProfileForm({ onSuccess, onClose, onError }) {
  const { auth } = useAuth();
  const toast = useToast();

  const [formData, setFormData] = useState({
    institute_name: '',
    address: '',
    contact_number: '',
    email: '',
    additional_director_name: '',
    additional_director_mobile: '',
    dealing_person_name: '',
    dealing_person_mobile: '',
  });
  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await get('/api/scert/profile', { token: auth?.token });
        const profile = data?.profile || {};
        setFormData({
          institute_name: profile.institute_name || '',
          address: profile.address || '',
          contact_number: profile.contact_number || '',
          email: profile.email || '',
          additional_director_name: profile.additional_director_name || '',
          additional_director_mobile: profile.additional_director_mobile || '',
          dealing_person_name: profile.dealing_person_name || '',
          dealing_person_mobile: profile.dealing_person_mobile || '',
        });
      } catch (err) {
        const msg = toast.getErrorMessage(err, 'Failed to load profile');
        setError(msg);
        toast.error(`Failed to load profile: ${msg}`);
      } finally {
        setFetchingProfile(false);
      }
    };

    fetchProfile();
  }, [auth?.token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue =
      name === 'additional_director_name' || name === 'dealing_person_name'
        ? String(value || '').toUpperCase()
        : value;
    setFormData((prev) => ({ ...prev, [name]: nextValue }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.institute_name || !formData.address || !formData.additional_director_name) {
      const msg = 'Please fill all required fields';
      setError(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    try {
      await put('/api/scert/profile/edit', formData, { token: auth?.token });
      toast.success('Profile updated successfully');
      onSuccess?.();
    } catch (err) {
      const msg = toast.getErrorMessage(err, 'Failed to update profile');
      setError(msg);
      toast.error(`Failed to update profile: ${msg}`);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay auth-profile-overlay">
      <div className="modal-content profile-modal auth-profile-modal">
        <div className="modal-header auth-profile-header">
          <div className="auth-password-header-row">
            <div>
              <h2 className="modal-title auth-profile-title">Edit SCERT Profile</h2>
              <p className="modal-subtitle">Update profile details and save changes.</p>
            </div>
            {onClose && (
              <button
                type="button"
                className="auth-password-close"
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form profile-form">
          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="institute_name">
                Institute Name <span className="required">*</span>
              </label>
              <input
                id="institute_name"
                name="institute_name"
                type="text"
                className="form-input"
                value={formData.institute_name}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="contact_number">
                Contact Number
              </label>
              <input
                id="contact_number"
                name="contact_number"
                type="tel"
                className="form-input"
                value={formData.contact_number}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field full-width">
              <label className="form-label" htmlFor="address">
                Address <span className="required">*</span>
              </label>
              <textarea
                id="address"
                name="address"
                rows="3"
                className="form-input"
                value={formData.address}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="form-input"
                value={formData.email}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="additional_director_name">
                Additional Director Name <span className="required">*</span>
              </label>
              <input
                id="additional_director_name"
                name="additional_director_name"
                type="text"
                className="form-input"
                value={formData.additional_director_name}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="additional_director_mobile">
                Additional Director Mobile
              </label>
              <input
                id="additional_director_mobile"
                name="additional_director_mobile"
                type="tel"
                className="form-input"
                value={formData.additional_director_mobile}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="dealing_person_name">
                Dealing Person Name
              </label>
              <input
                id="dealing_person_name"
                name="dealing_person_name"
                type="text"
                className="form-input"
                value={formData.dealing_person_name}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="dealing_person_mobile">
                Dealing Person Mobile
              </label>
              <input
                id="dealing_person_mobile"
                name="dealing_person_mobile"
                type="tel"
                className="form-input"
                value={formData.dealing_person_mobile}
                onChange={handleChange}
                disabled={loading || fetchingProfile}
              />
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions profile-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || fetchingProfile}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
