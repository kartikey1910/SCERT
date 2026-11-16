import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { DashboardProvider, useDashboard } from './DashboardContext.jsx';
import { get, post, put } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { BeoPendingApplicationEditor } from './BeoPendingApplicationEditor.jsx';
import { BeoCenterAssignment } from './BeoCenterAssignment.jsx';
import { BeoCreateCenters } from './BeoCreateCenters.jsx';
import { BeoReturnedBySCERT } from './BeoReturnedBySCERT.jsx';
import { BeoApprovedApplications } from './BeoApprovedApplications.jsx';
import { BeoSubmittedApplications } from './BeoSubmittedApplications.jsx';
import { BeoListOfCenters } from './BeoListOfCenters.jsx';
import { BeoDashboardHome } from './BeoDashboardHome.jsx';
import { BeoCsReports } from './BeoCsReports.jsx';
import { BeoProgressReport } from './BeoProgressReport.jsx';
import { BeoAdmitCardsPage } from './beo.admit-cards-page.jsx';
import { BeoNominalRollPage } from './beo.nominal-roll-page.jsx';
import { BeoVerificationFormPage } from './beo.verification-form-page.jsx';
import { BeoUploadAbsentee } from './BeoUploadAbsentee.jsx';
import { BeoUploadAbsenteeDuringExam } from './BeoUploadAbsenteeDuringExam.jsx';
import { BeoListCentersPage } from './beo.list-centers-page.jsx';
import { BeoAbsenteeDuringExamPage } from './beo.absentee-during-exam-page.jsx';
import { BeoResultPage } from './beo.result-page.jsx';
import { BeoProfileForm } from './BeoProfileForm.jsx';
import { BeoBulkReturnModal } from './BeoBulkReturnModal.jsx';
import { HowToApplyGuide } from './HowToApplyGuide.jsx';
import {
  HiOutlineHome,
  HiOutlineAcademicCap,
  HiOutlineVideoCamera,
  HiOutlineCog,
  HiOutlineCheckCircle,
  HiOutlineDownload,
  HiOutlineDocumentReport,
  HiOutlineLogout,
  HiOutlineChevronRight,
  HiOutlineChevronDown,
  HiOutlinePencil,
} from 'react-icons/hi';

function BeoSchoolsCard() {
  const { auth } = useAuth();
  const toast = useToast();
  const [schoolsData, setSchoolsData] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [schoolTypeFilter, setSchoolTypeFilter] = useState('ALL');

  const fetchSchools = async (nextPage, schoolType = schoolTypeFilter) => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('page', String(nextPage));
      params.append('limit', '50');
      if (schoolType && schoolType !== 'ALL') params.append('school_type', schoolType);
      const data = await get(`/api/beo/schools?${params.toString()}`, { token: auth?.token });
      setSchoolsData({
        data: Array.isArray(data?.data) ? data.data : [],
        pagination: data?.pagination || null,
      });
      setPage(nextPage);
    } catch (e) {
      console.error('Failed to fetch schools:', e);
      setError(e.message || 'Failed to load schools');
      toast.error(`Failed to load schools: ${toast.getErrorMessage(e)}`);
      setSchoolsData({ data: [], pagination: null });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auth?.token) fetchSchools(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  useEffect(() => {
    if (auth?.token) fetchSchools(1, schoolTypeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolTypeFilter]);

  const pagination = schoolsData.pagination;

  return (
    <div className="profile-section beo-profile-card">
      <div className="beo-schools-card-header">
        <div>
          <h3 className="profile-section-title" style={{ marginBottom: 0 }}>List of schools in your block</h3>
        </div>
        <div className="beo-schools-filters">
          <select
            className="topbar-filter-select"
            value={schoolTypeFilter}
            onChange={(e) => setSchoolTypeFilter(e.target.value)}
            style={{ minWidth: 190 }}
          >
            <option value="ALL">School Type</option>
            <option value="Dept of Edu">Dept of Edu</option>
            <option value="Govt Aided">Govt Aided</option>
            <option value="Local Body">Local Body</option>
          </select>
        </div>
      </div>

      {error && <div className="error-state" style={{ padding: '1rem' }}>{error}</div>}

      {!error && loading && schoolsData.data.length === 0 ? (
        <div className="loading-state beo-schools-loading" style={{ padding: '1rem' }}>Loading schools...</div>
      ) : schoolsData.data.length === 0 ? (
        <div className="empty-state" style={{ padding: '1rem' }}>No schools found.</div>
      ) : (
        <div className="beo-schools-list">
          <div className="smart-table-wrap beo-schools-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table beo-schools-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '72px' }}>S. No.</th>
                  <th>School Name</th>
                  <th style={{ minWidth: '120px' }}>UDISE</th>
                  <th>Head of Institute Name</th>
                  <th>Mobile Number</th>
                </tr>
              </thead>
              <tbody>
                {schoolsData.data.map((s, idx) => (
                  <tr key={String(s.user_id)} className={window.getSubmissionRoleRowClass(s)}>
                    <td className="smart-table-strong">
                      {((Number(pagination?.page) || page || 1) - 1) * (Number(pagination?.limit) || 50) + idx + 1}
                    </td>
                    <td className="smart-table-strong beo-smart-school-list">{s.school_name || '-'}</td>
                    <td style={{ wordBreak: 'break-all' }}>{s.udise_code || s.login_id || '-'}</td>
                    <td>{s.head_of_institution_name || '-'}</td>
                    <td>{s.head_of_institution_mobile || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="table-footer" style={{ marginTop: '0.75rem' }}>
              <span className="table-count">
                Total: <strong>{pagination.total}</strong> | Page {pagination.page} of {pagination.totalPages}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="scert-btn-secondary"
                  onClick={() => fetchSchools(page - 1, schoolTypeFilter)}
                  disabled={loading || page <= 1}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  Previous
                </button>
                <button
                  className="scert-btn-secondary"
                  onClick={() => fetchSchools(page + 1, schoolTypeFilter)}
                  disabled={loading || (pagination?.totalPages ? page >= pagination.totalPages : true)}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BeoDashboardContent() {
  const navigate = useNavigate();
  const { logout, auth } = useAuth();
  const toast = useToast();
  const { 
    sessions, 
    selectedSessionId, 
    setSelectedSessionId,
    scholarships,
    selectedScholarshipId,
    setSelectedScholarshipId,
    loadingSessions,
    loadingScholarships
  } = useDashboard();

  const selectedScholarshipName =
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || '';

  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

  const formatMaybeDate = (value) => {
    if (!value) return '-';
    const str = String(value).split('T')[0];
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-GB');
  };

  const formatDivyangta = (value, row = null) => {
    let v = String(value ?? '').trim();
    if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).trim();
    }
    if ((!v || v.toLowerCase() === 'null') && row) {
      const fallback = [
        row?.type_of_divyangta,
        row?.type_of_disability,
        row?.divyangta_code,
        row?.disability_code,
        row?.type_of_divyangta_code,
        row?.type_of_disability_code,
      row?.disability_type_code,
      row?.divyangta_type_code,
      row?.disability_type,
      row?.divyangta_type,
      row?.disability,
      row?.divyangta,
      ].find((item) => item !== null && item !== undefined && String(item).trim() !== '');
      v = String(fallback ?? '').trim();
    }
    return v || 'No divyangta';
  };

  const pickFirst = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
    return null;
  };

  const formatAttendanceFlag = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return '-';
    if (normalized === 'ABSENT' || normalized === 'A') return 'A';
    if (normalized === 'PRESENT' || normalized === 'P') return 'P';
    return normalized;
  };

  const getStudentRegistrationNo = (row) => {
    const keys = [
      'student_registration_no',
      'student_registration_number',
      'student_registrations',
      'registration_no',
      'registration_number',
      'student_reg_no',
      'student_registration',
      'student_registration_id',
      'sr_no',
      'sr_number',
      'student_sr_no',
      'app_serial_no',
      'application_serial_no',
    ];
    for (const key of keys) {
      const value = row?.[key];
      if (value === null || value === undefined) continue;
      const normalized = String(value).trim();
      if (normalized !== '') return normalized;
    }
    return '-';
  };

  const filterRowsBySelectedScholarship = (rows) => {
    if (!selectedScholarshipId) return rows;
    const sid = String(selectedScholarshipId);
    const sname = String(selectedScholarshipName || '');

    return (rows || []).filter((row) => {
      const rowSid = row?.scholarship_id ?? row?.scholarshipId ?? row?.scholarship;
      if (rowSid !== null && rowSid !== undefined && String(rowSid) === sid) return true;

      const rowSname = String(row?.scholarship_name || row?.scholarshipName || '');
      if (sname && rowSname && rowSname === sname) return true;

      return false;
    });
  };

  const sortRowsByApplicationDisplayIdAsc = (rows) => {
    const parseDisplayId = (row) => {
      const raw = String(window.getDisplayApplicationId(row) || '').trim().toUpperCase();
      const trailingSerial = raw.match(/(\d{5})$/);
      const serial = trailingSerial ? Number.parseInt(trailingSerial[1], 10) : Number.POSITIVE_INFINITY;
      return { serial, raw };
    };

    return [...(rows || [])].sort((a, b) => {
      const A = parseDisplayId(a);
      const B = parseDisplayId(b);
      if (A.serial !== B.serial) return A.serial - B.serial;
      if (A.raw !== B.raw) return A.raw.localeCompare(B.raw, undefined, { numeric: true, sensitivity: 'base' });

      const aId = Number(a?.application_id);
      const bId = Number(b?.application_id);
      if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
      return String(a?.application_id || '').localeCompare(String(b?.application_id || ''));
    });
  };
  
  const [currentView, setCurrentView] = useState('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState(null);
  const [navCounter, setNavCounter] = useState(0);

  const [profileData, setProfileData] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const [pendingApps, setPendingApps] = useState([]);
  const [loadingPendingApps, setLoadingPendingApps] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [selectedPendingIds, setSelectedPendingIds] = useState(new Set());
  const [editingPendingId, setEditingPendingId] = useState(null);
  const [pendingClassFilter, setPendingClassFilter] = useState('');
  const [pendingSchoolFilter, setPendingSchoolFilter] = useState('');
  const [pendingCurrentPage, setPendingCurrentPage] = useState(1);
  const PENDING_PAGE_SIZE = 20;
  const [beoSchools, setBeoSchools] = useState([]);
  const [showBulkReturnModal, setShowBulkReturnModal] = useState(false);
  const [bulkReturning, setBulkReturning] = useState(false);

  const [returnedToSchoolApps, setReturnedToSchoolApps] = useState([]);
  const [loadingReturnedToSchoolApps, setLoadingReturnedToSchoolApps] = useState(false);
  const [returnedToSchoolError, setReturnedToSchoolError] = useState('');

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const sessionDropdownRef = useRef(null);
  const [scholarshipDropdownOpen, setScholarshipDropdownOpen] = useState(false);
  const scholarshipDropdownRef = useRef(null);

  const [featureLocks, setFeatureLocks] = useState({});
  const [loadingLocks, setLoadingLocks] = useState(false);

  useEffect(() => {
    if (isCmScholarship) {
      setPendingClassFilter('6');
      return;
    }

    if (isNmmssScholarship) {
      setPendingClassFilter('8');
      return;
    }

    setPendingClassFilter('');
  }, [selectedScholarshipId, isCmScholarship, isNmmssScholarship]);

  const fetchProfile = async () => {
    setLoadingProfile(true);
    try {
      const data = await get('/api/beo/profile', { token: auth?.token });
      setProfileData(data);
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      toast.error(`Failed to load profile: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingProfile(false);
    }
  };

  const fetchBeoSchools = async () => {
    try {
      const data = await get('/api/beo/schools?page=1&limit=5000', {
        token: auth?.token,
      });
      setBeoSchools(Array.isArray(data?.data) ? data.data : []);
    } catch (err) {
      setBeoSchools([]);
      toast.error(`Failed to load schools: ${toast.getErrorMessage(err)}`);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    const currentPassword = String(passwordForm.currentPassword || '');
    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setPasswordChangeLoading(true);
    try {
      await put(
        '/api/auth/change-password',
        {
          current_password: currentPassword,
          new_password: passwordForm.newPassword,
        },
        { token: auth?.token }
      );

      setPasswordSuccess(true);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed successfully. Please log in again.');
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      setPasswordError(err?.message || 'Failed to change password');
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const fetchPendingApplications = async () => {
    setLoadingPendingApps(true);
    setPendingError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (pendingClassFilter) params.append('class_filter', pendingClassFilter);

      const data = await get(
        `/api/beo/applications/inbox${params.toString() ? '?' + params.toString() : ''}`,
        { token: auth?.token, sessionId: selectedSessionId }
      );
      setPendingApps(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      setPendingError(err.message || 'Failed to fetch pending applications');
      toast.error(`Failed to load pending applications: ${toast.getErrorMessage(err)}`);
      setPendingApps([]);
    } finally {
      setLoadingPendingApps(false);
    }
  };

  const fetchReturnedToSchoolApplications = async () => {
    setLoadingReturnedToSchoolApps(true);
    setReturnedToSchoolError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (pendingClassFilter) params.append('class_filter', pendingClassFilter);

      const data = await get(
        `/api/beo/applications/returned-to-school${params.toString() ? '?' + params.toString() : ''}`,
        { token: auth?.token, sessionId: selectedSessionId }
      );
      setReturnedToSchoolApps(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      setReturnedToSchoolError(err.message || 'Failed to fetch returned applications');
      toast.error(`Failed to load returned applications: ${toast.getErrorMessage(err)}`);
      setReturnedToSchoolApps([]);
    } finally {
      setLoadingReturnedToSchoolApps(false);
    }
  };

  // Fetch profile once on mount for the info bar
  useEffect(() => {
    if (auth?.token && !profileData) {
      fetchProfile();
    }
    if (auth?.token) {
      fetchBeoSchools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  // Fetch feature locks when session changes
  useEffect(() => {
    const fetchLocks = async () => {
      if (!selectedSessionId || !auth?.token) return;
      setLoadingLocks(true);
      try {
        const data = await get(`/api/beo/feature-locks?session_id=${selectedSessionId}`, { token: auth.token });
        setFeatureLocks(data.locks || {});
      } catch (err) {
        console.error('Failed to fetch feature locks:', err);
      } finally {
        setLoadingLocks(false);
      }
    };
    fetchLocks();
  }, [selectedSessionId, auth?.token]);

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

  // Get selected session/scholarship objects
  const selectedSession = sessions.find(s => s.session_id === selectedSessionId);
  const selectedScholarship = scholarships.find(s => s.scholarship_id === selectedScholarshipId);

  useEffect(() => {
    if (currentView === 'profile') {
      fetchProfile();
    }

    if (currentView === 'verification-pending' && !editingPendingId) {
      fetchPendingApplications();
    }

    if (currentView === 'return-to-school') {
      fetchReturnedToSchoolApplications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, editingPendingId, selectedScholarshipId, selectedSessionId, pendingClassFilter]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [currentView]);

  const toggleMenu = (menu) => {
    setExpandedMenu(prev => {
      const isCurrentlyExpanded = prev === menu;
      if (!isCurrentlyExpanded) {
        return menu;
      }
      return null;
    });
  };

  const navigateTo = (view) => {
    setCurrentView(view);
    setNavCounter(prev => prev + 1);
  };

  const toggleSelectedPending = (applicationId) => {
    setSelectedPendingIds((prev) => {
      const next = new Set(prev);
      const key = String(applicationId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearPendingSelection = () => {
    setSelectedPendingIds(new Set());
  };

  useEffect(() => {
    // Changing scholarship/class filter should re-scope lists and reset selection/editor state.
    clearPendingSelection();
    setEditingPendingId(null);
    setPendingCurrentPage(1);
  }, [selectedScholarshipId, pendingClassFilter, pendingSchoolFilter]);

  const schoolFilterOptions = useMemo(() => {
    const fromPending = (Array.isArray(pendingApps) ? pendingApps : []).map((a) => ({
      value: String(a.udise_code || '').trim(),
      label: a.school_name || a.udise_code || '-',
    }));
    const map = new Map();
    fromPending
      .filter((x) => x.value)
      .forEach((x) => {
        if (!map.has(x.value)) map.set(x.value, x);
      });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [pendingApps]);

  const handleBulkReturnToSchool = async (remarkText) => {
    const ids = Array.from(selectedPendingIds);
    if (ids.length === 0) return;

    setBulkReturning(true);

    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          post(
            `/api/beo/applications/${id}/return`,
            { remark_text: remarkText },
            { token: auth?.token }
          )
        )
      );

      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;

      if (fail > 0) {
        toast.warning(`Returned: ${ok}, Failed: ${fail}`);
        const firstErr = results.find((r) => r.status === 'rejected')?.reason;
        if (firstErr) {
          toast.error(`Some returns failed: ${toast.getErrorMessage(firstErr)}`);
        }
      } else {
        toast.success(`Returned ${ok} application(s) to school.`);
      }

      setShowBulkReturnModal(false);
    } finally {
      setBulkReturning(false);
      clearPendingSelection();
      fetchPendingApplications();
    }
  };

  // hideNmmssClass: NMMSS has a single class (8), so on the Pending tab the
  // "NMMSS Class 8" button chooses nothing and is left out. The list is still
  // scoped to class 8 by pendingClassFilter.
  const renderPendingClassFilters = ({ includeSchool = false, hideNmmssClass = false } = {}) => {
    const showClassFilters = isCmScholarship || (isNmmssScholarship && !hideNmmssClass);
    if (!showClassFilters && !includeSchool) return null;

    return (
      <div className="filters-bar">
      {showClassFilters && (
        <div className="filter-group">
          <label className="filter-label">Class</label>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {isNmmssScholarship ? (
              <button
                type="button"
                className={`filter-btn ${pendingClassFilter === '8' ? 'filter-btn-active' : ''}`}
                onClick={() => setPendingClassFilter('8')}
              >
                NMMSS Class 8
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`filter-btn ${pendingClassFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                  onClick={() => setPendingClassFilter('6')}
                >
                  CM Class 6
                </button>
                <button
                  type="button"
                  className={`filter-btn ${pendingClassFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                  onClick={() => setPendingClassFilter('9')}
                >
                  CM Class 9
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {includeSchool && (
        <div className="filter-group">
          <label className="filter-label">School</label>
          <select
            className="form-input"
            value={pendingSchoolFilter}
            onChange={(e) => setPendingSchoolFilter(e.target.value)}
            style={{ minWidth: '280px' }}
          >
            <option value="">All Schools</option>
            {schoolFilterOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      </div>
    );
  };

  const renderContent = () => {
    const key = `${currentView}-${navCounter}`;
    
    // Check for locked views
    const isLocked = (featureKey) => featureLocks[featureKey] === true;
    
    let lockedFeatureName = null;
    if (['create-centers'].includes(currentView) && isLocked('CREATE_CENTER')) {
      lockedFeatureName = "Create Center";
    } else if (['allocate-centers'].includes(currentView) && isLocked('ALLOCATE_CENTERS')) {
      lockedFeatureName = "Allocate Centers";
    } else if (['upload-absentee'].includes(currentView) && isLocked('UPLOAD_ABSENTEE')) {
      lockedFeatureName = "Upload Absentee After Exam";
    } else if (['upload-absentee-during-exam'].includes(currentView) && isLocked('UPLOAD_ABSENTEE_DURING_EXAM')) {
      lockedFeatureName = "Upload Absentee During Exam";
    } else if (['upload-cs-report'].includes(currentView) && isLocked('UPLOAD_CS_REPORT')) {
      lockedFeatureName = "Upload Center Superintendent Report";
    }

    if (lockedFeatureName) {
      return (
        <div className="placeholder-view" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', borderRadius: '12px', margin: '2rem' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity: '0.8' }}>🔒</div>
          <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '1.5rem' }}>Feature Locked</h2>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '400px', lineHeight: '1.5' }}>
            The <strong>{lockedFeatureName}</strong> feature is currently locked by SCERT for the selected session.
          </p>
        </div>
      );
    }

    if (currentView === 'dashboard') {
      return <BeoDashboardHome key={key} onNavigate={navigateTo} />
    }

    if (currentView === 'how-to-apply') {
      // The BEO tutorials SCERT pushes from the CMS (the "BEO" role tab).
      return <HowToApplyGuide key={key} audience="beo" embedded />;
    }

    if (currentView === 'profile') {
      if (loadingProfile) {
        return <div className="loading-state">Loading profile...</div>;
      }

      if (!profileData?.profile) {
        return <div className="error-state">Failed to load profile</div>;
      }

      const profile = profileData.profile;

      return (
        <div className="scert-page beo-profile-page">
          {showEditProfile && (
            <BeoProfileForm
              mode="edit"
              onClose={() => setShowEditProfile(false)}
              onSuccess={() => {
                setShowEditProfile(false);
                fetchProfile();
              }}
            />
          )}

          <div className="beo-profile-compact-grid">
            <div className="profile-section beo-profile-card beo-profile-full-width-card">
              <div className="beo-schools-card-header">
                <h3 className="profile-section-title" style={{ marginBottom: 0 }}>BEO Profile Details</h3>
                <button
                  type="button"
                  className="scert-btn-secondary"
                  onClick={() => setShowEditProfile(true)}
                >
                  Edit Profile
                </button>
              </div>

              <div className="beo-profile-structured-wrap">
                <div className="beo-profile-structured-section">
                  <h4 className="beo-profile-structured-heading">Official details</h4>
                  <div className="profile-grid">
                    <div className="profile-item">
                      <label>BEO</label>
                      <p>{profile?.block_name || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>Unit ID</label>
                      <p>{profile?.unit_id || '-'}</p>
                    </div>
                    <div className="profile-item full-width">
                      <label>Distance from ceo office</label>
                      <p>{profile?.distance_from_district_hq_km || '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="beo-profile-structured-section">
                  <h4 className="beo-profile-structured-heading">Account detail</h4>
                  <div className="profile-grid">
                    <div className="profile-item">
                      <label>Acc No.</label>
                      <p>{profile?.beo_account_no || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>IFCS.</label>
                      <p>{profile?.beo_ifsc_code || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>Bank Name</label>
                      <p>{profile?.beo_bank_name || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>office Email ID.</label>
                      <p>{profile?.email || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>Office Phone No.</label>
                      <p>{profile?.contact_number || '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="beo-profile-structured-section">
                  <h4 className="beo-profile-structured-heading">Officer details</h4>
                  <div className="profile-grid">
                    <div className="profile-item">
                      <label>Name of BEO.</label>
                      <p>{profile?.beo_name || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>Mobile No.</label>
                      <p>{profile?.beo_mobile || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>Name of dealing person.</label>
                      <p>{profile?.dealing_person_name || '-'}</p>
                    </div>
                    <div className="profile-item">
                      <label>Mobile no.</label>
                      <p>{profile?.dealing_person_mobile || '-'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (currentView === 'school-list') {
      return (
        <div className="scert-page beo-profile-page">
          <BeoSchoolsCard />
        </div>
      );
    }

    if (currentView === 'change-password') {
      const closePasswordModal = () => {
        setPasswordError('');
        setPasswordSuccess(false);
        setPasswordChangeLoading(false);
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setShowEditProfile(false);
        navigateTo('profile');
      };

      return (
        <div className="modal-overlay" onClick={closePasswordModal}>
          <div
            className="modal-content scert-violet-modal student-password-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <h3 className="modal-title scert-violet-modal-title">Change Password</h3>
                  <p className="modal-subtitle">Enter your current password and set a new password.</p>
                </div>
                <button
                  type="button"
                  className="auth-password-close"
                  aria-label="Close"
                  onClick={closePasswordModal}
                >
                  X
                </button>
              </div>
            </div>

            <form className="password-form" onSubmit={handlePasswordChange}>
              {passwordError && <div className="form-error">{passwordError}</div>}
              {passwordSuccess && <div className="form-success">Password changed successfully!</div>}

              <div className="form-field" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter your current password"
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                  }
                  disabled={passwordChangeLoading}
                  required
                />
              </div>

              <div className="password-fields-row">
                <div className="form-field">
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Enter new password"
                    value={passwordForm.newPassword}
                    onChange={(e) =>
                      setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                    }
                    disabled={passwordChangeLoading}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">Confirm Password</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Re-enter new password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) =>
                      setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                    }
                    disabled={passwordChangeLoading}
                    required
                  />
                </div>
              </div>

              <div className="password-form-actions">
                <button
                  type="submit"
                  className="submit-btn"
                  disabled={
                    passwordChangeLoading ||
                    !passwordForm.currentPassword ||
                    !passwordForm.newPassword ||
                    !passwordForm.confirmPassword
                  }
                >
                  {passwordChangeLoading ? 'Updating...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    if (currentView === 'verification-pending') {
      if (editingPendingId) {
        return (
          <div className="applications-view">
            <div className="view-header-row">
              <h3 className="view-title">Pending Application Verification</h3>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => {
                  setEditingPendingId(null);
                  fetchPendingApplications();
                }}
              >
                Back to Pending List
              </button>
            </div>

            <BeoPendingApplicationEditor
              applicationId={editingPendingId}
              onBack={() => {
                setEditingPendingId(null);
                fetchPendingApplications();
              }}
            />
          </div>
        );
      }

      let scopedPendingApps = filterRowsBySelectedScholarship(pendingApps);
      if (pendingClassFilter) {
        scopedPendingApps = scopedPendingApps.filter(
          (a) => String(a?.class ?? '') === String(pendingClassFilter)
        );
      }
      if (pendingSchoolFilter) {
        scopedPendingApps = scopedPendingApps.filter(
          (a) => String(a?.udise_code || '').trim() === String(pendingSchoolFilter)
        );
      }
      scopedPendingApps = sortRowsByApplicationDisplayIdAsc(scopedPendingApps);
      const pendingTotal = scopedPendingApps.length;
      const pendingTotalPages = Math.max(1, Math.ceil(pendingTotal / PENDING_PAGE_SIZE));
      const safePendingPage = Math.min(pendingCurrentPage, pendingTotalPages);
      const pendingStartIndex = (safePendingPage - 1) * PENDING_PAGE_SIZE;
      const pagedPendingApps = scopedPendingApps.slice(
        pendingStartIndex,
        pendingStartIndex + PENDING_PAGE_SIZE
      );
      const allIds = scopedPendingApps.map((a) => String(a.application_id));
      const allSelected = allIds.length > 0 && allIds.every((id) => selectedPendingIds.has(id));

      const handleDownloadPendingPDF = () => {
        if (scopedPendingApps.length === 0) {
          toast.error('No applications to download');
          return;
        }

        const generatedAt = new Date().toLocaleString();
        const classMeta = pendingClassFilter
          ? ` | <strong>Class:</strong> ${pendingClassFilter}`
          : '';
        const schoolMeta = pendingSchoolFilter
          ? ` | <strong>School:</strong> ${schoolFilterOptions.find((x) => x.value === pendingSchoolFilter)?.label || pendingSchoolFilter}`
          : '';

        // CM headers span two rows (MAT / SAT sit under Attendance); a scholarship
        // with neither keeps a single row.
        const th = isCmScholarship ? '<th rowspan="2">' : '<th>';
        const headerColumns = isNmmssScholarship
          ? `
            <th rowspan="2">S. No.</th>
            <th rowspan="2">BlockCode</th>
            <th rowspan="2">Exam Code</th>
            <th rowspan="2">Application ID</th>
            <th rowspan="2">ROLL. No. (10 Digit)</th>
            <th rowspan="2">SR No. of students</th>
            <th rowspan="2">Student's Name</th>
            <th rowspan="2">Father's Name</th>
            <th rowspan="2">Mother's Name</th>
            <th rowspan="2">Date of Birth</th>
            <th rowspan="2">Sex</th>
            <th rowspan="2">Caste Category</th>
            <th rowspan="2">Divyangta code</th>
            <th rowspan="2">Percentage of marks in Class 7th</th>
            <th rowspan="2">Parental Income Code 1 or 2</th>
            <th rowspan="2">Aadhaar Number</th>
            <th rowspan="2">School Name</th>
            <th rowspan="2">Block</th>
            <th rowspan="2">District</th>
            <th rowspan="2">School Type (Govt, Govt aided, Local body)</th>
            <th rowspan="2">School Catogary (Urban, Rural)</th>
            <th rowspan="2">Exam Center Code</th>
            <th rowspan="2">Exam Centre's Name</th>
            <th rowspan="2">Contact No</th>
            <th colspan="2">Attendance</th>
          `
          : `
            ${th}S. No.</th>
            ${th}Block Code</th>
            ${th}Application ID</th>
            ${th}Roll No. (10 Digit)</th>
            ${th}SR No. of students</th>
            ${th}Student's Name</th>
            ${th}Father's Name</th>
            ${th}Mother's Name</th>
            ${th}Date of Birth</th>
            ${th}Sex</th>
            ${th}Caste Category</th>
            ${th}Type of Divyangta</th>
            ${th}Aadhaar Number</th>
            ${th}School Name</th>
            ${th}Block</th>
            ${th}District</th>
            ${th}School Type (Govt, Govt aided, Local body)</th>
            ${th}School Category (Urban, Rural)</th>
            ${th}Previous School Name</th>
            ${th}Previous School Type (Govt, Govt aided, Local body)</th>
            ${th}Exam Center Code</th>
            ${th}Exam Centre's Name</th>
            ${th}Contact No</th>
            ${isCmScholarship ? '<th colspan="2">Attendance</th>' : ''}
          `;

        // MAT / SAT sit under one merged Attendance heading, so those tables
        // have a second header row.
        const hasAttendance = isNmmssScholarship || isCmScholarship;
        const headerRows = hasAttendance
          ? `<tr>${headerColumns}</tr><tr><th>MAT</th><th>SAT</th></tr>`
          : `<tr>${headerColumns}</tr>`;

        const rowsHtml = scopedPendingApps
          .map((app, index) => {
            if (isNmmssScholarship) {
              return `
                <tr>
                  <td>${index + 1}</td>
                  <td>${app.block_code || '-'}</td>
                  <td>${pickFirst(app, ['exam_code']) || '-'}</td>
                  <td>${window.getDisplayApplicationId(app)}</td>
                  <td>${app.roll_number || '-'}</td>
                  <td>${getStudentRegistrationNo(app)}</td>
                  <td>${app.candidate_name || app.student_name || '-'}</td>
                  <td>${app.father_name || '-'}</td>
                  <td>${app.mother_name || '-'}</td>
                  <td>${formatMaybeDate(app.date_of_birth || app.dob)}</td>
                  <td>${app.sex || app.gender || '-'}</td>
                  <td>${app.caste_category || '-'}</td>
                  <td>${formatDivyangta(app.type_of_divyangta, app)}</td>
                  <td>${pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7']) || '-'}</td>
                  <td>${pickFirst(app, ['parental_income_code', 'income_code']) || '-'}</td>
                  <td>${app.aadhaar_number || '-'}</td>
                  <td>${app.school_name || app.origin_school || '-'}</td>
                  <td>${app.block_name || '-'}</td>
                  <td>${app.district_name || app.district || app.district_code || '-'}</td>
                  <td>${app.school_type || '-'}</td>
                  <td>${app.school_category || '-'}</td>
                  <td>${app.center_order || '-'}</td>
                  <td>${app.center_name || '-'}</td>
                  <td>${app.contact_no || '-'}</td>
                  <td>${formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td>
                  <td>${formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td>
                </tr>
              `;
            }

            return `
              <tr>
                <td>${index + 1}</td>
                <td>${app.block_code || '-'}</td>
                <td>${window.getDisplayApplicationId(app)}</td>
                <td>${app.roll_number || '-'}</td>
                <td>${getStudentRegistrationNo(app)}</td>
                <td>${app.candidate_name || app.student_name || '-'}</td>
                <td>${app.father_name || '-'}</td>
                <td>${app.mother_name || '-'}</td>
                <td>${formatMaybeDate(app.date_of_birth || app.dob)}</td>
                <td>${app.sex || app.gender || '-'}</td>
                <td>${app.caste_category || '-'}</td>
                <td>${formatDivyangta(app.type_of_divyangta, app)}</td>
                <td>${app.aadhaar_number || '-'}</td>
                <td>${app.school_name || app.origin_school || '-'}</td>
                <td>${app.block_name || '-'}</td>
                <td>${app.district_name || app.district || app.district_code || '-'}</td>
                <td>${app.school_type || '-'}</td>
                <td>${app.school_category || '-'}</td>
                <td>${app.previous_school_name || '-'}</td>
                <td>${app.previous_school_type || '-'}</td>
                <td>${app.center_order || '-'}</td>
                <td>${app.center_name || '-'}</td>
                <td>${app.contact_no || '-'}</td>
                ${isCmScholarship ? `<td>${formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td><td>${formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td>` : ''}
              </tr>
            `;
          })
          .join('');

        const html = `
          <html>
            <head>
              <title>Pending Applications Report</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h2 { text-align: center; margin-bottom: 10px; }
                .info { text-align: center; margin-bottom: 20px; font-size: 14px; }
                .info .meta { margin: 0; font-size: 12px; font-weight: 600; }
                table { width: 100%; border-collapse: collapse; font-size: 10px; }
                th, td { border: 1px solid #000; padding: 6px 4px; text-align: left; vertical-align: top; }
                th { background-color: #f0f0f0; font-weight: bold; }
              </style>
            </head>
            <body>
              <h2>Pending Applications Report</h2>
              <div class="info">
                <p class="meta">
                  <strong>Scholarship:</strong> ${selectedScholarshipName || 'N/A'} |
                  <strong>Session:</strong> ${selectedSession?.session_name || 'N/A'}${classMeta}${schoolMeta} |
                  <strong>Generated:</strong> ${generatedAt}
                </p>
              </div>
              <table>
                <thead>${headerRows}</thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </body>
          </html>
        `;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          toast.error('Please allow pop-ups to download PDF');
          return;
        }
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
      };

      return (
        <div className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Pending Applications</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="scert-btn-primary"
                onClick={handleDownloadPendingPDF}
                disabled={loadingPendingApps || scopedPendingApps.length === 0}
              >
                Download PDF
              </button>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => {
                  clearPendingSelection();
                  fetchPendingApplications();
                }}
                disabled={loadingPendingApps}
              >
                {loadingPendingApps ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {renderPendingClassFilters({ includeSchool: true, hideNmmssClass: true })}

          <div className="bulk-actions-bar">
            <div className="bulk-actions-left">
              <span className="bulk-count">
                Selected: <strong>{selectedPendingIds.size}</strong>
              </span>
            </div>
            <div className="bulk-actions-right" style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="save-draft-btn"
                disabled={selectedPendingIds.size === 0 || loadingPendingApps}
                onClick={() => setShowBulkReturnModal(true)}
              >
                Return to School
              </button>
            </div>
          </div>

          {loadingPendingApps ? (
            <div className="loading-state">Loading pending applications...</div>
          ) : pendingError ? (
            <div className="error-state">{pendingError}</div>
          ) : scopedPendingApps.length === 0 ? (
            <div className="empty-state">No pending applications found for the selected filters.</div>
          ) : (
            <>
            <div className="smart-table-wrap beo-pending-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
              <table
                className={`smart-table beo-pending-table ${isCmScholarship ? 'beo-pending-table-cm' : ''}`}
                style={{ minWidth: isNmmssScholarship ? '3200px' : '2800px' }}
              >
                <thead>
                  {isNmmssScholarship ? (
                    <>
                    <tr>
                      <th rowSpan={2} style={{ width: 48 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedPendingIds(new Set(allIds));
                            else clearPendingSelection();
                          }}
                          disabled={allIds.length === 0}
                        />
                      </th>
                      <th rowSpan={2} style={{ minWidth: 90 }}>Action</th>
                      <th rowSpan={2} style={{ minWidth: 70 }}>S. No.</th>
                      <th rowSpan={2} style={{ minWidth: 100 }}>BlockCode</th>
                      <th rowSpan={2} style={{ minWidth: 100 }}>Exam Code</th>
                      <th rowSpan={2} style={{ minWidth: 120 }}>Application ID</th>
                      <th rowSpan={2} style={{ minWidth: 170 }}>ROLL. No. (10 Digit)</th>
                      <th rowSpan={2} style={{ minWidth: 140 }}>SR No. of students</th>
                      <th rowSpan={2} style={{ minWidth: 170 }}>Student&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Father&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Date of Birth</th>
                      <th rowSpan={2} style={{ minWidth: 90 }}>Sex</th>
                      <th rowSpan={2} style={{ minWidth: 140 }}>Caste Category</th>
                      <th rowSpan={2} style={{ minWidth: 140 }}>Divyangta code</th>
                      <th rowSpan={2} style={{ minWidth: 220 }}>Percentage of marks in Class 7th</th>
                      <th rowSpan={2} style={{ minWidth: 200 }}>Parental Income Code 1 or 2</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Aadhaar Number</th>
                      <th rowSpan={2} style={{ minWidth: 180 }}>School Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Block</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>District</th>
                      <th rowSpan={2} style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th rowSpan={2} style={{ minWidth: 220 }}>School Catogary (Urban, Rural)</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th rowSpan={2} style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Contact No</th>
                      <th colSpan={2} style={{ minWidth: 180, textAlign: 'center' }}>Attendance</th>
                    </tr>
                    <tr>
                      <th style={{ minWidth: 90 }}>MAT</th>
                      <th style={{ minWidth: 90 }}>SAT</th>
                    </tr>
                  </>
                  ) : (
                    <>
                    <tr>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ width: 48 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedPendingIds(new Set(allIds));
                            else clearPendingSelection();
                          }}
                          disabled={allIds.length === 0}
                        />
                      </th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 90 }}>Action</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 70 }}>S. No.</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 100 }}>Block Code</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 120 }}>Application ID</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 130 }}>SR No. of students</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 170 }}>Student&apos;s Name</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 160 }}>Father&apos;s Name</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 130 }}>Date of Birth</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 90 }}>Sex</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 140 }}>Caste Category</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 170 }}>Type of Divyangta</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 150 }}>Aadhaar Number</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 180 }}>School Name</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 130 }}>Block</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 150 }}>District</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 220 }}>School Category (Urban, Rural)</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 180 }}>Previous School Name</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 300 }}>Previous School Type (Govt, Govt aided, Local body)</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                      <th rowSpan={isCmScholarship ? 2 : undefined} style={{ minWidth: 130 }}>Contact No</th>
                      {isCmScholarship ? <th colSpan={2} style={{ minWidth: 180, textAlign: 'center' }}>Attendance</th> : null}
                    </tr>
                    {isCmScholarship ? (
                      <tr>
                        <th style={{ minWidth: 90 }}>MAT</th>
                        <th style={{ minWidth: 90 }}>SAT</th>
                      </tr>
                    ) : null}
                  </>
                  )}
                </thead>
                <tbody>
                  {pagedPendingApps.map((row, index) => {
                    const displayStatus = row.status === 'SUBMITTED' && row.current_stage === 'BEO' ? 'Pending' : row.status;
                    if (isNmmssScholarship) {
                      return (
                        <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPendingIds.has(String(row.application_id))}
                              onChange={() => toggleSelectedPending(row.application_id)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="icon-action-btn"
                              title="Verify / Edit"
                              onClick={() => setEditingPendingId(String(row.application_id))}
                            >
                              <HiOutlinePencil />
                            </button>
                          </td>
                          <td>{pendingStartIndex + index + 1}</td>
                          <td>{row.block_code || '-'}</td>
                          <td>{pickFirst(row, ['exam_code']) || '-'}</td>
                          <td><code className="smart-table-id">{window.getDisplayApplicationId(row)}</code></td>
                          <td className="smart-table-strong">{row.roll_number || '-'}</td>
                          <td>{getStudentRegistrationNo(row)}</td>
                          <td>{row.candidate_name || row.student_name || '-'}</td>
                          <td>{row.father_name || '-'}</td>
                          <td>{row.mother_name || '-'}</td>
                          <td>{formatMaybeDate(row.date_of_birth || row.dob)}</td>
                          <td>{row.sex || row.gender || '-'}</td>
                          <td>{row.caste_category || '-'}</td>
                          <td>{formatDivyangta(row.type_of_divyangta, row)}</td>
                          <td>{pickFirst(row, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7']) || '-'}</td>
                          <td>{pickFirst(row, ['parental_income_code', 'income_code']) || '-'}</td>
                          <td>{row.aadhaar_number || '-'}</td>
                          <td>{row.school_name || row.origin_school || '-'}</td>
                          <td>{row.block_name || '-'}</td>
                          <td>{row.district_name || row.district || row.district_code || '-'}</td>
                          <td>{row.school_type || '-'}</td>
                          <td>{row.school_category || '-'}</td>
                          <td>{row.center_order || '-'}</td>
                          <td>{row.center_name || '-'}</td>
                          <td>{row.contact_no || '-'}</td>
                          <td>{formatAttendanceFlag(pickFirst(row, ['mat', 'mat_status']))}</td>
                          <td>{formatAttendanceFlag(pickFirst(row, ['sat', 'sat_status']))}</td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedPendingIds.has(String(row.application_id))}
                            onChange={() => toggleSelectedPending(row.application_id)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-action-btn"
                            title="Verify / Edit"
                            onClick={() => setEditingPendingId(String(row.application_id))}
                          >
                            <HiOutlinePencil />
                          </button>
                        </td>
                        <td>{pendingStartIndex + index + 1}</td>
                        <td>{row.block_code || '-'}</td>
                        <td><code className="smart-table-id">{window.getDisplayApplicationId(row)}</code></td>
                        <td className="smart-table-strong">{row.roll_number || '-'}</td>
                        <td>{getStudentRegistrationNo(row)}</td>
                        <td>{row.candidate_name || row.student_name || '-'}</td>
                        <td>{row.father_name || '-'}</td>
                        <td>{row.mother_name || '-'}</td>
                        <td>{formatMaybeDate(row.date_of_birth || row.dob)}</td>
                        <td>{row.sex || row.gender || '-'}</td>
                        <td>{row.caste_category || '-'}</td>
                        <td>{formatDivyangta(row.type_of_divyangta, row)}</td>
                        <td>{row.aadhaar_number || '-'}</td>
                        <td>{row.school_name || row.origin_school || '-'}</td>
                        <td>{row.block_name || '-'}</td>
                        <td>{row.district_name || row.district || row.district_code || '-'}</td>
                        <td>{row.school_type || '-'}</td>
                        <td>{row.school_category || '-'}</td>
                        <td>{row.previous_school_name || '-'}</td>
                        <td>{row.previous_school_type || '-'}</td>
                        <td>{row.center_order || '-'}</td>
                        <td>{row.center_name || row.center_id || '-'}</td>
                        <td>{row.contact_no || '-'}</td>
                        {isCmScholarship ? <td>{formatAttendanceFlag(pickFirst(row, ['mat', 'mat_status']))}</td> : null}
                        {isCmScholarship ? <td>{formatAttendanceFlag(pickFirst(row, ['sat', 'sat_status']))}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPendingCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={safePendingPage <= 1}
              >
                Previous
              </button>
              <span className="pagination-info">
                Showing {pendingTotal === 0 ? 0 : pendingStartIndex + 1}-
                {Math.min(pendingStartIndex + PENDING_PAGE_SIZE, pendingTotal)} of {pendingTotal} (Page{' '}
                {safePendingPage} / {pendingTotalPages})
              </span>
              <button
                type="button"
                className="pagination-btn"
                onClick={() =>
                  setPendingCurrentPage((prev) => Math.min(pendingTotalPages, prev + 1))
                }
                disabled={safePendingPage >= pendingTotalPages}
              >
                Next
              </button>
            </div>
            </>
          )}
        </div>
      );
    }

    if (currentView === 'submitted-applications') {
      return <BeoSubmittedApplications key={key} />;
    }

    if (currentView === 'return-to-school') {
      let scopedReturnedApps = filterRowsBySelectedScholarship(returnedToSchoolApps);
      if (pendingClassFilter) {
        scopedReturnedApps = scopedReturnedApps.filter(
          (a) => String(a?.class ?? '') === String(pendingClassFilter)
        );
      }

      return (
        <div className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Returned to School</h3>
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={fetchReturnedToSchoolApplications}
              disabled={loadingReturnedToSchoolApps}
            >
              {loadingReturnedToSchoolApps ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {renderPendingClassFilters()}

          {loadingReturnedToSchoolApps ? (
            <div className="loading-state">Loading returned applications...</div>
          ) : returnedToSchoolError ? (
            <div className="error-state">{returnedToSchoolError}</div>
          ) : scopedReturnedApps.length === 0 ? (
            <div className="empty-state">No applications returned to school found for the selected filters.</div>
          ) : (
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>Application ID</th>
                    <th>Student Name</th>
                    <th>Class</th>
                    <th>School Name</th>
                    <th>UDISE Code</th>
                    
                    <th>Status</th>
                    <th>Returned At</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedReturnedApps.map((row) => (
                    <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(row)}</code>
                      </td>
                      <td className="smart-table-strong">{row.student_name || '-'}</td>
                      <td>{row.class || '-'}</td>
                      <td>{row.school_name || '-'}</td>
                      <td>{row.udise_code || '-'}</td>
                      
                      <td>
                        <span className="status-pill status-returned">
                         Returned
                        </span>
                      </td>
                      <td>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    if (currentView === 'returned-by-scert') {
      return <BeoReturnedBySCERT key={key} />;
    }

    if (currentView === 'approved-applications') {
      return <BeoApprovedApplications key={key} featureLocks={featureLocks} />;
    }

    if (currentView === 'create-centers') {
      return <BeoCreateCenters key={key} />;
    }

    if (currentView === 'allocate-centers') {
      return <BeoCenterAssignment key={key} />;
    }

    if (currentView === 'admit-cards') {
      return <BeoAdmitCardsPage key={key} onNavigate={navigateTo} />;
    }

    if (currentView === 'nominee-roll') {
      return <BeoNominalRollPage key={key} onNavigate={navigateTo} />;
    }

    if (currentView === 'verification-form') {
      return <BeoVerificationFormPage key={key} onNavigate={navigateTo} />;
    }

    if (currentView === 'upload-absentee') {
      return <BeoUploadAbsentee key={key} />;
    }

    if (currentView === 'upload-absentee-during-exam') {
      return <BeoUploadAbsenteeDuringExam key={key} />;
    }

    if (currentView === 'upload-cs-report') {
      return <BeoCsReports key={key} />;
    }

    if (currentView === 'cs-report') {
      return <BeoCsReports key={key} viewOnly={true} />;
    }

    if (currentView === 'progress-report') {
      return <BeoProgressReport key={key} />;
    }

    if (currentView === 'list-centers') {
      return <BeoListCentersPage key={key} />;
    }

    if (currentView === 'absentee-during-exam') {
      return <BeoAbsenteeDuringExamPage key={key} />;
    }

    if (currentView === 'result') {
      return (
        <BeoResultPage
          key={key}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          sessionName={sessions.find((s) => String(s.session_id) === String(selectedSessionId))?.session_name || '—'}
          schemeName={selectedScholarshipName || '—'}
        />
      );
    }

    return (
      <div className="placeholder-view">
        <div className="placeholder-content">
          <h3>{currentView.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h3>
          <p>This feature is under development.</p>
        </div>
      </div>
    );
  };

  return (
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
            {mobileSidebarOpen ? 'X' : 'Menu'}
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
              <span className="custom-dropdown-arrow">{sessionDropdownOpen ? '^' : 'v'}</span>
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
              <span className="custom-dropdown-arrow">{scholarshipDropdownOpen ? '^' : 'v'}</span>
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
            className={currentView === 'dashboard' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => navigateTo('dashboard')}
          >
            <span className="scert-dash-link-icon"><HiOutlineHome /></span>
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className={currentView === 'how-to-apply' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => navigateTo('how-to-apply')}
          >
            <span className="scert-dash-link-icon"><HiOutlineVideoCamera /></span>
            <span>Tutorial</span>
          </button>
          {/* Administration */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleMenu('administration')}
            >
              <span className="scert-nav-section-icon"><HiOutlineCog /></span>
              <span>Administration</span>
              <span className="scert-nav-section-arrow">
                {expandedMenu === 'administration' ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedMenu === 'administration' && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={currentView === 'profile' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setShowEditProfile(false);
                    navigateTo('profile');
                  }}
                >
                  <span>Profile</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'change-password' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('change-password')}
                >
                  <span>Change Password</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'create-centers' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('create-centers')}
                >
                  <span>Create Centers</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'allocate-centers' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('allocate-centers')}
                >
                  <span>Allocate Centers</span>
                </button>
              </div>
            )}
          </div>

          {/* Data Entry */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleMenu('data-entry')}
            >
              <span className="scert-nav-section-icon"><HiOutlinePencil /></span>
              <span>Data Entry</span>
              <span className="scert-nav-section-arrow">
                {expandedMenu === 'data-entry' ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedMenu === 'data-entry' && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={currentView === 'upload-absentee-during-exam' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('upload-absentee-during-exam')}
                >
                  <span>Absentee During Exam</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'upload-absentee' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('upload-absentee')}
                >
                  <span>Absentee After Exam</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'upload-cs-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('upload-cs-report')}
                >
                  <span>Center Superintendents Report</span>
                </button>
              </div>
            )}
          </div>

          {/* Verification */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleMenu('verification')}
            >
              <span className="scert-nav-section-icon"><HiOutlineCheckCircle /></span>
              <span>Verification</span>
              <span className="scert-nav-section-arrow">
                {expandedMenu === 'verification' ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedMenu === 'verification' && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={currentView === 'verification-pending' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('verification-pending')}
                >
                  <span>Pending Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'submitted-applications' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('submitted-applications')}
                >
                  <span>Submitted Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'return-to-school' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('return-to-school')}
                >
                  <span>Applications Return to School</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'returned-by-scert' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('returned-by-scert')}
                >
                  <span>Applications Return by SCERT</span>
                </button>
              </div>
            )}
          </div>

          {/* Download */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleMenu('download')}
            >
              <span className="scert-nav-section-icon"><HiOutlineDownload /></span>
              <span>Download</span>
              <span className="scert-nav-section-arrow">
                {expandedMenu === 'download' ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedMenu === 'download' && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={currentView === 'nominee-roll' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('nominee-roll')}
                >
                  <span>Center-Wise Nominal Roll</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'verification-form' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('verification-form')}
                >
                  <span>Center-Wise Verification Form</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'admit-cards' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('admit-cards')}
                >
                  <span>Admit Card</span>
                </button>
              </div>
            )}
          </div>

          {/* Reports */}
          <div className="scert-nav-section">
            <button
              type="button"
              className="scert-nav-section-header"
              onClick={() => toggleMenu('reports')}
            >
              <span className="scert-nav-section-icon"><HiOutlineDocumentReport /></span>
              <span>Reports</span>
              <span className="scert-nav-section-arrow">
                {expandedMenu === 'reports' ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}
              </span>
            </button>
            {expandedMenu === 'reports' && (
              <div className="scert-nav-section-items">
                <button
                  type="button"
                  className={currentView === 'progress-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('progress-report')}
                >
                  <span>Progress Report</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'approved-applications' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('approved-applications')}
                >
                  <span>Approved Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'absentee-during-exam' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('absentee-during-exam')}
                >
                  <span>Absentee During Exam</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'cs-report' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('cs-report')}
                >
                  <span>Center supritendent Reports</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'list-centers' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('list-centers')}
                >
                  <span>List Of Centers</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'school-list' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => navigateTo('school-list')}
                >
                  <span>List of Schools</span>
                </button>
              </div>
            )}
          </div>

          {/* Result is its own destination, not a report - a top-level link like Dashboard. */}
          <button
            type="button"
            className={currentView === 'result' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => navigateTo('result')}
          >
            <span className="scert-dash-link-icon"><HiOutlineAcademicCap /></span>
            <span>Result</span>
          </button>
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
        {/* Sticky BEO Info Bar */}
        <div className="school-info-bar">
          {!profileData && loadingProfile ? (
            <span className="school-info-loading">Loading BEO info...</span>
          ) : profileData?.profile ? (
            <>
              <div className="school-info-name">
                Block Education Officer - {profileData.profile.block_name || '-'}
              </div>
              <div className="school-info-details">
                <div className="school-info-item">
                  <span className="school-info-label">District</span>
                  <span className="school-info-value">{profileData.profile.district_name || '-'}</span>
                </div>
                <div className="school-info-item">
                  <span className="school-info-label">District Code</span>
                  <span className="school-info-value">{profileData.profile.district_code || '-'}</span>
                </div>
                <div className="school-info-divider" />
                <div className="school-info-item">
                  <span className="school-info-label">Block Code</span>
                  <span className="school-info-value">{profileData.profile.block_code || '-'}</span>
                </div>
              </div>
            </>
          ) : (
            <span className="school-info-loading">BEO info unavailable</span>
          )}
        </div>

        <div className="scert-dash-content">
          {renderContent()}
        </div>
      </main>

      <BeoBulkReturnModal
        isOpen={showBulkReturnModal}
        onClose={() => setShowBulkReturnModal(false)}
        onSubmit={handleBulkReturnToSchool}
        selectedCount={selectedPendingIds.size}
        isSubmitting={bulkReturning}
      />
      </div>
    </div>
  );
}

export function BeoDashboard() {
  return (
    <DashboardProvider>
      <BeoDashboardContent />
    </DashboardProvider>
  );
}
