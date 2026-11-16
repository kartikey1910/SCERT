import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  HiOutlineAcademicCap,
  HiOutlineBadgeCheck,
  HiOutlineChartBar,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineCog,
  HiOutlineDocumentReport,
  HiOutlineHome,
  HiOutlineLogout,
  HiOutlineLockClosed,
  HiOutlineUser,
  HiOutlineViewGrid,
  HiOutlineVideoCamera,
} from 'react-icons/hi'
import { useAuth } from './AuthContext.jsx'
import { get } from './apiClient.js'
import { HowToApplyGuide } from './HowToApplyGuide.jsx'
import { pickDefaultScholarship } from './utils/defaultScholarship.js'
import { DistrictProfilePage } from './district.profile-page.jsx'
import { DistrictSchoolListPage } from './district.school-list-page.jsx'
import { DistrictProfileForm } from './DistrictProfileForm.jsx'
import { DistrictProgressReports } from './district.progress-reports.jsx'
import { DistrictApprovedStudentsPage } from './district.approved-students-page.jsx'
import { DistrictCentersPage } from './district.centers-page.jsx'
import { DistrictDashboardHome } from './DistrictDashboardHome.jsx'
import { DistrictSubmittedApplicationsPage } from './district.submitted-applications-page.jsx'
import { DistrictBeoListPage } from './district.beo-list-page.jsx'
import { DistrictAbsenteeDuringExamPage } from './district.absentee-during-exam-page.jsx'
import { DistrictResultPage } from './district.result-page.jsx'
import { DistrictSelectedStudentsPage } from './district.selected-students-page.jsx'

function DistrictDashboardContent() {
  const navigate = useNavigate()
  const { logout, auth } = useAuth()

  // Match SCERT dashboard behavior: sessions + scholarships fetched from SCERT endpoints.
  const [sessions, setSessions] = useState([])
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [scholarships, setScholarships] = useState([])
  const [selectedScholarshipId, setSelectedScholarshipId] = useState(null)
  const [loadingScholarships, setLoadingScholarships] = useState(false)

  const selectedSession = sessions.find((s) => s.session_id === selectedSessionId)

  const [active, setActive] = useState('dashboard')
  // Counter to force a remount on navigation, even back to the same tab, so
  // its data refetches instead of showing whatever it last fetched (e.g. a
  // Registered Students count that doesn't move until the view remounts).
  const [navCounter, setNavCounter] = useState(0)
  const navigateTo = (page) => {
    setActive(page)
    setNavCounter((prev) => prev + 1)
  }
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [profileViewKey, setProfileViewKey] = useState(0)
  const [districtProfile, setDistrictProfile] = useState(null)
  const [expandedSections, setExpandedSections] = useState({ administration: true })
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const sessionDropdownRef = useRef(null)
  const [scholarshipDropdownOpen, setScholarshipDropdownOpen] = useState(false)
  const scholarshipDropdownRef = useRef(null)

  const toggleSection = (section) => {
    setExpandedSections((prev) => {
      const isCurrentlyExpanded = prev[section]
      const next = {}
      if (!isCurrentlyExpanded) next[section] = true
      return next
    })
  }

  // Fetch available sessions (same as SCERT dashboard)
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await get('/api/sessions', { token: auth.token })
        setSessions(Array.isArray(data) ? data : [])

        const activeSession = Array.isArray(data) ? data.find((s) => s.is_active) : null
        if (activeSession) {
          setSelectedSessionId(activeSession.session_id)
        } else if (Array.isArray(data) && data.length > 0) {
          setSelectedSessionId(data[0].session_id)
        }
      } catch (err) {
        console.error('Failed to fetch sessions:', err)
        setSessions([])
      } finally {
        setLoadingSessions(false)
      }
    }

    if (auth?.token) fetchSessions()
  }, [auth?.token])

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [active])

  // Fetch district profile (for dashboard title + home card)
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await get('/api/district/profile', { token: auth.token })
        setDistrictProfile(data?.profile || null)
      } catch (err) {
        console.error('Failed to fetch district profile:', err)
        setDistrictProfile(null)
      }
    }

    if (auth?.token) fetchProfile()
  }, [auth?.token])

  // Fetch scholarships for selected session (same as SCERT dashboard)
  useEffect(() => {
    const fetchScholarships = async () => {
      if (!selectedSessionId) return

      setLoadingScholarships(true)
      try {
        const data = await get('/api/scholarships', {
          token: auth.token,
          sessionId: selectedSessionId,
        })

        setScholarships(Array.isArray(data) ? data : [])
        // Pre-select the newest ACTIVE scholarship (newest overall if none is active)
        const defaultScholarship = pickDefaultScholarship(data)
        setSelectedScholarshipId(defaultScholarship ? defaultScholarship.scholarship_id : null)
      } catch (err) {
        console.error('Failed to fetch scholarships:', err)
        setScholarships([])
        setSelectedScholarshipId(null)
      } finally {
        setLoadingScholarships(false)
      }
    }

    if (auth?.token) fetchScholarships()
  }, [selectedSessionId, auth?.token])

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target)) {
        setSessionDropdownOpen(false)
      }
      if (scholarshipDropdownRef.current && !scholarshipDropdownRef.current.contains(e.target)) {
        setScholarshipDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-logout on session expiry
  useEffect(() => {
    const handleSessionExpired = () => {
      logout()
      navigate('/', { replace: true })
    }
    window.addEventListener('auth:session-expired', handleSessionExpired)
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired)
  }, [logout, navigate])

  const renderContent = () => {
    const sessionName = selectedSession?.session_name || '—'
    const schemeName = scholarships.find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || '—'
    // Forces a remount on navigation, even back to the same tab, so it
    // refetches instead of showing whatever it last fetched.
    const key = `${active}-${navCounter}`

    if (active === 'dashboard') {
      return (
        <DistrictDashboardHome
          key={key}
          districtProfile={districtProfile}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          selectedScholarshipName={schemeName === '—' ? '' : schemeName}
          onNavigate={navigateTo}
        />
      )
    }

    if (active === 'how-to-apply') {
      // The District tutorials SCERT pushes from the CMS (the "District" role tab).
      return <HowToApplyGuide key={active} audience="district" embedded />
    }

    if (active === 'profile') {
      return (
        <div className="applications-view">
          <div className="view-header-row" style={{ alignItems: 'center', height: 'auto', marginBottom: '0.75rem' }}>
            <h3 className="view-title" style={{ margin: 0 }}>Profile</h3>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => setShowEditProfile(true)}
            >
              Edit Profile
            </button>
          </div>

          {showEditProfile && (
            <DistrictProfileForm
              mode="edit"
              onClose={() => setShowEditProfile(false)}
              onSuccess={() => {
                setShowEditProfile(false)
                setProfileViewKey((k) => k + 1)
              }}
            />
          )}
          <DistrictProfilePage
            key={profileViewKey}
          />
        </div>
      )
    }

    if (active === 'school-list') {
      return (
        <DistrictSchoolListPage
          key={key}
          selectedScholarshipId={selectedScholarshipId}
          sessionId={selectedSessionId}
        />
      )
    }

    if (active === 'beo-list') {
      return <DistrictBeoListPage key={key} />
    }

    if (active === 'change-password') {
      return (
        <div className="applications-view">
          <h3 className="view-title">Change Password</h3>
          <p className="view-subtitle">Use the “Change Password” option from your profile or first-time login flow.</p>
          <div className="empty-state">This section will be wired to the password workflow next.</div>
        </div>
      )
    }

    if (active === 'reports-progress') {
      return (
        <DistrictProgressReports
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          selectedScholarshipName={schemeName}
          onNavigate={navigateTo}
        />
      )
    }

    if (active === 'reports-approved') {
      return (
        <DistrictApprovedStudentsPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          selectedScholarshipName={schemeName}
        />
      )
    }

    if (active === 'reports-centers') {
      return (
        <DistrictCentersPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          selectedScholarshipName={schemeName}
        />
      )
    }

    if (active === 'absentee-during-exam') {
      return (
        <DistrictAbsenteeDuringExamPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          selectedScholarshipName={schemeName}
        />
      )
    }

    if (active === 'reports-submitted') {
      return (
        <DistrictSubmittedApplicationsPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          selectedScholarshipName={schemeName}
        />
      )
    }

    if (active === 'reports-result') {
      return (
        <DistrictResultPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          sessionName={sessionName}
          schemeName={schemeName}
        />
      )
    }

    if (active === 'reports-selected-students') {
      return (
        <DistrictSelectedStudentsPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          sessionName={sessionName}
          schemeName={schemeName}
        />
      )
    }

    return <div className="empty-state">Select an option from the sidebar.</div>
  }

  return (
    <div className="scert-dash-root">
      <div className="scert-dash-topbar">
        <div className="scert-dash-topbar-left">
          <button
            type="button"
            className="mobile-sidebar-toggle"
            aria-label="Toggle menu"
            onClick={() => setMobileSidebarOpen((prev) => !prev)}
          >
            {mobileSidebarOpen ? '✕' : '☰'}
          </button>
          <img src="/scert-logo.png" alt="SCERT" className="scert-topbar-logo" />
        </div>

        <div className="scert-dash-topbar-filters">
          <div className="custom-dropdown" ref={sessionDropdownRef}>
            <button
              type="button"
              className="custom-dropdown-trigger"
              onClick={() => !loadingSessions && setSessionDropdownOpen(!sessionDropdownOpen)}
              disabled={loadingSessions}
            >
              <span className="custom-dropdown-text">
                {loadingSessions ? (
                  'Loading...'
                ) : sessions.length === 0 ? (
                  'No sessions'
                ) : (
                  <>
                    {selectedSession?.session_name || 'Select Session'}
                    {selectedSession?.is_active && <span className="active-glow">(Active)</span>}
                  </>
                )}
              </span>
              <span className="custom-dropdown-arrow">{sessionDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {sessionDropdownOpen && sessions.length > 0 && (
              <div className="custom-dropdown-menu">
                {sessions.map((session) => (
                  <button
                    key={session.session_id}
                    type="button"
                    className={`custom-dropdown-item ${selectedSessionId === session.session_id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedSessionId(session.session_id)
                      setSessionDropdownOpen(false)
                    }}
                  >
                    {session.session_name}
                    {session.is_active && <span className="active-glow">(Active)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="custom-dropdown" ref={scholarshipDropdownRef}>
            <button
              type="button"
              className="custom-dropdown-trigger"
              onClick={() => !loadingScholarships && scholarships.length > 0 && setScholarshipDropdownOpen(!scholarshipDropdownOpen)}
              disabled={loadingScholarships || scholarships.length === 0}
            >
              <span className="custom-dropdown-text">
                {loadingScholarships ? 'Loading...' : scholarships.length === 0 ? 'No scholarships' : (
                  scholarships.find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || 'Select Scholarship'
                )}
              </span>
              <span className="custom-dropdown-arrow">{scholarshipDropdownOpen ? '▲' : '▼'}</span>
            </button>

            {scholarshipDropdownOpen && scholarships.length > 0 && (
              <div className="custom-dropdown-menu">
                {scholarships.map((sch) => (
                  <button
                    key={sch.scholarship_id}
                    type="button"
                    className={`custom-dropdown-item ${selectedScholarshipId === sch.scholarship_id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedScholarshipId(sch.scholarship_id)
                      setScholarshipDropdownOpen(false)
                    }}
                  >
                    {sch.scholarship_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label="Close menu"
        className={`mobile-sidebar-overlay ${mobileSidebarOpen ? 'is-open' : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <div className="scert-dash-layout">
        <aside className={`scert-dash-sidebar ${mobileSidebarOpen ? 'is-open' : ''}`}>
          <nav className="scert-dash-nav" onClick={() => setMobileSidebarOpen(false)}>
            <button
              type="button"
              className={active === 'dashboard' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
              onClick={() => navigateTo('dashboard')}
            >
              <span className="scert-dash-link-icon">
                <HiOutlineHome />
              </span>
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              className={active === 'how-to-apply' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
              onClick={() => navigateTo('how-to-apply')}
            >
              <span className="scert-dash-link-icon">
                <HiOutlineVideoCamera />
              </span>
              <span>Tutorial</span>
            </button>
            <div className="scert-nav-section">
              <button
                type="button"
                className="scert-nav-section-header"
                onClick={() => toggleSection('administration')}
              >
                <span className="scert-nav-section-icon">
                  <HiOutlineCog />
                </span>
                <span>Administration</span>
                <span className="scert-nav-section-arrow">
                  {expandedSections.administration ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
                </span>
              </button>

              {expandedSections.administration && (
                <div className="scert-nav-section-items">
                  <button
                    type="button"
                    className={active === 'profile' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                    onClick={() => {
                      setShowEditProfile(false)
                      navigateTo('profile')
                    }}
                  >
                    <span>Profile</span>
                  </button>

                  <button
                    type="button"
                    className={
                      active === 'change-password'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('change-password')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineLockClosed />
                    </span>
                    <span>Change Password</span>
                  </button>
                </div>
              )}
            </div>

            <div className="scert-nav-section">
              <button type="button" className="scert-nav-section-header" onClick={() => toggleSection('reports')}>
                <span className="scert-nav-section-icon">
                  <HiOutlineDocumentReport />
                </span>
                <span>Reports</span>
                <span className="scert-nav-section-arrow">
                  {expandedSections.reports ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
                </span>
              </button>

              {expandedSections.reports && (
                <div className="scert-nav-section-items">
                  <button
                    type="button"
                    className={
                      active === 'reports-progress'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('reports-progress')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineChartBar />
                    </span>
                    <span>Progress Report</span>
                  </button>

                  <button
                    type="button"
                    className={
                      active === 'reports-submitted'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('reports-submitted')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineDocumentReport />
                    </span>
                    <span>Submitted Applications</span>
                  </button>

                  <button
                    type="button"
                    className={
                      active === 'reports-approved'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('reports-approved')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineBadgeCheck />
                    </span>
                    <span>Approved Applications</span>
                  </button>

                  <button
                    type="button"
                    className={
                      active === 'reports-centers'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('reports-centers')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineViewGrid />
                    </span>
                    <span>List of Centers</span>
                  </button>

                  <button
                    type="button"
                    className={
                      active === 'absentee-during-exam'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('absentee-during-exam')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineDocumentReport />
                    </span>
                    <span>Absentee During Exam</span>
                  </button>

                  <button
                    type="button"
                    className={
                      active === 'reports-selected-students'
                        ? 'scert-dash-link scert-dash-link-active'
                        : 'scert-dash-link'
                    }
                    onClick={() => navigateTo('reports-selected-students')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineBadgeCheck />
                    </span>
                    <span>Selected Students</span>
                  </button>

                  <button
                    type="button"
                    className={active === 'school-list' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                    onClick={() => navigateTo('school-list')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineViewGrid />
                    </span>
                    <span>List of Schools</span>
                  </button>

                  <button
                    type="button"
                    className={active === 'beo-list' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                    onClick={() => navigateTo('beo-list')}
                  >
                    <span className="scert-dash-link-icon">
                      <HiOutlineUser />
                    </span>
                    <span>List of BEOs</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              className={active === 'reports-result' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
              onClick={() => navigateTo('reports-result')}
            >
              <span className="scert-dash-link-icon">
                <HiOutlineAcademicCap />
              </span>
              <span>Result</span>
            </button>
          </nav>

          <button
            className="scert-dash-logout"
            onClick={() => {
              logout()
              navigate('/', { replace: true })
            }}
          >
            <span className="scert-dash-link-icon">
              <HiOutlineLogout />
            </span>
            <span>Sign Out</span>
          </button>
        </aside>

        <main className="scert-dash-main">
          <div className="school-info-bar">
            <div className="school-info-name">
               {'Chief Education Officer ' + (districtProfile?.district_name || 'District')}
            </div>
            <div className="school-info-details">
              <div className="school-info-item">
                <span className="school-info-label">District</span>
                <span className="school-info-value">{districtProfile?.district_name || 'N/A'}</span>
              </div>
              <div className="school-info-divider" />
              <div className="school-info-item">
                <span className="school-info-label">District Code</span>
                <span className="school-info-value">{districtProfile?.district_code || 'N/A'}</span>
              </div>
              <div className="school-info-divider" />
              <div className="school-info-item">
                <span className="school-info-label">CEO Name</span>
                <span className="school-info-value">{districtProfile?.ceo_name || 'N/A'}</span>
              </div>
              <div className="school-info-divider" />
              <div className="school-info-item">
                <span className="school-info-label">Mobile No.</span>
                <span className="school-info-value">{districtProfile?.ceo_mobile || 'N/A'}</span>
              </div>
              <div className="school-info-divider" />
              <div className="school-info-item">
                <span className="school-info-label">Office Mail ID</span>
                <span className="school-info-value">{districtProfile?.email || 'N/A'}</span>
              </div>
            </div>
          </div>
          <div className="scert-dash-content">{renderContent()}</div>
        </main>
      </div>
    </div>
  )
}

export function DistrictDashboard() {
  return <DistrictDashboardContent />
}
