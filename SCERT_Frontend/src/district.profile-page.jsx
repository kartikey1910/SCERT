import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { get } from './apiClient.js'

export function DistrictProfilePage() {
  const { auth } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)
      setError('')
      try {
        const data = await get('/api/district/profile', { token: auth.token })
        setProfile(data.profile)
      } catch (err) {
        console.error('Failed to fetch district profile:', err)
        setError(err.message || 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }

    if (auth?.token) fetchProfile()
  }, [auth?.token])

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-loading">Loading profile...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="profile-page">
        <div className="profile-error">{error}</div>
      </div>
    )
  }

  return (
    <div className="scert-page district-profile-page">
      <div className="district-profile-left-stack">
        <div className="scert-profile-section">
          <h3 className="scert-profile-section-title">District Information</h3>
          <div className="district-info-rows">
            <div className="district-info-row district-info-row-top">
              <div className="scert-profile-item">
                <label>DISTRICT NAME</label>
                <div className="scert-profile-value">{profile?.district_name || '-'}</div>
              </div>
              <div className="scert-profile-item">
                <label>DISTRICT CODE</label>
                <div className="scert-profile-value">{profile?.district_code || '-'}</div>
              </div>
              <div className="scert-profile-item">
                <label>UNIT ID</label>
                <div className="scert-profile-value">{profile?.unit_id || '-'}</div>
              </div>
            </div>
            <div className="district-info-row district-info-row-bottom">
              <div className="scert-profile-item">
                <label>OFFICE CONTACT NUMBER</label>
                <div className="scert-profile-value">{profile?.contact_number || '-'}</div>
              </div>
              <div className="scert-profile-item">
                <label>OFFICE EMAIL</label>
                <div className="scert-profile-value">{profile?.email || '-'}</div>
              </div>
              <div className="scert-profile-item">
                <label>DISTANCE FROM PAPER DISTRIBUTION CENTER (KM)</label>
                <div className="scert-profile-value">{profile?.distance_from_paper_distribution_center_km || '-'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="scert-profile-section">
          <h3 className="scert-profile-section-title">Bank Details</h3>
          <div className="scert-profile-grid">
            <div className="scert-profile-item">
              <label>ACCOUNT NUMBER</label>
              <div className="scert-profile-value">{profile?.account_no || '-'}</div>
            </div>
            <div className="scert-profile-item">
              <label>IFSC CODE</label>
              <div className="scert-profile-value">{profile?.ifsc_code || '-'}</div>
            </div>
            <div className="scert-profile-item">
              <label>BANK NAME</label>
              <div className="scert-profile-value">{profile?.bank_name || '-'}</div>
            </div>
          </div>
        </div>

        <div className="scert-profile-section">
          <h3 className="scert-profile-section-title">CEO Details</h3>
          <div className="scert-profile-grid">
            <div className="scert-profile-item">
              <label>NAME</label>
              <div className="scert-profile-value">{profile?.ceo_name || '-'}</div>
            </div>
            <div className="scert-profile-item">
              <label>MOBILE</label>
              <div className="scert-profile-value">{profile?.ceo_mobile || '-'}</div>
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
      </div>
    </div>
  )
}

