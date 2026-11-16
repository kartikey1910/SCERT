import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { ScertProfileForm } from './ScertProfileForm.jsx';

export function ScertProfilePage() {
  const { auth } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showEditProfile, setShowEditProfile] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get('/api/scert/profile', { token: auth.token });
      setUser(data.user);
      setProfile(data.profile);
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      setError(err.message || 'Failed to load profile');
      toast.error(`Failed to load profile: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [auth.token]);

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-loading">Loading profile...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-page">
        <div className="profile-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="scert-page">
      <div className="profile-header-with-button">
        <h2 className="profile-page-title">SCERT Profile</h2>
        <button
          type="button"
          className="profile-edit-btn"
          onClick={() => setShowEditProfile(true)}
        >
          Edit Profile
        </button>
      </div>

      <div className="scert-profile-section">
        <h3 className="scert-profile-section-title">Login Information</h3>
        <div className="scert-profile-grid">
          <div className="scert-profile-item">
            <label>USER ID</label>
            <div className="scert-profile-value">{user?.user_id}</div>
          </div>
          <div className="scert-profile-item">
            <label>LOGIN ID</label>
            <div className="scert-profile-value">{user?.login_id}</div>
          </div>
        </div>
      </div>

      <div className="scert-profile-section">
        <h3 className="scert-profile-section-title">Institute Information</h3>
        <div className="scert-profile-grid">
          <div className="scert-profile-item">
            <label>INSTITUTE NAME</label>
            <div className="scert-profile-value">{profile?.institute_name || '-'}</div>
          </div>
          <div className="scert-profile-item">
            <label>ADDRESS</label>
            <div className="scert-profile-value">{profile?.address || '-'}</div>
          </div>
          <div className="scert-profile-item">
            <label>CONTACT NUMBER</label>
            <div className="scert-profile-value">{profile?.contact_number || '-'}</div>
          </div>
          <div className="scert-profile-item">
            <label>EMAIL</label>
            <div className="scert-profile-value">{profile?.email || '-'}</div>
          </div>
        </div>
      </div>

      <div className="scert-profile-section">
        <h3 className="scert-profile-section-title">Additional Director Details</h3>
        <div className="scert-profile-grid">
          <div className="scert-profile-item">
            <label>NAME</label>
            <div className="scert-profile-value">{profile?.additional_director_name || '-'}</div>
          </div>
          <div className="scert-profile-item">
            <label>MOBILE</label>
            <div className="scert-profile-value">{profile?.additional_director_mobile || '-'}</div>
          </div>
        </div>
      </div>

      <div className="scert-profile-section">
        <h3 className="scert-profile-section-title">Dealing Person Details</h3>
        <div className="scert-profile-grid">
          <div className="scert-profile-item">
            <label>NAME</label>
            <div className="scert-profile-value">{profile?.dealing_person_name || '-'}</div>
          </div>
          <div className="scert-profile-item">
            <label>MOBILE</label>
            <div className="scert-profile-value">{profile?.dealing_person_mobile || '-'}</div>
          </div>
        </div>
      </div>

      {showEditProfile && (
        <ScertProfileForm
          onClose={() => setShowEditProfile(false)}
          onSuccess={() => {
            setShowEditProfile(false);
            fetchProfile();
          }}
        />
      )}
    </div>
  );
}
