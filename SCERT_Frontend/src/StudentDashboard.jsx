import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { get, put, API_BASE_URL } from './apiClient.js';
import { StudentScholarshipApplication } from './StudentScholarshipApplication.jsx';
import { StudentProfileEditForm } from './StudentProfileEditForm.jsx';
import { useToast } from './ToastContext.jsx';
import {
  HiOutlineUser,
  HiOutlineDocumentText,
  HiOutlineAcademicCap,
  HiOutlineLockClosed,
  HiOutlineLogout,
  HiOutlinePencil,
  HiOutlineDownload,
} from 'react-icons/hi';

export function StudentDashboard() {
  const navigate = useNavigate();
  const { logout, auth } = useAuth();
  const toast = useToast();
  const [currentView, setCurrentView] = useState('scholarships');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [scholarships, setScholarships] = useState([]);
  const [loadingScholarships, setLoadingScholarships] = useState(false);
  const [selectedScholarship, setSelectedScholarship] = useState(null);
  // Per scholarship: has the student confirmed they read the information and eligibility?
  const [eligibilityAccepted, setEligibilityAccepted] = useState({});
  const [editingDraft, setEditingDraft] = useState(null);
  const scholarshipsLoadedRef = useRef(false);
  const scholarshipsRequestRef = useRef(null);

  const [applications, setApplications] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [applicationsError, setApplicationsError] = useState('');
  const applicationsLoadedRef = useRef(false);
  const applicationsRequestRef = useRef(null);
  // The latest list, for the cached path below - kept in a ref so fetchApplications
  // stays the same function as the list changes.
  const applicationsRef = useRef([]);

  const [profile, setProfile] = useState(null);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);

  const fetchScholarships = useCallback(async (force = false) => {
    if (scholarshipsLoadedRef.current && !force) return;
    if (scholarshipsRequestRef.current && !force) return scholarshipsRequestRef.current;

    setLoadingScholarships(true);

    const request = (async () => {
      try {
        const data = await get('/api/scholarships/active', { token: auth?.token });
        setScholarships(data);
        scholarshipsLoadedRef.current = true;
      } catch (err) {
        console.error('Failed to fetch scholarships:', err);
      } finally {
        scholarshipsRequestRef.current = null;
        setLoadingScholarships(false);
      }
    })();

    scholarshipsRequestRef.current = request;
    return request;
  }, [auth?.token]);

  const fetchProfile = useCallback(async () => {
    try {
      const data = await get('/api/student/profile', { token: auth?.token });
      setProfile({
        ...data,
        school_name: String(
          data?.school_name ??
          data?.schoolName ??
          data?.school?.school_name ??
          data?.school?.name ??
          ''
        ).trim(),
      });
    } catch (err) {
      console.error('Failed to fetch profile:', err);
    }
  }, [auth?.token]);

  const fetchApplications = useCallback(async (force = false) => {
    if (applicationsLoadedRef.current && !force) return applicationsRef.current;
    if (applicationsRequestRef.current && !force) return applicationsRequestRef.current;

    setLoadingApplications(true);
    setApplicationsError('');

    const request = (async () => {
      try {
        const data = await get('/api/student/applications', { token: auth?.token });
        const nextApplications = Array.isArray(data) ? data : [];
        applicationsRef.current = nextApplications;
        setApplications(nextApplications);
        applicationsLoadedRef.current = true;
        return nextApplications;
      } catch (err) {
        setApplicationsError(err?.message || 'Failed to load applications');
        applicationsRef.current = [];
        setApplications([]);
        return [];
      } finally {
        applicationsRequestRef.current = null;
        setLoadingApplications(false);
      }
    })();

    applicationsRequestRef.current = request;
    return request;
  }, [auth?.token]);

  useEffect(() => {
    // Opening the Apply or My Applications tab always loads the student's applications
    // afresh (force): the list is cached, and a draft saved or an application submitted
    // in the form would otherwise not show until the Refresh button was pressed.
    if (currentView === 'scholarships') {
      fetchScholarships();
      fetchApplications(true);
    } else if (currentView === 'profile') {
      fetchProfile();
    } else if (currentView === 'applications') {
      fetchApplications(true);
    }
  }, [currentView, fetchApplications, fetchProfile, fetchScholarships]);

  useEffect(() => {
    scholarshipsLoadedRef.current = false;
    scholarshipsRequestRef.current = null;
    applicationsLoadedRef.current = false;
    applicationsRequestRef.current = null;
  }, [auth?.token]);

  // Auto-logout on session expiry
  useEffect(() => {
    const handleSessionExpired = () => {
      logout();
      navigate('/', { replace: true });
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, [logout, navigate]);

  // SCERT switched Student Access off while this student was signed in. The
  // dashboard usually has several requests in flight, and each one is refused,
  // so this runs once and ignores the rest.
  const accessClosedHandledRef = useRef(false);
  useEffect(() => {
    const handleAccessClosed = () => {
      if (accessClosedHandledRef.current) return;
      accessClosedHandledRef.current = true;
      toast.info('Student access is currently closed. You have been signed out.');
      logout();
      navigate('/', { replace: true });
    };
    window.addEventListener('auth:student-access-closed', handleAccessClosed);
    return () => window.removeEventListener('auth:student-access-closed', handleAccessClosed);
  }, [logout, navigate, toast]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [currentView]);

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

  const handlePasswordChange = async (e) => {
    e.preventDefault();

    const currentPassword = String(passwordForm.currentPassword || '');
    if (!currentPassword) {
      toast.warning('Please enter your current password.');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      toast.warning('Password must be at least 8 characters.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.warning('Passwords do not match.');
      return;
    }

    setPasswordChangeLoading(true);
    try {
      // Backend verifies current_password and updates password in the same request.
      await put(
        '/api/auth/change-password',
        {
          current_password: currentPassword,
          new_password: passwordForm.newPassword,
        },
        { token: auth?.token }
      );
      toast.success('Password changed successfully. Please log in again.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Failed to change password:', err);
      toast.error(toast.getErrorMessage(err, 'Failed to change password.'));
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const isStudentEditLocked = (application) => {
    const status = String(application?.status || '').toUpperCase();
    const stage = String(application?.current_stage || '').toUpperCase();
    return status === 'SUBMITTED' && stage === 'SCHOOL';
  };

  const formatDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? String(value)
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const normalizeKey = (value) => String(value || '').trim().toLowerCase();
  const isUdiseValue = (value) => /^\d{5,11}$/.test(String(value || '').trim());
  const isUdiseLikeField = (answer) => {
    const key = normalizeKey(answer?.field_key);
    const label = normalizeKey(answer?.field_label || answer?.label);
    const type = normalizeKey(answer?.field_type);
    return type === 'preschool' || key.includes('udise') || label.includes('udise');
  };
  const resolveFileUrl = (value) => {
    if (!value || typeof value !== 'string') return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('/api/uploads/')) return `${API_BASE_URL}${value}`;
    if (value.startsWith('/uploads/')) return `${API_BASE_URL}/api${value}`;
    if (value.startsWith('/')) return `${API_BASE_URL}${value}`;
    return `${API_BASE_URL}/api/uploads/${value}`;
  };
  const formatMaybeDate = (value) => {
    if (!value) return '-';
    const str = String(value).split('T')[0];
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-GB');
  };
  const fetchSchoolNameByUdise = async (udiseCode) => {
    const udise = String(udiseCode || '').trim();
    if (!udise) return '';
    try {
      const publicRes = await get(
        `/api/schools?search=${encodeURIComponent(udise)}&page=1&limit=20`,
        { token: auth?.token }
      );
      const publicRows = Array.isArray(publicRes?.data) ? publicRes.data : [];
      const publicExact = publicRows.find((r) => String(r?.udise_code || '').trim() === udise);
      const publicName = String(publicExact?.school_name || publicRows?.[0]?.school_name || '').trim();
      if (publicName) return publicName;
    } catch {
      // fallback below
    }

    try {
      const response = await get(
        `/api/preschools?search=${encodeURIComponent(udise)}&page=1&limit=20`,
        { token: auth?.token }
      );
      const rows = Array.isArray(response?.data) ? response.data : [];
      const exact = rows.find((r) => String(r?.udise_code || '').trim() === udise);
      return String(exact?.school_name || rows?.[0]?.school_name || '').trim();
    } catch {
      return '';
    }
  };

  const handleDownloadApplicationPdf = async (item) => {
    try {
      const application = item?.application || {};
      const answers = Array.isArray(item?.answers) ? item.answers : [];
      const scholarshipTitle = item?.scholarship?.scholarship_name || 'Scholarship Application';
      const isCmScholarship =
        /\bCM\b/i.test(String(scholarshipTitle || '')) ||
        /CHIEF\s*MINISTER/i.test(String(scholarshipTitle || ''));
      const isNmmssScholarship =
        /\bNMMSS\b/i.test(String(scholarshipTitle || '')) ||
        /\bNMMS\b/i.test(String(scholarshipTitle || '')) ||
        /\bSNSS\b/i.test(String(scholarshipTitle || '')) ||
        /\bSSSS\b/i.test(String(scholarshipTitle || ''));
      // exam_code 1 = the student sits both NMMSS and SNSS/SSSS papers;
      // exam_code 2 = SNSS/SSSS only. Same rule as the admit card.
      const eligibility = isNmmssScholarship
        ? (Number(application?.exam_code) === 1 ? 'NMMSS/SNSS/SSSS' : 'SNSS/SSSS')
        : null;

      const getAnswerRawValue = (ans) => {
        if (ans?.answer !== undefined && ans?.answer !== null) return ans.answer;
        if (ans?.value_text !== undefined && ans?.value_text !== null) return ans.value_text;
        if (ans?.value_number !== undefined && ans?.value_number !== null) return ans.value_number;
        if (ans?.value_date) return ans.value_date;
        if (ans?.value_file_path) return ans.value_file_path;
        return '';
      };

      // Uploaded documents (marksheet, certificates, Aadhaar card ...) are not part of the
      // printed form: their value is only a file path, which means nothing on paper. The
      // candidate's photograph and signature are printed as images beside the table.
      const isUploadedFileAnswer = (a) =>
        normalizeKey(a?.field_type) === 'file' ||
        (a?.value_file_path !== undefined && a?.value_file_path !== null && a?.value_file_path !== '');

      const normalizeWrappedValue = (value) => {
        const raw = String(value ?? '').trim();
        const m = raw.match(/^\{\s*"?(.*?)"?\s*\}$/);
        return m ? m[1] : raw;
      };

      const udiseToSchoolName = {};
      const udiseCandidates = answers
        .filter((a) => isUdiseLikeField(a) && isUdiseValue(getAnswerRawValue(a)))
        .map((a) => String(getAnswerRawValue(a)).trim());
      const uniqueUdises = Array.from(new Set(udiseCandidates));
      if (uniqueUdises.length) {
        const resolved = await Promise.all(
          uniqueUdises.map(async (udise) => [udise, await fetchSchoolNameByUdise(udise)])
        );
        resolved.forEach(([udise, schoolName]) => {
          if (schoolName) udiseToSchoolName[udise] = schoolName;
        });
      }

      const toLabelValue = (ans) => {
        const raw = getAnswerRawValue(ans);
        if (raw === null || raw === undefined || raw === '') return '-';
        const normalizedRaw = normalizeWrappedValue(raw);

        const type = normalizeKey(ans?.field_type);
        if (isUdiseLikeField(ans) && isUdiseValue(normalizedRaw)) {
          const udise = String(normalizedRaw).trim();
          return udiseToSchoolName[udise] || '-';
        }

        if (type === 'date') return formatMaybeDate(normalizedRaw);
        if (type === 'checkbox') {
          const arr = Array.isArray(normalizedRaw) ? normalizedRaw : [normalizedRaw];
          return arr.map((v) => String(v)).filter(Boolean).join(', ') || '-';
        }
        return String(normalizedRaw);
      };

      // The summary fields (name, caste, class ...) are found by name, so an uploaded
      // document must never be picked - "Caste Certificate" is not the caste category.
      const findByMatchers = (matchers) =>
        answers.find((a) => {
          if (isUploadedFileAnswer(a)) return false;
          const key = normalizeKey(a?.field_key);
          const label = normalizeKey(a?.field_label || a?.label);
          return matchers.some((m) => key.includes(m) || label.includes(m));
        });

      const isPhotoAnswer = (a) => {
        const key = normalizeKey(a?.field_key);
        const label = normalizeKey(a?.field_label || a?.label);
        return ['photo', 'photograph', 'candidate_image', 'student_image', 'image'].some(
          (m) => key.includes(m) || label.includes(m)
        );
      };
      const isSignatureAnswer = (a) => {
        const key = normalizeKey(a?.field_key);
        const label = normalizeKey(a?.field_label || a?.label);
        return ['signature', 'sign', 'candidate_signature'].some((m) => key.includes(m) || label.includes(m));
      };

      const nameAnswer = findByMatchers(['name', 'student_name', 'candidate_name']);
      const fatherAnswer = findByMatchers(['father', 'father_name']);
      const motherAnswer = findByMatchers(['mother', 'mother_name']);
      const regNoAnswer = findByMatchers(['student_registration', 'registration_no', 'sr_no', 'sr number']);
      const dobAnswer = findByMatchers(['date_of_birth', 'dob']);
      const sexAnswer = findByMatchers(['sex', 'gender']);
      const casteAnswer = findByMatchers(['caste', 'category']);
      const classAnswer = findByMatchers(['class', 'standard', 'grade']);
      const selectedClassValue = classAnswer ? String(getAnswerRawValue(classAnswer) || '').trim() : '';
      const contactAnswer = findByMatchers(['contact', 'mobile', 'phone']);
      const emailAnswer = findByMatchers(['email']);
      const photoAnswer = answers.find(isPhotoAnswer);
      const signatureAnswer = answers.find(isSignatureAnswer);

      const schoolNameFromAppRaw = String(application?.school_name || application?.origin_school || '').trim();
      let currentSchoolName = '-';
      if (schoolNameFromAppRaw) {
        if (isUdiseValue(schoolNameFromAppRaw)) {
          currentSchoolName = (await fetchSchoolNameByUdise(schoolNameFromAppRaw)) || schoolNameFromAppRaw;
        } else {
          currentSchoolName = schoolNameFromAppRaw;
        }
      } else {
        const schoolUdise = String(application?.udise_code || '').trim();
        if (schoolUdise) {
          currentSchoolName = (await fetchSchoolNameByUdise(schoolUdise)) || schoolUdise;
        } else {
          try {
            const profileData = await get('/api/student/profile', { token: auth?.token });
            const profile = profileData?.profile || profileData || {};
            const profileSchoolName = String(profile?.school_name || '').trim();
            if (profileSchoolName) {
              currentSchoolName = profileSchoolName;
            } else {
              const profileUdise = String(profile?.udise_code || '').trim();
              if (profileUdise) {
                currentSchoolName = (await fetchSchoolNameByUdise(profileUdise)) || profileUdise;
              }
            }
          } catch {
            currentSchoolName = '-';
          }
        }
      }

      if (!currentSchoolName || currentSchoolName === '-') {
        const registeredSchoolAnswer = findByMatchers([
          'current_school_name',
          'school_name',
          'registered_school_name',
          'current_school',
          'school',
          'udise_code',
        ]);
        const registeredSchoolRaw = String(getAnswerRawValue(registeredSchoolAnswer) || '').trim();
        if (registeredSchoolRaw) {
          currentSchoolName = isUdiseValue(registeredSchoolRaw)
            ? (await fetchSchoolNameByUdise(registeredSchoolRaw)) || registeredSchoolRaw
            : registeredSchoolRaw;
        }
      }

      const submissionDate =
        application?.submitted_at ||
        application?.submittedAt ||
        application?.application_submitted_at ||
        application?.updated_at ||
        application?.created_at ||
        '';

      const sortedAnswers = [...answers].sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0));
      const keyFields = new Set(
        [nameAnswer, fatherAnswer, motherAnswer, regNoAnswer, dobAnswer, sexAnswer, casteAnswer, classAnswer, contactAnswer, emailAnswer, photoAnswer, signatureAnswer]
          .filter(Boolean)
          .map((a) => String(a?.field_key || ''))
      );
      const detailRows = sortedAnswers
        .filter((a) => !keyFields.has(String(a?.field_key || '')))
        .filter((a) => !isUploadedFileAnswer(a))
        .map((a) => ({
          label:
            isCmScholarship &&
            (normalizeKey(a?.field_type) === 'preschool' ||
              normalizeKey(a?.field_key) === 'previous_school_udise')
              ? selectedClassValue === '6'
                ? 'Name of school from which class 5th was passed'
                : selectedClassValue === '9'
                  ? 'Name of school from which class 8th was passed'
                  : (a?.field_label || a?.label || a?.field_key || '-')
              : (a?.field_label || a?.label || a?.field_key || '-'),
          value: toLabelValue(a),
        }));

      const summaryRows = [
        { label: 'Application ID', value: window.getDisplayApplicationId(application) || '-' },
        { label: 'Date of Submission', value: formatMaybeDate(submissionDate) },
        { label: regNoAnswer?.field_label || regNoAnswer?.label || 'Student Registration No.', value: regNoAnswer ? toLabelValue(regNoAnswer) : '-' },
        { label: nameAnswer?.field_label || nameAnswer?.label || 'Candidate Name', value: nameAnswer ? toLabelValue(nameAnswer) : '-' },
        { label: fatherAnswer?.field_label || fatherAnswer?.label || "Father's Name", value: fatherAnswer ? toLabelValue(fatherAnswer) : '-' },
        { label: motherAnswer?.field_label || motherAnswer?.label || "Mother's Name", value: motherAnswer ? toLabelValue(motherAnswer) : '-' },
        { label: sexAnswer?.field_label || sexAnswer?.label || 'Gender', value: sexAnswer ? toLabelValue(sexAnswer) : '-' },
        { label: dobAnswer?.field_label || dobAnswer?.label || 'Date of Birth', value: dobAnswer ? toLabelValue(dobAnswer) : '-' },
        { label: casteAnswer?.field_label || casteAnswer?.label || 'Caste Category', value: casteAnswer ? toLabelValue(casteAnswer) : '-' },
        { label: classAnswer?.field_label || classAnswer?.label || 'Class', value: classAnswer ? toLabelValue(classAnswer) : '-' },
        { label: 'Current School Name', value: currentSchoolName || '-' },
        ...(eligibility ? [{ label: 'Eligibility', value: eligibility }] : []),
        { label: contactAnswer?.field_label || contactAnswer?.label || 'Contact No', value: contactAnswer ? toLabelValue(contactAnswer) : '-' },
        { label: emailAnswer?.field_label || emailAnswer?.label || 'Email', value: emailAnswer ? toLabelValue(emailAnswer) : '-' },
        ...detailRows,
      ];

      const safeHtml = (s) =>
        String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const downloadedAt = new Date().toLocaleString('en-GB');
      const blobToDataUrl = (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      const resolvePrintableImageSrc = async (value) => {
        if (!value) return '';
        const remoteUrl = resolveFileUrl(String(value));
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

      // The SCERT logo, embedded like the photo so it is in the page when it prints.
      const logoSrc = await (async () => {
        const url = `${window.location.origin}/scert-logo.png`;
        try {
          const res = await fetch(url);
          if (!res.ok) return url;
          return await blobToDataUrl(await res.blob());
        } catch {
          return url;
        }
      })();

      const photoPrintableSrc = await resolvePrintableImageSrc(getAnswerRawValue(photoAnswer));
      const signaturePrintableSrc = await resolvePrintableImageSrc(getAnswerRawValue(signatureAnswer));

      const summaryRowsHtml = summaryRows
        .map(
          (row, idx) => `
            <tr>
              <td class="label-cell">${safeHtml(row.label)}</td>
              <td class="value-cell">${safeHtml(row.value)}</td>
              ${
                idx === 0
                  ? `<td class="photo-cell" rowspan="${summaryRows.length}">
                      <div class="photo-title">${safeHtml(photoAnswer?.field_label || photoAnswer?.label || 'Candidate Photograph')}</div>
                      <div class="image-box">
                        ${photoPrintableSrc ? `<img src="${safeHtml(photoPrintableSrc)}" alt="photo" />` : '<span class="no-image">Photo unavailable</span>'}
                      </div>
                      <div class="photo-title" style="margin-top:10px;">${safeHtml(signatureAnswer?.field_label || signatureAnswer?.label || 'Candidate Signature')}</div>
                      <div class="image-box large-sign">
                        ${signaturePrintableSrc ? `<img src="${safeHtml(signaturePrintableSrc)}" alt="signature" />` : '<span class="no-image">Signature unavailable</span>'}
                      </div>
                    </td>`
                  : ''
              }
            </tr>
          `
        )
        .join('');

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
    .heading .logo { display: block; width: 100%; max-width: 640px; height: auto; margin: 0 auto 8px; }
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
      <img class="logo" src="${safeHtml(logoSrc)}" alt="SCERT Uttarakhand" />
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
      // Print once the logo, photo and signature have loaded (never wait more than 3 s).
      const startedWaiting = Date.now();
      const printWhenImagesReady = () => {
        const pending = Array.from(w.document.images).some((img) => !img.complete);
        if (pending && Date.now() - startedWaiting < 3000) {
          setTimeout(printWhenImagesReady, 100);
          return;
        }
        w.print();
      };
      setTimeout(printWhenImagesReady, 250);
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to download PDF'));
    }
  };

  const renderContent = () => {
    if (currentView === 'profile') {
      return (
        <div className="scert-profile-section">
          <div className="scert-hero-card">
            <div className="hero-text">
              <p className="eyebrow">Student Dashboard</p>
              <h2>Welcome back, {profile?.full_name || 'Student'}</h2>
              <p className="hero-subtitle">
                Keep your profile up to date and track your scholarship journey.
              </p>
              <div className="hero-actions">
                <button
                  type="button"
                  className="scert-btn-primary"
                  onClick={() => setCurrentView('applications')}
                >
                  View applications
                </button>
                <button
                  type="button"
                  className="scert-btn-ghost"
                  onClick={() => setShowEditProfile(true)}
                >
                  Edit Profile
                </button>
              </div>
            </div>
            <div className="hero-metrics">
              {/* <div className="metric-card">
                <span className="metric-label">Student ID</span>
                <span className="metric-value">{profile?.user_id || '-'}</span>
              </div> */}
              <div className="metric-card">
                <span className="metric-label">School Name</span>
                <span className="metric-value">{profile?.school_name || '-'}</span>
              </div>
            </div>
          </div>

          {showEditProfile && (
            <StudentProfileEditForm
              initialProfile={profile}
              onClose={() => setShowEditProfile(false)}
              onSuccess={() => {
                setShowEditProfile(false);
                fetchProfile();
              }}
            />
          )}

          <div className="scert-profile-section">
            <div className="student-profile-compact-card">
              <h3 className="profile-section-title">Personal Information</h3>
              <div className="profile-compact-grid">
                <div className="profile-compact-row">
                  <div className="profile-compact-item">
                    <label>Full Name</label>
                    <div className="profile-compact-value">{profile?.full_name || '-'}</div>
                  </div>
                  <div className="profile-compact-item">
                    <label>Gender</label>
                    <div className="profile-compact-value">{profile?.gender || '-'}</div>
                  </div>
                  <div className="profile-compact-item">
                    <label>Date of Birth</label>
                    <div className="profile-compact-value">{profile?.date_of_birth ? formatDate(profile.date_of_birth) : '-'}</div>
                  </div>
                </div>

                <div className="profile-compact-row">
                  <div className="profile-compact-item">
                    <label>Father's Name</label>
                    <div className="profile-compact-value">{profile?.father_name || '-'}</div>
                  </div>
                  <div className="profile-compact-item">
                    <label>Mother's Name</label>
                    <div className="profile-compact-value">{profile?.mother_name || '-'}</div>
                  </div>
                </div>

                <div className="profile-compact-row">
                  <div className="profile-compact-item">
                    <label>Mobile Number</label>
                    <div className="profile-compact-value">{profile?.mobile_number || '-'}</div>
                  </div>
                  <div className="profile-compact-item">
                    <label>Aadhaar Number</label>
                    <div className="profile-compact-value">{profile?.aadhaar_number || '-'}</div>
                  </div>
                  <div className="profile-compact-item">
                    <label>Email</label>
                    <div className="profile-compact-value">{profile?.login_id || '-'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="student-profile-compact-card">
              <h3 className="profile-section-title">Enrollment Details</h3>
              <div className="profile-compact-grid">
                <div className="profile-compact-row">
                  {/* <div className="profile-compact-item">
                    <label>Student ID</label>
                    <div className="profile-compact-value">{profile?.user_id || '-'}</div>
                  </div> */}
                  <div className="profile-compact-item">
                    <label>School Name</label>
                    <div className="profile-compact-value">{profile?.school_name || '-'}</div>
                  </div>
                  <div className="profile-compact-item">
                    <label>Registered On</label>
                    <div className="profile-compact-value">{formatDate(profile?.created_at)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (currentView === 'applications') {
      const pickAnswerValue = (ans) => {
        if (ans.value_text !== null && ans.value_text !== undefined) return ans.value_text;
        if (ans.value_number !== null && ans.value_number !== undefined) return String(ans.value_number);
        if (ans.value_date) return formatMaybeDate(ans.value_date);
        if (ans.value_file_path) return ans.value_file_path;
        return '';
      };

      const getStudentName = (item) => {
        const directName = String(item?.application?.student_name || '').trim();
        if (directName) return directName;

        const answers = Array.isArray(item?.answers) ? item.answers : [];
        const nameField = answers.find((a) => {
          const key = String(a?.field_key || '').toLowerCase();
          const label = String(a?.label || '').toLowerCase();
          const isCandidateName =
            key === 'name' ||
            key === 'student_name' ||
            key === 'candidate_name' ||
            (label.includes('name') && !label.includes('father') && !label.includes('mother'));
          return isCandidateName;
        });
        return nameField ? pickAnswerValue(nameField) : '';
      };

      const rows = [...applications].sort((a, b) => {
        const aId = Number(a?.application?.application_id);
        const bId = Number(b?.application?.application_id);
        if (Number.isFinite(aId) && Number.isFinite(bId)) return bId - aId;
        return String(b?.application?.application_id || '').localeCompare(String(a?.application?.application_id || ''));
      });

      const closeDraftEditor = () => {
        setEditingDraft(null);
        fetchApplications(true);
      };

      // Inline editor/viewer (same route/screen)
      if (editingDraft) {
        return (
          <div className="applications-view">
            <div className="view-header-row">
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">{editingDraft.readOnly ? 'View Application' : 'Edit Draft'}</h3>
              
            </div>
              <button type="button" className="scert-btn-secondary" onClick={closeDraftEditor}>
                ← Back to Applications
              </button>
            </div>

            <StudentScholarshipApplication
              scholarship={editingDraft.scholarship}
              existingApplication={editingDraft.application}
              existingAnswers={editingDraft.answers}
              cachedProfile={profile}
              readOnly={Boolean(editingDraft.readOnly)}
              autoDownloadOnLoad={Boolean(editingDraft.autoDownloadOnLoad)}
              hideBackButton={true}
              onBack={closeDraftEditor}
            />
          </div>
        );
      }

      return (
        <div className="applications-view">
          <div className="view-header-row">
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">My Applications</h3>
              
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => fetchApplications(true)}
              disabled={loadingApplications}
            >
              {loadingApplications ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {loadingApplications ? (
            <div className="loading-state">Loading applications...</div>
          ) : applicationsError ? (
            <div className="error-state">{applicationsError}</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">No draft/submitted applications found yet</div>
          ) : (
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>Application ID</th>
                    <th>Student Name</th>
                    <th>Scholarship Name</th>
                    <th>Status</th>
                    <th style={{ width: 140 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={String(item.application?.application_id)} className={window.getSubmissionRoleRowClass(item)}>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(item.application)}</code>
                      </td>
                      <td className="smart-table-strong">{getStudentName(item) || '—'}</td>
                      <td>{item.scholarship?.scholarship_name || '—'}</td>
                      <td>
                        <span className={`status-pill status-${String(item.application?.status || '').toLowerCase()}`}>
                          {item.application?.status || '—'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            type="button"
                            className="icon-action-btn"
                            title={
                              isStudentEditLocked(item.application)
                                ? 'View (editing disabled after submission)'
                                : 'Edit / Continue'
                            }
                            onClick={() => {
                              setEditingDraft({
                                scholarship: item.scholarship,
                                application: item.application,
                                answers: item.answers,
                                readOnly: isStudentEditLocked(item.application) || Boolean(item.application?.is_locked),
                                autoDownloadOnLoad: false,
                              });
                            }}
                          >
                            {isStudentEditLocked(item.application) ? <HiOutlineLockClosed /> : <HiOutlinePencil />}
                          </button>
                          <button
                            type="button"
                            className="icon-action-btn"
                            title="Download PDF"
                            onClick={() => handleDownloadApplicationPdf(item)}
                          >
                            <HiOutlineDownload />
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

    if (currentView === 'scholarships') {
      // If a scholarship is selected, show the application form
      if (selectedScholarship) {
        const isEditing = Boolean(editingDraft);
        return (
          <StudentScholarshipApplication
            scholarship={selectedScholarship}
            existingApplication={editingDraft?.application || null}
            existingAnswers={editingDraft?.answers || null}
            cachedProfile={profile}
            onBack={() => {
              setSelectedScholarship(null);
              if (isEditing) {
                setEditingDraft(null);
                setCurrentView('applications');
              }
              // Back from the form: a draft may have been saved or the application
              // submitted, so load the list afresh either way.
              fetchApplications(true);
            }}
          />
        );
      }

      // Otherwise, show the scholarships list
      return (
        <div className="applications-view">
          <div className="view-header-row">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">All Scholarships</h3>
              
            </div>
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => fetchScholarships(true)}
              disabled={loadingScholarships}
            >
              {loadingScholarships ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {loadingScholarships ? (
            <div className="loading-state">Loading scholarships...</div>
          ) : scholarships.length === 0 ? (
            <div className="empty-state">No active scholarships available at the moment</div>
          ) : (
            <div className="school-apply-card-wrap" style={{ flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
              {scholarships.map((sch) => (
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
                                <li key={`st-hi1-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>{details.hiPara}</p>
                          )}
                          {Array.isArray(details.enBullets) ? (
                            <ul>
                              {details.enBullets.map((item, idx) => (
                                <li key={`st-en1-${idx}`}>{item}</li>
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
                                  <li key={`st-hi2-${idx}`}>{item}</li>
                                ))}
                              </ul>
                            ) : (
                              details.hiPara2 ? <p>{details.hiPara2}</p> : null
                            )}
                            {Array.isArray(details.enBullets2) ? (
                              <ul>
                                {details.enBullets2.map((item, idx) => (
                                  <li key={`st-en2-${idx}`}>{item}</li>
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
                    {(() => {
                      const isAlreadyApplied = applications.some(
                        (item) => String(item?.scholarship?.scholarship_id || '') === String(sch.scholarship_id)
                      );
                      const accepted = Boolean(eligibilityAccepted[sch.scholarship_id]);
                      return (
                    <>
                    {!isAlreadyApplied ? (
                      <label className={`school-apply-consent${accepted ? ' is-checked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={accepted}
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
                    ) : null}
                    <button
                      type="button"
                      className="apply-btn school-apply-card-btn"
                      disabled={isAlreadyApplied || !accepted}
                      title={!isAlreadyApplied && !accepted ? 'Please confirm that you have read the information above' : undefined}
                      onClick={() => {
                        if (!accepted) return;
                        setEditingDraft(null);
                        setSelectedScholarship(sch);
                      }}
                    >
                      {isAlreadyApplied ? 'Already Applied' : 'Apply for Scholarship'}
                    </button>
                    </>
                      );
                    })()}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (currentView === 'password') {
      const closePasswordModal = () => {
        setPasswordChangeLoading(false);
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setCurrentView('profile');
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
                  ×
                </button>
              </div>
            </div>

            <form className="password-form" onSubmit={handlePasswordChange}>
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

    return <div className="empty-state">Select an option from the sidebar</div>;
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
            {mobileSidebarOpen ? '✕' : '☰'}
          </button>
          <img src="/scert-logo.png" alt="SCERT" className="scert-topbar-logo" />
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
            className={currentView === 'profile' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setShowEditProfile(false);
              setEditingDraft(null);
              setSelectedScholarship(null);
              setCurrentView('profile');
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineUser /></span>
            <span>Profile</span>
          </button>

          <button
            type="button"
            className={currentView === 'applications' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setSelectedScholarship(null);
              setCurrentView('applications');
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineDocumentText /></span>
            <span>My Applications</span>
          </button>
          <button
            type="button"
            className={currentView === 'scholarships' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => {
              setEditingDraft(null);
              setSelectedScholarship(null);
              setCurrentView('scholarships');
            }}
          >
            <span className="scert-dash-link-icon"><HiOutlineAcademicCap /></span>
            <span>All Scholarships</span>
          </button>
          <button
            type="button"
            className={currentView === 'password' ? 'scert-dash-link scert-dash-link-active' : 'scert-dash-link'}
            onClick={() => setCurrentView('password')}
          >
            <span className="scert-dash-link-icon"><HiOutlineLockClosed /></span>
            <span>Change Password</span>
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
        <div className={currentView === 'profile' ? 'scert-dash-content student-profile-no-scroll' : 'scert-dash-content'}>
          {renderContent()}
        </div>
      </main>
      </div>
    </div>
  );
}
