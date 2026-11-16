import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { pickDefaultScholarship } from './utils/defaultScholarship.js';
import {
  HiOutlineHome,
  HiOutlinePlus, 
  HiOutlineViewGrid, 
  HiOutlineCog, 
  HiOutlineCheckCircle, 
  HiOutlineDownload, 
  HiOutlineDocumentReport, 
  HiOutlineChartBar, 
  HiOutlineBadgeCheck,
  HiOutlineLogout,
  HiOutlineChevronRight,
  HiOutlineChevronDown,
  HiOutlineBell,
  HiOutlineLockClosed
} from 'react-icons/hi';
import { ScertScholarshipCreatePage } from './scert.scholarship-create-page.jsx';
import { ScertScholarshipsListPage } from './scert.scholarships-list-page.jsx';
import { ScertRolesPage } from './scert.roles-page.jsx';
import { ScertProfilePage } from './scert.profile-page.jsx';
import { ChangePasswordModal } from './ChangePasswordModal.jsx';
import { ScertPendingApplicationsPage } from './scert.pending-applications-page.jsx';
import { ScertReturnedToBeoPage } from './scert.returned-to-beo-page.jsx';
import { ScertApprovedApplicationsPage } from './scert.approved-applications-page.jsx';
import { ScertNominalRollPage } from './scert.nominal-roll-page.jsx';
import { ScertVerificationFormPage } from './scert.verification-form-page.jsx';
import { ScertAdmitCardsPage } from './scert.admit-cards-page.jsx';
import { ScertDashboardHome } from './ScertDashboardHome.jsx';
import { ScertCsReports } from './ScertCsReports.jsx';
import { ScertProgressReports } from './ScertProgressReports.jsx';
import { ScertListCentersPage } from './scert.list-centers-page.jsx';
import { ScertListBeoPage } from './scert.list-beo-page.jsx';
import { ScertListCeoPage } from './scert.list-ceo-page.jsx';
import { ScertAbsenteePage } from './scert.absentee-page.jsx';
import { ScertBeoDetailsPage } from './scert.beo-details-page.jsx';
import { ScertCeoDetailsPage } from './scert.ceo-details-page.jsx';
import { ScertSchoolListReportPage } from './scert.school-list-report-page.jsx';
import { ScertSessionContext } from './scert.session-context.jsx';
import { ScertHomePageCms } from './ScertHomePageCms.jsx';
import { ScertAboutPageCms } from './ScertAboutPageCms.jsx';
import { ScertExemplarQuestionsCms } from './ScertExemplarQuestionsCms.jsx';
import { ScertPublicationsCms } from './ScertPublicationsCms.jsx';
import { ScertAnnouncementsPageCms } from './ScertAnnouncementsPageCms.jsx';
import { ScertImportantCircularsCms } from './ScertImportantCircularsCms.jsx';
import { ScertHowToApplyCms } from './ScertHowToApplyCms.jsx';
import ResultPage from './pages/ResultPage.jsx';
import ResultRankingsPage from './pages/ResultRankingsPage.jsx';
import SchoolParticipationPage from './pages/SchoolParticipationPage.jsx';
import ResultUploadPage from './pages/ResultUploadPage.jsx';
import PublishResultPage from './pages/PublishResultPage.jsx';
import { ExamAnalyticalReportPage } from './pages/ExamAnalyticalReportPage.jsx';
import { OverallPerformanceReportPage } from './pages/OverallPerformanceReportPage.jsx';
import { SummaryReportPage } from './pages/SummaryReportPage.jsx';
import { FullResultPage } from './pages/FullResultPage.jsx';
import { SelectedStudentsPage } from './pages/SelectedStudentsPage.jsx';
import { SubjectWiseReportPage } from './pages/SubjectWiseReportPage.jsx';
import { ScertRateConfigurationPage } from './scert.rate-configuration-page.jsx';
import { ScertNotificationsPage } from './scert.notifications-page.jsx';
import { ScertFeatureLocksPage } from './scert.feature-locks-page.jsx';

export function ScertDashboardLayout() {
  const navigate = useNavigate();
  const { logout, auth } = useAuth();
  const toast = useToast();
  const [active, setActive] = useState('dashboard'); // 'dashboard' | 'create' | 'list' | 'roles' | 'profile' | 'change-password' | 'approve-centers' | etc.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [navCounter, setNavCounter] = useState(0); // Counter to force remount
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [scholarships, setScholarships] = useState([]);
  const [selectedScholarshipId, setSelectedScholarshipId] = useState(null);
  const [loadingScholarships, setLoadingScholarships] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const sessionDropdownRef = useRef(null);
  const [scholarshipDropdownOpen, setScholarshipDropdownOpen] = useState(false);
  const scholarshipDropdownRef = useRef(null);

  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const isCurrentlyExpanded = prev[section];
      // Close all sections
      const newSections = {};
      // If this section was closed, open it. If it was open, close it.
      if (!isCurrentlyExpanded) {
        newSections[section] = true;
      }
      return newSections;
    });
  };

  // Fetch available sessions
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await get('/api/sessions', { token: auth.token });
        setSessions(data);
        // Auto-select active session
        const activeSession = data.find(s => s.is_active);
        if (activeSession) {
          setSelectedSessionId(activeSession.session_id);
        } else if (data.length > 0) {
          setSelectedSessionId(data[0].session_id);
        }
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
        toast.error(`Failed to load sessions: ${toast.getErrorMessage(err)}`);
      } finally {
        setLoadingSessions(false);
      }
    };
    fetchSessions();
  }, [auth.token]);

  // Fetch scholarships when session changes
  useEffect(() => {
    const fetchScholarships = async () => {
      if (!selectedSessionId) return;
      setLoadingScholarships(true);
      try {
        const data = await get('/api/scholarships', { 
          token: auth.token,
          sessionId: selectedSessionId
        });
        setScholarships(data);
        // Pre-select the newest ACTIVE scholarship (newest overall if none is active)
        const defaultScholarship = pickDefaultScholarship(data);
        setSelectedScholarshipId(defaultScholarship ? defaultScholarship.scholarship_id : null);
      } catch (err) {
        console.error('Failed to fetch scholarships:', err);
        toast.error(`Failed to load scholarships: ${toast.getErrorMessage(err)}`);
        setScholarships([]);
        setSelectedScholarshipId(null);
      } finally {
        setLoadingScholarships(false);
      }
    };
    fetchScholarships();
  }, [selectedSessionId, auth.token]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target)) {
        setSessionDropdownOpen(false);
      }
      if (scholarshipDropdownRef.current && !scholarshipDropdownRef.current.contains(e.target)) {
        setScholarshipDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-logout on session expiry
  useEffect(() => {
    const handleSessionExpired = () => {
      logout();
      navigate('/', { replace: true });
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, [logout, navigate]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [active]);

  // Get selected session/scholarship objects
  const selectedSession = sessions.find(s => s.session_id === selectedSessionId);
  const selectedScholarship = scholarships.find(s => s.scholarship_id === selectedScholarshipId);

  // The Full Result tabs reproduce the CM scheme's own class 6 / class 9
  // All-Data sheets, so they only apply to CM — NMMSS is a single class 8
  // exam with a different layout entirely.
  const isCmScholarship = (() => {
    const name = String(selectedScholarship?.scholarship_name || '').toLowerCase();
    return /\bcm\b/i.test(name) || name.includes('chief minister');
  })();

  // Helper function to navigate and force remount
  const navigateTo = (page) => {
    setActive(page);
    setNavCounter(prev => prev + 1);
  };

  const renderContent = () => {
    // Use navCounter to force remount when navigating
    const key = `${active}-${navCounter}`;
    
    if (active === 'dashboard') {
      return <ScertDashboardHome key={key} onNavigate={navigateTo} />;
    }
    if (active === 'create') {
      return (
        <ScertScholarshipCreatePage
          key={key}
          onCreated={() => navigateTo('list')}
          onCancel={() => navigateTo('list')}
        />
      );
    }
    if (active === 'roles') {
      return <ScertRolesPage key={key} />;
    }
    if (active === 'profile') {
      return <ScertProfilePage key={key} />;
    }
    if (active === 'applications') {
      return <ScertPendingApplicationsPage key={key} />;
    }
    if (active === 'pending-applications') {
      return <ScertPendingApplicationsPage key={key} />;
    }
    if (active === 'returned-to-beo') {
      return <ScertReturnedToBeoPage key={key} />;
    }
    if (active === 'nominal-roll') {
      return <ScertNominalRollPage key={key} />;
    }
    if (active === 'verification-form') {
      return <ScertVerificationFormPage key={key} />;
    }
    if (active === 'admit-cards') {
      return <ScertAdmitCardsPage key={key} />;
    }
    if (active === 'progress-reports') {
      return <ScertProgressReports key={key} onNavigate={navigateTo} />;
    }
    if (active === 'approved') {
      return <ScertApprovedApplicationsPage key={key} />;
    }
    if (active === 'approved-applications') {
      return <ScertApprovedApplicationsPage key={key} />;
    }
    if (active === 'list-centers') {
      return <ScertListCentersPage key={key} />;
    }
    if (active === 'cs-reports') {
      return <ScertCsReports key={key} />;
    }
    if (active === 'list-beo') {
      return <ScertListBeoPage key={key} />;
    }
    if (active === 'beo-details') {
      return <ScertBeoDetailsPage key={key} />;
    }
    if (active === 'list-ceo') {
      return <ScertListCeoPage key={key} />;
    }
    if (active === 'ceo-details') {
      return <ScertCeoDetailsPage key={key} />;
    }
    if (active === 'school-list-report') {
      return <ScertSchoolListReportPage key={key} />;
    }
    if (active === 'homepage-cms') {
      return <ScertHomePageCms key={key} />;
    }
    if (active === 'about-page-cms') {
      return <ScertAboutPageCms key={key} />;
    }
    if (active === 'exemplar-questions-cms') {
      return <ScertExemplarQuestionsCms key={key} />;
    }
    if (active === 'publications-cms') {
      return <ScertPublicationsCms key={key} />;
    }
    if (active === 'announcements-page-cms') {
      return <ScertAnnouncementsPageCms key={key} />;
    }
    if (active === 'important-circulars-cms') {
      return <ScertImportantCircularsCms key={key} />;
    }
    if (active === 'how-to-apply-cms') {
      return <ScertHowToApplyCms key={key} />;
    }
    if (active === 'result') {
      return <div key={key} className="placeholder-page">Result - Coming Soon</div>;
    }
    if (active === 'absentee') {
      return <ScertAbsenteePage key={key} />;
    }
    if (active === 'selected-students') {
      return <div key={key} className="placeholder-page">Selected Students - Coming Soon</div>;
    }
    if (active === 'results-analytic') {
      return <ResultPage key={key} />;
    }
    if (active === 'results-exam-analytical-report') {
      return <ExamAnalyticalReportPage key={key} />;
    }
    if (active === 'results-overall-performance-report') {
      return <OverallPerformanceReportPage key={key} />;
    }
    if (active === 'results-top-rankings') {
      return <ResultRankingsPage key={key} />;
    }
    if (active === 'results-school-participation') {
      return <SchoolParticipationPage key={key} />;
    }
    if (active === 'results-summary-report') {
      return <SummaryReportPage key={key} />;
    }
    if (active === 'results-full-6') {
      return <FullResultPage key={key} classValue="6" />;
    }
    if (active === 'results-full-9') {
      return <FullResultPage key={key} classValue="9" />;
    }
    if (active === 'results-selected-6') {
      return <SelectedStudentsPage key={key} classValue="6" />;
    }
    if (active === 'results-selected-9') {
      return <SelectedStudentsPage key={key} classValue="9" />;
    }
    if (active === 'results-subject-wise-report') {
      return <SubjectWiseReportPage key={key} />;
    }
    if (active === 'results-publish') {
      return <PublishResultPage key={key} />;
    }
    if (active === 'results-upload') {
      return <ResultUploadPage key={key} />;
    }
    if (active === 'rate-configuration') {
      return <ScertRateConfigurationPage key={key} />;
    }
    if (active === 'notifications') {
      return <ScertNotificationsPage key={key} />;
    }
    if (active === 'feature-locks') {
      return <ScertFeatureLocksPage key={key} selectedSessionId={selectedSessionId} />;
    }
    return (
      <ScertScholarshipsListPage
        key={key}
        onCreateNew={() => navigateTo('create')}
        // onOpenDetails={(id) => console.log('open details', id)}
      />
    );
  };

  return (
    <ScertSessionContext.Provider value={{ 
      sessionId: selectedSessionId, 
      sessions,
      scholarships,
      selectedScholarshipId,
      setSelectedScholarshipId,
      loadingScholarships
    }}>
      <div className="scert-dash-root">
      {/* Topbar - Full Width */}
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
          {/* Custom Session Dropdown */}
          <div className="custom-dropdown" ref={sessionDropdownRef}>
            <button
              type="button"
              className="custom-dropdown-trigger"
              onClick={() => !loadingSessions && setSessionDropdownOpen(!sessionDropdownOpen)}
              disabled={loadingSessions}
            >
              <span className="custom-dropdown-text">
                {loadingSessions ? 'Loading...' : sessions.length === 0 ? 'No sessions' : (
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
                {sessions.map(session => (
                  <button
                    key={session.session_id}
                    type="button"
                    className={`custom-dropdown-item ${selectedSessionId === session.session_id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedSessionId(session.session_id);
                      setSessionDropdownOpen(false);
                    }}
                  >
                    {session.session_name}
                    {session.is_active && <span className="active-glow">(Active)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom Scholarship Dropdown */}
          <div className="custom-dropdown" ref={scholarshipDropdownRef}>
            <button
              type="button"
              className="custom-dropdown-trigger"
              onClick={() => !loadingScholarships && scholarships.length > 0 && setScholarshipDropdownOpen(!scholarshipDropdownOpen)}
              disabled={loadingScholarships || scholarships.length === 0}
            >
              <span className="custom-dropdown-text">
                {loadingScholarships ? 'Loading...' : scholarships.length === 0 ? 'No scholarships' : (
                  selectedScholarship?.scholarship_name || 'Select Scholarship'
                )}
              </span>
              <span className="custom-dropdown-arrow">{scholarshipDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {scholarshipDropdownOpen && scholarships.length > 0 && (
              <div className="custom-dropdown-menu">
                {scholarships.map(sch => (
                  <button
                    key={sch.scholarship_id}
                    type="button"
                    className={`custom-dropdown-item ${selectedScholarshipId === sch.scholarship_id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedScholarshipId(sch.scholarship_id);
                      setScholarshipDropdownOpen(false);
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
            className={
              active === 'dashboard'
                ? 'scert-dash-link scert-dash-link-active'
                : 'scert-dash-link'
            }
            onClick={() => navigateTo('dashboard')}
          >
            <span className="scert-dash-link-icon"><HiOutlineHome /></span>
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            className={
              active === 'create'
                ? 'scert-dash-link scert-dash-link-active'
                : 'scert-dash-link'
            }
            onClick={() => navigateTo('create')}
          >
            <span className="scert-dash-link-icon"><HiOutlinePlus /></span>
            <span>Create Scholarship</span>
          </button>

          <button
            type="button"
            className={
              active === 'list'
                ? 'scert-dash-link scert-dash-link-active'
                : 'scert-dash-link'
            }
            onClick={() => navigateTo('list')}
          >
            <span className="scert-dash-link-icon"><HiOutlineViewGrid /></span>
            <span>All Scholarships</span>
          </button>

          {/* Administration Section */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleSection('administration')}
            >
              <span className="scert-nav-section-icon"><HiOutlineCog /></span>
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
                  onClick={() => navigateTo('profile')}
                >
                  <span>Profile</span>
                </button>
                <button
                  type="button"
                  className={active === 'rate-configuration' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('rate-configuration')}
                >
                  <span>Rate Configuration</span>
                </button>
                <button
                  type="button"
                  className={active === 'notifications' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('notifications')}
                >
                  <span className="scert-dash-link-icon"><HiOutlineBell size={18} /></span>
                  <span>BEO & CEO Notifications</span>
                </button>
                <button
                  type="button"
                  className={active === 'feature-locks' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('feature-locks')}
                >
                  <span className="scert-dash-link-icon"><HiOutlineLockClosed size={18} /></span>
                  <span>Feature Locks</span>
                </button>
                <button
                  type="button"
                  className={active === 'roles' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('roles')}
                >
                  <span>User Management</span>
                </button>
                <button
                  type="button"
                  className={active === 'homepage-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('homepage-cms')}
                >
                  <span>Home Page CMS</span>
                </button>
                <button
                  type="button"
                  className={active === 'about-page-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('about-page-cms')}
                >
                  <span>About Page CMS</span>
                </button>
                <button
                  type="button"
                  className={active === 'exemplar-questions-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('exemplar-questions-cms')}
                >
                  <span>Exemplar Questions CMS</span>
                </button>
                <button
                  type="button"
                  className={active === 'publications-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('publications-cms')}
                >
                  <span>Publications CMS</span>
                </button>
                <button
                  type="button"
                  className={active === 'announcements-page-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('announcements-page-cms')}
                >
                  <span>Announcements CMS</span>
                </button>
                <button
                  type="button"
                  className={active === 'important-circulars-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('important-circulars-cms')}
                >
                  <span>Important Circulars &amp; GOs CMS</span>
                </button>
                <button
                  type="button"
                  className={active === 'how-to-apply-cms' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('how-to-apply-cms')}
                >
                  <span>How to Apply CMS</span>
                </button>
              </div>
            )}
          </div>

          {/* Verification Section */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleSection('verification')}
            >
              <span className="scert-nav-section-icon"><HiOutlineCheckCircle /></span>
              <span>Verification</span>
              <span className="scert-nav-section-arrow">
                {expandedSections.verification ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedSections.verification && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={active === 'pending-applications' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('pending-applications')}
                >
                  <span>Pending Applications</span>
                </button>
                <button
                  type="button"
                  className={active === 'returned-to-beo' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('returned-to-beo')}
                >
                  <span>Applications Return To BEOs</span>
                </button>
              </div>
            )}
          </div>

          {/* Downloads Section */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleSection('downloads')}
            >
              <span className="scert-nav-section-icon"><HiOutlineDownload /></span>
              <span>Downloads</span>
              <span className="scert-nav-section-arrow">
                {expandedSections.downloads ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedSections.downloads && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={active === 'nominal-roll' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('nominal-roll')}
                >
                  <span>Center-Wise Nominal Roll</span>
                </button>
                <button
                  type="button"
                  className={active === 'verification-form' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('verification-form')}
                >
                  <span>Center-Wise Verification Form Roll</span>
                </button>
                <button
                  type="button"
                  className={active === 'admit-cards' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('admit-cards')}
                >
                  <span>Admit Card</span>
                </button>
              </div>
            )}
          </div>

          {/* Reports Section */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleSection('reports')}
            >
              <span className="scert-nav-section-icon"><HiOutlineDocumentReport /></span>
              <span>Reports</span>
              <span className="scert-nav-section-arrow">
                {expandedSections.reports ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedSections.reports && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={active === 'progress-reports' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('progress-reports')}
                >
                  <span>Progress Report</span>
                </button>
                <button
                  type="button"
                  className={active === 'approved-applications' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('approved-applications')}
                >
                  <span>Approved Applications</span>
                </button>
                <button
                  type="button"
                  className={active === 'list-centers' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('list-centers')}
                >
                  <span>List of Centers</span>
                </button>
                <button
                  type="button"
                  className={active === 'cs-reports' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('cs-reports')}
                >
                  <span>Center Superintendent Report</span>
                </button>
                <button
                  type="button"
                  className={active === 'list-beo' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('list-beo')}
                >
                  <span>BEO Account Details</span>
                </button>
                <button
                  type="button"
                  className={active === 'list-ceo' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('list-ceo')}
                >
                  <span>CEO Account Details</span>
                </button>
                <button
                  type="button"
                  className={active === 'beo-details' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('beo-details')}
                >
                  <span>Contact Details of BEOs</span>
                </button>
                <button
                  type="button"
                  className={active === 'ceo-details' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('ceo-details')}
                >
                  <span>Contact Details of CEOs</span>
                </button>
                <button
                  type="button"
                  className={active === 'school-list-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('school-list-report')}
                >
                  <span>List of Schools</span>
                </button>
                <button
                  type="button"
                  className={active === 'absentee' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('absentee')}
                >
                  <span>Absentee during Examination</span>
                </button>
              </div>
            )}
          </div>

          {/* Analytical Report Section */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleSection('analytic')}
            >
              <span className="scert-nav-section-icon"><HiOutlineChartBar /></span>
              <span>Analytical Report</span>
              <span className="scert-nav-section-arrow">
                {expandedSections.analytic ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedSections.analytic && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={active === 'results-analytic' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-analytic')}
                >
                  <span>Selection Summary</span>
                </button>
                <button
                  type="button"
                  className={active === 'results-top-rankings' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-top-rankings')}
                >
                  <span>Top Rankers</span>
                </button>
                <button
                  type="button"
                  className={active === 'results-school-participation' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-school-participation')}
                >
                  <span>School Participation</span>
                </button>
                <button
                  type="button"
                  className={active === 'results-exam-analytical-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-exam-analytical-report')}
                >
                  <span>Exam Analytical Report</span>
                </button>
                <button
                  type="button"
                  className={active === 'results-subject-wise-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-subject-wise-report')}
                >
                  <span>Subject Wise Report</span>
                </button>
              </div>
            )}
          </div>

          {/* Result Section */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleSection('results')}
            >
              <span className="scert-nav-section-icon"><HiOutlineBadgeCheck /></span>
              <span>Result</span>
              <span className="scert-nav-section-arrow">
                {expandedSections.results ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedSections.results && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={active === 'results-upload' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-upload')}
                >
                  <span>Result Upload</span>
                </button>
                <button
                  type="button"
                  className={active === 'results-overall-performance-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-overall-performance-report')}
                >
                  <span>Overall Performance Report</span>
                </button>
                <button
                  type="button"
                  className={active === 'results-summary-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-summary-report')}
                >
                  <span>Summary Report</span>
                </button>
                {isCmScholarship && (
                  <>
                    <button
                      type="button"
                      className={active === 'results-full-6' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                      onClick={() => navigateTo('results-full-6')}
                    >
                      <span>Full Result Class 6</span>
                    </button>
                    <button
                      type="button"
                      className={active === 'results-full-9' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                      onClick={() => navigateTo('results-full-9')}
                    >
                      <span>Full Result Class 9</span>
                    </button>
                    <button
                      type="button"
                      className={active === 'results-selected-6' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                      onClick={() => navigateTo('results-selected-6')}
                    >
                      <span>Selected Students Class 6</span>
                    </button>
                    <button
                      type="button"
                      className={active === 'results-selected-9' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                      onClick={() => navigateTo('results-selected-9')}
                    >
                      <span>Selected Students Class 9</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={active === 'results-publish' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('results-publish')}
                >
                  <span>Publish Result</span>
                </button>
              </div>
            )}
          </div>
        </nav>

        <button
          className="scert-dash-logout"
          onClick={() => {
            logout();
            navigate('/', { replace: true });
          }}
        >
          <span className="scert-dash-link-icon"><HiOutlineLogout /></span>
          <span>Sign Out</span>
        </button>
      </aside>

      <main className="scert-dash-main">
        {/* Sticky SCERT Title Bar */}
        <div className="school-info-bar scert-info-bar">
          <div className="school-info-name">State Council of Educational Research and Training</div>
        </div>

        <div className="scert-dash-content">{renderContent()}</div>
      </main>
      </div>

      {showChangePasswordModal && (
        <ChangePasswordModal
          onSuccess={() => {
            setShowChangePasswordModal(false);
            toast.success('Password changed successfully. Please log in again.');
            logout();
            navigate('/', { replace: true });
          }}
          onError={(error) => {
            toast.error(toast.getErrorMessage(error, 'Failed to change password.'));
          }}
          onClose={() => setShowChangePasswordModal(false)}
        />
      )}
      </div>
    </ScertSessionContext.Provider>
  );
}
