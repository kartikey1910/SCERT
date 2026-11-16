import { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useCallback } from 'react';
import { get, post, put, API_BASE_URL } from './apiClient.js';
import { PrimarySchoolSelectorModal } from './PrimarySchoolSelectorModal.jsx';
import { FileAttachment } from './FileAttachment.jsx';
import { useToast } from './ToastContext.jsx';
import { nmmssDocumentVisibility, readCasteValue, readIncomeUnderLimit, isUploadRequired, isDivyangtaCertificateDoc } from './utils/nmmssDocumentRules.js';
import { shrinkImageForUpload, PHOTO_MAX_DIMENSION, DOCUMENT_MAX_DIMENSION } from './utils/shrinkImageForUpload.js';
import { requiredFieldsMessage, invalidValuesMessage } from './utils/formValidationMessages.js';
import { packFormRows, formRowClassName, rowKinds } from './utils/formRows.js';
import { numberInputAttrs, sanitizeNumberValue } from './utils/numberInput.js';
import { HIDDEN_FILE_INPUT_STYLE } from './utils/hiddenFileInput.js';

const scholarshipFormCache = new Map();
const scholarshipFormPromiseCache = new Map();
const studentProfileCache = new Map();
const studentProfilePromiseCache = new Map();

export function StudentScholarshipApplication({
  scholarship,
  onBack,
  existingApplication = null,
  existingAnswers = null,
  readOnly = false,
  hideBackButton = false,
  autoDownloadOnLoad = false,
  cachedProfile = null,
}) {
  const { auth } = useAuth();
  const toast = useToast();
  const [scholarshipForm, setScholarshipForm] = useState(null);
  const [applicationId, setApplicationId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fileUploading, setFileUploading] = useState({});
  const [pendingFiles, setPendingFiles] = useState({});
  const [localPreviewUrls, setLocalPreviewUrls] = useState({});
  const fileInputRefs = useRef({});
  const cameraInputRefs = useRef({});
  const downloadPdfBtnRef = useRef(null);
  const autoDownloadTriggeredRef = useRef(false);
  const persistedValuesRef = useRef({});
  const [schoolSelectorOpen, setSchoolSelectorOpen] = useState(false);
  const [currentSchoolField, setCurrentSchoolField] = useState(null);
  const [preschoolLabels, setPreschoolLabels] = useState({});
  const [formStep, setFormStep] = useState(1);
  // Exam code (1 or 2) as computed by the backend. It decides which
  // documents NMMSS asks for on step 2. Saving returns a fresh one; the
  // loaded application supplies it when reopening a draft.
  const [savedExamCode, setSavedExamCode] = useState(null);

  const isLockedByBackend = Boolean(existingApplication?.is_locked);
  const isSubmittedAndMovedToSchool =
    String(existingApplication?.status || '').toUpperCase() === 'SUBMITTED' &&
    String(existingApplication?.current_stage || '').toUpperCase() === 'SCHOOL';

  const isReadOnly = Boolean(readOnly || isLockedByBackend || isSubmittedAndMovedToSchool);
  const isCmScholarship =
    /\bCM\b/i.test(String(scholarship?.scholarship_name || '')) ||
    /CHIEF\s*MINISTER/i.test(String(scholarship?.scholarship_name || ''));

  const getCachedStudentProfile = async () => {
    if (cachedProfile) return cachedProfile;
    const cacheKey = String(auth?.token || '');
    if (!cacheKey) return null;
    if (studentProfileCache.has(cacheKey)) {
      return studentProfileCache.get(cacheKey);
    }
    if (studentProfilePromiseCache.has(cacheKey)) {
      return studentProfilePromiseCache.get(cacheKey);
    }

    const promise = get('/api/student/profile', { token: auth?.token })
      .then((data) => {
        studentProfileCache.set(cacheKey, data);
        studentProfilePromiseCache.delete(cacheKey);
        return data;
      })
      .catch((err) => {
        studentProfilePromiseCache.delete(cacheKey);
        throw err;
      });

    studentProfilePromiseCache.set(cacheKey, promise);
    return promise;
  };

  const getScholarshipFormData = async () => {
    const cacheKey = String(scholarship?.scholarship_id || '');
    if (!cacheKey) return null;
    if (scholarshipFormCache.has(cacheKey)) {
      return scholarshipFormCache.get(cacheKey);
    }
    if (scholarshipFormPromiseCache.has(cacheKey)) {
      return scholarshipFormPromiseCache.get(cacheKey);
    }

    const promise = get(`/api/scholarships/${scholarship.scholarship_id}/form`, {
      token: auth?.token,
    })
      .then((data) => {
        scholarshipFormCache.set(cacheKey, data);
        scholarshipFormPromiseCache.delete(cacheKey);
        return data;
      })
      .catch((err) => {
        scholarshipFormPromiseCache.delete(cacheKey);
        throw err;
      });

    scholarshipFormPromiseCache.set(cacheKey, promise);
    return promise;
  };

  useEffect(() => {
    initializeApplication();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scholarship.scholarship_id, existingApplication?.application_id]);

  const getAnswerValue = (ans) => {
    if (!ans) return null;
    if (ans.value_text !== null && ans.value_text !== undefined) return ans.value_text;
    if (ans.value_number !== null && ans.value_number !== undefined) return ans.value_number;
    if (ans.value_date) return ans.value_date;
    if (ans.value_file_path) return ans.value_file_path;
    return null;
  };

  const findOptionValue = (field, value) => {
    if (!field?.options || value === null || value === undefined) return value;
    const normalizeWrappedValue = (v) => {
      const raw = String(v ?? '').trim();
      const m = raw.match(/^\{\s*"?(.*?)"?\s*\}$/);
      return m ? m[1] : raw;
    };
    const raw = normalizeWrappedValue(value);
    const key = String(field?.field_key || '').toLowerCase();

    // Handle legacy/new variants for sex/gender option values
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
    const type = String(field.field_type || '').toUpperCase();
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

  const resolveFileUrl = (value) => {
    if (!value || typeof value !== 'string') return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('/api/uploads/')) return `${API_BASE_URL}${value}`;
    if (value.startsWith('/uploads/')) return `${API_BASE_URL}/api${value}`;
    if (value.startsWith('/')) return `${API_BASE_URL}${value}`;
    return `${API_BASE_URL}/api/uploads/${value}`;
  };

  useEffect(() => {
    return () => {
      Object.values(localPreviewUrls).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
    };
  }, [localPreviewUrls]);

  useEffect(() => {
    if (!autoDownloadOnLoad) return;
    if (loading) return;
    if (!scholarshipForm) return;
    if (autoDownloadTriggeredRef.current) return;
    if (!downloadPdfBtnRef.current) return;

    autoDownloadTriggeredRef.current = true;
    downloadPdfBtnRef.current.click();
  }, [autoDownloadOnLoad, loading, scholarshipForm]);

  useEffect(() => {
    autoDownloadTriggeredRef.current = false;
  }, [applicationId, autoDownloadOnLoad]);

  const uploadSingleFile = async (field, file, targetApplicationId) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('field_id', field.field_id);

    const response = await fetch(
      `${API_BASE_URL}/api/applications/${targetApplicationId}/upload-file`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth?.token}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'File upload failed');
    }

    return response.json();
  };

  const uploadPendingFiles = async (targetApplicationId) => {
    const entries = Object.entries(pendingFiles || {});
    if (!entries.length) return {};

    const uploadedEntries = await Promise.all(
      entries.map(async ([fieldKey, pending]) => {
        const field = scholarshipForm?.form?.find((f) => String(f.field_key) === String(fieldKey));
        if (!field || !pending?.file) return null;

        setFileUploading((prev) => ({ ...prev, [fieldKey]: true }));
        try {
          const result = await uploadSingleFile(field, pending.file, targetApplicationId);
          return [fieldKey, result.file_path];
        } finally {
          setFileUploading((prev) => ({ ...prev, [fieldKey]: false }));
        }
      })
    );

    const uploadedPaths = Object.fromEntries(uploadedEntries.filter(Boolean));

    if (Object.keys(uploadedPaths).length > 0) {
      setPendingFiles((prev) => {
        const next = { ...prev };
        Object.keys(uploadedPaths).forEach((fieldKey) => {
          delete next[fieldKey];
        });
        return next;
      });
    }

    setFormValues((prev) => ({ ...prev, ...uploadedPaths }));
    return uploadedPaths;
  };

  const ensureApplicationInitialized = async () => {
    if (existingApplication?.application_id) {
      if (!applicationId) {
        setApplicationId(existingApplication.application_id);
      }
      return existingApplication.application_id;
    }

    if (applicationId) return applicationId;

    const initResponse = await post(
      `/api/applications/${scholarship.scholarship_id}/init`,
      {},
      { token: auth?.token }
    );

    const nextApplicationId = initResponse.application_id;
    setApplicationId(nextApplicationId);
    return nextApplicationId;
  };

  const initializeApplication = async () => {
    setLoading(true);
    setError('');
    setScholarshipForm(null);
    setFormValues({});

    try {
      const appId = existingApplication?.application_id || null;
      setApplicationId(appId);

      const formData = await getScholarshipFormData();

      setScholarshipForm(formData);

      // 3) Fetch student profile for auto-prefilling only if needed.
      let profileData = null;
      if (!Array.isArray(existingAnswers) || existingAnswers.length === 0) {
        try {
          profileData = await getCachedStudentProfile();
        } catch (err) {
          console.warn('Failed to fetch profile for auto-prefill:', err);
        }
      }

      // 4) Prefill answers when editing
      if (Array.isArray(existingAnswers) && existingAnswers.length > 0) {
        const nextValues = {};

        for (const ans of existingAnswers) {
          const field = formData.form.find(
            (f) => String(f.field_id) === String(ans.field_id)
          );
          if (!field) continue;

          let value = getAnswerValue(ans);

          // Normalize date input value (YYYY-MM-DD)
          if (field.field_type === 'DATE' && typeof value === 'string' && value.includes('T')) {
            value = value.slice(0, 10);
          }

          // Best-effort: if checkbox stored as JSON string, parse it
          if (field.field_type === 'CHECKBOX' && typeof value === 'string') {
            const trimmed = value.trim();
            if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
              try {
                value = JSON.parse(trimmed);
              } catch {
                // keep original
              }
            }
          }

          nextValues[field.field_key] = normalizeFieldValue(field, value);
        }

        setFormValues(nextValues);
        persistedValuesRef.current = { ...nextValues };
      } else if (profileData) {
        // 5) Auto-prefill profile values by field_key only
        const nextValues = {};
        const setPrefillValue = (field, value) => {
          nextValues[field.field_key] = normalizeFieldValue(field, value);
        };
        const profile = profileData?.profile || profileData || {};
        const user = profileData?.user || {};
        const studentEmail =
          profile?.email ||
          profile?.email_id ||
          profile?.login_id ||
          user?.email ||
          user?.login_id ||
          '';

        const profileFullName = profile?.full_name || '';
        const profileGender = profile?.gender || '';
        const profileFatherName = profile?.father_name || '';
        const profileMotherName = profile?.mother_name || '';
        const profileDob = profile?.date_of_birth || '';
        const profileAadhaar = profile?.aadhaar_number || '';
        const profileMobile = profile?.mobile_number || '';

        const NAME_KEYS = new Set([
          'student_name',
          'candidate_name',
          'applicant_name',
          'full_name',
          'name',
        ]);
        const GENDER_KEYS = new Set(['gender', 'sex']);
        const FATHER_KEYS = new Set(['father_name', 'fathers_name']);
        const MOTHER_KEYS = new Set(['mother_name', 'mothers_name']);
        const DOB_KEYS = new Set(['date_of_birth', 'dob', 'birth_date']);
        const AADHAAR_KEYS = new Set([
          'aadhaar_number',
          'aadhaar_no',
          'aadhar_number',
          'aadhar_no',
          'aadhaar',
        ]);
        const MOBILE_KEYS = new Set([
          'mobile_number',
          'mobile_no',
          'contact_no',
          'contact_number',
          'phone_number',
          'phone',
        ]);
        const EMAIL_KEYS = new Set(['email', 'email_id', 'mail', 'student_email']);

        for (const field of formData.form) {
          const fieldKey = String(field.field_key || '').toLowerCase();
          if (NAME_KEYS.has(fieldKey) && profileFullName) {
            setPrefillValue(field, profileFullName);
          } else if (GENDER_KEYS.has(fieldKey) && profileGender) {
            if (field.field_type === 'DROPDOWN' || field.field_type === 'RADIO') {
              setPrefillValue(field, findOptionValue(field, profileGender));
            } else {
              setPrefillValue(field, profileGender);
            }
          } else if (FATHER_KEYS.has(fieldKey) && profileFatherName) {
            setPrefillValue(field, profileFatherName);
          } else if (MOTHER_KEYS.has(fieldKey) && profileMotherName) {
            setPrefillValue(field, profileMotherName);
          } else if (DOB_KEYS.has(fieldKey) && profileDob) {
            const dobValue =
              typeof profileDob === 'string' && profileDob.includes('T')
                ? profileDob.slice(0, 10)
                : profileDob;
            setPrefillValue(field, dobValue);
          } else if (
            AADHAAR_KEYS.has(fieldKey) &&
            field.field_type !== 'FILE' &&
            profileAadhaar
          ) {
            setPrefillValue(field, String(profileAadhaar).trim());
          } else if (MOBILE_KEYS.has(fieldKey) && profileMobile) {
            setPrefillValue(field, profileMobile);
          } else if (EMAIL_KEYS.has(fieldKey) && studentEmail) {
            setPrefillValue(field, String(studentEmail).trim());
          }
        }

        if (Object.keys(nextValues).length > 0) {
          setFormValues(nextValues);
        }
        persistedValuesRef.current = {};
      } else {
        persistedValuesRef.current = {};
      }
    } catch (err) {
      setError(err.message || 'Failed to load application form');
    } finally {
      setLoading(false);
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
  const DISABILITY_KEYS = new Set(['disability', 'divyangta', 'divyangata', 'disability_status', 'divyangta_status', 'divyangata_status', 'is_divyang', 'is_divyangta', 'is_disabled']);
  const TYPE_KEYS = new Set(['type_of_disability', 'type_of_divyangta', 'type_of_divyangata', 'disability_code', 'divyangta_code', 'divyangata_code', 'type_of_disability_code', 'type_of_divyangta_code', 'type_of_divyangata_code', 'disability_type_code', 'divyangta_type_code', 'divyangata_type_code', 'disability_type', 'divyangta_type', 'divyangata_type']);
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
  const examCode = savedExamCode ?? existingApplication?.exam_code ?? null;
  const scholarshipNameForRules =
    scholarshipForm?.scholarship?.scholarship_name || scholarship?.scholarship_name || '';

  /** NMMSS document rule for this field, or null when it does not apply. */
  const nmmssDocRule = (field, values, fields = []) =>
    nmmssDocumentVisibility({
      field,
      scholarshipName: scholarshipNameForRules,
      examCode,
      casteValue: readCasteValue(values, fields),
      incomeUnderLimit: readIncomeUnderLimit(values, fields),
      disabilityYes: isDisabilityYesValue(getDisabilityValue(values)),
    });

  const isFieldRequired = ({ field, values, fields = [] }) => {
    const disabilityYes = isDisabilityYesValue(getDisabilityValue(values));
    const showCasteCertificate = isScStSelected(values, fields);
    if (isTypeFieldKey(field?.field_key) && !disabilityYes) return false;
    // A document the NMMSS rules hide can never be required — otherwise
    // submit would block on a field nobody can see.
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

  const isUdiseValue = (value) => /^\d{5,11}$/.test(String(value || '').trim());

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

  const fetchSchoolNameByUdise = useCallback(async (udiseCode) => {
    const udise = String(udiseCode || '').trim();
    if (!udise) return '';
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
  }, [auth?.token]);

  useEffect(() => {
    let cancelled = false;

    const hydratePreschoolLabels = async () => {
      if (!scholarshipForm?.form?.length) return;
      const preschoolFields = scholarshipForm.form.filter(
        (f) => String(f?.field_type || '').toUpperCase() === 'PRESCHOOL'
      );
      if (!preschoolFields.length) return;

      const toResolve = preschoolFields
        .map((f) => ({ key: String(f.field_key), udise: String(formValues[f.field_key] || '').trim() }))
        .filter((x) => isUdiseValue(x.udise) && !preschoolLabels[x.key]);

      if (!toResolve.length) return;

      const resolvedEntries = await Promise.all(
        toResolve.map(async ({ key, udise }) => {
          const schoolName = await fetchSchoolNameByUdise(udise);
          return [key, schoolName ? schoolName : `UDISE: ${udise}`];
        })
      );

      if (cancelled) return;
      setPreschoolLabels((prev) => {
        const next = { ...prev };
        resolvedEntries.forEach(([key, label]) => {
          if (!next[key] && label) next[key] = label;
        });
        return next;
      });
    };

    hydratePreschoolLabels();
    return () => {
      cancelled = true;
    };
  }, [fetchSchoolNameByUdise, scholarshipForm, formValues, preschoolLabels]);

  const normalizeComparableValue = (value) => {
    if (Array.isArray(value)) {
      return JSON.stringify([...value].map((v) => String(v ?? '').trim()).sort());
    }
    if (value === null || value === undefined || value === '') return '';
    return String(value).trim();
  };

  const buildAnswersPayload = ({ onlyDirty = false } = {}) => {
    if (!scholarshipForm?.form?.length) return [];

    const disabilityValue = getDisabilityValue(formValues);
    const nextAnswers = [];

    for (const field of scholarshipForm.form) {
      const fieldKey = String(field.field_key || '');
      let value = formValues[field.field_key] ?? null;

      if (isPreschoolField(field)) {
        value = extractUdiseCode(value) || null;
      }

      if (isTypeFieldKey(fieldKey) && !isDisabilityYesValue(disabilityValue)) {
        value = null;
      }

      const currentComparable = normalizeComparableValue(value);
      const persistedComparable = normalizeComparableValue(persistedValuesRef.current[field.field_key]);
      const isDirty = currentComparable !== persistedComparable;

      if (onlyDirty && !isDirty) continue;
      if (!onlyDirty && (value === null || value === '' || (Array.isArray(value) && value.length === 0))) {
        continue;
      }
      if (onlyDirty && currentComparable === '' && persistedComparable === '') {
        continue;
      }

      nextAnswers.push({ field_id: field.field_id, value });
    }

    return nextAnswers;
  };

  const commitPersistedValues = (answers) => {
    if (!Array.isArray(answers) || !scholarshipForm?.form?.length) return;

    const fieldKeyById = new Map(
      scholarshipForm.form.map((field) => [String(field.field_id), String(field.field_key)])
    );
    const nextValues = { ...persistedValuesRef.current };
    answers.forEach((answer) => {
      const fieldKey = fieldKeyById.get(String(answer.field_id));
      if (!fieldKey) return;
      nextValues[fieldKey] = answer.value ?? null;
    });
    persistedValuesRef.current = nextValues;
  };

  const normalizeAlreadyFilledMessage = (msg) => {
    const text = String(msg || '').toLowerCase();
    if (
      text.includes('unauthorized access') ||
      text.includes('already filled this scholarship application')
    ) {
      return 'You have already filled this scholarship application.';
    }
    return '';
  };

  const handleSaveAnswers = async ({ silent = false } = {}) => {
    if (isReadOnly) {
      setError('This application is locked and cannot be edited.');
      return false;
    }

    setSaving(true);
    setError('');

    try {
      const ensuredApplicationId = await ensureApplicationInitialized();
      const invalidDigitFields = validateDigitConstrainedFields(scholarshipForm.form, formValues);
      if (invalidDigitFields.length > 0) {
        throw new Error(`Please enter valid values: ${invalidDigitFields.join(', ')}`);
      }
      const invalidAgeFields = validateMinimumAge(scholarshipForm.form, formValues);
      if (invalidAgeFields.length > 0) {
        throw new Error(`Please enter valid values: ${invalidAgeFields.join(', ')}`);
      }

      const answers = buildAnswersPayload({ onlyDirty: true });
      const hasPendingUploads = Object.keys(pendingFiles || {}).length > 0;
      if (answers.length === 0 && !hasPendingUploads) {
        if (!silent) {
          toast.success('No changes to save');
        }
        return true;
      }

      const uploadedPaths = await uploadPendingFiles(ensuredApplicationId);
      const fieldKeyById = new Map(
        scholarshipForm.form.map((field) => [String(field.field_id), String(field.field_key)])
      );
      const refreshedAnswers = buildAnswersPayload({ onlyDirty: true }).map((answer) => {
        const fieldKey = fieldKeyById.get(String(answer.field_id));
        return {
          ...answer,
          value: fieldKey ? uploadedPaths[fieldKey] ?? answer.value : answer.value,
        };
      });

      if (refreshedAnswers.length === 0) {
        return true;
      }

      const saveResponse = await put(
        `/api/applications/${ensuredApplicationId}/answers`,
        { answers: refreshedAnswers },
        { token: auth?.token }
      );
      if (saveResponse && 'exam_code' in saveResponse) setSavedExamCode(saveResponse.exam_code);
      commitPersistedValues(refreshedAnswers);

      if (!silent) {
        toast.success('Application saved as draft successfully');
      }

      return true;
    } catch (err) {
      const alreadyFilledMsg = normalizeAlreadyFilledMessage(err?.message);
      if (alreadyFilledMsg) {
        setError('');
        toast.warning(alreadyFilledMsg);
      } else {
        setError(err.message || 'Failed to save application');
        toast.error(toast.getErrorMessage(err, 'Failed to save application'));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitApplication = async (e) => {
    e.preventDefault();

    // On step 1, persist answers first so eligibility is validated before moving ahead
    if (formStep === 1) {
      if (isReadOnly) {
        setFormStep(2);
        return;
      }

      const hasPendingUploads = Object.keys(pendingFiles || {}).length > 0;
      const dirtyAnswers = buildAnswersPayload({ onlyDirty: true });
      if (!hasPendingUploads && dirtyAnswers.length === 0) {
        setFormStep(2);
        return;
      }

      const canProceed = await handleSaveAnswers({ silent: true });
      if (canProceed) {
        setFormStep(2);
      }
      return;
    }

    if (isReadOnly) {
      setError('This application is locked and cannot be submitted/updated.');
      return;
    }

    const disabilityValue = getDisabilityValue(formValues);
    const disabilityYes = isDisabilityYesValue(disabilityValue);
    const showCasteCertificate = isScStSelected(formValues, scholarshipForm.form);
    const invalidDigitFields = validateDigitConstrainedFields(scholarshipForm.form, formValues);
    if (invalidDigitFields.length > 0) {
      setError('');
      toast.error(invalidValuesMessage(invalidDigitFields));
      return;
    }

    const invalidAgeFields = validateMinimumAge(scholarshipForm.form, formValues);
    if (invalidAgeFields.length > 0) {
      setError('');
      toast.error(invalidValuesMessage(invalidAgeFields));
      return;
    }

    // Validate required fields (type field required only when disability=yes)
    const missingFields = scholarshipForm.form
      .filter((field) => {
        const requiredForField = isFieldRequired({
          field,
          values: formValues,
          fields: scholarshipForm.form,
        });
        if (!requiredForField) return false;

        const value = formValues[field.field_key];
        const hasPendingFile = Boolean(pendingFiles[field.field_key]?.file);
        if (field.field_type === 'CHECKBOX') {
          return !Array.isArray(value) || value.length === 0;
        }
        if (String(field.field_type || '').toUpperCase() === 'FILE') {
          const hasActualFile =
            typeof value === 'string' &&
            (value.includes('/') || value.includes('uploads') || value.startsWith('http'));
          return !(hasActualFile || hasPendingFile);
        }
        return value === null || value === undefined || value === '';
      })
      .map((field) => field.field_label);

    if (missingFields.length > 0) {
      setError('');
      toast.error(requiredFieldsMessage(missingFields));
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const ensuredApplicationId = await ensureApplicationInitialized();
      const hasPendingUploads = Object.keys(pendingFiles || {}).length > 0;
      const dirtyAnswers = buildAnswersPayload({ onlyDirty: true });

      if (hasPendingUploads || dirtyAnswers.length > 0) {
        const uploadedPaths = await uploadPendingFiles(ensuredApplicationId);
        const fieldKeyById = new Map(
          scholarshipForm.form.map((field) => [String(field.field_id), String(field.field_key)])
        );
        const answers = buildAnswersPayload({ onlyDirty: true }).map((answer) => {
          const fieldKey = fieldKeyById.get(String(answer.field_id));
          return {
            ...answer,
            value: fieldKey ? uploadedPaths[fieldKey] ?? answer.value : answer.value,
          };
        });

        if (answers.length > 0) {
          await put(
            `/api/applications/${ensuredApplicationId}/answers`,
            { answers },
            { token: auth?.token }
          );
          commitPersistedValues(answers);
        }
      }

      // Then submit the application
      await post(
        `/api/applications/${ensuredApplicationId}/submit`,
        {},
        { token: auth?.token }
      );

      toast.success('Application submitted successfully');
      setTimeout(() => {
        onBack();
      }, 2000);
    } catch (err) {
      const alreadyFilledMsg = normalizeAlreadyFilledMessage(err?.message);
      if (alreadyFilledMsg) {
        setError('');
        toast.warning(alreadyFilledMsg);
      } else {
        setError(err.message || 'Failed to submit application');
        toast.error(toast.getErrorMessage(err, 'Failed to submit application'));
      }
    } finally {
      setSubmitting(false);
    }
  };
  const renderFieldInput = (field) => {
    const fieldType = String(field?.field_type || '').trim().toUpperCase();
    const requiredForField = isFieldRequired({
      field,
      values: formValues,
      fields: scholarshipForm?.form || [],
    });

    switch (fieldType) {
      case 'TEXT':
        return (
          <input
            type="text"
            className="dynamic-input"
            value={formValues[field.field_key] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            required={requiredForField && !isReadOnly}
            disabled={isReadOnly}
          />
        );
      
      case 'NUMBER':
      {
        const digitConstraint = getDigitConstraint(field);
        return (
          <input
            type={digitConstraint ? 'text' : 'number'}
            className="dynamic-input"
            inputMode={digitConstraint ? 'numeric' : undefined}
            pattern={digitConstraint ? `\\d{${digitConstraint}}` : undefined}
            maxLength={digitConstraint || undefined}
            {...(digitConstraint ? {} : numberInputAttrs(field))}
            value={formValues[field.field_key] || ''}
            onChange={(e) => {
              const nextValue = digitConstraint
                ? sanitizeDigitInput(e.target.value, digitConstraint)
                : sanitizeNumberValue(e.target.value, field, formValues[field.field_key]);
              handleFieldChange(field, nextValue);
            }}
            required={requiredForField && !isReadOnly}
            disabled={isReadOnly}
          />
        );
      }
      
      case 'EMAIL':
        return (
          <input
            type="email"
            className="dynamic-input"
            value={formValues[field.field_key] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            required={requiredForField && !isReadOnly}
            disabled={isReadOnly}
          />
        );
      
      case 'TEXTAREA':
        return (
          <textarea
            className="dynamic-textarea"
            rows="4"
            value={formValues[field.field_key] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            required={requiredForField && !isReadOnly}
            disabled={isReadOnly}
          />
        );
      
      case 'DATE':
        return (
          <input
            type="date"
            className="dynamic-input"
            value={formValues[field.field_key] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            required={requiredForField && !isReadOnly}
            disabled={isReadOnly}
          />
        );
      
      case 'DROPDOWN':
        return (
          <select
            className="dynamic-select"
            value={formValues[field.field_key] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            required={requiredForField && !isReadOnly}
            disabled={isReadOnly}
          >
            <option value="">Select an option</option>
            {field.options.map(opt => (
              <option key={opt.option_id} value={opt.option_value}>
                {opt.option_label}
              </option>
            ))}
          </select>
        );
      
      case 'RADIO':
        return (
          <div className="radio-group">
            {field.options.map(opt => (
              <label key={opt.option_id} className="radio-label">
                <input
                  type="radio"
                  name={field.field_key}
                  value={opt.option_value}
                  checked={formValues[field.field_key] === opt.option_value}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                  required={requiredForField && !isReadOnly}
                  disabled={isReadOnly}
                />
                <span>{opt.option_label}</span>
              </label>
            ))}
          </div>
        );
      
      case 'CHECKBOX':
        return (
          <div className="checkbox-group">
            {field.options.map(opt => (
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
                    handleFieldChange(field, newValue);
                  }}
                  disabled={isReadOnly}
                />
                <span>{opt.option_label}</span>
              </label>
            ))}
          </div>
        );
      
      case 'PRESCHOOL':
        return (
          <div className="preschool-selector-container">
            <div className="preschool-selector-row">
              <button
                type="button"
                className="preschool-select-btn form-submit-btn"
                onClick={async () => {
                  setCurrentSchoolField(field);
                  setSchoolSelectorOpen(true);
                }}
                disabled={isReadOnly}
              >
                {formValues[field.field_key] ? 'School Selected' : 'Select Previous School'}
              </button>
              {formValues[field.field_key] && (
                <div className="selected-school-info">
                  <div className="selected-school-name">
                    {preschoolLabels[field.field_key] || `UDISE: ${formValues[field.field_key]}`}
                  </div>
                </div>
              )}
            </div>
            {requiredForField && !formValues[field.field_key] && (
              <small className="field-hint">Required: Please select your previous school</small>
            )}
          </div>
        );
      
      case 'FILE': {
        // Check if the value is actually a file path (contains / or uploads)
        const hasActualFile = formValues[field.field_key] &&
          typeof formValues[field.field_key] === 'string' &&
          (formValues[field.field_key].includes('/') || formValues[field.field_key].includes('uploads'));
        const pendingFile = pendingFiles[field.field_key]?.file || null;

        if (isPhotoField(field) || isSignatureField(field)) {
          const previewUrl = localPreviewUrls[field.field_key];
          const persistedUrl = hasActualFile ? resolveFileUrl(formValues[field.field_key]) : '';
          const imageUrl = previewUrl || persistedUrl;
          return (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {/* The hidden inputs sit OUTSIDE the clickable box: the box's onClick
                  opens the gallery picker, so a Camera tap bubbling up into it fired
                  both pickers at once and mobile browsers dropped the camera. */}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                ref={(el) => {
                  fileInputRefs.current[field.field_key] = el;
                }}
                style={HIDDEN_FILE_INPUT_STYLE}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(field, file);
                  e.target.value = '';
                }}
                disabled={isReadOnly || fileUploading[field.field_key]}
              />
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                capture={isPhotoField(field) ? 'environment' : 'user'}
                ref={(el) => {
                  cameraInputRefs.current[field.field_key] = el;
                }}
                style={HIDDEN_FILE_INPUT_STYLE}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(field, file);
                  e.target.value = '';
                }}
                disabled={isReadOnly || fileUploading[field.field_key]}
              />
              <div
                className="candidate-image-box"
                role={isReadOnly ? 'img' : 'button'}
                tabIndex={isReadOnly ? -1 : 0}
                onClick={() => {
                  if (isReadOnly) return;
                  const ref = fileInputRefs.current[field.field_key];
                  if (ref) ref.click();
                }}
                onKeyDown={(e) => {
                  if (isReadOnly) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const ref = fileInputRefs.current[field.field_key];
                    if (ref) ref.click();
                  }
                }}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
              >
                {imageUrl ? (
                  <img src={imageUrl} alt={field.field_label || 'Uploaded file'} />
                ) : (
                  <span className="candidate-image-empty">📷 Click to upload</span>
                )}
              </div>
              {!isReadOnly && (
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
              )}
            </div>
          );
        }

        if (isReadOnly) {
          return (
            <div className="file-uploaded-info">
              {hasActualFile ? (
                <FileAttachment value={formValues[field.field_key]} compact />
              ) : (
                <span className="candidate-image-empty">No file uploaded</span>
              )}
            </div>
          );
        }

        return (
          <div className="file-upload-container">
            <input
              type="file"
              id={`file-${field.field_key}`}
              className="file-input"
              accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(field, file);
              }}
              disabled={fileUploading[field.field_key]}
            />
            {(hasActualFile || pendingFile) && (
              <div className="file-uploaded-info">
                <span className="file-status-icon">Done</span>
                <span className="file-status-text">{hasActualFile ? 'File uploaded' : 'File selected (not saved yet)'}</span>
                <span className="file-path-hint">
                  {hasActualFile
                    ? formValues[field.field_key].split('/').pop()
                    : (pendingFile?.name || 'file')}
                </span>
                {hasActualFile && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <FileAttachment value={formValues[field.field_key]} compact />
                  </div>
                )}
              </div>
            )}
            {fileUploading[field.field_key] && (
              <div className="file-uploading-info">
                <span className="loading-spinner">...</span>
                <span>Uploading...</span>
              </div>
            )}
            {requiredForField && !hasActualFile && !pendingFile && (
              <small className="field-hint">Required: Please upload a file</small>
            )}
          </div>
        );
      }
      
      default:
        return null;
    }
  };

  const handleFieldChange = (fieldOrKey, value) => {
    if (isReadOnly) return;
    const field =
      typeof fieldOrKey === 'object'
        ? fieldOrKey
        : scholarshipForm?.form?.find(
            (f) => String(f.field_key) === String(fieldOrKey)
          );
    const fieldKey = typeof fieldOrKey === 'object' ? fieldOrKey.field_key : fieldOrKey;
    const nextValue = field
      ? (isPreschoolField(field) ? extractUdiseCode(value) : normalizeFieldValue(field, value))
      : value;

    // type_of_* should only apply when disability/divyangta = yes
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

    setFormValues((prev) => ({
      ...prev,
      [fieldKey]: nextValue,
    }));
  };

  const handleFileUpload = async (field, pickedFile) => {
    if (!pickedFile || isReadOnly) return;

    const file = await shrinkImageForUpload(pickedFile, {
      maxDimension:
        isPhotoField(field) || isSignatureField(field) ? PHOTO_MAX_DIMENSION : DOCUMENT_MAX_DIMENSION,
    });

    if (isPhotoField(field) || isSignatureField(field)) {
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
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setError(`File size must be less than 5MB`);
      toast.error('File size must be less than 5MB');
      return;
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/webp',
      'application/pdf'
    ];
    if (!allowedTypes.includes(file.type)) {
      setError('Only JPEG, PNG, WEBP, and PDF files are allowed');
      toast.error('Only JPEG, PNG, WEBP, and PDF files are allowed');
      return;
    }

    setFileUploading(prev => ({ ...prev, [field.field_key]: true }));
    setError('');

    // Keep selected files local; upload only on explicit Save/Submit.
    setPendingFiles((prev) => ({
      ...prev,
      [field.field_key]: { file, field_id: field.field_id },
    }));
    toast.info('File selected. It will upload when you click Save as Draft or Submit.');
    setFileUploading(prev => ({ ...prev, [field.field_key]: false }));
  };

  if (loading) {
    return (
      <div className="scholarship-form-view">
        <div className="loading-state">Loading application form...</div>
      </div>
    );
  }

  if (error && !scholarshipForm) {
    return (
      <div className="scholarship-form-view">
        {!hideBackButton && (
          <button className="back-btn" onClick={onBack}>
            {'< Back to Scholarships'}
          </button>
        )}
        <div className="error-state">{error}</div>
      </div>
    );
  }

  return (
    <div className="scholarship-form-view">
      {!hideBackButton && (
        <button className="back-btn" onClick={onBack}>
          {'< Back to Scholarships'}
        </button>
      )}

      <div className="form-container">
        <div className="form-header">
          <h2 className="form-title">{scholarshipForm.scholarship.scholarship_name}</h2>
          <p className="form-deadline">
            Last Date: {new Date(scholarshipForm.scholarship.last_date).toLocaleDateString('en-IN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
          {applicationId && (
            <div className="application-id-row">
              {/* <div className="application-id-badge">
                Application ID: {applicationDisplayId || '-'}
              </div> */}
              {/* <button
                type="button"
                className="scert-btn-secondary"
                ref={downloadPdfBtnRef}
                onClick={async () => {
                  const allFields = scholarshipForm.form || [];
                  const fieldType = (f) => String(f.field_type || '').trim().toUpperCase();
                  const isDocField = (f) => fieldType(f) !== 'FILE' || (!isPhotoField(f) && !isSignatureField(f));
                  let currentSchoolName = '-';
                  const schoolNameFieldFromForm = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['current_school_name', 'school_name', 'name of school', 'school'].some(
                      (m) => key.includes(m) || label.includes(m)
                    );
                  });
                  const formSchoolNameValue = schoolNameFieldFromForm
                    ? String(formValues[schoolNameFieldFromForm.field_key] || '').trim()
                    : '';
                  const udiseFields = allFields.filter((f) => {
                    const value = formValues[f.field_key];
                    if (!value || Array.isArray(value)) return false;
                    return isUdiseLikeField(f) && isUdiseValue(value);
                  });
                  const udiseCodes = Array.from(
                    new Set(udiseFields.map((f) => String(formValues[f.field_key]).trim()).filter(Boolean))
                  );
                  const udiseToSchoolName = {};
                  if (udiseCodes.length) {
                    const resolved = await Promise.all(
                      udiseCodes.map(async (udise) => [udise, await fetchSchoolNameByUdise(udise)])
                    );
                    resolved.forEach(([udise, schoolName]) => {
                      if (schoolName) udiseToSchoolName[udise] = schoolName;
                    });
                  }

                  if (formSchoolNameValue) {
                    if (isUdiseValue(formSchoolNameValue)) {
                      const resolved = await fetchSchoolNameByUdise(formSchoolNameValue);
                      currentSchoolName = resolved || formSchoolNameValue;
                    } else {
                      currentSchoolName = formSchoolNameValue;
                    }
                  } else {
                    try {
                      const profileData = await get('/api/student/profile', { token: auth?.token });
                      const profile = profileData?.profile || profileData || {};
                      const directSchoolName = String(
                        profile?.school_name || profile?.schoolName || profile?.school?.school_name || ''
                      ).trim();
                      if (directSchoolName) {
                        if (isUdiseValue(directSchoolName)) {
                          const resolved = await fetchSchoolNameByUdise(directSchoolName);
                          currentSchoolName = resolved || directSchoolName;
                        } else {
                          currentSchoolName = directSchoolName;
                        }
                      } else {
                        const profileUdise = String(profile?.udise_code || '').trim();
                        if (profileUdise) {
                          const resolved = await fetchSchoolNameByUdise(profileUdise);
                          currentSchoolName = resolved || profileUdise;
                        }
                      }
                    } catch {
                      currentSchoolName = '-';
                    }
                  }

                  const toLabelValue = (field, value) => {
                    const type = String(field?.field_type || '').toUpperCase();
                    const key = String(field?.field_key || '');
                    if (value === null || value === undefined || value === '') return '-';

                    if (isUdiseLikeField(field) && isUdiseValue(value)) {
                      const udise = String(value).trim();
                      return udiseToSchoolName[udise] || String(value);
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
                      const normalizedValue = normalizeWrappedDisplayValue(value);
                      const opt = (field.options || []).find(
                        (o) =>
                          String(o.option_value || '').toLowerCase() ===
                          String(normalizedValue || '').toLowerCase()
                      );
                      return opt?.option_label || String(normalizedValue);
                    }
                    if (type === 'FILE') {
                      if (value instanceof File) return value.name || 'file';
                      const p = String(value);
                      const clean = p.split('?')[0].split('#')[0];
                      const parts = clean.split('/');
                      return parts[parts.length - 1] || clean;
                    }
                    return String(normalizeWrappedDisplayValue(value));
                  };

                  const nameField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['name', 'student_name', 'candidate_name'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const fatherField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['father', 'father_name', "father's"].some((m) => key.includes(m) || label.includes(m));
                  });
                  const motherField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['mother', 'mother_name', "mother's"].some((m) => key.includes(m) || label.includes(m));
                  });
                  const classField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['class', 'standard', 'grade'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const photoField = allFields.find(isPhotoField);
                  const signatureField = allFields.find(isSignatureField);

                  const photoValue = photoField ? formValues[photoField.field_key] : '';
                  const signatureValue = signatureField ? formValues[signatureField.field_key] : '';
                  const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));

                  const safeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                  }[c]));
                  const downloadedAt = new Date().toLocaleString('en-GB');
                  const scholarshipTitle = scholarshipForm.scholarship?.scholarship_name || 'Scholarship Application';

                  const regNoField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['student_registration', 'registration_no', 'sr_no', 'sr number'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const dobField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['date_of_birth', 'dob', 'date of birth'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const sexField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['sex', 'gender'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const casteField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['caste', 'category'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const contactField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['contact', 'mobile', 'phone'].some((m) => key.includes(m) || label.includes(m));
                  });
                  const emailField = allFields.find((f) => {
                    const key = normalizeKey(f.field_key);
                    const label = normalizeKey(f.field_label);
                    return ['email'].some((m) => key.includes(m) || label.includes(m));
                  });

                  const keyFieldKeys = new Set(
                    [nameField, fatherField, motherField, classField, photoField, signatureField, regNoField, dobField, sexField, casteField, contactField, emailField, schoolNameFieldFromForm]
                      .filter(Boolean)
                      .map((f) => String(f.field_key))
                  );

                  const selectedClassValue = classField && classField.field_key
                    ? String(formValues[classField.field_key] || '').trim()
                    : '';

                  const detailRows = allFields
                    .filter((f) => !keyFieldKeys.has(String(f.field_key)))
                    .filter((f) => !(isTypeFieldKey(f.field_key) && !disabilityYes))
                    .map((f) => ({
                      label:
                        isCmScholarship &&
                        (String(f?.field_type || '').toUpperCase() === 'PRESCHOOL' ||
                          normalizeKey(f?.field_key) === 'previous_school_udise')
                          ? selectedClassValue === '6'
                            ? 'Name of school from which class 5th was passed'
                            : selectedClassValue === '9'
                              ? 'Name of school from which class 8th was passed'
                              : (f.field_label || f.field_key)
                          : (f.field_label || f.field_key),
                      value: toLabelValue(f, formValues[f.field_key]),
                    }));

                  const summaryRows = [
                    { label: 'Application ID', value: applicationDisplayId || '-' },
                    {
                      label: 'Date of Submission',
                      value: formatMaybeDate(
                        existingApplication?.submitted_at ||
                          existingApplication?.submittedAt ||
                          existingApplication?.application_submitted_at ||
                          existingApplication?.updated_at ||
                          existingApplication?.created_at
                      ),
                    },
                    { label: regNoField?.field_label || 'Student Registration No.', value: toLabelValue(regNoField, regNoField ? formValues[regNoField.field_key] : '-') },
                    { label: nameField?.field_label || 'Candidate Name', value: toLabelValue(nameField, nameField ? formValues[nameField.field_key] : '-') },
                    { label: fatherField?.field_label || "Father's Name", value: toLabelValue(fatherField, fatherField ? formValues[fatherField.field_key] : '-') },
                    { label: motherField?.field_label || "Mother's Name", value: toLabelValue(motherField, motherField ? formValues[motherField.field_key] : '-') },
                    { label: sexField?.field_label || 'Gender', value: toLabelValue(sexField, sexField ? formValues[sexField.field_key] : '-') },
                    { label: dobField?.field_label || 'Date of Birth', value: toLabelValue(dobField, dobField ? formValues[dobField.field_key] : '-') },
                    { label: casteField?.field_label || 'Caste Category', value: toLabelValue(casteField, casteField ? formValues[casteField.field_key] : '-') },
                    { label: classField?.field_label || 'Class', value: toLabelValue(classField, classField ? formValues[classField.field_key] : '-') },
                    { label: 'Current School Name', value: currentSchoolName || '-' },
                    ...((
                      /\bNMMSS\b/i.test(String(scholarship?.scholarship_name || '')) ||
                      /\bNMMS\b/i.test(String(scholarship?.scholarship_name || '')) ||
                      /\bSNSS\b/i.test(String(scholarship?.scholarship_name || '')) ||
                      /\bSSSS\b/i.test(String(scholarship?.scholarship_name || ''))
                    )
                      ? [
                          {
                            label: 'Eligibility',
                            // exam_code 1 = sits both NMMSS and SNSS/SSSS papers; exam_code 2 = SNSS/SSSS only.
                            value:
                              Number(savedExamCode ?? existingApplication?.exam_code) === 1
                                ? 'NMMSS/SNSS/SSSS'
                                : 'SNSS/SSSS',
                          },
                        ]
                      : []),
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

                    const remoteUrl = resolveFileUrl(value);
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
                }}
              >
                Download PDF
              </button> */}
            </div>
          )}
        </div>

        {isReadOnly && (
          <div className="form-success" style={{ background: 'rgba(148,163,184,0.18)', color: '#334155', border: '1px solid rgba(148,163,184,0.3)' }}>
            This application is locked for editing (submitted to School).
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <p className="form-helper-text" style={{ marginTop: '0.35rem', color: '#dc2626', fontWeight: 600 }}>
          Fields marked with red * are mandatory.
        </p>

        <form className="dynamic-form school-application-form" onSubmit={handleSubmitApplication}>
          <div className="form-fields-grid">
          {(() => {
            const visibleFields = scholarshipForm.form.filter((field) => {
              const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));
              const showCasteCertificate = isScStSelected(formValues, scholarshipForm.form);
              if (isTypeFieldKey(field.field_key) && !disabilityYes) {
                return false;
              }
              // NMMSS decides its own document set from the exam code.
              const nmmssRule = nmmssDocRule(field, formValues, scholarshipForm.form);
              if (nmmssRule !== null) return nmmssRule;
              if (isCasteCertificateField(field) && !showCasteCertificate) {
                return false;
              }
              // The Divyangta certificate only exists for candidates who answered Yes.
              if (isDivyangtaCertificateDoc(field) && !disabilityYes) return false;
              return true;
            });

            // Filter fields by step: Step 1 = non-FILE fields + photo/signature, Step 2 = remaining FILE fields
            const fieldsForStep = visibleFields.filter((field) => {
              const fieldType = String(field.field_type || '').trim().toUpperCase();
              if (formStep === 1) {
                if (fieldType !== 'FILE') return true;
                return isPhotoField(field) || isSignatureField(field);
              }
              if (fieldType !== 'FILE') return false;
              return !isPhotoField(field) && !isSignatureField(field);
            });

            const findField = (matchers) =>
              fieldsForStep.find((f) => {
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
              photoField = fieldsForStep.find(isPhotoField);
              signatureField = fieldsForStep.find(isSignatureField);
            }

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

            const renderDynamicField = (field, keyPrefix = '') => {
              const fieldKey = normalizeKey(field?.field_key);
              const normalizedFieldLabel = normalizeKey(field?.field_label);
              const fieldType = String(field?.field_type || '').trim().toUpperCase();
              const isPreviousSchoolField =
                fieldType === 'PRESCHOOL' ||
                fieldKey === 'previous_school_udise';
              const isCmMarksheetField =
                isCmScholarship &&
                fieldType === 'FILE' &&
                (fieldKey.includes('marksheet') || normalizedFieldLabel.includes('marksheet'));
              const classValue =
                classField && classField.field_key ? String(formValues[classField.field_key] || '').trim() : '';
              const dynamicPreviousSchoolLabel =
                isCmScholarship && isPreviousSchoolField
                  ? classValue === '6'
                    ? 'Name of school from which class 5th was passed'
                    : classValue === '9'
                      ? 'Name of school from which class 8th was passed'
                      : field.field_label
                  : field.field_label;
              const dynamicLabel = isCmMarksheetField
                ? classValue === '6'
                  ? 'Marksheet of Class 5'
                  : classValue === '9'
                    ? 'Marksheet of Class 8'
                    : field.field_label
                : dynamicPreviousSchoolLabel;

              return (
                <div key={`${keyPrefix}${field.field_id}`} className="dynamic-field">
                  {(() => {
                    const requiredForLabel = isFieldRequired({
                      field,
                      values: formValues,
                      fields: scholarshipForm?.form || [],
                    });
                    return (
                  <label className="dynamic-label">
                    {dynamicLabel}
                        {requiredForLabel && <span className="required">*</span>}
                  </label>
                    );
                  })()}
                  {renderFieldInput(field)}
                </div>
              );
            };

            const rows = [];
            let currentRow = [];

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
              ? fieldsForStep
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

            for (const field of fieldsForStep.filter((f) => !excluded.has(f))) {
              if (isFullWidthField(field)) {
                flushRow();
                rows.push([field]);
                continue;
              }

              currentRow.push(field);
              if (currentRow.length === 3) flushRow();
            }

            flushRow();

            return (
              <>
                {formStep === 1 && (topLeftFields.length || topRightFields.length) && (
                  <div className="school-form-top-split">
                    <div className="school-form-top-left">
                      <div className="school-form-top-left-grid">
                        {topLeftFields.map((field) => renderDynamicField(field, 'top-left-'))}
                      </div>
                    </div>
                    <div className="school-form-top-right">
                      {topRightFields.map((field) => (
                        <div
                          key={`top-right-${field.field_id}`}
                          className={`school-form-top-media-field ${isPhotoField(field) ? 'top-photo-field' : ''} ${isSignatureField(field) ? 'top-signature-field' : ''}`}
                        >
                          {renderDynamicField(field)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Radio groups and document uploads share lines - see utils/formRows.js */}
                {packFormRows(rows, rowKinds).map((row, idx) => (
                  <div key={`form-row-${idx}`} className={formRowClassName(row)}>
                    {row.fields.map((field) => renderDynamicField(field))}
                  </div>
                ))}
              </>
            );
          })()}
          </div>

          <div className="form-actions">
            {formStep === 2 && (
              <button
                type="button"
                className="back-step-btn"
                onClick={() => setFormStep(1)}
                disabled={submitting}
              >
                {'< Back to Step 1'}
              </button>
            )}
            {!isReadOnly && formStep === 2 && (
              <button
                type="button"
                className="save-draft-btn"
                onClick={handleSaveAnswers}
                disabled={isReadOnly || saving || submitting}
              >
                {isReadOnly ? 'Save disabled' : saving ? 'Saving...' : 'Save as Draft'}
              </button>
            )}
            <button
              type="submit"
              className="form-submit-btn"
              disabled={(isReadOnly && formStep === 2) || saving || submitting}
            >
              {formStep === 1
                ? (isReadOnly ? 'Uploads' : 'Next: Step 2')
                : (isReadOnly ? 'Submit disabled' : submitting ? 'Submitting...' : 'Submit Application')}
            </button>
          </div>
        </form>
      </div>

      <PrimarySchoolSelectorModal
        isOpen={schoolSelectorOpen}
        onClose={() => {
          setSchoolSelectorOpen(false);
          setCurrentSchoolField(null);
        }}
        onSelect={(school) => {
          if (currentSchoolField) {
            handleFieldChange(currentSchoolField, school);
            setPreschoolLabels((prev) => ({
              ...prev,
              [currentSchoolField.field_key]: `${school.school_name} (UDISE: ${school.udise_code})`,
            }));
          }
        }}
        currentValue={
          currentSchoolField
            ? (preschoolLabels[currentSchoolField.field_key] || formValues[currentSchoolField.field_key])
            : null
        }
      />
    </div>
  );
}
