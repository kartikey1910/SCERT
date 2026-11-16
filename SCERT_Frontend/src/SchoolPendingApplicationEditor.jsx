import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, post, put, del, API_BASE_URL } from './apiClient.js';
import { PrimarySchoolSelectorModal } from './PrimarySchoolSelectorModal.jsx';
import { SchoolDeclarationModal } from './SchoolDeclarationModal.jsx';
import { SchoolDeleteDraftModal } from './SchoolDeleteDraftModal.jsx';
import { SchoolBulkRejectModal } from './SchoolBulkRejectModal.jsx';
import { FileAttachment } from './FileAttachment.jsx';
import { nmmssDocumentVisibility, readCasteValue, readIncomeUnderLimit, isUploadRequired, isDivyangtaCertificateDoc } from './utils/nmmssDocumentRules.js';
import { requiredFieldsMessage, invalidValuesMessage } from './utils/formValidationMessages.js';
import { useToast } from './ToastContext.jsx';
import { packFormRows, formRowClassName, rowKinds } from './utils/formRows.js';
import { numberInputAttrs, sanitizeNumberValue } from './utils/numberInput.js';
import { HIDDEN_FILE_INPUT_STYLE } from './utils/hiddenFileInput.js';
import { shrinkImageForUpload, PHOTO_MAX_DIMENSION, DOCUMENT_MAX_DIMENSION } from './utils/shrinkImageForUpload.js';

export function SchoolPendingApplicationEditor({ applicationId, onBack, goBackOnSave = false, forceReadOnly = false }) {
  const { auth } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [markingSubmitted, setMarkingSubmitted] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [appData, setAppData] = useState(null);
  // Exam code returned by this editor's own saves. undefined = nothing saved
  // yet, so the loaded application's code applies; once a save has answered,
  // its code wins even when it is null (the server could not work one out).
  const [savedExamCode, setSavedExamCode] = useState(undefined);
  const [formValues, setFormValues] = useState({});
  const [remarkText, setRemarkText] = useState('');
  const [remarks, setRemarks] = useState([]);
  const [showAllRemarks, setShowAllRemarks] = useState(false);
  const [fileUploading, setFileUploading] = useState({});
  const [localPreviewUrls, setLocalPreviewUrls] = useState({});
  const fileInputRefs = useRef({});
  const cameraInputRefs = useRef({});
  const [schoolSelectorOpen, setSchoolSelectorOpen] = useState(false);
  const [currentSchoolField, setCurrentSchoolField] = useState(null);
  const [showDeclarationModal, setShowDeclarationModal] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [preschoolLabels, setPreschoolLabels] = useState({});
  const [preschoolNameByUdise, setPreschoolNameByUdise] = useState({});

  const isReadOnly = useMemo(() => {
    return Boolean(forceReadOnly);
  }, [forceReadOnly]);

  const stage = String(appData?.application?.current_stage || '').toUpperCase();
  const status = String(appData?.application?.status || '').toUpperCase();
  const submittedByRole = String(appData?.application?.submitted_by_role || '').toUpperCase();

  const canMarkSubmittedAtSchool = !isReadOnly && stage === 'SCHOOL' && status === 'DRAFT';
  const canForwardToBeo = !isReadOnly && stage === 'SCHOOL' && (status === 'SUBMITTED' || status === 'RETURNED');
  const canReturnToStudent = !isReadOnly && stage === 'SCHOOL' && status === 'SUBMITTED' && submittedByRole === 'STUDENT';
  // Rejecting only ever makes sense once something has actually been
  // submitted. A draft that is no longer wanted is deleted instead - see
  // canDeleteDraft below.
  const canReject = !isReadOnly && stage === 'SCHOOL' && (status === 'SUBMITTED' || status === 'RETURNED');
  const canDeleteDraft = !isReadOnly && stage === 'SCHOOL' && status === 'DRAFT';

  const preschoolUdiseCodes = useMemo(() => {
    const form = Array.isArray(appData?.form) ? appData.form : [];
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
  }, [appData?.form, formValues]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      setSuccess('');
      setSavedExamCode(undefined);

      try {
        const data = await get(`/api/school/applications/${applicationId}`, {
          token: auth?.token,
        });

        setAppData(data);
        setRemarks(Array.isArray(data.remarks) ? data.remarks : []);

        // Prefill
        const nextValues = {};
        for (const field of data.form || []) {
          let value = field.value;

          // Normalize date input
          if (String(field?.field_type || '').trim().toUpperCase() === 'DATE' && typeof value === 'string' && value.includes('T')) {
            value = value.slice(0, 10);
          }

          // Best-effort parse checkbox JSON
          if (String(field?.field_type || '').trim().toUpperCase() === 'CHECKBOX' && typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              try {
                value = JSON.parse(trimmed);
              } catch {
                // ignore
              }
            }
          }

          const fieldType = String(field.field_type || '').toUpperCase();
          let normalized = value ?? (fieldType === 'CHECKBOX' ? [] : '');
          if ((fieldType === 'TEXT' || fieldType === 'TEXTAREA' || fieldType === 'EMAIL') && typeof normalized === 'string') {
            normalized = normalized.toUpperCase();
          }
          nextValues[field.field_key] = normalized;
        }

        setFormValues(nextValues);
      } catch (e) {
        setError(e?.message || 'Failed to load application');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [applicationId, auth?.token]);

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
    return (
      key.includes('caste_certificate') ||
      (key.includes('caste') && key.includes('certificate')) ||
      label.includes('caste certificate')
    );
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
      scholarshipName: appData?.scholarship?.scholarship_name || '',
      examCode: savedExamCode !== undefined ? savedExamCode : (appData?.application?.exam_code ?? null),
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
  const getMissingRequiredFields = (fields = [], values = {}) => {
    return fields
      .filter((field) =>
        isFieldRequired({
          field,
          values,
          fields,
        })
      )
      .filter((field) => {
        const value = values[field.field_key];
        const type = String(field?.field_type || '').toUpperCase();
        if (type === 'CHECKBOX') {
          return !Array.isArray(value) || value.length === 0;
        }
        if (type === 'FILE') {
          return !value;
        }
        return value === null || value === undefined || value === '';
      })
      .map((field) => field.field_label || field.field_key);
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

  const handleFieldChange = (fieldOrKey, value) => {
    if (isReadOnly) return;
    const field =
      typeof fieldOrKey === 'object'
        ? fieldOrKey
        : appData?.form?.find((f) => String(f.field_key) === String(fieldOrKey));
    const fieldKey = typeof fieldOrKey === 'object' ? fieldOrKey.field_key : fieldOrKey;
    const nextValue = field ? normalizeFieldValue(field, value) : value;

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

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size must be less than 5MB');
      toast.error('File size must be less than 5MB');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Only JPEG, PNG, WEBP, and PDF files are allowed');
      toast.error('Only JPEG, PNG, WEBP, and PDF files are allowed');
      return;
    }

    setFileUploading(prev => ({ ...prev, [field.field_key]: true }));
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('field_id', field.field_id);

      const response = await fetch(
        `${API_BASE_URL}/api/school/applications/${applicationId}/upload-file`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${auth?.token}` },
          body: formData
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'File upload failed');
      }

      const result = await response.json();
      handleFieldChange(field.field_key, result.file_path);
      setSuccess('File uploaded successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to upload file');
      toast.error(err.message || 'Failed to upload file');
    } finally {
      setFileUploading(prev => ({ ...prev, [field.field_key]: false }));
    }
  };

  const buildAnswersPayload = () => {
    const disabilityValue = getDisabilityValue(formValues);
    const answers = [];

    for (const field of appData?.form || []) {
      const fieldKey = String(field.field_key || '');
      let value = formValues[field.field_key] ?? null;

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

    return { answers };
  };

  const handleSave = async ({ silent = false } = {}) => {
    if (isReadOnly) return false;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const invalidDigitFields = validateDigitConstrainedFields(appData?.form || [], formValues);
      if (invalidDigitFields.length > 0) {
        toast.error(invalidValuesMessage(invalidDigitFields));
        return false;
      }
      const invalidAgeFields = validateMinimumAge(appData?.form || [], formValues);
      if (invalidAgeFields.length > 0) {
        toast.error(invalidValuesMessage(invalidAgeFields));
        return false;
      }

      const payload = buildAnswersPayload();
      if (!payload.answers.length) {
        setError('Please fill at least one field before saving.');
        return false;
      }

      const saveResponse = await put(`/api/school/applications/${applicationId}/answers`, payload, {
        token: auth?.token,
      });
      if (saveResponse && 'exam_code' in saveResponse) setSavedExamCode(saveResponse.exam_code);

      if (!silent) {
        setSuccess('Saved successfully.');
      }
      if (!silent && goBackOnSave) {
        setTimeout(() => {
          onBack?.();
        }, 400);
      }

      return true;
    } catch (e) {
      setError(e?.message || 'Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleNextStep = async () => {
    if (isReadOnly) {
      setCurrentStep(2);
      return;
    }

    const canProceed = await handleSave({ silent: true });
    if (canProceed) {
      setCurrentStep(2);
    }
  };

  const handleMarkSubmittedAtSchool = async () => {
    if (!canMarkSubmittedAtSchool) return;

    setMarkingSubmitted(true);
    setError('');
    setSuccess('');

    try {
      const invalidDigitFields = validateDigitConstrainedFields(appData?.form || [], formValues);
      if (invalidDigitFields.length > 0) {
        toast.error(invalidValuesMessage(invalidDigitFields));
        return;
      }
      const invalidAgeFields = validateMinimumAge(appData?.form || [], formValues);
      if (invalidAgeFields.length > 0) {
        toast.error(invalidValuesMessage(invalidAgeFields));
        return;
      }
      const missingFields = getMissingRequiredFields(appData?.form || [], formValues);
      if (missingFields.length > 0) {
        toast.error(requiredFieldsMessage(missingFields));
        return;
      }

      // Save changes first (required)
      const payload = buildAnswersPayload();
      if (!payload.answers.length) {
        setError('Please fill at least one field before submitting.');
        return;
      }

      const saveResponse = await put(`/api/school/applications/${applicationId}/answers`, payload, {
        token: auth?.token,
      });
      if (saveResponse && 'exam_code' in saveResponse) setSavedExamCode(saveResponse.exam_code);

      try {
        await post(
          `/api/school/applications/${applicationId}/mark-submitted`,
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

      setSuccess('Application submitted. It will appear in Pending Applications.');

      setTimeout(() => {
        onBack?.();
      }, 600);
    } catch (e) {
      setError(e?.message || 'Failed to submit application');
    } finally {
      setMarkingSubmitted(false);
    }
  };

  const handleForwardToBeo = async () => {
    if (!canForwardToBeo) return;

    setForwarding(true);
    setError('');
    setSuccess('');

    try {
      const invalidDigitFields = validateDigitConstrainedFields(appData?.form || [], formValues);
      if (invalidDigitFields.length > 0) {
        toast.error(invalidValuesMessage(invalidDigitFields));
        return;
      }
      const invalidAgeFields = validateMinimumAge(appData?.form || [], formValues);
      if (invalidAgeFields.length > 0) {
        toast.error(invalidValuesMessage(invalidAgeFields));
        return;
      }
      const missingFields = getMissingRequiredFields(appData?.form || [], formValues);
      if (missingFields.length > 0) {
        toast.error(requiredFieldsMessage(missingFields));
        return;
      }

      // Save changes first (best-effort)
      const payload = buildAnswersPayload();
      if (payload.answers.length) {
        const saveResponse = await put(`/api/school/applications/${applicationId}/answers`, payload, {
          token: auth?.token,
        });
        if (saveResponse && 'exam_code' in saveResponse) setSavedExamCode(saveResponse.exam_code);
      }

      await post(`/api/school/applications/${applicationId}/submit`, {}, { token: auth?.token });
      setSuccess('Application submitted to BEO.');
      setShowDeclarationModal(false);

      setTimeout(() => {
        onBack?.();
      }, 600);
    } catch (e) {
      setError(e?.message || 'Failed to submit to BEO');
    } finally {
      setForwarding(false);
    }
  };

  const handleReturnToStudent = async () => {
    if (!canReturnToStudent) return;

    if (!remarkText.trim()) {
      setError('Please enter remarks before returning to student.');
      return;
    }

    setReturning(true);
    setError('');
    setSuccess('');

    try {
      await post(
        `/api/school/applications/${applicationId}/return`,
        { remark_text: remarkText.trim() },
        { token: auth?.token }
      );
      setSuccess('Returned to student.');

      setTimeout(() => {
        onBack?.();
      }, 600);
    } catch (e) {
      setError(e?.message || 'Failed to return to student');
    } finally {
      setReturning(false);
    }
  };

  const handleReject = async (reason) => {
    if (!canReject) return;

    setRejecting(true);
    setError('');
    setSuccess('');

    try {
      await post(
        `/api/school/applications/${applicationId}/reject`,
        { remark_text: reason },
        { token: auth?.token }
      );
      setShowRejectModal(false);
      setSuccess('Application rejected permanently.');

      setTimeout(() => {
        onBack?.();
      }, 600);
    } catch (e) {
      setError(e?.message || 'Failed to reject application');
    } finally {
      setRejecting(false);
    }
  };

  // Permanently deletes this draft. The backend refuses anything that is no
  // longer a draft, so a stale screen (someone submitted it in another tab)
  // fails cleanly instead of deleting the wrong thing.
  const handleDeleteDraft = async () => {
    if (!canDeleteDraft) return;

    setDeletingDraft(true);
    try {
      await del(`/api/school/applications/${applicationId}/draft`, { token: auth?.token });
      toast.success('Draft application deleted.');
      onBack?.();
    } catch (e) {
      toast.error(`Failed to delete draft: ${toast.getErrorMessage(e)}`);
    } finally {
      setDeletingDraft(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading) {
    return <div className="loading-state">Loading application...</div>;
  }

  if (!appData) {
    return <div className="error-state">{error || 'Application not found'}</div>;
  }

  return (
    <div className="scholarship-form-view">
      <div className="form-container">
        <div className="form-header">
          <h2 className="form-title">{appData.scholarship?.scholarship_name}</h2>
          <p className="form-deadline flex items-center gap-2">
            Student: {appData.student?.student_name || '—'} {window.renderSubmissionRoleBadge(appData.application)}
          </p>
          {isReadOnly && (
            <div
              className="form-success"
              style={{
                background: 'rgba(148,163,184,0.18)',
                color: '#334155',
                border: '1px solid rgba(148,163,184,0.3)',
              }}
            >
              This application is locked and cannot be edited.
            </div>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}
        <p className="form-helper-text" style={{ marginTop: '0.35rem', color: '#dc2626', fontWeight: 600 }}>
          Fields marked with red * are mandatory.
        </p>

        {remarks.length > 0 && (
          <div className="beo-remarks-card">
            <div className="beo-remarks-head">
              <h3 className="beo-section-title">Remarks History</h3>
              {remarks.length > 1 && (
                <button
                  type="button"
                  className="beo-remarks-toggle-btn"
                  onClick={() => setShowAllRemarks((prev) => !prev)}
                >
                  {showAllRemarks ? 'Show Latest' : `Show All (${remarks.length})`}
                </button>
              )}
            </div>
            <div className={`beo-remarks-list ${showAllRemarks ? 'is-scrollable' : ''}`}>
              {(showAllRemarks ? remarks : remarks.slice(-1)).map((remark, idx) => (
                <div key={idx} className="beo-remark-item">
                  <div className="beo-remark-header">
                    <span className="beo-remark-badge">{remark.action || 'REMARK'}</span>
                    <span className="beo-remark-stage">{remark.from_stage} → {remark.to_stage}</span>
                    <span className="beo-remark-date">{new Date(remark.created_at).toLocaleString()}</span>
                  </div>
                  <p className="beo-remark-text">{remark.remark_text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <form className="dynamic-form school-application-form" onSubmit={(e) => e.preventDefault()}>
          {(() => {
            const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));
            
            // Split form into Step 1 (non-FILE fields) and Step 2 (FILE fields only)
            const allVisibleFields = (appData.form || []).filter((field) => {
              const showCasteCertificate = isScStSelected(formValues, appData.form || []);
              if (isTypeFieldKey(field.field_key) && !disabilityYes) {
                return false;
              }
              // NMMSS decides its own document set from the exam code.
              const nmmssRule = nmmssDocRule(field, formValues, appData.form || []);
              if (nmmssRule !== null) return nmmssRule;
              if (isCasteCertificateField(field) && !showCasteCertificate) {
                return false;
              }
              // The Divyangta certificate only exists for candidates who answered Yes.
              if (isDivyangtaCertificateDoc(field) && !disabilityYes) return false;
              return true;
            });

            const step1Fields = allVisibleFields.filter((f) => {
              const type = String(f.field_type || '').toUpperCase();
              if (type !== 'FILE') return true;
              return isPhotoField(f) || isSignatureField(f);
            });
            const step2Fields = allVisibleFields.filter((f) => {
              const type = String(f.field_type || '').toUpperCase();
              if (type !== 'FILE') return false;
              return !isPhotoField(f) && !isSignatureField(f);
            });
            const fieldsToRender = currentStep === 1 ? step1Fields : step2Fields;

            const renderFieldInput = (field) => {
              const fieldType = String(field?.field_type || '').trim().toUpperCase();
              const requiredForField = isFieldRequired({
                field,
                values: formValues,
                fields: appData?.form || [],
              });
              switch (fieldType) {
                case 'TEXT':
                  return (
                    <input
                      type="text"
                      className="dynamic-input"
                      value={formValues[field.field_key] || ''}
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
                      required={requiredForField && !isReadOnly}
                      disabled={isReadOnly}
                    />
                  );

                case 'NUMBER':
                  return (
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
                        handleFieldChange(field.field_key, nextValue);
                      }}
                      required={requiredForField && !isReadOnly}
                      disabled={isReadOnly}
                    />
                  );

                case 'EMAIL':
                  return (
                    <input
                      type="email"
                      className="dynamic-input"
                      value={formValues[field.field_key] || ''}
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
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
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
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
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
                      required={requiredForField && !isReadOnly}
                      disabled={isReadOnly}
                    />
                  );

                case 'DROPDOWN':
                  return (
                    <select
                      className="dynamic-select"
                      value={formValues[field.field_key] || ''}
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
                      required={requiredForField && !isReadOnly}
                      disabled={isReadOnly}
                    >
                      <option value="">Select an option</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt.option_id} value={opt.option_value}>
                          {opt.option_label}
                        </option>
                      ))}
                    </select>
                  );

                case 'RADIO':
                  return (
                    <div className="radio-group">
                      {(field.options || []).map((opt) => (
                        <label key={opt.option_id} className="radio-label">
                          <input
                            type="radio"
                            name={field.field_key}
                            value={opt.option_value}
                            checked={formValues[field.field_key] === opt.option_value}
                            onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
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
                      {(field.options || []).map((opt) => (
                        <label key={opt.option_id} className="checkbox-label">
                          <input
                            type="checkbox"
                            value={opt.option_value}
                            checked={(formValues[field.field_key] || []).includes(opt.option_value)}
                            onChange={(e) => {
                              const current = formValues[field.field_key] || [];
                              const next = e.target.checked
                                ? [...current, opt.option_value]
                                : current.filter((v) => v !== opt.option_value);
                              handleFieldChange(field.field_key, next);
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
                          onClick={() => {
                            setCurrentSchoolField(field);
                            setSchoolSelectorOpen(true);
                          }}
                          disabled={isReadOnly}
                        >
                          {formValues[field.field_key] ? '✓ School Selected' : 'Select Previous School'}
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
                        <small className="field-hint">Required: Please select your previous school</small>
                      )}
                    </div>
                  );

                case 'FILE':
                  if (isPhotoField(field) || isSignatureField(field)) {
                    const fileValue = formValues[field.field_key];
                    const hasActual = Boolean(fileValue);
                    const previewUrl = localPreviewUrls[field.field_key];
                    const persistedUrl = hasActual ? resolveFileUrl(fileValue) : '';
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
                    const fileValue = formValues[field.field_key];
                    return (
                      <div className="file-uploaded-info">
                        {fileValue ? (
                          <FileAttachment value={fileValue} compact />
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
                      {formValues[field.field_key] && (
                        <div className="file-uploaded-info">
                          <span className="file-status-icon">✓</span>
                          <span className="file-status-text">File uploaded</span>
                          <span className="file-path-hint">
                            {typeof formValues[field.field_key] === 'string'
                              ? formValues[field.field_key].split('/').pop()
                              : (formValues[field.field_key]?.name || 'file')}
                          </span>
                          {typeof formValues[field.field_key] === 'string' && (
                            <div style={{ marginTop: '0.5rem' }}>
                              <FileAttachment value={formValues[field.field_key]} compact />
                            </div>
                          )}
                        </div>
                      )}
                      {fileUploading[field.field_key] && (
                        <div className="file-uploading-info">
                          <span className="loading-spinner">⏳</span>
                          <span>Uploading...</span>
                        </div>
                      )}
                      {requiredForField && !formValues[field.field_key] && (
                        <small className="field-hint">Required: Please upload a file</small>
                      )}
                    </div>
                  );

                default:
                  return null;
              }
            };

            const isFullWidthField = (field) => {
              const fieldType = String(field?.field_type || '').trim().toUpperCase();
              const key = String(field?.field_key || '').trim();
              const label = String(field?.field_label || '').trim().toLowerCase();

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

            const renderField = (field) => (
              <div key={field.field_id} className="dynamic-field">
                <label className="dynamic-label">
                  {(() => {
                    const fieldType = String(field?.field_type || '').trim().toUpperCase();
                    const isPreschoolField =
                      fieldType === 'PRESCHOOL' ||
                      String(field?.field_key || '').trim() === 'previous_school_udise' ||
                      String(field?.field_label || '').trim().toLowerCase() === 'previous school';

                    if (!isPreschoolField) return field.field_label;

                    const classFieldFromAll = (appData?.form || []).find((f) => {
                      const key = normalizeKey(f?.field_key);
                      const label = normalizeKey(f?.field_label);
                      return (
                        key.includes('class') ||
                        key.includes('standard') ||
                        key.includes('grade') ||
                        label.includes('class') ||
                        label.includes('standard') ||
                        label.includes('grade')
                      );
                    });
                    const classValue = classFieldFromAll
                      ? String(formValues?.[classFieldFromAll.field_key] || '').trim()
                      : '';

                    if (classValue === '6') return 'Name of school from which class 5th was passed';
                    if (classValue === '9') return 'Name of school from which class 8th was passed';
                    return 'Name of school from which class 5th or class 8th was passed';
                  })()}
                  {isFieldRequired({ field, values: formValues, fields: appData?.form || [] }) && <span className="required">*</span>}
                </label>
                {renderFieldInput(field)}
              </div>
            );

            const rows = [];
            let currentRow = [];

            const findField = (matchers) =>
              fieldsToRender.find((f) => {
                const key = normalizeKey(f.field_key);
                const label = normalizeKey(f.field_label);
                return matchers.some((m) => key.includes(m) || label.includes(m));
              });

            const nameField = findField(['name', 'student_name', 'candidate_name']);
            const fatherField = findField(['father', 'father_name', "father's"]);
            const motherField = findField(['mother', 'mother_name', "mother's"]);
            const classField = findField(['class', 'standard', 'grade']);
            const dobField = findField(['date_of_birth', 'date of birth', 'dob']);
            const studentRegistrationField = findField([
              'student_registration',
              'student registration',
              'studentregistrations',
              'studentregistration',
              'registration no',
              'registration number',
            ]);
            const sexField = findField(['sex', 'gender']);
            const casteField = findField(['caste', 'category']);
            const photoField = fieldsToRender.find(isPhotoField);
            const signatureField = fieldsToRender.find(isSignatureField);

            const topLeftBaseFields = currentStep === 1
              ? [
                nameField,
                fatherField,
                motherField,
                classField,
                dobField,
                studentRegistrationField,
              ].filter(Boolean)
              : [];

            const topRightFields = currentStep === 1
              ? [photoField, signatureField].filter(Boolean)
              : [];

            const topLeftFieldSet = new Set([...topLeftBaseFields, ...topRightFields]);
            const topLeftExtraFields = currentStep === 1
              ? fieldsToRender
                .filter((f) => !topLeftFieldSet.has(f) && !isFullWidthField(f))
                .slice(0, 4)
              : [];

            const topLeftFields = currentStep === 1
              ? [...topLeftBaseFields, ...topLeftExtraFields]
              : [];

            const excluded = currentStep === 1
              ? new Set([...topLeftFields, ...topRightFields].filter(Boolean))
              : new Set();

            const flushRow = () => {
              if (currentRow.length) {
                rows.push(currentRow);
                currentRow = [];
              }
            };

            const orderedRemainingFields = fieldsToRender.filter((f) => !excluded.has(f));

            for (let idx = 0; idx < orderedRemainingFields.length; idx++) {
              const field = orderedRemainingFields[idx];

              if (
                currentStep === 1 &&
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

            return (
              <>
                <div className="form-fields-grid">
                  {currentStep === 1 && (topLeftFields.length || topRightFields.length) && (
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

                  {/* Radio groups and document uploads share lines - see utils/formRows.js */}
                  {packFormRows(rows, rowKinds).map((row, idx) => (
                    <div key={`form-row-${idx}`} className={formRowClassName(row)}>
                      {row.fields.map((field) => renderField(field))}
                    </div>
                  ))}
                </div>

                {step2Fields.length > 0 && (
                  <div className="form-actions" style={{ marginTop: '1.5rem', justifyContent: 'center' }}>
                    {currentStep === 1 ? (
                      <button
                        type="button"
                        className="form-submit-btn"
                        onClick={handleNextStep}
                        disabled={saving || markingSubmitted || forwarding || returning}
                      >
                        {isReadOnly ? 'Uploads →' : 'Next: Step 2 - Upload Documents →'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="save-draft-btn"
                        onClick={() => setCurrentStep(1)}
                      >
                        ← Back to Step 1
                      </button>
                    )}
                  </div>
                )}
              </>
            );
          })()}

          <div className="school-verification-actions">
            <button
              type="button"
              className="save-draft-btn"
              onClick={handleSave}
              disabled={isReadOnly || saving || markingSubmitted || forwarding || returning}
            >
              {saving ? 'Saving…' : isReadOnly ? 'Save disabled' : 'Save Changes'}
            </button>

            {canMarkSubmittedAtSchool ? (
              <button
                type="button"
                className="form-submit-btn"
                onClick={handleMarkSubmittedAtSchool}
                disabled={isReadOnly || saving || markingSubmitted || forwarding || returning || rejecting}
              >
                {markingSubmitted ? 'Submitting…' : 'Submit Application'}
              </button>
            ) : (
              <button
                type="button"
                className="form-submit-btn"
                onClick={() => setShowDeclarationModal(true)}
                disabled={isReadOnly || saving || markingSubmitted || forwarding || returning || rejecting || !canForwardToBeo}
              >
                {forwarding
                  ? 'Submitting…'
                  : isReadOnly || !canForwardToBeo
                    ? 'Submit disabled'
                    : status === 'RETURNED'
                      ? 'Resubmit to BEO'
                      : 'Submit to BEO'}
              </button>
            )}

            {canReject && (
              <button
                type="button"
                className="scert-btn-danger"
                onClick={() => setShowRejectModal(true)}
                disabled={isReadOnly || saving || markingSubmitted || forwarding || returning || rejecting}
              >
                {rejecting ? 'Rejecting…' : 'Reject Application'}
              </button>
            )}

            {canDeleteDraft && (
              <button
                type="button"
                className="scert-btn-danger"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isReadOnly || saving || markingSubmitted}
              >
                Delete Application
              </button>
            )}
          </div>

          {canReturnToStudent && (
            <div className="school-return-box">
              <div className="form-field">
                <label className="form-label">Return to Student (Remarks)</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value)}
                  placeholder="Write remarks explaining why this application is being returned..."
                  disabled={returning || forwarding || markingSubmitted || saving || rejecting}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="scert-btn-secondary"
                  style={{ borderColor: '#dc2626', color: '#dc2626' }}
                  onClick={handleReturnToStudent}
                  disabled={returning || forwarding || markingSubmitted || saving || rejecting}
                >
                  {returning ? 'Returning…' : 'Return to Student'}
                </button>
              </div>
            </div>
          )}
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
            handleFieldChange(currentSchoolField.field_key, school.udise_code);
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

      <SchoolDeclarationModal
        isOpen={showDeclarationModal}
        onClose={() => setShowDeclarationModal(false)}
        onSubmit={handleForwardToBeo}
        isSubmitting={forwarding}
        scholarshipId={appData?.application?.scholarship_id}
        classValue={appData?.application?.class ?? formValues?.class}
      />

      {canDeleteDraft && (
        <SchoolDeleteDraftModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteDraft}
          isDeleting={deletingDraft}
          applicationLabel={window.getDisplayApplicationId(appData?.application)}
          studentName={appData?.student?.student_name}
        />
      )}

      {canReject && (
        <SchoolBulkRejectModal
          isOpen={showRejectModal}
          onClose={() => setShowRejectModal(false)}
          onSubmit={handleReject}
          selectedCount={1}
          isSubmitting={rejecting}
        />
      )}
    </div>
  );
}
