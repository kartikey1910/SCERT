import { useState, useEffect } from 'react';
import { get, put } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';

export function DistrictProfileForm({ mode = 'complete', onSuccess, onError, onClose }) {
  const { auth } = useAuth();
  const isEdit = String(mode).toLowerCase() === 'edit';

  const [readOnlyData, setReadOnlyData] = useState({
    district_name: '',
    district_code: '',
    unit_id: '',
  });

  const [formData, setFormData] = useState({
    ceo_name: '',
    district_location: '',
    address: '',
    ceo_mobile: '',
    account_no: '',
    ifsc_code: '',
    bank_name: '',
    contact_number: '',
    email: '',
    dealing_person_name: '',
    dealing_person_mobile: '',
    distance_from_paper_distribution_center_km: '',
  });

  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await get('/api/district/profile', { token: auth?.token });
        if (data.profile) {
          setReadOnlyData({
            district_name: data.profile.district_name || '',
            district_code: data.profile.district_code || '',
            unit_id: data.profile.unit_id || '',
          });

          setFormData({
            ceo_name: data.profile.ceo_name || '',
            district_location: data.profile.district_location || '',
            address: data.profile.address || '',
            ceo_mobile: data.profile.ceo_mobile || '',
            account_no: data.profile.account_no || '',
            ifsc_code: data.profile.ifsc_code || '',
            bank_name: data.profile.bank_name || '',
            contact_number: data.profile.contact_number || '',
            email: data.profile.email || '',
            dealing_person_name: data.profile.dealing_person_name || '',
            dealing_person_mobile: data.profile.dealing_person_mobile || '',
            distance_from_paper_distribution_center_km: data.profile.distance_from_paper_distribution_center_km || '',
          });
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setFetchingProfile(false);
      }
    };

    fetchProfile();
  }, [auth?.token]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.ceo_name) {
      setError('Please fill all required fields');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isEdit ? '/api/district/profile/edit' : '/api/district/profile/complete';
      const payload = {
        ...formData,
        // Backend requires district_location; keep existing value from profile, else fallback.
        district_location: formData.district_location || readOnlyData.district_name || 'N/A',
      };
      await put(endpoint, payload, { token: auth?.token });
      onSuccess?.();
    } catch (err) {
      const errorMsg = err.message || 'Failed to complete profile';
      setError(errorMsg);
      if (onError) onError(errorMsg);
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
              <h2 className="modal-title auth-profile-title">
                {isEdit ? 'Edit Your District Profile' : 'Complete Your District Profile'}
              </h2>
              <p className="modal-subtitle">
                {isEdit
                  ? 'Update your profile details and save changes.'
                  : 'Please provide the following details to complete your profile.'}
              </p>
            </div>
            {onClose && (
              <button type="button" className="auth-password-close" onClick={onClose} aria-label="Close">
                x
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form profile-form">
          {readOnlyData.district_name && (
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">District Name</label>
                <input type="text" className="form-input" value={readOnlyData.district_name} disabled readOnly />
              </div>
              <div className="form-field">
                <label className="form-label">District Code</label>
                <input type="text" className="form-input" value={readOnlyData.district_code} disabled readOnly />
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Unit ID</label>
              <input type="text" className="form-input" value={readOnlyData.unit_id} disabled readOnly />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="address">
                Address
              </label>
              <input
                id="address"
                name="address"
                type="text"
                className="form-input"
                placeholder="Enter complete address"
                value={formData.address}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="distance_from_paper_distribution_center_km">
                Distance from Paper Distribution Center (in km)
              </label>
              <input
                id="distance_from_paper_distribution_center_km"
                name="distance_from_paper_distribution_center_km"
                type="number"
                min="0"
                step="0.1"
                className="form-input"
                placeholder="Enter distance in km"
                value={formData.distance_from_paper_distribution_center_km}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="contact_number">
                Contact Number of CEO Office
              </label>
              <input
                id="contact_number"
                name="contact_number"
                type="tel"
                className="form-input"
                placeholder="Enter contact number"
                value={formData.contact_number}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="email">
                Email of CEO Office <span className="required">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="form-input"
                placeholder="Enter email address"
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>


          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="account_no">
                Account Number
              </label>
              <input
                id="account_no"
                name="account_no"
                type="text"
                className="form-input"
                placeholder="Enter account number"
                value={formData.account_no}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="ifsc_code">
                IFSC Code
              </label>
              <input
                id="ifsc_code"
                name="ifsc_code"
                type="text"
                className="form-input"
                placeholder="Enter IFSC code"
                value={formData.ifsc_code}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="bank_name">
                Bank Name
              </label>
              <input
                id="bank_name"
                name="bank_name"
                type="text"
                className="form-input"
                placeholder="Enter bank name"
                value={formData.bank_name}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>


          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="ceo_name">
                CEO Name <span className="required">*</span>
              </label>
              <input
                id="ceo_name"
                name="ceo_name"
                type="text"
                className="form-input"
                placeholder="Enter CEO name"
                value={formData.ceo_name?.toUpperCase() || ''}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="ceo_mobile">
                CEO Mobile <span className="required">*</span>
              </label>
              <input
                id="ceo_mobile"
                name="ceo_mobile"
                type="tel"
                className="form-input"
                placeholder="Enter CEO mobile number"
                value={formData.ceo_mobile}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>


          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="dealing_person_name">
                Dealing Person Name <span className="required">*</span>
              </label>
              <input
                id="dealing_person_name"
                name="dealing_person_name"
                type="text"
                className="form-input"
                placeholder="Enter dealing person name"
                value={formData.dealing_person_name?.toUpperCase() || ''}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="dealing_person_mobile">
                Dealing Person Mobile <span className="required">*</span>
              </label>
              <input
                id="dealing_person_mobile"
                name="dealing_person_mobile"
                type="tel"
                className="form-input"
                placeholder="Enter dealing person mobile"
                value={formData.dealing_person_mobile}
                onChange={handleChange}
                disabled={loading}
                required
              />
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="modal-button auth-profile-button" disabled={loading}>
            {loading ? 'Saving Profile...' : isEdit ? 'Save Changes' : 'Complete Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
