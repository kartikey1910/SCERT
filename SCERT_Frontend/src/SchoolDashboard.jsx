import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { DashboardProvider, useDashboard } from './DashboardContext.jsx';
import { get, post, put, API_BASE_URL, del } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { SchoolPendingApplicationEditor } from './SchoolPendingApplicationEditor.jsx';
import { SchoolDashboardHome } from './SchoolDashboardHome.jsx';
import { SchoolProfileForm } from './SchoolProfileForm.jsx';
import { SchoolAdmitCardsPage } from './school.admit-cards-page.jsx';
import { SchoolResultPage } from './school.result-page.jsx';
import { SchoolApprovedApplicationsPage } from './school.approved-applications-page.jsx';
import { PrimarySchoolSelectorModal } from './PrimarySchoolSelectorModal.jsx';
import { SchoolDeclarationModal } from './SchoolDeclarationModal.jsx';
import { SchoolBulkRejectModal } from './SchoolBulkRejectModal.jsx';
import { SchoolDeleteDraftModal } from './SchoolDeleteDraftModal.jsx';
import { HowToApplyGuide } from './HowToApplyGuide.jsx';
import { FileAttachment } from './FileAttachment.jsx';
import { getScholarshipDisplayName } from './utils/scholarshipDisplayName.js';
import { nmmssDocumentVisibility, readCasteValue, readIncomeUnderLimit, isUploadRequired, isDivyangtaCertificateDoc } from './utils/nmmssDocumentRules.js';
import { shrinkImageForUpload, PHOTO_MAX_DIMENSION, DOCUMENT_MAX_DIMENSION } from './utils/shrinkImageForUpload.js';
import { packFormRows, formRowClassName, rowKinds } from './utils/formRows.js';
import { numberInputAttrs, sanitizeNumberValue } from './utils/numberInput.js';
import { HIDDEN_FILE_INPUT_STYLE } from './utils/hiddenFileInput.js';
import { 
  HiOutlineHome,
  HiOutlineCog, 
  HiOutlineDocumentAdd,
  HiOutlineCheckCircle,
  HiOutlineDownload,
  HiOutlineLogout,
  HiOutlineChevronRight,
  HiOutlineChevronDown,
  HiOutlineAcademicCap,
  HiOutlineVideoCamera
} from 'react-icons/hi';

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
  const splitMultiValues = (rawValue) => {
    if (rawValue === null || rawValue === undefined) return [];
    if (Array.isArray(rawValue)) {
      return rawValue.flatMap((item) => splitMultiValues(item)).filter(Boolean);
    }

    const raw = String(rawValue).trim();
    if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') {
      return [];
    }

    if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
      if (raw.startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
          }
        } catch {
          // Fallback to tokenization below.
        }
      }

      return raw
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
        .filter(Boolean);
    }

    return [raw];
  };

  const normalizeDisplay = (rawValue) => {
    const parts = splitMultiValues(rawValue);
    if (!parts.length) return '';
    return Array.from(new Set(parts)).join(', ');
  };

  let v = normalizeDisplay(value);
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
    v = normalizeDisplay(fallback);
  }
  return v ? v : 'No divyangta';
};

const pickFirst = (obj, keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
};

const getStudentRegistrationNo = (app) =>
  pickFirst(app, [
    'sr_no',
    'sr_number',
    'student_registration_number',
    'student_registration_no',
    'student_reg_no',
    'registration_number',
    'registration_no',
  ]) || app.student_registration_no || app.sr_no || '-';

function SchoolDashboardContent() {
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
    loadingScholarships,
    selectedSession
  } = useDashboard();

  const selectedScholarship = scholarships.find(s => s.scholarship_id === selectedScholarshipId);
  const selectedScholarshipName = String(selectedScholarship?.scholarship_name || '');
  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

  const [schoolAppsClassFilter, setSchoolAppsClassFilter] = useState('');

  useEffect(() => {
    if (isCmScholarship) {
      setSchoolAppsClassFilter('6');
      return;
    }

    if (isNmmssScholarship) {
      setSchoolAppsClassFilter('8');
      return;
    }

    setSchoolAppsClassFilter('');
  }, [selectedScholarshipId, isCmScholarship, isNmmssScholarship]);
  
  const [currentView, setCurrentView] = useState('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [navCounter, setNavCounter] = useState(0);
  const [expandedMenu, setExpandedMenu] = useState(null);
  const [approvedStudentsData, setApprovedStudentsData] = useState([]);
  const [admitCardsData, setAdmitCardsData] = useState([]);

  // Verification
  const [draftApps, setDraftApps] = useState([]);
  const [loadingDraftApps, setLoadingDraftApps] = useState(false);
  const [draftError, setDraftError] = useState('');
  // The draft row awaiting delete confirmation, and whether the request is running.
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState(null);

  const [pendingApps, setPendingApps] = useState([]);
  const [loadingPendingApps, setLoadingPendingApps] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [selectedPendingIds, setSelectedPendingIds] = useState(new Set());
  const [editingPendingId, setEditingPendingId] = useState(null);
  const [viewingSubmittedId, setViewingSubmittedId] = useState(null);

  const [submittedApps, setSubmittedApps] = useState([]);
  const [loadingSubmittedApps, setLoadingSubmittedApps] = useState(false);
  const [submittedError, setSubmittedError] = useState('');

  const [rejectedApps, setRejectedApps] = useState([]);
  const [loadingRejectedApps, setLoadingRejectedApps] = useState(false);
  const [rejectedError, setRejectedError] = useState('');

  const [returnedByBeoApps, setReturnedByBeoApps] = useState([]);
  const [loadingReturnedByBeoApps, setLoadingReturnedByBeoApps] = useState(false);
  const [returnedByBeoError, setReturnedByBeoError] = useState('');
  const [editingReturnedByBeoId, setEditingReturnedByBeoId] = useState(null);

  const [profileData, setProfileData] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [activeStrengthClass, setActiveStrengthClass] = useState(6);

  // Password change (same modal UX as Student dashboard)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [scholarshipFormData, setScholarshipFormData] = useState(null);
  // Keyed by scholarship_id: has the school confirmed reading that card's
  // information and eligibility? Cleared whenever the page is reopened, so
  // the confirmation is given fresh on every visit.
  const [eligibilityAccepted, setEligibilityAccepted] = useState({});
  // Exam code (1 or 2) from the backend; decides which documents NMMSS
  // asks for on step 2. Refreshed by every answers save.
  const [savedExamCode, setSavedExamCode] = useState(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [applicationId, setApplicationId] = useState(null);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [fileUploading, setFileUploading] = useState({});
  const [localPreviewUrls, setLocalPreviewUrls] = useState({});
  const localPreviewUrlsRef = useRef({});
  const preschoolNameCacheRef = useRef({});
  const fileInputRefs = useRef({});
  const cameraInputRefs = useRef({});
  const [schoolSelectorOpen, setSchoolSelectorOpen] = useState(false);
  const [currentPreschoolField, setCurrentPreschoolField] = useState(null);
  const [preschoolLabels, setPreschoolLabels] = useState({});
  const [preschoolNameByUdise, setPreschoolNameByUdise] = useState({});
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const sessionDropdownRef = useRef(null);
  const [scholarshipDropdownOpen, setScholarshipDropdownOpen] = useState(false);
  const scholarshipDropdownRef = useRef(null);
  const [formStep, setFormStep] = useState(1);
  const [showBulkDeclarationModal, setShowBulkDeclarationModal] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [showBulkRejectModal, setShowBulkRejectModal] = useState(false);
  const [isBulkRejecting, setIsBulkRejecting] = useState(false);

  const preschoolUdiseCodes = useMemo(() => {
    const form = Array.isArray(scholarshipFormData?.form) ? scholarshipFormData.form : [];
    const preschoolFields = form.filter(
      (f) => String(f?.field_type || '').toUpperCase() === 'PRESCHOOL'
    );
    return Array.from(
      new Set(
        preschoolFields
          .map((f) => String(formValues?.[f.field_key] || '').trim())
          .filter(Boolean)
      )
    );
  }, [scholarshipFormData?.form, formValues]);

  const fetchProfile = async () => {
    setLoadingProfile(true);
    try {
      const data = await get('/api/school/profile', { token: auth?.token });
      setProfileData(data);

      const classes = Array.from(
        new Set((data?.class_strengths || []).map((s) => Number(s.class_level)).filter(Boolean))
      ).sort((a, b) => a - b);

      if (classes.length > 0) {
        setActiveStrengthClass((prev) => (classes.includes(prev) ? prev : classes[0]));
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      toast.error(`Failed to load profile: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingProfile(false);
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

  const fetchDraftApplications = async () => {
    setLoadingDraftApps(true);
    setDraftError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (schoolAppsClassFilter) params.append('class_filter', schoolAppsClassFilter);

      const data = await get(
        `/api/school/applications/drafts${params.toString() ? `?${params.toString()}` : ''}`,
        { token: auth?.token, sessionId: selectedSessionId }
      );
      setDraftApps(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch draft applications';
      setDraftError(errorMsg);
      setDraftApps([]);
      toast.error(`Failed to load draft applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingDraftApps(false);
    }
  };

  const fetchPendingApplications = async () => {
    setLoadingPendingApps(true);
    setPendingError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (schoolAppsClassFilter) params.append('class_filter', schoolAppsClassFilter);

      const data = await get(
        `/api/school/applications/pending${params.toString() ? `?${params.toString()}` : ''}`,
        { token: auth?.token, sessionId: selectedSessionId }
      );
      setPendingApps(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch pending applications';
      setPendingError(errorMsg);
      setPendingApps([]);
      toast.error(`Failed to load pending applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingPendingApps(false);
    }
  };

  const fetchSubmittedApplications = async () => {
    setLoadingSubmittedApps(true);
    setSubmittedError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (schoolAppsClassFilter) params.append('class_filter', schoolAppsClassFilter);

      const data = await get(
        `/api/school/applications/submitted${params.toString() ? `?${params.toString()}` : ''}`,
        { token: auth?.token }
      );
      setSubmittedApps(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch submitted applications';
      setSubmittedError(errorMsg);
      setSubmittedApps([]);
      toast.error(`Failed to load submitted applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingSubmittedApps(false);
    }
  };

  const fetchRejectedApplications = async () => {
    setLoadingRejectedApps(true);
    setRejectedError('');

    try {
      const data = await get('/api/school/applications/rejected', { token: auth?.token });
      setRejectedApps(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch rejected applications';
      setRejectedError(errorMsg);
      setRejectedApps([]);
      toast.error(`Failed to load rejected applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingRejectedApps(false);
    }
  };

  const fetchReturnedByBeoApplications = async () => {
    setLoadingReturnedByBeoApps(true);
    setReturnedByBeoError('');

    try {
      const data = await get('/api/school/applications/returned-by-beo', { token: auth?.token });
      setReturnedByBeoApps(Array.isArray(data) ? data : []);
    } catch (err) {
      const errorMsg = err.message || 'Failed to fetch returned applications';
      setReturnedByBeoError(errorMsg);
      setReturnedByBeoApps([]);
      toast.error(`Failed to load returned applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingReturnedByBeoApps(false);
    }
  };

  // Fetch profile once for topbar + for profile view
  useEffect(() => {
    if (auth?.token && !profileData) {
      fetchProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

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


  const filterRowsBySelectedScholarship = (rows) => {
    if (!selectedScholarshipId) return rows;
    return (rows || []).filter(
      (row) => String(row.scholarship_id || '') === String(selectedScholarshipId)
    );
  };

  const sortRowsByApplicationDisplayIdAsc = (rows, { byFilledOrder = false } = {}) => {
    const list = Array.isArray(rows) ? [...rows] : [];
    const isNmmssSelected =
      /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

    const getDisplayId = (row) =>
      String(row?.application_display_id || window.getDisplayApplicationId(row) || '').trim().toUpperCase();

    const getTrailingSerial = (displayId) => {
      const match = String(displayId || '').match(/(\d{5})$/);
      return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    };

    // NMMSS pending list: the order the applications were filled in (first
    // submitted first), not the application ID, which is issued separately.
    if (isNmmssSelected && byFilledOrder) {
      const filledAt = (row) => {
        const t = Date.parse(row?.submitted_at || row?.created_at || '');
        return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
      };
      return list.sort((a, b) => {
        const diff = filledAt(a) - filledAt(b);
        if (diff !== 0) return diff;
        return Number(a?.application_id || 0) - Number(b?.application_id || 0);
      });
    }

    // For other NMMSS lists: strictly sort by trailing 5-digit serial (small -> big).
    if (isNmmssSelected) {
      return list.sort((a, b) => {
        const aDisplay = getDisplayId(a);
        const bDisplay = getDisplayId(b);
        const aSerial = getTrailingSerial(aDisplay);
        const bSerial = getTrailingSerial(bDisplay);

        if (aSerial !== bSerial) return aSerial - bSerial;
        if (aDisplay !== bDisplay) return aDisplay.localeCompare(bDisplay, undefined, { numeric: true });
        return Number(a?.application_id || 0) - Number(b?.application_id || 0);
      });
    }

    const extractParts = (value) => {
      const text = String(value || '').trim().toUpperCase();
      const serialMatch = text.match(/(\d{5})$/);
      const serial = serialMatch ? Number(serialMatch[1]) : Number.MAX_SAFE_INTEGER;
      const m = text.match(/^([A-Z]*)(\d+)$/);
      if (!m) return { prefix: text, number: Number.MAX_SAFE_INTEGER, serial };
      return { prefix: m[1] || '', number: Number(m[2] || 0), serial };
    };

    return list.sort((a, b) => {
      const aDisplay = getDisplayId(a);
      const bDisplay = getDisplayId(b);

      if (!aDisplay && !bDisplay) {
        return Number(a?.application_id || 0) - Number(b?.application_id || 0);
      }
      if (!aDisplay) return 1;
      if (!bDisplay) return -1;

      const aParts = extractParts(aDisplay);
      const bParts = extractParts(bDisplay);

      if (aParts.serial !== bParts.serial) return aParts.serial - bParts.serial;

      const prefixCmp = aParts.prefix.localeCompare(bParts.prefix);
      if (prefixCmp !== 0) return prefixCmp;
      if (aParts.number !== bParts.number) return aParts.number - bParts.number;
      return aDisplay.localeCompare(bDisplay, undefined, { numeric: true });
    });
  };

  const renderSchoolClassFilters = () => {
    if (!isCmScholarship && !isNmmssScholarship) return null;

    return (
      <div className="filters-bar">
        <div className="filter-group">
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {isNmmssScholarship ? (
              <button
                type="button"
                className={`filter-btn ${schoolAppsClassFilter === '8' ? 'filter-btn-active' : ''}`}
                onClick={() => setSchoolAppsClassFilter('8')}
              >
                Class 8
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`filter-btn ${schoolAppsClassFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                  onClick={() => setSchoolAppsClassFilter('6')}
                >
                  Class 6
                </button>
                <button
                  type="button"
                  className={`filter-btn ${schoolAppsClassFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                  onClick={() => setSchoolAppsClassFilter('9')}
                >
                  Class 9
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSchoolClassFilterButtons = () => {
    if (!isCmScholarship && !isNmmssScholarship) return null;

    if (isNmmssScholarship) {
      return (
        <button
          type="button"
          className={`filter-btn ${schoolAppsClassFilter === '8' ? 'filter-btn-active' : ''}`}
          onClick={() => setSchoolAppsClassFilter('8')}
        >
          Class 8
        </button>
      );
    }

    return (
      <>
        <button
          type="button"
          className={`filter-btn ${schoolAppsClassFilter === '6' ? 'filter-btn-class6-active' : ''}`}
          onClick={() => setSchoolAppsClassFilter('6')}
        >
          Class 6
        </button>
        <button
          type="button"
          className={`filter-btn ${schoolAppsClassFilter === '9' ? 'filter-btn-class9-active' : ''}`}
          onClick={() => setSchoolAppsClassFilter('9')}
        >
          Class 9
        </button>
      </>
    );
  };

  const getApplyScholarshipDetails = (scholarship) => {
    const scholarshipName = String(scholarship?.scholarship_name || '');
    const isCm =
      /\bCM\b/i.test(scholarshipName) || /CHIEF\s*MINISTER/i.test(scholarshipName);
    const isNmmss =
      /\bNMMSS\b/i.test(scholarshipName) || /\bNMMS\b/i.test(scholarshipName);

    if (isCm) {
      return {
        hiTitle: 'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति योजना जूनियर स्तर (कक्षा 6) परीक्षा हेतु अर्हता',
        enTitle:
          'Eligibility for the Chief Minister Meritorious Student Incentive Scholarship Scheme Junior Level (Class 6) Examination',
        hiPara:
          'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति योजना के अंतर्गत जूनियर स्तर (कक्षा 6) परीक्षा   के लिए वही छात्र अर्ह होंगे, जिन्होंने कक्षा 5  की परीक्षा उत्तराखंड राज्य के किसी राजकीय/राजकीय सहायता प्राप्त विद्यालय से उत्तीर्ण की हो तथा वर्तमान में किसी राजकीय/राजकीय सहायता प्राप्त विद्यालय में अध्ययनरत हों।',
        enPara:
          'Under the Chief Minister Meritorious Student Incentive Scholarship Scheme Junior Level (Class 6), only those students will be eligible who have passed Class 5 from a Government / Government-aided school of Uttarakhand and currently studying in a Government / Government-aided school.',
        hiTitle2: 'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति योजना माध्यमिक स्तर (कक्षा 9) परीक्षा हेतु अर्हता',
        enTitle2:
          'Eligibility for the Chief Minister Meritorious Student Incentive Scholarship Scheme Secondary Level (Class 9) Examination',
        hiPara2:
          'मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति योजना माध्यमिक स्तर (कक्षा 9) परीक्षा के लिए वही छात्र अर्ह होंगे, जिन्होंने कक्षा 8 की परीक्षा उत्तराखंड राज्य के किसी राजकीय/राजकीय सहायता प्राप्त विद्यालय से उत्तीर्ण की हो तथा वर्तमान में किसी राजकीय/राजकीय सहायता प्राप्त विद्यालय में अध्ययनरत हों।',
        enPara2:
          'Under the Chief Minister Meritorious Student Incentive Scholarship Scheme Secondary Level (Class 9) examination, only those students will be eligible who have passed Class 8 from a Government / Government-aided school of Uttarakhand and currently studying in a Government / Government-aided school.',
      };
    }

    if (isNmmss) {
      return {
        hiTitle: 'राष्ट्रीय साधन-सह-योग्यता छात्रवृत्ति योजना परीक्षा हेतु अर्हता',
        enTitle: 'Eligibility for the National Means-cum-Merit Scholarship Scheme (NMMSS) Examination',
        hiBullets: [
          'छात्र किसी राजकीय (केन्द्रीय एवं आवासीय विद्यालय को छोड़कर)/राजकीय सहायता प्राप्त/स्थानीय निकाय के विद्यालय में कक्षा 8 में अध्ययनरत् हो।',
          'छात्र ने कक्षा 7 में 55% या उससे अधिक अंक प्राप्त किए हों। (SC तथा ST के छात्रों लिए 50% या उससे अधिक)।',
          'छात्र के माता-पिता की वार्षिक आय ₹ 3,50,000 से अधिक न हो।',
        ],
        enBullets: [
          'The student should be studying in Class 8 in a Government (excluding kendriya vidyalaya and residential schools) / Government-aided / Local body school.',
          'The student should have obtained 55% or more marks in Class 7 (50 % or more for SC and ST students).',
          'The annual income of the parents should not exceed ₹ 3,50,000.',
        ],
        hiTitle2: 'डॉ. शिवानंद नौटियाल तथा श्रीदेव सुमन छात्रवृत्ति योजना परीक्षा हेतु अर्हता',
        enTitle2: 'Eligibility for Dr. Shivanand Nautiyal and Sridev Suman Scholarship Schemes Examination',
        hiBullets2: [
          'छात्र किसी राजकीय (केन्द्रीय एवं आवासीय विद्यालय को छोड़कर)/राजकीय सहायता प्राप्त/स्थानीय निकाय के विद्यालय में कक्षा 8 में अध्ययनरत् हो।',
          'छात्र ने कक्षा 7 में 50% या उससे अधिक अंक प्राप्त किए हों। (SC तथा ST के छात्रों लिए 40% या उससे अधिक)।',
          'इस योजना के लिए माता-पिता की वार्षिक आय का कोई प्रतिबंध नहीं है।',
        ],
        enBullets2: [
          'The student should be studying in Class 8 in a Government (excluding kendriya vidyalaya and residential schools) / Government-aided / Local body school.',
          'The student should have obtained 50% or more marks in Class 7 (40% or more for SC and ST students).',
          'There is no restriction on the annual income of the parents for this scheme.',
        ],
      };
    }

    return {
      hiTitle: 'अर्हता',
      enTitle: 'Eligibility',
      hiPara: String(scholarship?.eligibility || ''),
      enPara: String(scholarship?.eligibility || ''),
    };
  };

  const buildSchoolApplicationsReportHtml = (rows, reportTitle, { includeDeclaration = false } = {}) => {
    const sessionLabel =
      selectedSession?.session_name ||
      sessions?.find((s) => String(s?.session_id) === String(selectedSessionId))?.session_name ||
      'N/A';
    const classLine =
      (isCmScholarship || isNmmssScholarship) && schoolAppsClassFilter
        ? `<span><strong>Class:</strong> ${schoolAppsClassFilter}</span>`
        : '';

    // table-layout: auto still let this table's header words wrap onto
    // many stacked lines once there were more columns than the printed page
    // was wide enough for - the browser shrank every column, long ones
    // included, rather than favouring the ones that actually need the room.
    // A colgroup with widths sized to each column's content fixes that.
    const colgroupHtml = isNmmssScholarship
      ? `
        <colgroup>
          <col style="width:2%" /><col style="width:3%" /><col style="width:3%" />
          <col style="width:5%" /><col style="width:5%" /><col style="width:4%" />
          <col style="width:6%" /><col style="width:6%" /><col style="width:6%" />
          <col style="width:4%" /><col style="width:2%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:4%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:7%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:5%" /><col style="width:4%" />
          <col style="width:3%" /><col style="width:5%" /><col style="width:5%" />
        </colgroup>
      `
      : `
        <colgroup>
          <col style="width:2%" /><col style="width:4%" /><col style="width:5%" />
          <col style="width:5%" /><col style="width:4%" /><col style="width:7%" />
          <col style="width:7%" /><col style="width:7%" /><col style="width:4%" />
          <col style="width:3%" /><col style="width:3%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:6%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:5%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:5%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:3%" />
        </colgroup>
      `;

    const headerHtml = isNmmssScholarship
      ? `
        <tr>
          <th>S. No.</th>
          <th>BlockCode</th>
          <th>Exam Code</th>
          <th>Application ID</th>
          <th>ROLL. No. (10 Digit)</th>
          <th>SR No. of students</th>
          <th>Student's Name</th>
          <th>Father's Name</th>
          <th>Mother's Name</th>
          <th>Date of Birth</th>
          <th>Sex</th>
          <th>Caste Category</th>
          <th>Divyangta code</th>
          <th>Percentage of marks in Class 7th</th>
          <th>Parental Income Code 1 or 2</th>
          <th>Aadhaar Number</th>
          <th>School Name</th>
          <th>Block</th>
          <th>District</th>
          <th>School Type (Govt, Govt aided, Local body)</th>
          <th>School Catogary (Urban, Rural)</th>
          <th>Exam Center Code</th>
          <th>Exam Centre's Name</th>
          <th class="contact-col">Contact No</th>
        </tr>
      `
      : `
        <tr>
          <th>S. No.</th>
          <th>Block Code</th>
          <th>Application ID</th>
          <th>Roll No. (10 Digit)</th>
          <th>SR No. of students</th>
          <th>Student's Name</th>
          <th>Father's Name</th>
          <th>Mother's Name</th>
          <th>Date of Birth</th>
          <th>Sex</th>
          <th>Caste Category</th>
          <th>Type of Divyangta</th>
          <th>Aadhaar Number</th>
          <th>School Name</th>
          <th>Block</th>
          <th>District</th>
          <th>School Type (Govt, Govt aided, Local body)</th>
          <th>School Category (Urban, Rural)</th>
          <th>Previous School Name</th>
          <th>Previous School Type (Govt, Govt aided, Local body)</th>
          <th>Exam Center Code</th>
          <th>Exam Centre's Name</th>
          <th class="contact-col">Contact No</th>
        </tr>
      `;

    const rowsHtml = rows
      .map((app, index) =>
        isNmmssScholarship
          ? `
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
              <td class="contact-col">${app.contact_no || '-'}</td>
            </tr>
          `
          : `
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
              <td class="contact-col">${app.contact_no || '-'}</td>
            </tr>
          `
      )
      .join('');

    return `
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @page { size: A4 landscape; margin: 8mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            h2 { text-align: center; margin: 0 0 6px; font-size: 18px; }
            .info { margin-bottom: 10px; font-size: 12px; line-height: 1.35; }
            .info-row {
              display: flex;
              justify-content: center;
              align-items: center;
              gap: 18px;
              white-space: nowrap;
            }
            .report-wrap { width: 100%; overflow: visible; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
            th, td { border: 1px solid #000; padding: 3px 4px; text-align: left; vertical-align: top; white-space: normal; word-break: break-word; }
            th { background-color: #f0f0f0; font-weight: 700; }
            .contact-col { white-space: nowrap !important; word-break: normal !important; overflow-wrap: normal !important; min-width: 88px; }
            .footer { margin-top: 8px; text-align: right; font-size: 11px; }
            .declaration { margin-top: 18px; font-size: 11px; line-height: 1.6; page-break-inside: avoid; }
            .declaration-signatures { display: flex; justify-content: space-between; margin-top: 26px; }
            .declaration-sign-block { font-size: 11px; }
            @media print {
              html, body { width: 100%; height: auto; }
              .report-wrap { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="report-wrap">
            <h2>${reportTitle}</h2>
            <div class="info">
              <div class="info-row">
                <span><strong>Scholarship:</strong> ${selectedScholarship?.scholarship_name || 'N/A'}</span>
                <span><strong>Session:</strong> ${sessionLabel}</span>
                ${classLine}
                <span><strong>Generated:</strong> ${new Date().toLocaleString()}</span>
              </div>
            </div>
            <table>
              ${colgroupHtml}
              <thead>${headerHtml}</thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div class="footer"><strong>Total Applications:</strong> ${rows.length}</div>
            ${
              includeDeclaration
                ? `
                  <div class="declaration">
                    <p>
                      प्रमाणित किया जाता है कि उपरोक्त सभी सूचनाएँ सही हैं।  सभी सूचनाओं का विद्यालय अभिलेखों एवं छात्रों के
                      आधार कार्ड से मिलान कर लिया गया है।  जिन छात्रों के नाम अथवा जन्मतिथि में विद्यालय अभिलेखों एवं आधार
                      कार्ड के मध्य भिन्नता पाई गई है, उनके अभिभावकों को इस संबंध में सूचित कर दिया गया है।
                    </p>
                    <div class="declaration-signatures">
                      <div class="declaration-sign-block">
                        <div>हस्ताक्षर : ________________</div>
                        <div>कक्षा अध्यापक / कार्यालयाध्यक्ष</div>
                      </div>
                      <div class="declaration-sign-block">
                        <div>हस्ताक्षर : ________________</div>
                        <div>प्रधानाचार्य / प्रधानाध्यापक</div>
                      </div>
                    </div>
                  </div>
                `
                : ''
            }
          </div>
        </body>
      </html>
    `;
  };

  const downloadSchoolApplicationsPdf = (rows, reportTitle, options) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      toast.warning('No applications to download.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to download PDF');
      return;
    }

    printWindow.document.write(buildSchoolApplicationsReportHtml(rows, reportTitle, options));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  useEffect(() => {
    if (currentView === 'profile') {
      fetchProfile();
    }

    if (currentView === 'verification-drafts' && !editingDraftId) {
      fetchDraftApplications();
    }

    if (currentView === 'verification-pending' && !editingPendingId) {
      fetchPendingApplications();
    }

    if (currentView === 'verification-submitted') {
      fetchSubmittedApplications();
    }

    if (currentView === 'verification-rejected') {
      fetchRejectedApplications();
    }

    if (currentView === 'verification-returned-by-beo' && !editingReturnedByBeoId) {
      fetchReturnedByBeoApplications();
    }
  }, [
    currentView,
    editingDraftId,
    editingPendingId,
    editingReturnedByBeoId,
    selectedScholarshipId,
    selectedSessionId,
    schoolAppsClassFilter,
  ]);

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

  const toggleSelectedPending = (applicationId, isSelectable = true) => {
    if (!isSelectable) return;
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

  // Clear selection when scholarship/class filter changes (keeps UI consistent with filtering)
  useEffect(() => {
    clearPendingSelection();
  }, [selectedScholarshipId, schoolAppsClassFilter]);

  const handleBulkReturnToStudent = async () => {
    const scopedPendingApps = filterRowsBySelectedScholarship(pendingApps);
    const returnable = scopedPendingApps.filter(
      (row) => String(row.submitted_by_role || '').toUpperCase() === 'STUDENT'
    );
    const returnableIds = new Set(returnable.map((row) => String(row.application_id)));
    const ids = Array.from(selectedPendingIds).filter((id) => returnableIds.has(String(id)));
    if (ids.length === 0) {
      toast.warning('Select at least one student-submitted application to return.');
      return;
    }

    const remark = prompt('Enter remark to return selected applications to student:');
    if (!remark || !remark.trim()) return;

    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          post(
            `/api/school/applications/${id}/return`,
            { remark_text: remark.trim() },
            { token: auth?.token }
          )
        )
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      if (failureCount === 0) {
        toast.success(`Returned ${successCount} application(s) to student.`);
      } else {
        const firstError = results.find((r) => r.status === 'rejected')?.reason;
        toast.warning(
          `Returned ${successCount} application(s). Failed: ${failureCount}.` +
            (firstError?.message ? ` First error: ${firstError.message}` : '')
        );
      }
    } catch (err) {
      toast.error(`Failed to return applications: ${toast.getErrorMessage(err)}`);
    } finally {
      clearPendingSelection();
      fetchPendingApplications();
    }
  };

  // Permanently deletes one draft the school created. The backend refuses
  // anything that is no longer a draft, so a stale list (someone submitted it
  // in another tab) fails cleanly instead of deleting the wrong thing.
  const handleDeleteDraft = async () => {
    const target = draftToDelete;
    if (!target) return;

    setIsDeletingDraft(true);
    try {
      await del(`/api/school/applications/${target.application_id}/draft`, { token: auth?.token });
      toast.success('Draft application deleted.');
      // Drop the row now rather than waiting for the reload below.
      setDraftApps((prev) => prev.filter((row) => String(row.application_id) !== String(target.application_id)));
    } catch (err) {
      toast.error(`Failed to delete draft: ${toast.getErrorMessage(err)}`);
    } finally {
      setIsDeletingDraft(false);
      setDraftToDelete(null);
      // Whatever happened, show the server's truth.
      fetchDraftApplications();
    }
  };

  // Selected pending applications that Reject applies to: every selected row
  // in the current scholarship (student- and school-submitted alike).
  const getBulkRejectIds = () => {
    const rejectableIds = new Set(
      filterRowsBySelectedScholarship(pendingApps).map((row) => String(row.application_id))
    );
    return Array.from(selectedPendingIds).filter((id) => rejectableIds.has(String(id)));
  };

  const handleOpenBulkReject = () => {
    if (getBulkRejectIds().length === 0) {
      toast.warning('Select at least one application to reject.');
      return;
    }
    setShowBulkRejectModal(true);
  };

  // Permanently rejects the selected pending applications. The backend locks
  // a rejected application (status REJECTED, no resubmission), which is why
  // this sits behind SchoolBulkRejectModal, where a written reason is
  // required - it is what the school later sees under Rejected Applications.
  const handleBulkReject = async (reason) => {
    const ids = getBulkRejectIds();
    if (ids.length === 0) {
      setShowBulkRejectModal(false);
      return;
    }

    setIsBulkRejecting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          post(
            `/api/school/applications/${id}/reject`,
            { remark_text: reason },
            { token: auth?.token }
          )
        )
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      if (failureCount === 0) {
        toast.success(`Rejected ${successCount} application(s).`);
      } else {
        const firstError = results.find((r) => r.status === 'rejected')?.reason;
        toast.warning(
          `Rejected ${successCount} application(s). Failed: ${failureCount}.` +
            (firstError?.message ? ` First error: ${firstError.message}` : '')
        );
      }
    } catch (err) {
      toast.error(`Failed to reject applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setIsBulkRejecting(false);
      setShowBulkRejectModal(false);
      clearPendingSelection();
      fetchPendingApplications();
    }
  };

  const handleBulkSubmitToBeo = async () => {
    const scopedPendingApps = filterRowsBySelectedScholarship(pendingApps);
    const forwardableIds = new Set(scopedPendingApps.map((row) => String(row.application_id)));
    const ids = Array.from(selectedPendingIds).filter((id) => forwardableIds.has(String(id)));

    if (ids.length === 0) {
      toast.warning('Select at least one application to submit to BEO.');
      return;
    }

    setIsBulkSubmitting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => post(`/api/school/applications/${id}/submit`, {}, { token: auth?.token }))
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      if (failureCount === 0) {
        toast.success(`Submitted ${successCount} application(s) to BEO.`);
      } else {
        const firstError = results.find((r) => r.status === 'rejected')?.reason;
        toast.warning(
          `Submitted ${successCount} application(s) to BEO. Failed: ${failureCount}.` +
            (firstError?.message ? ` First error: ${firstError.message}` : '')
        );
      }
      setShowBulkDeclarationModal(false);
    } finally {
      setIsBulkSubmitting(false);
      clearPendingSelection();
      fetchPendingApplications();
    }
  };

  const normalizeKey = (key) => String(key || '').trim().toLowerCase();
  const isAadhaarField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    const hasAadhaarToken =
      key.includes('aadhaar') ||
      key.includes('aadhar') ||
      label.includes('aadhaar') ||
      label.includes('aadhar');
    const isNumberLike =
      key.includes('number') ||
      key.includes('no') ||
      key.includes('_no') ||
      label.includes('number') ||
      label.includes(' no');
    return hasAadhaarToken && isNumberLike;
  };
  const isMobileField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return (
      key.includes('mobile') ||
      key.includes('contact_no') ||
      key.includes('contactnumber') ||
      label.includes('mobile') ||
      label.includes('contact no') ||
      label.includes('contact number')
    );
  };
  const getDigitConstraint = (field) => {
    if (isAadhaarField(field)) return 12;
    if (isMobileField(field)) return 10;
    return null;
  };
  const sanitizeDigitInput = (value, maxLen) =>
    String(value || '')
      .replace(/\D/g, '')
      .slice(0, maxLen);
  const validateDigitConstrainedFields = (fields, valuesByKey) => {
    const invalid = [];
    for (const field of fields || []) {
      const expectedLen = getDigitConstraint(field);
      if (!expectedLen) continue;
      const rawValue = valuesByKey?.[field.field_key];
      if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') continue;
      const digits = String(rawValue).replace(/\D/g, '');
      if (digits.length !== expectedLen) {
        invalid.push(`${field.field_label || field.field_key} (${expectedLen} digits)`);
      }
    }
    return invalid;
  };
  const MIN_APPLICANT_AGE_YEARS = 10;
  const isDobField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return ['date_of_birth', 'dob', 'date of birth'].some((m) => key.includes(m) || label.includes(m));
  };
  const calculateAgeYears = (dobValue) => {
    const dob = new Date(dobValue);
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hadBirthdayThisYear =
      today.getMonth() > dob.getMonth() ||
      (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hadBirthdayThisYear) age -= 1;
    return age;
  };
  const validateMinimumAge = (fields, valuesByKey) => {
    const invalid = [];
    for (const field of fields || []) {
      if (!isDobField(field)) continue;
      const rawValue = valuesByKey?.[field.field_key];
      if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') continue;
      const age = calculateAgeYears(rawValue);
      if (age === null) continue;
      if (age <= MIN_APPLICANT_AGE_YEARS) {
        invalid.push(`${field.field_label || field.field_key} (age must be greater than ${MIN_APPLICANT_AGE_YEARS} years)`);
      }
    }
    return invalid;
  };
  const DISABILITY_KEYS = new Set(['disability', 'divyangta', 'disability_status', 'divyangta_status', 'is_divyang', 'is_disabled']);
  const TYPE_KEYS = new Set(['type_of_disability', 'type_of_divyangta', 'disability_code', 'divyangta_code', 'type_of_disability_code', 'type_of_divyangta_code']);
  const PHOTO_KEYS = ['photo', 'photograph', 'image', 'candidate_image', 'student_image'];
  const SIGN_KEYS = ['signature', 'sign', 'candidate_signature'];

  const getDisabilityValue = (values) => {
    for (const k of DISABILITY_KEYS) {
      const v = values?.[k];
      if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).toLowerCase();
    }
    return String(values?.disability || '').toLowerCase();
  };

  const isDisabilityYesValue = (value) => {
    const v = String(value ?? '').trim().toLowerCase();
    return ['yes', 'y', '1', 'true', 'divyang', 'pwbd', 'disabled'].includes(v);
  };

  const isDisabilityFieldKey = (key) => DISABILITY_KEYS.has(normalizeKey(key));
  const isTypeFieldKey = (key) => TYPE_KEYS.has(normalizeKey(key));
  const isCasteCertificateField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return key.includes('caste_certificate') || (key.includes('caste') && key.includes('certificate')) || label.includes('caste certificate');
  };
  const isMarksheetField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return key.includes('marksheet') || label.includes('marksheet');
  };
  const getCasteSelectionText = (values, fields = []) => {
    const casteField =
      (fields || []).find((f) => {
        const key = normalizeKey(f?.field_key);
        const label = normalizeKey(f?.field_label);
        return key === 'caste_category' || key.includes('caste') || label.includes('caste');
      }) || null;

    const rawValue =
      (casteField && values?.[casteField.field_key] !== undefined ? values?.[casteField.field_key] : undefined) ??
      values?.caste_category ??
      values?.caste ??
      values?.category ??
      '';

    const raw = String(rawValue ?? '').trim();
    if (!raw) return '';

    let optionLabel = '';
    if (casteField?.options?.length) {
      const matched = casteField.options.find(
        (opt) => String(opt?.option_value ?? '').trim().toLowerCase() === raw.toLowerCase()
      );
      optionLabel = String(matched?.option_label || '').trim();
    }

    return `${raw} ${optionLabel}`.trim().toLowerCase();
  };
  const isScStSelected = (values, fields = []) => {
    const text = getCasteSelectionText(values, fields);
    if (!text) return false;
    return /\bsc\b|\bst\b|scheduled caste|scheduled tribe/.test(text);
  };
  /** NMMSS document rule for this field, or null when it does not apply. */
  const nmmssDocRule = (field, values, fields = []) =>
    nmmssDocumentVisibility({
      field,
      scholarshipName: selectedScholarshipName,
      examCode: savedExamCode,
      casteValue: readCasteValue(values, fields),
      incomeUnderLimit: readIncomeUnderLimit(values, fields),
      disabilityYes: isDisabilityYesValue(getDisabilityValue(values)),
    });

  const isFieldRequired = ({ field, values, fields = [] }) => {
    const disabilityYes = isDisabilityYesValue(getDisabilityValue(values));
    const showCasteCertificate = isScStSelected(values, fields);
    if (isTypeFieldKey(field?.field_key) && !disabilityYes) return false;
    // A document the NMMSS rules hide can never be required.
    const nmmssRule = nmmssDocRule(field, values, fields);
    if (nmmssRule === false) return false;
    // Every visible upload is mandatory.
    const uploadRequired = isUploadRequired({ field, nmmssRule, showCasteCertificate, disabilityYes });
    if (uploadRequired !== null) return uploadRequired;
    if (isCasteCertificateField(field)) return showCasteCertificate;
    if (isMarksheetField(field)) return true;
    return Boolean(field?.is_required);
  };

  const isPhotoField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return PHOTO_KEYS.some((k) => key.includes(k) || label.includes(k));
  };

  const isSignatureField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return SIGN_KEYS.some((k) => key.includes(k) || label.includes(k));
  };

  const findOptionValue = (field, value) => {
    if (!field?.options || value === null || value === undefined) return value;
    const raw = String(value);
    const key = String(field?.field_key || '').toLowerCase();

    if (key === 'sex' || key === 'gender') {
      const normalizedRaw = raw.trim().toLowerCase();
      if (normalizedRaw === 'other' || normalizedRaw === 'others') {
        const otherOpt = field.options.find((opt) => {
          const ov = String(opt.option_value || '').trim().toLowerCase();
          return ov === 'other' || ov === 'others';
        });
        if (otherOpt) return otherOpt.option_value;
      }
    }

    const match = field.options.find(
      (opt) => String(opt.option_value || '').toLowerCase() === raw.toLowerCase()
    );
    return match ? match.option_value : value;
  };

  const normalizeFieldValue = (field, value) => {
    if (value === null || value === undefined) return value;
    const type = String(field?.field_type || '').toUpperCase();

    if (type === 'TEXT' || type === 'TEXTAREA' || type === 'EMAIL') {
      return typeof value === 'string' ? value.toUpperCase() : value;
    }

    if (type === 'DROPDOWN' || type === 'RADIO') {
      return findOptionValue(field, value);
    }

    if (type === 'CHECKBOX') {
      if (!Array.isArray(value)) return value;
      return value.map((v) => findOptionValue(field, v));
    }

    return value;
  };

  const resolveUploadedFileUrl = (value) => {
    if (!value || value instanceof File) return '';
    const s = String(value).trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    const clean = s.replace(/^\/+/, '');
    if (clean.startsWith('uploads/')) return `${API_BASE_URL}/api/${clean}`;
    if (clean.startsWith('api/uploads/')) return `${API_BASE_URL}/${clean}`;
    if (clean.startsWith('api/')) return `${API_BASE_URL}/${clean}`;
    return `${API_BASE_URL}/api/uploads/${clean}`;
  };

  const normalizeTokenizedValue = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value
        .map((item) => normalizeTokenizedValue(item))
        .filter(Boolean)
        .join(', ');
    }

    const raw = String(value).trim();
    if (!raw) return '';

    if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
      if (raw.startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed
              .map((item) => String(item ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
              .filter(Boolean)
              .join(', ');
          }
        } catch {
          // fallback below
        }
      }

      return raw
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
        .filter(Boolean)
        .join(', ');
    }

    return raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  };

  const extractUdiseCode = (value) => {
    if (value && typeof value === 'object') {
      const objectUdise = String(value.udise_code || value.udiseCode || '').trim();
      if (objectUdise) return objectUdise;
    }

    const raw = String(value || '').trim();
    if (!raw) return '';

    const tagged = raw.match(/udise\s*[:\-]?\s*([0-9]+)/i);
    if (tagged?.[1]) return tagged[1];
    if (/^[0-9]+$/.test(raw)) return raw;

    const digitRuns = raw.match(/[0-9]{5,}/g);
    if (digitRuns?.length) {
      return digitRuns.sort((a, b) => b.length - a.length)[0];
    }

    return raw;
  };

  const isPreschoolField = (field) => {
    const fieldType = String(field?.field_type || '').trim().toUpperCase();
    const fieldKey = String(field?.field_key || '').trim();
    const fieldLabel = String(field?.field_label || '').trim().toLowerCase();
    return fieldType === 'PRESCHOOL' || fieldKey === 'previous_school_udise' || fieldLabel === 'previous school';
  };

  const resolvePreschoolNameByUdise = async (udiseCode) => {
    const udise = String(udiseCode || '').trim();
    if (!udise) return '';

    const cached = preschoolNameByUdise[udise] || preschoolNameCacheRef.current[udise];
    if (cached) return cached;

    try {
      const resp = await get(
        `/api/preschools?search=${encodeURIComponent(udise)}&page=1&limit=20`,
        { token: auth?.token }
      );
      const rows = Array.isArray(resp?.data) ? resp.data : [];
      const exact = rows.find((r) => String(r?.udise_code || '').trim() === udise);
      const schoolName = String(exact?.school_name || '').trim();
      if (schoolName) {
        preschoolNameCacheRef.current[udise] = schoolName;
        setPreschoolNameByUdise((prev) => (prev[udise] ? prev : { ...prev, [udise]: schoolName }));
        return schoolName;
      }
    } catch {
      // best effort
    }
    return '';
  };

  const downloadCurrentSchoolFormPdf = async () => {
    const fields = Array.isArray(scholarshipFormData?.form) ? scholarshipFormData.form : [];
    if (!fields.length) {
      toast.warning('No form data available to download.');
      return;
    }

    const safeHtml = (s) =>
      String(s ?? '').replace(/[&<>"]/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      }[c]));

    const findField = (matchers) =>
      fields.find((f) => {
        const key = normalizeKey(f?.field_key);
        const label = normalizeKey(f?.field_label);
        return matchers.some((m) => key.includes(m) || label.includes(m));
      });

    let previousSchoolLabelByClass = 'Name of school from which class 5th or class 8th was passed';

    const preschoolNameByCode = {};
    for (const field of fields) {
      const type = String(field?.field_type || '').toUpperCase();
      const key = String(field?.field_key || '');
      const isPreschoolField =
        type === 'PRESCHOOL' ||
        key === 'previous_school_udise' ||
        String(field?.field_label || '').trim().toLowerCase() === 'previous school';
      if (!isPreschoolField) continue;
      const udise = String(formValues?.[key] || '').trim();
      if (!udise) continue;
      const schoolName =
        preschoolLabels[key] ||
        preschoolNameByUdise[udise] ||
        (await resolvePreschoolNameByUdise(udise)) ||
        '';
      if (schoolName) preschoolNameByCode[udise] = schoolName;
    }

    const toLabelValue = (field, value) => {
      const type = String(field?.field_type || '').toUpperCase();
      const key = String(field?.field_key || '');
      if (value === null || value === undefined || value === '') return '-';

      if (
        type === 'PRESCHOOL' ||
        key === 'previous_school_udise' ||
        String(field?.field_label || '').trim().toLowerCase() === 'previous school'
      ) {
        const udise = String(value).trim();
        const label = preschoolLabels[key] || preschoolNameByCode[udise] || preschoolNameByUdise[udise] || '';
        return label || '-';
      }

      if (isTypeFieldKey(key)) {
        const normalized = normalizeTokenizedValue(value);
        return normalized || '-';
      }

      if (type === 'DATE') return formatMaybeDate(value);
      if (type === 'CHECKBOX') {
        const arr = Array.isArray(value) ? value : [value];
        const labels = arr.map((v) => {
          const opt = (field.options || []).find(
            (o) => String(o.option_value || '').toLowerCase() === String(v || '').toLowerCase()
          );
          return opt?.option_label || v;
        });
        return labels.filter(Boolean).join(', ') || '-';
      }
      if (type === 'DROPDOWN' || type === 'RADIO') {
        const normalizedValue = normalizeTokenizedValue(value) || String(value || '');
        const opt = (field.options || []).find(
          (o) => String(o.option_value || '').toLowerCase() === normalizedValue.toLowerCase()
        );
        return opt?.option_label || normalizedValue;
      }
      if (type === 'FILE') {
        if (value instanceof File) return value.name || 'file';
        const p = String(value);
        const clean = p.split('?')[0].split('#')[0];
        const parts = clean.split('/');
        return parts[parts.length - 1] || clean;
      }
      return String(value);
    };

    const nameField = findField(['name', 'candidate_name', 'student_name']);
    const fatherField = findField(['father', 'father_name']);
    const motherField = findField(['mother', 'mother_name']);
    const classField = findField(['class', 'standard', 'grade']);
    const selectedClassValue = classField ? String(formValues[classField.field_key] ?? '').trim() : '';
    previousSchoolLabelByClass =
      selectedClassValue === '6'
        ? 'Name of school from which class 5th was passed'
        : selectedClassValue === '9'
          ? 'Name of school from which class 8th was passed'
          : 'Name of school from which class 5th or class 8th was passed';
    
    const photoField = fields.find(isPhotoField);
    const signatureField = fields.find(isSignatureField);

    const photoValue = photoField ? formValues[photoField.field_key] : null;
    const signatureValue = signatureField ? formValues[signatureField.field_key] : null;

    const photoUrl =
      (photoField && localPreviewUrls[photoField.field_key]) ||
      resolveUploadedFileUrl(photoValue);
    const signatureUrl =
      (signatureField && localPreviewUrls[signatureField.field_key]) ||
      resolveUploadedFileUrl(signatureValue);

    const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));
    const excludedKeys = new Set(
      [nameField, fatherField, motherField, classField, photoField, signatureField]
        .filter(Boolean)
        .map((f) => String(f.field_key))
    );

    const detailPairs = fields
      .filter((f) => !excludedKeys.has(String(f.field_key)))
      .filter((f) => !(isTypeFieldKey(f.field_key) && !disabilityYes))
      .map((f) => ({
        label: f.field_label || f.field_key,
        value: toLabelValue(f, formValues[f.field_key]),
      }));

    const appDisplayId = window.getDisplayApplicationId({
      application_id:
        applicationId ||
        scholarshipFormData?.application?.application_id ||
        scholarshipFormData?.application_id,
      application_display_id:
        scholarshipFormData?.application?.application_display_id ||
        scholarshipFormData?.application_display_id,
    }) || '-';

    const scholarshipTitle = scholarshipFormData?.scholarship?.scholarship_name || 'Scholarship Application';
    const downloadedAt = new Date().toLocaleString('en-GB');

    const regNoField = findField(['student_registration', 'registration_no', 'sr_no', 'sr number']);
    const dobField = findField(['date_of_birth', 'dob', 'date of birth']);
    const sexField = findField(['sex', 'gender']);
    const casteField = findField(['caste', 'category']);
    const contactField = findField(['contact', 'mobile', 'phone']);
    const emailField = findField(['email']);

    const keyFieldKeys = new Set(
      [nameField, fatherField, motherField, classField, photoField, signatureField, regNoField, dobField, sexField, casteField, contactField, emailField]
        .filter(Boolean)
        .map((f) => String(f.field_key))
    );

    const detailRows = fields
      .filter((f) => !keyFieldKeys.has(String(f.field_key)))
      .filter((f) => !(isTypeFieldKey(f.field_key) && !disabilityYes))
      .map((f) => ({
        label:
          isCmScholarship &&
          (
            String(f?.field_type || '').toUpperCase() === 'PRESCHOOL' ||
            String(f?.field_key || '') === 'previous_school_udise' ||
            String(f?.field_label || '').trim().toLowerCase() === 'previous school'
          )
            ? previousSchoolLabelByClass
            : (f.field_label || f.field_key),
        value: toLabelValue(f, formValues[f.field_key]),
      }));

    const submissionDateRaw =
      scholarshipFormData?.application?.submitted_at ||
      scholarshipFormData?.application?.submittedAt ||
      formValues?.submitted_at ||
      formValues?.submittedAt ||
      null;
    const submissionDate = submissionDateRaw
      ? new Date(submissionDateRaw).toLocaleDateString('en-GB')
      : new Date().toLocaleDateString('en-GB');

    const summaryRows = [
      { label: 'Application ID', value: appDisplayId },
      { label: 'Date of Submission', value: submissionDate },
      { label: regNoField?.field_label || 'Student Registration No.', value: toLabelValue(regNoField, regNoField ? formValues[regNoField.field_key] : '-') },
      { label: nameField?.field_label || 'Candidate Name', value: toLabelValue(nameField, nameField ? formValues[nameField.field_key] : '-') },
      { label: fatherField?.field_label || "Father's Name", value: toLabelValue(fatherField, fatherField ? formValues[fatherField.field_key] : '-') },
      { label: motherField?.field_label || "Mother's Name", value: toLabelValue(motherField, motherField ? formValues[motherField.field_key] : '-') },
      { label: sexField?.field_label || 'Gender', value: toLabelValue(sexField, sexField ? formValues[sexField.field_key] : '-') },
      { label: dobField?.field_label || 'Date of Birth', value: toLabelValue(dobField, dobField ? formValues[dobField.field_key] : '-') },
      { label: casteField?.field_label || 'Caste Category', value: toLabelValue(casteField, casteField ? formValues[casteField.field_key] : '-') },
      { label: classField?.field_label || 'Class', value: toLabelValue(classField, classField ? formValues[classField.field_key] : '-') },
      { label: contactField?.field_label || 'Contact No', value: toLabelValue(contactField, contactField ? formValues[contactField.field_key] : '-') },
      { label: emailField?.field_label || 'Email', value: toLabelValue(emailField, emailField ? formValues[emailField.field_key] : '-') },
      ...detailRows,
    ];

    const blobToDataUrl = (blob) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

    const resolvePrintableImageSrc = async (fieldKey, value) => {
      if (fieldKey && localPreviewUrls[fieldKey]) return localPreviewUrls[fieldKey];
      if (!value) return '';
      if (value instanceof File) {
        try {
          return await blobToDataUrl(value);
        } catch {
          return URL.createObjectURL(value);
        }
      }

      const remoteUrl = resolveUploadedFileUrl(value);
      if (!remoteUrl) return '';

      try {
        const headers = {};
        if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
        const res = await fetch(remoteUrl, { headers });
        if (!res.ok) return remoteUrl;
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      } catch {
        return remoteUrl;
      }
    };

    const photoPrintableSrc = await resolvePrintableImageSrc(photoField?.field_key, photoValue);
    const signaturePrintableSrc = await resolvePrintableImageSrc(signatureField?.field_key, signatureValue);

    const summaryRowsHtml = summaryRows.map((row, idx) => `
      <tr>
        <td class="label-cell">${safeHtml(row.label)}</td>
        <td class="value-cell">${safeHtml(row.value)}</td>
        ${
          idx === 0
              ? `<td class="photo-cell" rowspan="${summaryRows.length}">
                <div class="photo-title">${safeHtml(photoField?.field_label || 'Candidate Photograph')}</div>
                <div class="image-box">
                  ${photoPrintableSrc ? `<img src="${safeHtml(photoPrintableSrc)}" alt="photo" />` : '<span class="no-image">Photo unavailable</span>'}
                </div>
                <div class="photo-title" style="margin-top:10px;">${safeHtml(signatureField?.field_label || 'Candidate Signature')}</div>
                <div class="image-box large-sign">
                  ${signaturePrintableSrc ? `<img src="${safeHtml(signaturePrintableSrc)}" alt="signature" />` : '<span class="no-image">Signature unavailable</span>'}
                </div>
              </td>`
            : ''
        }
      </tr>
    `).join('');

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; }
    .sheet { width: 100%; }
    .heading { text-align: center; margin-bottom: 10px; }
    .heading h1 { font-size: 20px; margin: 0 0 4px; font-weight: 700; }
    .heading .sub { font-size: 12px; margin: 0; }
    .grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 10px; }
    .grid-table td { border: 1px solid #111; padding: 6px 7px; vertical-align: top; font-size: 12.5px; }
    .label-cell { width: 24%; font-weight: 700; background: #f8fafc; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
    .value-cell { width: 46%; word-break: break-word; overflow-wrap: anywhere; }
    .photo-cell { width: 30%; text-align: center; font-weight: 700; padding: 8px; }
    .photo-title { font-weight: 700; margin-bottom: 6px; }
    .image-box { width: 100%; height: 170px; border: 1px solid #111; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #f8fafc; }
    .image-box.large-sign { height: 170px; }
    .image-box img { width: 100%; height: 100%; object-fit: contain; }
    .no-image { font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="heading">
      <h1>${safeHtml(scholarshipTitle)}</h1>
      <p class="sub"><strong>Application Form</strong></p>
      <p class="sub"><strong>Downloaded On:</strong> ${safeHtml(downloadedAt)}</p>
    </div>

    <table class="grid-table">
      ${summaryRowsHtml}
    </table>
  </div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Please allow pop-ups to download PDF');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  const downloadSubmittedApplicationPdf = async (applicationRow) => {
    const appId = String(applicationRow?.application_id || '').trim();
    if (!appId) {
      toast.warning('Invalid application selected.');
      return;
    }

    try {
      const appData = await get(`/api/school/applications/${appId}`, { token: auth?.token });
      const fields = Array.isArray(appData?.form) ? appData.form : [];
      if (!fields.length) {
        toast.warning('No form data available to download.');
        return;
      }

      const valuesByKey = {};
      fields.forEach((field) => {
        let value = field?.value;
        if (
          String(field?.field_type || '').trim().toUpperCase() === 'DATE' &&
          typeof value === 'string' &&
          value.includes('T')
        ) {
          value = value.slice(0, 10);
        }
        valuesByKey[String(field?.field_key || '')] = value;
      });

      const safeHtml = (s) =>
        String(s ?? '').replace(/[&<>"]/g, (c) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
        }[c]));

      const findField = (matchers) =>
        fields.find((f) => {
          const key = normalizeKey(f?.field_key);
          const label = normalizeKey(f?.field_label);
          return matchers.some((m) => key.includes(m) || label.includes(m));
        });

      let previousSchoolLabelByClass = 'Name of school from which class 5th or class 8th was passed';

      const preschoolNameByCode = {};
      for (const field of fields) {
        const type = String(field?.field_type || '').toUpperCase();
        const key = String(field?.field_key || '');
        const isPreschoolField =
          type === 'PRESCHOOL' ||
          key === 'previous_school_udise' ||
          String(field?.field_label || '').trim().toLowerCase() === 'previous school';
        if (!isPreschoolField) continue;
        const udise = String(valuesByKey?.[key] || '').trim();
        if (!udise) continue;
        const schoolName =
          preschoolNameByUdise[udise] ||
          (await resolvePreschoolNameByUdise(udise)) ||
          '';
        if (schoolName) preschoolNameByCode[udise] = schoolName;
      }

      const toLabelValue = (field, value) => {
        const type = String(field?.field_type || '').toUpperCase();
        const key = String(field?.field_key || '');
        if (value === null || value === undefined || value === '') return '-';

        if (
          type === 'PRESCHOOL' ||
          key === 'previous_school_udise' ||
          String(field?.field_label || '').trim().toLowerCase() === 'previous school'
        ) {
          const udise = String(value).trim();
          const label = preschoolNameByCode[udise] || preschoolNameByUdise[udise] || '';
          return label || '-';
        }

        if (isTypeFieldKey(key)) {
          const normalized = normalizeTokenizedValue(value);
          return normalized || '-';
        }

        if (type === 'DATE') return formatMaybeDate(value);
        if (type === 'CHECKBOX') {
          const arr = Array.isArray(value) ? value : [value];
          const labels = arr.map((v) => {
            const opt = (field.options || []).find(
              (o) => String(o.option_value || '').toLowerCase() === String(v || '').toLowerCase()
            );
            return opt?.option_label || v;
          });
          return labels.filter(Boolean).join(', ') || '-';
        }
        if (type === 'DROPDOWN' || type === 'RADIO') {
          const normalizedValue = normalizeTokenizedValue(value) || String(value || '');
          const opt = (field.options || []).find(
            (o) => String(o.option_value || '').toLowerCase() === normalizedValue.toLowerCase()
          );
          return opt?.option_label || normalizedValue;
        }
        if (type === 'FILE') {
          const p = String(value);
          const clean = p.split('?')[0].split('#')[0];
          const parts = clean.split('/');
          return parts[parts.length - 1] || clean;
        }
        return String(value);
      };

      const nameField = findField(['name', 'candidate_name', 'student_name']);
      const fatherField = findField(['father', 'father_name']);
      const motherField = findField(['mother', 'mother_name']);
      const classField = findField(['class', 'standard', 'grade']);
      const selectedClassValue = classField ? String(valuesByKey[classField.field_key] ?? '').trim() : '';
      previousSchoolLabelByClass =
        selectedClassValue === '6'
          ? 'Name of school from which class 5th was passed'
          : selectedClassValue === '9'
            ? 'Name of school from which class 8th was passed'
            : 'Name of school from which class 5th or class 8th was passed';

      const photoField = fields.find(isPhotoField);
      const signatureField = fields.find(isSignatureField);
      const regNoField = findField(['student_registration', 'registration_no', 'sr_no', 'sr number']);
      const dobField = findField(['date_of_birth', 'dob', 'date of birth']);
      const sexField = findField(['sex', 'gender']);
      const casteField = findField(['caste', 'category']);
      const contactField = findField(['contact', 'mobile', 'phone']);
      const emailField = findField(['email']);

      const photoValue = photoField ? valuesByKey[photoField.field_key] : null;
      const signatureValue = signatureField ? valuesByKey[signatureField.field_key] : null;

      const disabilityYes = isDisabilityYesValue(getDisabilityValue(valuesByKey));
      const excludedKeys = new Set(
        [nameField, fatherField, motherField, classField, photoField, signatureField, regNoField, dobField, sexField, casteField, contactField, emailField]
          .filter(Boolean)
          .map((f) => String(f.field_key))
      );

      const detailRows = fields
        .filter((f) => !excludedKeys.has(String(f.field_key)))
        .filter((f) => !(isTypeFieldKey(f.field_key) && !disabilityYes))
        .map((f) => ({
          label:
            isCmScholarship &&
            (
              String(f?.field_type || '').toUpperCase() === 'PRESCHOOL' ||
              String(f?.field_key || '') === 'previous_school_udise' ||
              String(f?.field_label || '').trim().toLowerCase() === 'previous school'
            )
              ? previousSchoolLabelByClass
              : (f.field_label || f.field_key),
          value: toLabelValue(f, valuesByKey[f.field_key]),
        }));

      const rawDisplayId =
        String(
          applicationRow?.application_display_id ??
          appData?.application?.application_display_id ??
          appData?.application_display_id ??
          ''
        ).trim();
      const appDisplayId = rawDisplayId || '-';

      const scholarshipTitle = appData?.scholarship?.scholarship_name || selectedScholarship?.scholarship_name || 'Scholarship Application';
      const downloadedAt = new Date().toLocaleString('en-GB');
      const submissionDateRaw =
        appData?.application?.submitted_at ||
        appData?.application?.submittedAt ||
        applicationRow?.submitted_at ||
        applicationRow?.submittedAt ||
        null;
      const submissionDate = submissionDateRaw
        ? new Date(submissionDateRaw).toLocaleDateString('en-GB')
        : '-';

      const summaryRows = [
        { label: 'Application ID', value: appDisplayId },
        { label: 'Date of Submission', value: submissionDate },
        { label: regNoField?.field_label || 'Student Registration No.', value: toLabelValue(regNoField, regNoField ? valuesByKey[regNoField.field_key] : '-') },
        { label: nameField?.field_label || 'Candidate Name', value: toLabelValue(nameField, nameField ? valuesByKey[nameField.field_key] : '-') },
        { label: fatherField?.field_label || "Father's Name", value: toLabelValue(fatherField, fatherField ? valuesByKey[fatherField.field_key] : '-') },
        { label: motherField?.field_label || "Mother's Name", value: toLabelValue(motherField, motherField ? valuesByKey[motherField.field_key] : '-') },
        { label: sexField?.field_label || 'Gender', value: toLabelValue(sexField, sexField ? valuesByKey[sexField.field_key] : '-') },
        { label: dobField?.field_label || 'Date of Birth', value: toLabelValue(dobField, dobField ? valuesByKey[dobField.field_key] : '-') },
        { label: casteField?.field_label || 'Caste Category', value: toLabelValue(casteField, casteField ? valuesByKey[casteField.field_key] : '-') },
        { label: classField?.field_label || 'Class', value: toLabelValue(classField, classField ? valuesByKey[classField.field_key] : '-') },
        { label: contactField?.field_label || 'Contact No', value: toLabelValue(contactField, contactField ? valuesByKey[contactField.field_key] : '-') },
        { label: emailField?.field_label || 'Email', value: toLabelValue(emailField, emailField ? valuesByKey[emailField.field_key] : '-') },
        ...detailRows,
      ];

      const blobToDataUrl = (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

      const resolvePrintableImageSrc = async (value) => {
        if (!value) return '';
        const remoteUrl = resolveUploadedFileUrl(value);
        if (!remoteUrl) return '';
        try {
          const headers = {};
          if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
          const res = await fetch(remoteUrl, { headers });
          if (!res.ok) return remoteUrl;
          const blob = await res.blob();
          return await blobToDataUrl(blob);
        } catch {
          return remoteUrl;
        }
      };

      const photoPrintableSrc = await resolvePrintableImageSrc(photoValue);
      const signaturePrintableSrc = await resolvePrintableImageSrc(signatureValue);

      const summaryRowsHtml = summaryRows.map((row, idx) => `
        <tr>
          <td class="label-cell">${safeHtml(row.label)}</td>
          <td class="value-cell">${safeHtml(row.value)}</td>
          ${
            idx === 0
              ? `<td class="photo-cell" rowspan="${summaryRows.length}">
                <div class="photo-title">${safeHtml(photoField?.field_label || 'Candidate Photograph')}</div>
                <div class="image-box">
                  ${photoPrintableSrc ? `<img src="${safeHtml(photoPrintableSrc)}" alt="photo" />` : '<span class="no-image">Photo unavailable</span>'}
                </div>
                <div class="photo-title" style="margin-top:10px;">${safeHtml(signatureField?.field_label || 'Candidate Signature')}</div>
                <div class="image-box large-sign">
                  ${signaturePrintableSrc ? `<img src="${safeHtml(signaturePrintableSrc)}" alt="signature" />` : '<span class="no-image">Signature unavailable</span>'}
                </div>
              </td>`
              : ''
          }
        </tr>
      `).join('');

      const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { margin: 0; font-family: Arial, sans-serif; color: #111827; }
    .sheet { width: 100%; }
    .heading { text-align: center; margin-bottom: 10px; }
    .heading h1 { font-size: 20px; margin: 0 0 4px; font-weight: 700; }
    .heading .sub { font-size: 12px; margin: 0; }
    .grid-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 10px; }
    .grid-table td { border: 1px solid #111; padding: 6px 7px; vertical-align: top; font-size: 12.5px; }
    .label-cell { width: 24%; font-weight: 700; background: #f8fafc; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
    .value-cell { width: 46%; word-break: break-word; overflow-wrap: anywhere; }
    .photo-cell { width: 30%; text-align: center; font-weight: 700; padding: 8px; }
    .photo-title { font-weight: 700; margin-bottom: 6px; }
    .image-box { width: 100%; height: 170px; border: 1px solid #111; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #f8fafc; }
    .image-box.large-sign { height: 170px; }
    .image-box img { width: 100%; height: 100%; object-fit: contain; }
    .no-image { font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="heading">
      <h1>${safeHtml(scholarshipTitle)}</h1>
      <p class="sub"><strong>Application Form</strong></p>
      <p class="sub"><strong>Downloaded On:</strong> ${safeHtml(downloadedAt)}</p>
    </div>
    <table class="grid-table">${summaryRowsHtml}</table>
  </div>
</body>
</html>`;

      const w = window.open('', '_blank');
      if (!w) {
        toast.error('Please allow pop-ups to download PDF');
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 250);
    } catch (err) {
      toast.error(`Failed to download PDF: ${toast.getErrorMessage(err)}`);
    }
  };

  const handleFormFieldChange = (field, value) => {
    const fieldKey = String(field?.field_key || '');
    const nextValue = isPreschoolField(field)
      ? extractUdiseCode(value)
      : normalizeFieldValue(field, value);

    if (isDisabilityFieldKey(fieldKey)) {
      const nextDisability = String(nextValue || '').toLowerCase();
      setFormValues((prev) => {
        const next = { ...prev, [fieldKey]: nextValue };
        if (nextDisability !== 'yes') {
          next.type_of_disability = null;
          next.type_of_divyangta = null;
        }
        return next;
      });
      return;
    }

    setFormValues((prev) => ({ ...prev, [fieldKey]: nextValue }));
  };

  useEffect(() => {
    localPreviewUrlsRef.current = localPreviewUrls;
  }, [localPreviewUrls]);

  useEffect(() => {
    return () => {
      Object.values(localPreviewUrlsRef.current || {}).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
    };
  }, []);

  useEffect(() => {
    const resolvePreschoolLabels = async () => {
      if (!preschoolUdiseCodes.length) {
        setPreschoolNameByUdise({});
        return;
      }

      const nextLabels = {};
      await Promise.all(
        preschoolUdiseCodes.map(async (udise) => {
          try {
            const resp = await get(
              `/api/preschools?search=${encodeURIComponent(udise)}&page=1&limit=20`,
              { token: auth?.token }
            );
            const rows = Array.isArray(resp?.data) ? resp.data : [];
            const exact = rows.find((r) => String(r?.udise_code || '').trim() === udise);
            if (exact?.school_name) {
              nextLabels[udise] = exact.school_name;
            }
          } catch {
            // best-effort lookup only
          }
        })
      );

      setPreschoolNameByUdise(nextLabels);
    };

    resolvePreschoolLabels();
  }, [preschoolUdiseCodes, auth?.token]);

  useEffect(() => {
    if (currentView === 'register-application') return;

    resetRegisterApplicationState();
  }, [currentView]);

  const resetRegisterApplicationState = () => {
    setScholarshipFormData(null);
    setEligibilityAccepted({});
    setSavedExamCode(null);
    setFormValues({});
    setApplicationId(null);
    setFormStep(1);
    setSchoolSelectorOpen(false);
    setCurrentPreschoolField(null);
    setPreschoolLabels({});
    setLoadingForm(false);
    setFileUploading({});
    setLocalPreviewUrls((prev) => {
      Object.values(prev).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      return {};
    });
  };

  const loadSelectedScholarshipApplicationForm = async (scholarshipId) => {
    if (!scholarshipId) return;

    setLoadingForm(true);
    try {
      setFormValues({});
      setApplicationId(null);
      setFormStep(1);
      setPreschoolLabels({});
      setFileUploading({});
      setLocalPreviewUrls((prev) => {
        Object.values(prev).forEach((url) => {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        });
        return {};
      });

      const data = await get(`/api/scholarships/${scholarshipId}/form`, { token: auth?.token });
      setScholarshipFormData(data);
    } catch (err) {
      toast.error(`Failed to load form: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingForm(false);
    }
  };

  // Lands on the scholarship's information and eligibility page, the same
  // place the sidebar's "Apply for Scholarship" link opens. The form itself
  // is reached from that page's own "Apply for Scholarship" button, so the
  // school reads the eligibility rules before filling anything in.
  const handleApplyNow = () => {
    if (!selectedScholarshipId) {
      toast.warning('Please select a scholarship first.');
      return;
    }

    resetRegisterApplicationState();
    setCurrentView('register-application');
    setNavCounter((prev) => prev + 1);
  };

  const saveSchoolApplication = async ({ mode }) => {
    setSubmittingApplication(true);
    try {
      const invalidDigitFields = validateDigitConstrainedFields(
        scholarshipFormData?.form || [],
        formValues
      );
      if (invalidDigitFields.length > 0) {
        throw new Error(`Please enter valid values: ${invalidDigitFields.join(', ')}`);
      }

      const invalidAgeFields = validateMinimumAge(
        scholarshipFormData?.form || [],
        formValues
      );
      if (invalidAgeFields.length > 0) {
        throw new Error(`Please enter valid values: ${invalidAgeFields.join(', ')}`);
      }

      if (mode === 'submit') {
        const missingFields = (scholarshipFormData?.form || [])
          .filter((field) => {
            return isFieldRequired({
              field,
              values: formValues,
              fields: scholarshipFormData?.form || [],
            });
          })
          .filter((field) => {
            const fieldType = String(field.field_type || '').trim().toUpperCase();
            const value = formValues[field.field_key];
            if (fieldType === 'CHECKBOX') {
              return !Array.isArray(value) || value.length === 0;
            }
            return value === null || value === undefined || value === '';
          })
          .map((field) => field.field_label);

        if (missingFields.length > 0) {
          throw new Error(`Please fill all required fields: ${missingFields.join(', ')}`);
        }
      }

      // 1. Init application if not exists
      let appId = applicationId;
      if (!appId) {
        const initRes = await post(
          `/api/school/applications/${scholarshipFormData.scholarship.scholarship_id}/init`,
          {},
          { token: auth?.token }
        );
        appId = initRes.application_id;
        setApplicationId(appId);
      }

      // 2. Upload FILE fields first
      const nextValues = { ...formValues };
      for (const field of scholarshipFormData.form) {
        const fieldType = String(field.field_type || '').trim().toUpperCase();
        if (fieldType === 'FILE' && nextValues[field.field_key] instanceof File) {
          const uploadFile = await shrinkImageForUpload(nextValues[field.field_key], {
            maxDimension:
              isPhotoField(field) || isSignatureField(field) ? PHOTO_MAX_DIMENSION : DOCUMENT_MAX_DIMENSION,
          });
          const formData = new FormData();
          formData.append('file', uploadFile);
          formData.append('field_id', field.field_id);

          const response = await fetch(
            `${API_BASE_URL}/api/school/applications/${appId}/upload-file`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${auth?.token}` },
              body: formData,
            }
          );

          if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.message || 'File upload failed');
          }

          const result = await response.json();
          nextValues[field.field_key] = result.file_path;
        }
      }

      setFormValues(nextValues);

      // 3. Save answers
      const disabilityValue = getDisabilityValue(nextValues);
      const answers = [];

      for (const field of scholarshipFormData.form) {
        const fieldKey = String(field.field_key || '');
        let value = nextValues[field.field_key] ?? null;

        if (isPreschoolField(field)) {
          value = extractUdiseCode(value) || null;
          nextValues[field.field_key] = value ?? '';
        }

        // Clear type fields when disability is not YES so it is saved as NULL
        if (isTypeFieldKey(fieldKey) && !isDisabilityYesValue(disabilityValue)) {
          value = null;
          answers.push({ field_id: field.field_id, value });
          continue;
        }

        if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
          continue;
        }

        answers.push({ field_id: field.field_id, value });
      }

      if (answers.length) {
        const saveResponse = await put(
          `/api/school/applications/${appId}/answers`,
          { answers },
          { token: auth?.token }
        );
        if (saveResponse && 'exam_code' in saveResponse) setSavedExamCode(saveResponse.exam_code);
      } else if (mode === 'submit') {
        throw new Error('Please fill at least one field before submitting.');
      }

      // 4. Finalize
      if (mode === 'submit') {
        try {
          await post(
            `/api/school/applications/${appId}/mark-submitted`,
            {},
            { token: auth?.token }
          );
        } catch (err) {
          const msg = String(err?.message || '');
          const alreadySubmittedAtSchool =
            msg.includes('Application cannot be marked submitted in current state') &&
            msg.includes('Status: SUBMITTED') &&
            msg.includes('Stage: SCHOOL');
          if (!alreadySubmittedAtSchool) throw err;
        }

        toast.success('Application submitted successfully!');
        resetRegisterApplicationState();
        setEditingPendingId(null);
        clearPendingSelection();
        setExpandedMenu('verification');
        setCurrentView('verification-pending');
      } else if (mode === 'draft') {
        toast.info('Saved to draft.');
        resetRegisterApplicationState();
        setEditingDraftId(null);
        setExpandedMenu('verification');
        setCurrentView('verification-drafts');
      } else if (mode === 'step') {
        setFormStep(2);
      }
    } catch (err) {
      const prefix = mode === 'submit'
        ? 'Failed to submit: '
        : mode === 'step'
          ? 'Cannot continue to Step 2: '
          : 'Failed to save draft: ';
      toast.error(prefix + toast.getErrorMessage(err));
    } finally {
      setSubmittingApplication(false);
    }
  };

  // Opens one of the Verification tabs from a dashboard card. It does what the
  // matching sidebar link does - clears whatever the tab keeps between visits
  // and bumps navCounter so the list reloads - and also expands the
  // Verification group, otherwise the link for the tab just opened would be
  // hidden inside a collapsed menu.
  const openApplicationsTab = (view) => {
    setEditingDraftId(null);
    setEditingPendingId(null);
    setEditingReturnedByBeoId(null);
    clearPendingSelection();
    setExpandedMenu('verification');
    setCurrentView(view);
    setNavCounter((prev) => prev + 1);
  };

  const renderContent = () => {
    if (currentView === 'dashboard') {
      return (
        <SchoolDashboardHome
          key={`dashboard-${navCounter}`}
          onNavigate={setCurrentView}
          onOpenTab={openApplicationsTab}
          onApplyNow={handleApplyNow}
        />
      );
    }

    if (currentView === 'how-to-apply') {
      return <HowToApplyGuide key={`how-to-apply-${navCounter}`} audience="school" embedded />;
    }

    if (currentView === 'profile') {
      if (loadingProfile) {
        return <div key={`profile-loading-${navCounter}`} className="loading-state">Loading profile...</div>;
      }

      if (!profileData) {
        return <div key={`profile-error-${navCounter}`} className="error-state">Failed to load profile</div>;
      }

      const strengths = Array.isArray(profileData.class_strengths) ? profileData.class_strengths : [];
      const availableClasses = Array.from(
        new Set(strengths.map((s) => Number(s.class_level)).filter(Boolean))
      ).sort((a, b) => a - b);

      const activeClass = availableClasses.includes(activeStrengthClass)
        ? activeStrengthClass
        : availableClasses[0] || 6;

      const activeClassData = strengths.filter((s) => Number(s.class_level) === Number(activeClass));

      return (
        <div key={`profile-${navCounter}`} className="scert-page school-profile-page">
          <div className="profile-header-with-button">
            <h2 className="profile-page-title">School Profile</h2>
            <button
              type="button"
              className="scert-btn-primary"
              onClick={() => setShowEditProfile(true)}
            >
              Edit Profile
            </button>
          </div>
          <div className="school-profile-compact-grid">
            <div className="profile-section">
              <h3 className="profile-section-title">School Details</h3>
              <div className="profile-grid">
               
                <div className="profile-item">
                  <label>School Name</label>
                  <p className="school-name-strong">{profileData.profile.school_name}</p>
                </div>
                <div className="profile-item">
                  <label>UDISE Code</label>
                  <p>{profileData.profile.udise_code}</p>
                </div>
                <div className="profile-item">
                  <label>Unit ID (Education Portal ID)</label>
                  <p>{profileData.profile.unit_id || 'N/A'}</p>
                </div>
                <div className="profile-item">
                  <label>School Type</label>
                  <p>{profileData.profile.school_type}</p>
                </div>
                <div className="profile-item">
                  <label>Category</label>
                  <p>{profileData.profile.school_category}</p>
                </div>
                <div className="profile-item">
                  <label>Contact Number of School</label>
                  <p>{profileData.profile.contact_number || 'N/A'}</p>
                </div>
                <div className="profile-item">
                  <label>Email ID of School</label>
                  <p>{profileData.profile.email || 'N/A'}</p>
                </div>
                <div className="profile-item">
                  <label>Head of Institute Name</label>
                  <p>{profileData.profile.head_of_institution_name || 'N/A'}</p>
                </div>
                <div className="profile-item">
                  <label>Head of Institute Mobile</label>
                  <p>{profileData.profile.head_of_institution_mobile || 'N/A'}</p>
                </div>
                
                 
              </div>
            </div>

            {/* <div className="profile-section">
              <h3 className="profile-section-title">Head and Contacts</h3>
              <div className="profile-grid">
                <div className="profile-item">
                  <label>Head of Institute Name</label>
                  <p>{profileData.profile.head_of_institution_name || 'N/A'}</p>
                </div>
                <div className="profile-item">
                  <label>Head of Institute Mobile</label>
                  <p>{profileData.profile.head_of_institution_mobile || 'N/A'}</p>
                </div>
                
              </div>
            </div> */}

            {/* <div className="profile-section">
              <h3 className="profile-section-title">Location and Codes</h3>
              <div className="profile-grid">
                <div className="profile-item full-width">
                  <label>Address</label>
                  <p>{profileData.profile.address}</p>
                </div>
                <div className="profile-item">
                  <label>District</label>
                  <p>{profileData.profile.district_name}</p>
                </div>
                <div className="profile-item">
                  <label>District Code</label>
                  <p>{profileData.profile.district_code}</p>
                </div>
                <div className="profile-item">
                  <label>Block</label>
                  <p>{profileData.profile.block_name}</p>
                </div>
                <div className="profile-item">
                  <label>Block Code</label>
                  <p>{profileData.profile.block_code}</p>
                </div>
              </div>
            </div> */}

            <div className="profile-section">
              <h3 className="profile-section-title">Student Strength</h3>

              {availableClasses.length === 0 ? (
                <div className="empty-state" style={{ padding: '1.5rem' }}>
                  No strength data available.
                </div>
              ) : (
                <>
                  <div className="strength-tabs">
                    {availableClasses.map((cl) => (
                      <button
                        key={cl}
                        type="button"
                        className={cl === activeClass ? 'strength-tab strength-tab-active' : 'strength-tab'}
                        onClick={() => setActiveStrengthClass(cl)}
                      >
                        Class {cl}
                      </button>
                    ))}
                  </div>

                  <div className="strength-table-wrapper" style={{ padding: '0.75rem' }}>
                    <table className="strength-table">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Boys</th>
                          <th>Girls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeClassData.map((item) => (
                          <tr key={item.category} className={window.getSubmissionRoleRowClass(item)}>
                            <td>{item.category}</td>
                            <td>{item.boys_count}</td>
                            <td>{item.girls_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (currentView === 'verification-drafts') {
      if (editingDraftId) {
        return (
          <div key={`draft-edit-${editingDraftId}-${navCounter}`} className="applications-view">
            <div className="view-header-row">
              <h3 className="view-title">Draft Application</h3>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => {
                  setEditingDraftId(null);
                  fetchDraftApplications();
                }}
              >
                Back to Drafts
              </button>
            </div>

            <SchoolPendingApplicationEditor
              applicationId={editingDraftId}
              onBack={() => {
                setEditingDraftId(null);
                fetchDraftApplications();
              }}
            />
          </div>
        );
      }

      const scopedDraftApps = filterRowsBySelectedScholarship(draftApps);

      return (
        <div key={`verification-drafts-${navCounter}`} className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Draft Applications</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {renderSchoolClassFilterButtons()}
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={fetchDraftApplications}
                disabled={loadingDraftApps}
              >
                {loadingDraftApps ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {loadingDraftApps ? (
            <div className="loading-state">Loading draft applications...</div>
          ) : draftError ? (
            <div className="error-state">{draftError}</div>
          ) : scopedDraftApps.length === 0 ? (
            <div className="empty-state">No draft applications found.</div>
          ) : (
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>Application ID</th>
                    <th>Student Name</th>
                    <th>Scholarship Name</th>
                    <th>Status</th>
                    <th>Last Updated</th>
                    <th style={{ width: 170 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedDraftApps.map((row) => (
                    <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(row)}</code>
                      </td>
                      <td className="smart-table-strong">{row.student_name || '-'}</td>
                      <td>{row.scholarship_name || '-'}</td>
                      <td>
                        <span className={`status-pill status-${String(row.status || '').toLowerCase()}`}>
                          {row.status || '-'}
                        </span>
                      </td>
                      <td>{row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}</td>
                      <td>
                        <div className="school-draft-actions">
                          <button
                            type="button"
                            className="icon-action-btn"
                            title="Continue"
                            onClick={() => setEditingDraftId(String(row.application_id))}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="icon-action-btn icon-action-btn--danger"
                            title="Delete this draft"
                            onClick={() => setDraftToDelete(row)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    if (currentView === 'verification-pending') {
      if (editingPendingId) {
        return (
          <div key={`pending-edit-${editingPendingId}-${navCounter}`} className="applications-view">
            <div className="view-header-row">
              <h3 className="view-title">Pending Applications</h3>
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

            <SchoolPendingApplicationEditor
              applicationId={editingPendingId}
              goBackOnSave
              onBack={() => {
                setEditingPendingId(null);
                fetchPendingApplications();
              }}
            />
          </div>
        );
      }

      const scopedPendingApps = sortRowsByApplicationDisplayIdAsc(
        filterRowsBySelectedScholarship(pendingApps),
        { byFilledOrder: true }
      );

      const forwardableIds = scopedPendingApps.map((a) => String(a.application_id));
      const returnableIds = scopedPendingApps
        .filter((row) => String(row.submitted_by_role || '').toUpperCase() === 'STUDENT')
        .map((a) => String(a.application_id));

      const selectedReturnableCount = Array.from(selectedPendingIds).filter((id) =>
        returnableIds.includes(String(id))
      ).length;
      const selectedRejectableCount = Array.from(selectedPendingIds).filter((id) =>
        forwardableIds.includes(String(id))
      ).length;

      const allSelected = forwardableIds.length > 0 && forwardableIds.every((id) => selectedPendingIds.has(id));

      return (
        <div key={`verification-pending-${navCounter}`} className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Pending Applications</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="scert-btn-primary"
                onClick={() =>
                  downloadSchoolApplicationsPdf(scopedPendingApps, 'Pending Applications Report')
                }
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

          <div className="bulk-actions-bar">
            <div className="bulk-actions-left">
              {renderSchoolClassFilters()}
            </div>
            <div className="bulk-actions-right" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="form-submit-btn"
                disabled={selectedPendingIds.size === 0 || loadingPendingApps}
                onClick={() => setShowBulkDeclarationModal(true)}
              >
                Submit to BEO
              </button>
              <button
                type="button"
                className="save-draft-btn"
                disabled={selectedReturnableCount === 0 || loadingPendingApps}
                onClick={handleBulkReturnToStudent}
              >
                Return to Student
              </button>
              <button
                type="button"
                className="scert-btn-danger"
                disabled={selectedRejectableCount === 0 || loadingPendingApps}
                onClick={handleOpenBulkReject}
              >
                Reject Application
              </button>
            </div>
          </div>

          {loadingPendingApps ? (
            <div className="loading-state">Loading pending applications...</div>
          ) : pendingError ? (
            <div className="error-state">{pendingError}</div>
          ) : scopedPendingApps.length === 0 ? (
            <div className="empty-state">No pending applications found.</div>
          ) : (
            <div className="smart-table-wrap school-pending-table-wrap" style={{ overflowX: 'auto' }}>
              <table
                className={`smart-table school-pending-table ${isCmScholarship ? 'school-pending-table-cm' : ''}`}
                style={{ minWidth: isNmmssScholarship ? '3200px' : '2800px' }}
              >
                <thead>
                  {isNmmssScholarship ? (
                    <tr>
                      <th style={{ width: 48 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPendingIds(new Set(forwardableIds));
                            } else {
                              clearPendingSelection();
                            }
                          }}
                          disabled={forwardableIds.length === 0}
                          title={
                            forwardableIds.length === 0
                              ? 'No pending applications'
                              : 'Select all pending applications'
                          }
                        />
                      </th>
                      <th style={{ minWidth: 70 }}>S. No.</th>
                      <th style={{ minWidth: 90 }}>Action</th>
                      <th style={{ minWidth: 100 }}>BlockCode</th>
                      <th style={{ minWidth: 100 }}>Exam Code</th>
                      <th style={{ minWidth: 120 }}>Application ID</th>
                      <th style={{ minWidth: 170 }}>ROLL. No. (10 Digit)</th>
                      <th style={{ minWidth: 140 }}>SR No. of students</th>
                      <th style={{ minWidth: 170 }}>Student&apos;s Name</th>
                      <th style={{ minWidth: 160 }}>Father&apos;s Name</th>
                      <th style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                      <th style={{ minWidth: 130 }}>Date of Birth</th>
                      <th style={{ minWidth: 90 }}>Sex</th>
                      <th style={{ minWidth: 140 }}>Caste Category</th>
                      <th style={{ minWidth: 140 }}>Divyangta code</th>
                      <th style={{ minWidth: 220 }}>Percentage of marks in Class 7th</th>
                      <th style={{ minWidth: 200 }}>Parental Income Code 1 or 2</th>
                      <th style={{ minWidth: 160 }}>Aadhaar Number</th>
                      <th style={{ minWidth: 180 }}>School Name</th>
                      <th style={{ minWidth: 130 }}>Block</th>
                      <th style={{ minWidth: 150 }}>District</th>
                      <th style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th style={{ minWidth: 220 }}>School Catogary (Urban, Rural)</th>
                      <th style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                      <th style={{ minWidth: 130 }}>Contact No</th>
                      
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ width: 48 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPendingIds(new Set(forwardableIds));
                            } else {
                              clearPendingSelection();
                            }
                          }}
                          disabled={forwardableIds.length === 0}
                          title={
                            forwardableIds.length === 0
                              ? 'No pending applications'
                              : 'Select all pending applications'
                          }
                        />
                      </th>
                      <th style={{ minWidth: 70 }}>S. No.</th>
                      <th style={{ minWidth: 90 }}>Action</th>
                      <th style={{ minWidth: 100 }}>Block Code</th>
                      <th style={{ minWidth: 120 }}>Application ID</th>
                      <th style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                      <th style={{ minWidth: 130 }}>SR No. of students</th>
                      <th style={{ minWidth: 170 }}>Student's Name</th>
                      <th style={{ minWidth: 160 }}>Father's Name</th>
                      <th style={{ minWidth: 160 }}>Mother's Name</th>
                      <th style={{ minWidth: 130 }}>Date of Birth</th>
                      <th style={{ minWidth: 90 }}>Sex</th>
                      <th style={{ minWidth: 140 }}>Caste Category</th>
                      <th style={{ minWidth: 170 }}>Type of Divyangta</th>
                      <th style={{ minWidth: 150 }}>Aadhaar Number</th>
                      <th style={{ minWidth: 180 }}>School Name</th>
                      <th style={{ minWidth: 130 }}>Block</th>
                      <th style={{ minWidth: 150 }}>District</th>
                      <th style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th style={{ minWidth: 220 }}>School Category (Urban, Rural)</th>
                      <th style={{ minWidth: 180 }}>Previous School Name</th>
                      <th style={{ minWidth: 300 }}>Previous School Type (Govt, Govt aided, Local body)</th>
                      <th style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th style={{ minWidth: 180 }}>Exam Centre's Name</th>
                      <th style={{ minWidth: 130 }}>Contact No</th>
                      
                    </tr>
                  )}
                </thead>
                <tbody>
                  {scopedPendingApps.map((row, index) => {
                    return (
                    <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                      {isNmmssScholarship ? (
                        <>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPendingIds.has(String(row.application_id))}
                              onChange={() => toggleSelectedPending(row.application_id, true)}
                              title={
                                String(row.submitted_by_role || '').toUpperCase() === 'STUDENT'
                                  ? 'Select (returnable + forwardable)'
                                  : 'Select (forwardable)'
                              }
                            />
                          </td>
                          <td>{index + 1}</td>
                           <td>
                            <button
                              type="button"
                              className="icon-action-btn"
                              title="Open"
                              onClick={() => {
                                setEditingPendingId(String(row.application_id));
                              }}
                            >
                              Edit
                            </button>
                          </td>
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
                         
                        </>
                      ) : (
                        <>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedPendingIds.has(String(row.application_id))}
                              onChange={() => toggleSelectedPending(row.application_id, true)}
                              title={
                                String(row.submitted_by_role || '').toUpperCase() === 'STUDENT'
                                  ? 'Select (returnable + forwardable)'
                                  : 'Select (forwardable)'
                              }
                            />
                          </td>
                          <td>{index + 1}</td>
                          <td>
                            <button
                              type="button"
                              className="icon-action-btn"
                              title="Open"
                              onClick={() => {
                                setEditingPendingId(String(row.application_id));
                              }}
                            >
                              Edit
                            </button>
                          </td>
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
                          <td>{row.center_name || '-'}</td>
                          <td>{row.contact_no || '-'}</td>
                          
                        </>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }
    if (currentView === 'verification-rejected') {
      const scopedRejectedApps = sortRowsByApplicationDisplayIdAsc(
        filterRowsBySelectedScholarship(rejectedApps)
      );

      return (
        <div key={`verification-rejected-${navCounter}`} className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Rejected Applications</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={fetchRejectedApplications}
                disabled={loadingRejectedApps}
              >
                Refresh
              </button>
            </div>
          </div>

          {loadingRejectedApps ? (
            <div className="loading-state">Loading rejected applications...</div>
          ) : rejectedError ? (
            <div className="error-state">{rejectedError}</div>
          ) : scopedRejectedApps.length === 0 ? (
            <div className="empty-state">No rejected applications found</div>
          ) : (
            <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table school-rejected-table" style={{ minWidth: '1000px' }}>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Serial No.</th>
                    <th style={{ width: 180 }}>Application ID</th>
                    <th style={{ width: 140 }}>Roll Number</th>
                    <th style={{ width: 220 }}>Student Name</th>
                    <th style={{ width: 120 }}>DOB</th>
                    <th style={{ width: 140 }}>Category</th>
                    <th style={{ minWidth: 200 }}>Reason for Rejection</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedRejectedApps.map((app, index) => (
                    <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                      <td>{index + 1}</td>
                      <td>{window.getDisplayApplicationId(app)}</td>
                      <td>{app.roll_number || '-'}</td>
                      <td>{app.candidate_name || app.student_name || '-'}</td>
                      <td>{formatMaybeDate(app.date_of_birth || app.dob)}</td>
                      <td>{app.caste_category || '-'}</td>
                      <td>{app.remark_text || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }
    if (currentView === 'verification-submitted') {
      const scopedSubmittedApps = sortRowsByApplicationDisplayIdAsc(
        filterRowsBySelectedScholarship(submittedApps)
      );

      if (viewingSubmittedId) {
        return (
          <div key={`submitted-view-${viewingSubmittedId}-${navCounter}`} className="applications-view">
            <div className="view-header-row">
              <h3 className="view-title">Submitted Application</h3>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => {
                  setViewingSubmittedId(null);
                  fetchSubmittedApplications();
                }}
              >
                Back to Submitted List
              </button>
            </div>

            <SchoolPendingApplicationEditor
              applicationId={viewingSubmittedId}
              forceReadOnly={true}
              onBack={() => {
                setViewingSubmittedId(null);
                fetchSubmittedApplications();
              }}
            />
          </div>
        );
      }

      return (
        <div key={`verification-submitted-${navCounter}`} className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Submitted Applications</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {renderSchoolClassFilterButtons()}
              <button
                type="button"
                className="scert-btn-primary"
                onClick={() =>
                  downloadSchoolApplicationsPdf(scopedSubmittedApps, 'Submitted Applications Report', {
                    includeDeclaration: true,
                  })
                }
                disabled={loadingSubmittedApps || scopedSubmittedApps.length === 0}
              >
                Download PDF
              </button>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={fetchSubmittedApplications}
                disabled={loadingSubmittedApps}
              >
                {loadingSubmittedApps ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {loadingSubmittedApps ? (
            <div className="loading-state">Loading submitted applications...</div>
          ) : submittedError ? (
            <div className="error-state">{submittedError}</div>
          ) : scopedSubmittedApps.length === 0 ? (
            <div className="empty-state">No submitted applications found.</div>
          ) : (
            <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
              <table
                className={`smart-table school-submitted-table ${isCmScholarship ? 'school-submitted-table-cm' : ''}`}
                style={{ minWidth: isNmmssScholarship ? '3000px' : '2600px' }}
              >
                <thead>
                  {isNmmssScholarship ? (
                    <tr>
                      <th style={{ minWidth: 110 }}>Action</th>
                      <th style={{ minWidth: 70 }}>S. No.</th>
                      <th style={{ minWidth: 100 }}>BlockCode</th>
                      <th style={{ minWidth: 100 }}>Exam Code</th>
                      <th style={{ minWidth: 120 }}>Application ID</th>
                      <th style={{ minWidth: 170 }}>ROLL. No. (10 Digit)</th>
                      <th style={{ minWidth: 140 }}>SR No. of students</th>
                      <th style={{ minWidth: 170 }}>Student&apos;s Name</th>
                      <th style={{ minWidth: 160 }}>Father&apos;s Name</th>
                      <th style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                      <th style={{ minWidth: 130 }}>Date of Birth</th>
                      <th style={{ minWidth: 90 }}>Sex</th>
                      <th style={{ minWidth: 140 }}>Caste Category</th>
                      <th style={{ minWidth: 140 }}>Divyangta code</th>
                      <th style={{ minWidth: 220 }}>Percentage of marks in Class 7th</th>
                      <th style={{ minWidth: 200 }}>Parental Income Code 1 or 2</th>
                      <th style={{ minWidth: 160 }}>Aadhaar Number</th>
                      <th style={{ minWidth: 180 }}>School Name</th>
                      <th style={{ minWidth: 130 }}>Block</th>
                      <th style={{ minWidth: 150 }}>District</th>
                      <th style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th style={{ minWidth: 220 }}>School Catogary (Urban, Rural)</th>
                      <th style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                      <th style={{ minWidth: 130 }}>Contact No</th>
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ minWidth: 110 }}>Action</th>
                      <th style={{ minWidth: 70 }}>S. No.</th>
                      <th style={{ minWidth: 100 }}>Block Code</th>
                      <th style={{ minWidth: 120 }}>Application ID</th>
                      <th style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                      <th style={{ minWidth: 130 }}>SR No. of students</th>
                      <th style={{ minWidth: 170 }}>Student's Name</th>
                      <th style={{ minWidth: 160 }}>Father's Name</th>
                      <th style={{ minWidth: 160 }}>Mother's Name</th>
                      <th style={{ minWidth: 130 }}>Date of Birth</th>
                      <th style={{ minWidth: 90 }}>Sex</th>
                      <th style={{ minWidth: 140 }}>Caste Category</th>
                      <th style={{ minWidth: 170 }}>Type of Divyangta</th>
                      <th style={{ minWidth: 150 }}>Aadhaar Number</th>
                      <th style={{ minWidth: 180 }}>School Name</th>
                      <th style={{ minWidth: 130 }}>Block</th>
                      <th style={{ minWidth: 150 }}>District</th>
                      <th style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th style={{ minWidth: 220 }}>School Category (Urban, Rural)</th>
                      <th style={{ minWidth: 180 }}>Previous School Name</th>
                      <th style={{ minWidth: 300 }}>Previous School Type (Govt, Govt aided, Local body)</th>
                      <th style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th style={{ minWidth: 180 }}>Exam Centre's Name</th>
                      <th style={{ minWidth: 130 }}>Contact No</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {scopedSubmittedApps.map((row, index) => (
                    <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                      {isNmmssScholarship ? (
                        <>
                          <td>
                            <div >
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="View Application"
                                onClick={() => {
                                  setViewingSubmittedId(String(row.application_id));
                                }}
                              >
                                View
                              </button>
                              {/* <button
                                type="button"
                                className="icon-action-btn"
                                title="Download PDF"
                                onClick={() => downloadSubmittedApplicationPdf(row)}
                                aria-label="Download PDF"
                              >
                                <HiOutlineDownload />
                              </button> */}
                            </div>
                          </td>
                          <td>{index + 1}</td>
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
                        </>
                      ) : (
                        <>
                          <td>
                            <div>
                              <button
                                type="button"
                                className="icon-action-btn"
                                title="View Application"
                                onClick={() => {
                                  setViewingSubmittedId(String(row.application_id));
                                }}
                              >
                                View
                              </button>
                              {/* <button
                                type="button"
                                className="icon-action-btn"
                                title="Download PDF"
                                onClick={() => downloadSubmittedApplicationPdf(row)}
                                aria-label="Download PDF"
                              >
                                <HiOutlineDownload />
                              </button> */}
                            </div>
                          </td>
                          <td>{index + 1}</td>
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
                          <td>{row.center_name || '-'}</td>
                          <td>{row.contact_no || '-'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    if (currentView === 'verification-approved') {
      return <SchoolApprovedApplicationsPage key={`verification-approved-${navCounter}`} />;
    }

    if (currentView === 'verification-returned-by-beo') {
      if (editingReturnedByBeoId) {
        return (
          <div key={`returned-edit-${editingReturnedByBeoId}-${navCounter}`} className="applications-view">
            <div className="view-header-row">
              <h3 className="view-title">Returned Application - Edit & Resubmit</h3>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => {
                  setEditingReturnedByBeoId(null);
                  fetchReturnedByBeoApplications();
                }}
              >
                Back to Returned List
              </button>
            </div>

            <SchoolPendingApplicationEditor
              applicationId={editingReturnedByBeoId}
              onBack={() => {
                setEditingReturnedByBeoId(null);
                fetchReturnedByBeoApplications();
              }}
            />
          </div>
        );
      }

      return (
        <div key={`verification-returned-${navCounter}`} className="applications-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">Returned by BEO</h3>
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={fetchReturnedByBeoApplications}
              disabled={loadingReturnedByBeoApps}
            >
              {loadingReturnedByBeoApps ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {loadingReturnedByBeoApps ? (
            <div className="loading-state">Loading returned applications...</div>
          ) : returnedByBeoError ? (
            <div className="error-state">{returnedByBeoError}</div>
          ) : filterRowsBySelectedScholarship(returnedByBeoApps).length === 0 ? (
            <div className="empty-state">No applications returned by BEO found.</div>
          ) : (
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>Application ID</th>
                    <th>Student Name</th>
                    <th>Scholarship Name</th>
                    <th>Status</th>
                    <th>Returned At</th>
                    <th style={{ width: 90 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filterRowsBySelectedScholarship(returnedByBeoApps).map((row) => (
                    <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(row)}</code>
                      </td>
                      <td className="smart-table-strong">{row.student_name || '-'}</td>
                      <td>{row.scholarship_name || '-'}</td>
                      <td>
                        <span className="status-pill status-returned">
                         Returned
                        </span>
                      </td>
                      <td>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '-'}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-action-btn"
                          title="Edit & Resubmit"
                          onClick={() => {
                            setEditingReturnedByBeoId(String(row.application_id));
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
        setCurrentView('profile');
        setNavCounter((prev) => prev + 1);
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

    if (currentView === 'reports-admit-cards') {
      return <SchoolAdmitCardsPage key={`admit-cards-${navCounter}`} onNavigate={setCurrentView} />;
    }

    if (currentView === 'results') {
      return (
        <SchoolResultPage
          key={`result-${navCounter}`}
          sessionId={selectedSessionId}
          selectedScholarshipId={selectedScholarshipId}
          sessionName={sessions.find((s) => String(s.session_id) === String(selectedSessionId))?.session_name || '—'}
          schemeName={selectedScholarship?.scholarship_name || '—'}
        />
      );
    }

    if (currentView === 'register-application') {
      if (scholarshipFormData) {
        return (
          <div key={`scholarship-form-${selectedScholarshipId}-${navCounter}`} className="scholarship-form-view">
            <button
              className="back-btn"
              onClick={() => {
                resetRegisterApplicationState();
              }}
            >
              Back to Scholarships
            </button>
            <div className="form-container">
              <div className="form-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h2 className="form-title" style={{ marginBottom: 0 }}>
                    {scholarshipFormData.scholarship.scholarship_name}
                  </h2>
                  {/* <button
                    type="button"
                    className="scert-btn-secondary"
                    onClick={downloadCurrentSchoolFormPdf}
                  >
                    Download PDF
                  </button> */}
                </div>
                <p className="form-deadline">
                  Last Date: {new Date(scholarshipFormData.scholarship.last_date).toLocaleDateString()}
                  <span className="form-deadline-note">
                    {' '}| Important Note: Don&apos;t write Mr, Mrs, Shri, Shrimati before parent name.
                  </span>
                </p>
              </div>

              <form
                className="dynamic-form school-application-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (formStep === 1) {
                    await saveSchoolApplication({ mode: 'step' });
                  } else {
                    await saveSchoolApplication({ mode: 'submit' });
                  }
                }}
              >
                {(() => {
                  const fieldsForStep = (scholarshipFormData.form || []).filter((field) => {
                    const fieldType = String(field.field_type || '').trim().toUpperCase();
                    // Step 1: All fields except FILE type, plus photo/signature
                    // Step 2: Only remaining FILE type fields
                    if (formStep === 1) {
                      if (fieldType !== 'FILE') return true;
                      return isPhotoField(field) || isSignatureField(field);
                    }
                    if (fieldType !== 'FILE') return false;
                    return !isPhotoField(field) && !isSignatureField(field);
                  });

                  const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));
                  const showCasteCertificate = isScStSelected(formValues, scholarshipFormData.form || []);

                  const visibleFields = fieldsForStep.filter((field) => {
                    const fieldKey = String(field.field_key || '');
                    if (isTypeFieldKey(fieldKey) && !disabilityYes) {
                      return false;
                    }
                    // NMMSS decides its own document set from the exam code.
                    const nmmssRule = nmmssDocRule(field, formValues, scholarshipFormData?.form || []);
                    if (nmmssRule !== null) return nmmssRule;
                    if (isCasteCertificateField(field) && !showCasteCertificate) {
                      return false;
                    }
                    // The Divyangta certificate only exists for candidates who answered Yes.
                    if (isDivyangtaCertificateDoc(field) && !disabilityYes) return false;
                    return true;
                  });

                  const isFullWidthField = (field) => {
                    const fieldType = String(field.field_type || '').trim().toUpperCase();
                    const key = String(field.field_key || '').trim();
                    const label = String(field.field_label || '').trim().toLowerCase();

                    const isPreschoolField =
                      fieldType === 'PRESCHOOL' ||
                      key === 'previous_school_udise' ||
                      label === 'previous school';

                    return (
                      isPreschoolField ||
                      fieldType === 'TEXTAREA' ||
                      fieldType === 'FILE' ||
                      fieldType === 'RADIO' ||
                      fieldType === 'CHECKBOX'
                    );
                  };

                  const renderField = (field) => {
                    const fieldType = String(field.field_type || '').trim().toUpperCase();
                    const requiredForField = isFieldRequired({
                      field,
                      values: formValues,
                      fields: scholarshipFormData?.form || [],
                    });
                    const isImageUploadField =
                      fieldType === 'FILE' && (isPhotoField(field) || isSignatureField(field));
                    const isOtherUploadField =
                      fieldType === 'FILE' && !isImageUploadField;
                    const normalizedFieldKey = String(field.field_key || '').trim().toLowerCase();
                    const normalizedFieldLabel = String(field.field_label || '').trim().toLowerCase();
                    const isCmMarksheetField =
                      isCmScholarship &&
                      fieldType === 'FILE' &&
                      (normalizedFieldKey.includes('marksheet') || normalizedFieldLabel.includes('marksheet'));

                    const isPreschoolField =
                      fieldType === 'PRESCHOOL' ||
                      String(field.field_key || '').trim() === 'previous_school_udise' ||
                      String(field.field_label || '').trim().toLowerCase() === 'previous school';

                    return (
                      <div key={field.field_id} className="dynamic-field">
                        <label className="dynamic-label">
                          {(() => {
                            const classValue = String(
                              formValues?.[scholarshipFormData.form.find((f) => {
                                const k = String(f?.field_key || '').toLowerCase();
                                const l = String(f?.field_label || '').toLowerCase();
                                return (
                                  k.includes('class') ||
                                  k.includes('standard') ||
                                  k.includes('grade') ||
                                  l.includes('class') ||
                                  l.includes('standard') ||
                                  l.includes('grade')
                                );
                              })?.field_key] || ''
                            ).trim();

                            if (isCmMarksheetField) {
                              if (classValue === '6') return 'Marksheet of Class 5';
                              if (classValue === '9') return 'Marksheet of Class 8';
                            }
                            if (isImageUploadField) return `${field.field_label} (JPG/PNG)`;
                            if (isOtherUploadField) return `${field.field_label} (PDF/JPG/PNG)`;
                            if (!isCmScholarship || !isPreschoolField) return field.field_label;
                            if (classValue === '6') return 'Name of school from which class 5th was passed';
                            if (classValue === '9') return 'Name of school from which class 8th was passed';
                            return 'Name of school from which class 5th or class 8th was passed';
                          })()}
                          {requiredForField && <span className="required">*</span>}
                        </label>

                        {fieldType === 'TEXT' && (
                          <input
                            type="text"
                            className="dynamic-input"
                            value={formValues[field.field_key] || ''}
                            onChange={(e) => handleFormFieldChange(field, e.target.value)}
                            required={requiredForField}
                          />
                        )}

                        {fieldType === 'NUMBER' && (
                          <input
                            type={getDigitConstraint(field) ? 'text' : 'number'}
                            className="dynamic-input"
                            inputMode={getDigitConstraint(field) ? 'numeric' : undefined}
                            pattern={getDigitConstraint(field) ? `\\d{${getDigitConstraint(field)}}` : undefined}
                            maxLength={getDigitConstraint(field) || undefined}
                            {...(getDigitConstraint(field) ? {} : numberInputAttrs(field))}
                            value={formValues[field.field_key] || ''}
                            onChange={(e) => {
                              const digitConstraint = getDigitConstraint(field);
                              const nextValue = digitConstraint
                                ? sanitizeDigitInput(e.target.value, digitConstraint)
                                : sanitizeNumberValue(e.target.value, field, formValues[field.field_key]);
                              handleFormFieldChange(field, nextValue);
                            }}
                            required={requiredForField}
                          />
                        )}

                        {fieldType === 'EMAIL' && (
                          <input
                            type="email"
                            className="dynamic-input"
                            value={formValues[field.field_key] || ''}
                            onChange={(e) => handleFormFieldChange(field, e.target.value)}
                            required={requiredForField}
                          />
                        )}

                        {fieldType === 'TEXTAREA' && (
                          <textarea
                            className="dynamic-textarea"
                            rows="4"
                            value={formValues[field.field_key] || ''}
                            onChange={(e) => handleFormFieldChange(field, e.target.value)}
                            required={requiredForField}
                          />
                        )}

                        {fieldType === 'DATE' && (
                          <input
                            type="date"
                            className="dynamic-input"
                            value={formValues[field.field_key] || ''}
                            onChange={(e) => handleFormFieldChange(field, e.target.value)}
                            required={requiredForField}
                          />
                        )}

                        {fieldType === 'DROPDOWN' && (
                          <select
                            className="dynamic-select"
                            value={formValues[field.field_key] || ''}
                            onChange={(e) => handleFormFieldChange(field, e.target.value)}
                            required={requiredForField}
                          >
                            <option value="">Select an option</option>
                            {(field.options || []).map((opt) => (
                              <option key={opt.option_id} value={opt.option_value}>
                                {opt.option_label}
                              </option>
                            ))}
                          </select>
                        )}

                        {fieldType === 'RADIO' && (
                          <div
                            className={`radio-group ${
                              (() => {
                                const keyNorm = normalizeKey(field.field_key);
                                const labelNorm = normalizeKey(field.field_label);
                                const isSexField = keyNorm.includes('sex') || keyNorm.includes('gender') || labelNorm.includes('sex') || labelNorm.includes('gender');
                                const isCasteField = keyNorm.includes('caste') || keyNorm.includes('category') || labelNorm.includes('caste') || labelNorm.includes('category');
                                return isSexField || isCasteField ? 'radio-group-single-row' : '';
                              })()
                            }`}
                          >
                            {(field.options || []).map((opt) => (
                              <label key={opt.option_id} className="radio-label">
                                <input
                                  type="radio"
                                  name={field.field_key}
                                  value={opt.option_value}
                                  checked={formValues[field.field_key] === opt.option_value}
                                  onChange={(e) => handleFormFieldChange(field, e.target.value)}
                                  required={requiredForField}
                                />
                                <span>{opt.option_label}</span>
                              </label>
                            ))}
                          </div>
                        )}

                        {fieldType === 'CHECKBOX' && (
                          <div className="checkbox-group">
                            {(field.options || []).map((opt) => (
                              <label key={opt.option_id} className="checkbox-label">
                                <input
                                  type="checkbox"
                                  value={opt.option_value}
                                  checked={(formValues[field.field_key] || []).includes(opt.option_value)}
                                  onChange={(e) => {
                                    const current = formValues[field.field_key] || [];
                                    const newValue = e.target.checked
                                      ? [...current, opt.option_value]
                                      : current.filter((v) => v !== opt.option_value);
                                    handleFormFieldChange(field, newValue);
                                  }}
                                />
                                <span>{opt.option_label}</span>
                              </label>
                            ))}
                          </div>
                        )}

                        {isPreschoolField && (
                          <div className="preschool-selector-container">
                            <div className="preschool-selector-row">
                              <button
                                type="button"
                                className="preschool-select-btn form-submit-btn"
                                onClick={() => {
                                  setCurrentPreschoolField(field);
                                  setSchoolSelectorOpen(true);
                                }}
                              >
                                {formValues[field.field_key]
                                  ? ' School Selected'
                                  : 'Select Previous School'}
                              </button>
                        {formValues[field.field_key] && (
                          <div className="selected-school-info">
                            <div className="selected-school-name">
                              {preschoolLabels[field.field_key] ||
                                preschoolNameByUdise[String(formValues[field.field_key] || '').trim()] ||
                                `UDISE: ${formValues[field.field_key]}`}
                            </div>
                          </div>
                        )}
                            </div>
                            {requiredForField && !formValues[field.field_key] && (
                              <small className="field-hint">
                                Required: Please select previous school
                              </small>
                            )}
                          </div>
                        )}

                        {fieldType === 'FILE' && (
                          <>
                            {(isPhotoField(field) || isSignatureField(field)) ? (
                              <>
                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                  {/* The hidden inputs sit OUTSIDE the clickable box: the box's onClick
                                      opens the gallery picker, so a Camera tap bubbling up into it fired
                                      both pickers at once and mobile browsers dropped the camera. */}
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/jpg,image/png"
                                    ref={(el) => {
                                      fileInputRefs.current[field.field_key] = el;
                                    }}
                                    style={HIDDEN_FILE_INPUT_STYLE}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        const previewUrl = URL.createObjectURL(file);
                                        setLocalPreviewUrls((prev) => {
                                          const next = { ...prev, [field.field_key]: previewUrl };
                                          const oldUrl = prev[field.field_key];
                                          if (oldUrl && oldUrl !== previewUrl) {
                                            try {
                                              URL.revokeObjectURL(oldUrl);
                                            } catch {
                                              // ignore
                                            }
                                          }
                                          return next;
                                        });
                                        setFormValues((prev) => ({ ...prev, [field.field_key]: file }));
                                      }
                                      e.target.value = '';
                                    }}
                                    disabled={fileUploading[field.field_key]}
                                  />
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/jpg,image/png"
                                    capture={isPhotoField(field) ? 'environment' : 'user'}
                                    ref={(el) => {
                                      cameraInputRefs.current[field.field_key] = el;
                                    }}
                                    style={HIDDEN_FILE_INPUT_STYLE}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        const previewUrl = URL.createObjectURL(file);
                                        setLocalPreviewUrls((prev) => {
                                          const next = { ...prev, [field.field_key]: previewUrl };
                                          const oldUrl = prev[field.field_key];
                                          if (oldUrl && oldUrl !== previewUrl) {
                                            try {
                                              URL.revokeObjectURL(oldUrl);
                                            } catch {
                                              // ignore
                                            }
                                          }
                                          return next;
                                        });
                                        setFormValues((prev) => ({ ...prev, [field.field_key]: file }));
                                      }
                                      e.target.value = '';
                                    }}
                                    disabled={fileUploading[field.field_key]}
                                  />
                                  <div
                                    className="candidate-image-box"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      const ref = fileInputRefs.current[field.field_key];
                                      if (ref) ref.click();
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        const ref = fileInputRefs.current[field.field_key];
                                        if (ref) ref.click();
                                      }
                                    }}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    {localPreviewUrls[field.field_key] ? (
                                      <img src={localPreviewUrls[field.field_key]} alt={field.field_label || 'Uploaded file'} />
                                    ) : (
                                      <span className="candidate-image-empty">📷 Click to upload</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="scert-btn-secondary"
                                      onClick={() => cameraInputRefs.current[field.field_key]?.click()}
                                      disabled={fileUploading[field.field_key]}
                                    >
                                      Camera
                                    </button>
                                    <button
                                      type="button"
                                      className="scert-btn-secondary"
                                      onClick={() => fileInputRefs.current[field.field_key]?.click()}
                                      disabled={fileUploading[field.field_key]}
                                    >
                                      Choose File
                                    </button>
                                  </div>
                                </div>
                                <small className="field-hint">Allowed formats: JPG, PNG</small>
                              </>
                            ) : (
                              <div className="file-upload-container">
                                <input
                                  type="file"
                                  id={`file-${field.field_key}`}
                                  className="file-input"
                                  accept="application/pdf,image/jpeg,image/jpg,image/png"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setFormValues((prev) => ({ ...prev, [field.field_key]: file }));
                                    }
                                  }}
                                  disabled={fileUploading[field.field_key]}
                                />
                                {formValues[field.field_key] && (
                                  <div className="file-uploaded-info">
                                    <span className="file-status-icon"></span>
                                    <span className="file-status-text">
                                      {formValues[field.field_key] instanceof File
                                        ? 'File selected'
                                        : 'File uploaded'}
                                    </span>
                                    <span className="file-path-hint">
                                      {formValues[field.field_key] instanceof File
                                        ? formValues[field.field_key].name
                                        : String(formValues[field.field_key]).split('/').pop()}
                                    </span>
                                    <div style={{ marginTop: '0.5rem' }}>
                                      <FileAttachment value={formValues[field.field_key]} compact />
                                    </div>
                                  </div>
                                )}
                                <small className="field-hint">Allowed formats: PDF, JPG, PNG</small>
                                {requiredForField && !formValues[field.field_key] && (
                                  <small className="field-hint">Required: Please upload a file (PDF/JPG/PNG)</small>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  };

                  const rows = [];
                  let currentRow = [];

                  const findField = (matchers) =>
                    visibleFields.find((f) => {
                      const key = normalizeKey(f.field_key);
                      const label = normalizeKey(f.field_label);
                      return matchers.some((m) => key.includes(m) || label.includes(m));
                    });

                  let nameField = null;
                  let fatherField = null;
                  let motherField = null;
                  let classField = null;
                  let dobField = null;
                  let studentRegistrationField = null;
                  let sexField = null;
                  let casteField = null;
                  let photoField = null;
                  let signatureField = null;

                  if (formStep === 1) {
                    nameField = findField(['name', 'student_name', 'candidate_name']);
                    fatherField = findField(['father', 'father_name', "father's"]);
                    motherField = findField(['mother', 'mother_name', "mother's"]);
                    classField = findField(['class', 'standard', 'grade']);
                    dobField = findField(['date_of_birth', 'date of birth', 'dob']);
                    studentRegistrationField = findField([
                      'student_registration',
                      'student registration',
                      'studentregistrations',
                      'studentregistration',
                      'registration no',
                      'registration number',
                    ]);
                    sexField = findField(['sex', 'gender']);
                    casteField = findField(['caste', 'category']);
                    photoField = visibleFields.find(isPhotoField);
                    signatureField = visibleFields.find(isSignatureField);
                  }

                  const topLeftBaseFields = formStep === 1
                    ? [
                      nameField,
                      fatherField,
                      motherField,
                      classField,
                      dobField,
                      studentRegistrationField,
                    ].filter(Boolean)
                    : [];

                  const topRightFields = formStep === 1
                    ? [photoField, signatureField].filter(Boolean)
                    : [];

                  const topLeftFieldSet = new Set([...topLeftBaseFields, ...topRightFields]);
                  const topLeftExtraFields = formStep === 1
                    ? visibleFields
                      .filter((f) => !topLeftFieldSet.has(f) && !isFullWidthField(f))
                      .slice(0, 4)
                    : [];

                  const topLeftFields = formStep === 1
                    ? [...topLeftBaseFields, ...topLeftExtraFields]
                    : [];

                  const excluded = formStep === 1
                    ? new Set([...topLeftFields, ...topRightFields].filter(Boolean))
                    : new Set();

                  const flushRow = () => {
                    if (currentRow.length) {
                      rows.push(currentRow);
                      currentRow = [];
                    }
                  };

                  const orderedRemainingFields = visibleFields.filter((f) => !excluded.has(f));

                  for (let idx = 0; idx < orderedRemainingFields.length; idx++) {
                    const field = orderedRemainingFields[idx];

                    // Keep original sequence, but force Sex + Caste Category to stay in one row.
                    if (
                      formStep === 1 &&
                      sexField &&
                      casteField &&
                      (field === sexField || field === casteField)
                    ) {
                      const counterpart = field === sexField ? casteField : sexField;
                      const counterpartIdx = orderedRemainingFields.indexOf(counterpart, idx + 1);
                      if (counterpartIdx !== -1) {
                        flushRow();
                        rows.push([field, counterpart]);
                        idx = counterpartIdx;
                        continue;
                      }
                    }

                    if (isFullWidthField(field)) {
                      flushRow();
                      rows.push([field]);
                      continue;
                    }

                    currentRow.push(field);
                    if (currentRow.length === 3) flushRow();
                  }

                  flushRow();

                  // Short option groups (Sex, Category, Divyangta, Income) and document
                  // uploads share lines instead of taking a row each - see utils/formRows.js.
                  const packedRows = packFormRows(rows, rowKinds);

                  return (
                    <div className="form-fields-grid">
                      {formStep === 1 && (topLeftFields.length || topRightFields.length) && (
                        <div className="school-form-top-split">
                          <div className="school-form-top-left">
                            <div className="school-form-top-left-grid">
                              {topLeftFields.map((field) => (
                                <div
                                  key={`top-left-${field.field_id}`}
                                  className={`school-form-top-field ${
                                    nameField && field.field_id === nameField.field_id
                                      ? 'school-form-top-field-full-span'
                                      : ''
                                  }`}
                                >
                                  {renderField(field)}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="school-form-top-right">
                            {topRightFields.map((field) => (
                              <div
                                key={`top-right-${field.field_id}`}
                                className={`school-form-top-media-field ${isPhotoField(field) ? 'top-photo-field' : ''} ${isSignatureField(field) ? 'top-signature-field' : ''}`}
                              >
                                {renderField(field)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {packedRows.map((row, idx) => (
                        <div key={`form-row-${idx}`} className={formRowClassName(row)}>
                          {row.fields.map((field) => renderField(field))}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="form-actions">
                  {formStep === 2 && (
                    <button
                      type="button"
                      className="back-step-btn"
                      onClick={() => setFormStep(1)}
                      disabled={submittingApplication}
                    >
                      Back to Step 1
                    </button>
                  )}
                  {formStep === 2 && (
                    <button
                      type="button"
                      className="save-draft-btn"
                      disabled={submittingApplication}
                      onClick={() => saveSchoolApplication({ mode: 'draft' })}
                    >
                      {submittingApplication ? 'Saving...' : 'Save to Draft'}
                    </button>
                  )}
                  <button type="submit" className="form-submit-btn" disabled={submittingApplication}>
                    {formStep === 1 ? 'Next: Step 2 ' : (submittingApplication ? 'Submitting...' : 'Submit Application')}
                  </button>
                </div>
              </form>
            </div>

            <PrimarySchoolSelectorModal
              isOpen={schoolSelectorOpen}
              onClose={() => {
                setSchoolSelectorOpen(false);
                setCurrentPreschoolField(null);
              }}
              onSelect={(school) => {
                if (currentPreschoolField) {
                  handleFormFieldChange(currentPreschoolField, school);
                  setPreschoolLabels((prev) => ({
                    ...prev,
                    [currentPreschoolField.field_key]: `${school.school_name} (UDISE: ${school.udise_code})`,
                  }));
                }
              }}
              currentValue={
                currentPreschoolField
                  ? (preschoolLabels[currentPreschoolField.field_key] || formValues[currentPreschoolField.field_key])
                  : null
              }
            />
          </div>
        );
      }
      
      // Filter scholarships by selected scholarship ID
      const filteredScholarships = selectedScholarshipId 
        ? scholarships.filter(sch => String(sch.scholarship_id) === String(selectedScholarshipId))
        : scholarships;
      
      return (
        <div className="applications-view">
          {loadingScholarships ? (
            <div className="loading-state">Loading scholarships...</div>
          ) : filteredScholarships.length === 0 ? (
            <div className="empty-state">No scholarships available for the selected scheme</div>
          ) : (
            <div className="school-apply-card-wrap">
              {filteredScholarships.map(sch => (
                <article key={sch.scholarship_id} className="school-apply-card">
                  <div className="school-apply-card-header">
                    <h4 className="school-apply-card-title">{sch.scholarship_name}</h4>
                    <p className="school-apply-card-deadline">
                      <strong>Last Date:</strong> {new Date(sch.last_date).toLocaleDateString()}
                    </p>
                  </div>

                  {(() => {
                    const details = getApplyScholarshipDetails(sch);
                    return (
                      <div className="school-apply-card-content">
                        <section className="school-apply-details-block">
                          <h5>{details.hiTitle}</h5>
                          <h6>{details.enTitle}</h6>
                          {Array.isArray(details.hiBullets) ? (
                            <ul>
                              {details.hiBullets.map((item, idx) => (
                                <li key={`hi1-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>{details.hiPara}</p>
                          )}
                          {Array.isArray(details.enBullets) ? (
                            <ul>
                              {details.enBullets.map((item, idx) => (
                                <li key={`en1-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>{details.enPara}</p>
                          )}
                        </section>

                        {details.hiTitle2 || details.enTitle2 ? (
                          <section className="school-apply-details-block">
                            {details.hiTitle2 ? <h5>{details.hiTitle2}</h5> : null}
                            {details.enTitle2 ? <h6>{details.enTitle2}</h6> : null}
                            {Array.isArray(details.hiBullets2) ? (
                              <ul>
                                {details.hiBullets2.map((item, idx) => (
                                  <li key={`hi2-${idx}`}>{item}</li>
                                ))}
                              </ul>
                            ) : (
                              details.hiPara2 ? <p>{details.hiPara2}</p> : null
                            )}
                            {Array.isArray(details.enBullets2) ? (
                              <ul>
                                {details.enBullets2.map((item, idx) => (
                                  <li key={`en2-${idx}`}>{item}</li>
                                ))}
                              </ul>
                            ) : (
                              details.enPara2 ? <p>{details.enPara2}</p> : null
                            )}
                          </section>
                        ) : null}
                      </div>
                    );
                  })()}

                  <div className="school-apply-card-actions">
                    <label
                      className={`school-apply-consent${eligibilityAccepted[sch.scholarship_id] ? ' is-checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(eligibilityAccepted[sch.scholarship_id])}
                        onChange={(e) => {
                          const { checked } = e.target;
                          setEligibilityAccepted((prev) => ({ ...prev, [sch.scholarship_id]: checked }));
                        }}
                      />
                      <span className="school-apply-consent-text">
                        <span lang="hi">
                          मैंने उपरोक्त जानकारी एवं अर्हता संबंधी शर्तें ध्यानपूर्वक पढ़ ली हैं तथा मैं इनसे सहमत हूँ।
                        </span>
                        <span>
                          I have carefully read the above information and eligibility criteria, and I agree to them.
                        </span>
                      </span>
                    </label>
                    <button
                      className="apply-btn school-apply-card-btn"
                      disabled={!eligibilityAccepted[sch.scholarship_id]}
                      title={eligibilityAccepted[sch.scholarship_id] ? undefined : 'Please confirm that you have read the information above'}
                      onClick={() => {
                        if (!eligibilityAccepted[sch.scholarship_id]) return;
                        loadSelectedScholarshipApplicationForm(sch.scholarship_id);
                      }}
                    >
                      {loadingForm ? 'Loading...' : 'Apply for Scholarship'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      );
    }

    return <div className="placeholder-view">Select an option from the sidebar</div>;
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
                      // Reset form state when scholarship changes
                      if (currentView === 'register-application') {
                        resetRegisterApplicationState();
                        setNavCounter(prev => prev + 1);
                      }
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
            onClick={() => {
              setCurrentView('dashboard');
              setNavCounter(prev => prev + 1);
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineHome /></span>
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            className={currentView === 'how-to-apply' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setCurrentView('how-to-apply');
              setNavCounter(prev => prev + 1);
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineVideoCamera /></span>
            <span>Tutorial</span>
          </button>

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
                    setCurrentView('profile');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Profile</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'change-password' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setCurrentView('change-password');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Change Password</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className={
              currentView === 'register-application'
                ? 'scert-dash-link scert-dash-link-active school-apply-sidebar-link'
                : 'scert-dash-link school-apply-sidebar-link'
            }
            onClick={() => {
              resetRegisterApplicationState();
              setCurrentView('register-application');
              setNavCounter(prev => prev + 1);
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineDocumentAdd /></span>
            <span>Apply for Scholarship</span>
          </button>

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
                  className={currentView === 'verification-drafts' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setEditingDraftId(null);
                    setCurrentView('verification-drafts');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Draft Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'verification-pending' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setEditingPendingId(null);
                    clearPendingSelection();
                    setCurrentView('verification-pending');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Pending Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'verification-submitted' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setCurrentView('verification-submitted');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Submitted Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'verification-rejected' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setCurrentView('verification-rejected');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Rejected Applications</span>
                </button>
                <button
                  type="button"
                  className={currentView === 'verification-returned-by-beo' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
                  onClick={() => {
                    setCurrentView('verification-returned-by-beo');
                    setNavCounter(prev => prev + 1);
                  }}
                >
                  <span>Applications Return By BEO</span>
                </button>
              </div>
            )}
          </div>

          {/* These were the two Reports sub-tabs; the group only ever held
              these two, so it is flattened into top-level links, like
              Dashboard and Results below. */}
          <button
            type="button"
            className={currentView === 'verification-approved' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setCurrentView('verification-approved');
              setNavCounter(prev => prev + 1);
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineCheckCircle /></span>
            <span>Approved Applications</span>
          </button>
          <button
            type="button"
            className={currentView === 'reports-admit-cards' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setCurrentView('reports-admit-cards');
              setNavCounter(prev => prev + 1);
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineDownload /></span>
            <span>Admit Card</span>
          </button>

          {/* Results is its own tab rather than a Reports entry: it is a
              top-level destination, like Dashboard, so it uses the same link. */}
          <button
            type="button"
            className={currentView === 'results' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setCurrentView('results');
              setNavCounter(prev => prev + 1);
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineAcademicCap /></span>
            <span>Results</span>
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

      <main className="scert-dash-main school-dash-main-bg">
        {/* Sticky School Info Bar */}
        <div className="school-info-bar">
          {!profileData && loadingProfile ? (
            <span className="school-info-loading">Loading school info...</span>
          ) : profileData?.profile ? (
            <>
              <div className="school-info-name">
                {profileData.profile.school_name || '-'}
              </div>
              <div className="school-info-details">
                <div className="school-info-item">
              <span className="school-info-label">UDISE Code</span>
              <span className="school-info-value">{profileData.profile.udise_code || 'N/A'}</span>
                </div>
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
                  <span className="school-info-label">Block</span>
                  <span className="school-info-value">{profileData.profile.block_name || '-'}</span>
                </div>
                <div className="school-info-item">
                  <span className="school-info-label">Block Code</span>
                  <span className="school-info-value">{profileData.profile.block_code || '-'}</span>
                </div>
              </div>
            </>
          ) : (
            <span className="school-info-loading">School info unavailable</span>
          )}
        </div>

        {/* Marquee with the scholarship name */}
        {selectedScholarship && (() => {
          const name = getScholarshipDisplayName(selectedScholarship);
          // Longer names get proportionally longer loops, so every scholarship
          // scrolls at the same readable speed rather than the long NMMSS
          // title rushing past.
          const seconds = Math.max(18, Math.round((name.length + 45) / 7));
          return (
            <div className="scholarship-marquee">
              <div className="marquee-content" style={{ animationDuration: `${seconds}s` }}>
                <span className="marquee-icon" aria-hidden="true">{'\u{1F4C5}'}</span>
                <span className="marquee-text">
                  <strong>{name}</strong>
                </span>
              </div>
            </div>
          );
        })()}

        <div
          className={currentView === 'profile'
            ? 'scert-dash-content no-scroll'
            : 'scert-dash-content'}
        >
          {renderContent()}
        </div>
      </main>
      </div>

      {/* Edit Profile Modal (rendered at root so it overlays the sticky info bar) */}
      {showEditProfile && (
        <SchoolProfileForm
          mode="edit"
          onClose={() => setShowEditProfile(false)}
          onSuccess={() => {
            setShowEditProfile(false);
            fetchProfile();
          }}
        />
      )}

      {draftToDelete && (
        <SchoolDeleteDraftModal
          isOpen={Boolean(draftToDelete)}
          onClose={() => setDraftToDelete(null)}
          onConfirm={handleDeleteDraft}
          isDeleting={isDeletingDraft}
          applicationLabel={window.getDisplayApplicationId(draftToDelete)}
          studentName={draftToDelete.student_name}
        />
      )}

      {/* Reason + confirmation for bulk Reject (mounted only while open so the
          typed reason never carries over to the next time it opens) */}
      {showBulkRejectModal && (
        <SchoolBulkRejectModal
          isOpen={showBulkRejectModal}
          onClose={() => setShowBulkRejectModal(false)}
          onSubmit={handleBulkReject}
          isSubmitting={isBulkRejecting}
          selectedCount={getBulkRejectIds().length}
        />
      )}

      {/* Declaration Modal for Bulk Submit to BEO */}
      <SchoolDeclarationModal
        isOpen={showBulkDeclarationModal}
        onClose={() => setShowBulkDeclarationModal(false)}
        onSubmit={handleBulkSubmitToBeo}
        isSubmitting={isBulkSubmitting}
        scholarshipId={selectedScholarshipId}
        scholarshipName={selectedScholarshipName}
        classValue={schoolAppsClassFilter || (String(selectedScholarshipId) === '6' ? '8' : '')}
      />
    </div>
  );
}

export function SchoolDashboard() {
  return (
    <DashboardProvider>
      <SchoolDashboardContent />
    </DashboardProvider>
  );
}
