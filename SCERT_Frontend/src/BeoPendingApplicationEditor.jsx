import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, put, API_BASE_URL } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { FileAttachment } from './FileAttachment.jsx';
import { packFormRows, formRowClassName, rowKinds } from './utils/formRows.js';
import { numberInputAttrs, sanitizeNumberValue } from './utils/numberInput.js';
import { nmmssDocumentVisibility, readCasteValue, readIncomeUnderLimit } from './utils/nmmssDocumentRules.js';

export function BeoPendingApplicationEditor({ applicationId, onBack, forceReadOnly = false, showRemarks = true, featureLocks = {} }) {
  const { auth } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [appData, setAppData] = useState(null);
  // Exam code returned by this editor's own saves. undefined = nothing saved
  // yet, so the loaded application's code applies; after a save, its code wins.
  const [savedExamCode, setSavedExamCode] = useState(undefined);
  const [formValues, setFormValues] = useState({});
  const [remarks, setRemarks] = useState([]);
  const [remarkIndex, setRemarkIndex] = useState(0);
  const [fileUploading, setFileUploading] = useState({});
  const [localPreviewUrls, setLocalPreviewUrls] = useState({});
  const fileInputRefs = useRef({});
  const [currentStep, setCurrentStep] = useState(1);
  const [preschoolLabels, setPreschoolLabels] = useState({});

  const normalizeKey = (key) => String(key || '').trim().toLowerCase();
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

  const isReadOnly = useMemo(() => {
    if (forceReadOnly) return true;
    const a = appData?.application;
    if (!a) return false;

    if (a.status === 'APPROVED' && featureLocks['EDIT_APPROVED_APPLICATIONS'] === false) {
      return false;
    }

    return Boolean(a.is_locked) || String(a.current_stage || '').toUpperCase() !== 'BEO';
  }, [appData, forceReadOnly, featureLocks]);

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
        const data = await get(`/api/beo/applications/${applicationId}`, {
          token: auth?.token,
        });

        setAppData(data);
        setRemarks(Array.isArray(data.remarks) ? data.remarks : []);

        const nextValues = {};
        for (const field of data.form || []) {
          let value = field.answer;

          if (field.field_type === 'DATE' && typeof value === 'string' && value.includes('T')) {
            value = value.slice(0, 10);
          }

          if (field.field_type === 'CHECKBOX' && typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
              try {
                value = JSON.parse(trimmed);
              } catch {
                // ignore invalid serialized checkbox value
              }
            }
          }

          const normalized = normalizeFieldValue(
            field,
            value ?? (field.field_type === 'CHECKBOX' ? [] : '')
          );
          nextValues[field.field_key] = normalized;
        }

        setFormValues(nextValues);
      } catch (e) {
        setError(e?.message || 'Failed to load application');
        toast.error(`Failed to load application: ${toast.getErrorMessage(e)}`);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [applicationId, auth?.token]);

  useEffect(() => {
    if (!remarks.length) {
      setRemarkIndex(0);
      return;
    }
    setRemarkIndex(remarks.length - 1);
  }, [remarks]);

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
        setPreschoolLabels({});
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

      setPreschoolLabels(nextLabels);
    };

    resolvePreschoolLabels();
  }, [preschoolUdiseCodes, auth?.token]);

  const handleFieldChange = (fieldKey, value) => {
    if (isReadOnly) return;
    const field = appData?.form?.find((f) => String(f.field_key) === String(fieldKey));
    const normalizedValue = field ? normalizeFieldValue(field, value) : value;

    setFormValues((prev) => {
      const next = { ...prev, [fieldKey]: normalizedValue };

      if (isDisabilityFieldKey(fieldKey)) {
        const disabilityValue = String(normalizedValue || '').toLowerCase();
        if (!isDisabilityYesValue(disabilityValue)) {
          next.type_of_disability = [];
          next.type_of_divyangta = [];
        }
      }

      return next;
    });
  };

  const handleFileUpload = async (field, file) => {
    if (!file || isReadOnly) return;

    if (isPhotoField(field) || isSignatureField(field)) {
      const previewUrl = URL.createObjectURL(file);
      setLocalPreviewUrls((prev) => {
        const oldUrl = prev[field.field_key];
        if (oldUrl && oldUrl !== previewUrl) {
          try {
            URL.revokeObjectURL(oldUrl);
          } catch {
            // ignore
          }
        }
        return { ...prev, [field.field_key]: previewUrl };
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

    setFileUploading((prev) => ({ ...prev, [field.field_key]: true }));
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('field_id', field.field_id);

      const response = await fetch(`${API_BASE_URL}/api/beo/applications/${applicationId}/upload-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth?.token}` },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'File upload failed');
      }

      const result = await response.json();
      handleFieldChange(field.field_key, result.file_path);
      setSuccess('File uploaded successfully');
      toast.success('File uploaded successfully');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err) {
      setError(err.message || 'Failed to upload file');
      toast.error(`Failed to upload file: ${toast.getErrorMessage(err)}`);
    } finally {
      setFileUploading((prev) => ({ ...prev, [field.field_key]: false }));
    }
  };

  const buildAnswersPayload = () => {
    const form = appData?.form || [];

    const answers = form
      .map((field) => ({
        field_id: field.field_id,
        value: formValues[field.field_key] ?? null,
      }))
      .filter(
        (ans) =>
          ans.value !== null &&
          ans.value !== '' &&
          !(Array.isArray(ans.value) && ans.value.length === 0)
      );

    const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));
    if (!disabilityYes) {
      const typeFields = form.filter((f) => isTypeFieldKey(f.field_key));
      if (typeFields.length) {
        const keep = answers.filter((a) => !typeFields.some((f) => f.field_id === a.field_id));
        for (const f of typeFields) {
          keep.push({ field_id: f.field_id, value: null });
        }
        return { answers: keep };
      }
    }

    return { answers };
  };

  const handleSave = async ({ silent = false, goBack = true } = {}) => {
    if (isReadOnly) return false;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = buildAnswersPayload();
      if (!payload.answers.length) {
        setError('Please fill at least one field before saving.');
        if (!silent) {
          toast.error('Please fill at least one field before saving.');
        }
        return false;
      }

      const saveResponse = await put(`/api/beo/applications/${applicationId}/answers`, payload, {
        token: auth?.token,
      });
      if (saveResponse && 'exam_code' in saveResponse) setSavedExamCode(saveResponse.exam_code);

      // A save can change the exam code and the display ID. When the BEO stays
      // on this page (Next step), pull the application row again so it shows
      // what is stored. Only `application` is replaced: the BEO's form values
      // are left exactly as they are.
      if (!goBack) {
        try {
          const fresh = await get(`/api/beo/applications/${applicationId}`, { token: auth?.token });
          if (fresh?.application) {
            setAppData((prev) => (prev ? { ...prev, application: fresh.application } : prev));
          }
        } catch {
          // The save already succeeded and its exam code is in use above.
        }
      }

      if (!silent) {
        setSuccess('Saved successfully.');
        toast.success('Saved successfully.');
      }

      if (goBack) {
        setTimeout(() => {
          onBack?.();
        }, 200);
      }

      return true;
    } catch (e) {
      setError(e?.message || 'Failed to save');
      if (!silent) {
        toast.error(`Failed to save: ${toast.getErrorMessage(e)}`);
      }
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

    const canProceed = await handleSave({ silent: true, goBack: false });
    if (canProceed) {
      setCurrentStep(2);
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
          {/* {onBack && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={onBack}
              >
                ← Back to Returned List
              </button>
            </div>
          )} */}
          <h2 className="form-title">{appData.scholarship?.scholarship_name}</h2>
          <p className="form-deadline flex items-center gap-2">
            Application ID: {window.getDisplayApplicationId(appData.application)} {window.renderSubmissionRoleBadge(appData.application)} • School: {appData.school?.school_name || '—'}
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

        {showRemarks && remarks.length > 0 && (
          <div className="beo-remarks-card">
            <div className="beo-remarks-single-row">
              <h3 className="beo-section-title">Remarks History</h3>
              <div className="beo-remarks-inline-content">
                <span className="beo-remark-badge">{remarks[remarkIndex]?.action || 'REMARK'}</span>
                <span className="beo-remark-stage">
                  {remarks[remarkIndex]?.from_stage} to {remarks[remarkIndex]?.to_stage}
                </span>
                <span className="beo-remark-inline-text">{remarks[remarkIndex]?.remark_text || '—'}</span>
                <span className="beo-remark-date">
                  {remarks[remarkIndex]?.created_at ? new Date(remarks[remarkIndex].created_at).toLocaleString() : '—'}
                </span>
              </div>
              <div className="beo-remarks-nav">
                <button
                  type="button"
                  className="scert-btn-secondary beo-remarks-arrow-btn"
                  onClick={() => setRemarkIndex((prev) => Math.max(0, prev - 1))}
                  disabled={remarkIndex <= 0}
                  aria-label="Previous remark"
                >
                  &#8592;
                </button>
                <span className="beo-remarks-counter">
                  {remarkIndex + 1}/{remarks.length}
                </span>
                <button
                  type="button"
                  className="scert-btn-secondary beo-remarks-arrow-btn"
                  onClick={() => setRemarkIndex((prev) => Math.min(remarks.length - 1, prev + 1))}
                  disabled={remarkIndex >= remarks.length - 1}
                  aria-label="Next remark"
                >
                  &#8594;
                </button>
              </div>
            </div>
          </div>
        )}

        <form className="dynamic-form school-application-form" onSubmit={(e) => e.preventDefault()}>
          {(() => {
            const disabilityYes = isDisabilityYesValue(getDisabilityValue(formValues));
            const allVisibleFields = (appData.form || []).filter((field) => {
              if (isTypeFieldKey(field.field_key) && !disabilityYes) return false;
              // A document the NMMSS rules hide (not this exam code, not this
              // caste category, no Divyangta) is never shown - there is
              // nothing to say "No File Uploaded" about.
              const nmmssRule = nmmssDocumentVisibility({
                field,
                scholarshipName: appData?.scholarship?.scholarship_name || '',
                examCode: savedExamCode !== undefined ? savedExamCode : (appData?.application?.exam_code ?? null),
                casteValue: readCasteValue(formValues, appData.form || []),
                incomeUnderLimit: readIncomeUnderLimit(formValues, appData.form || []),
                disabilityYes,
              });
              if (nmmssRule === false) return false;
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
              const fieldType = String(field.field_type || '').toUpperCase();

              switch (fieldType) {
                case 'TEXT':
                  return (
                    <input
                      type="text"
                      className="dynamic-input"
                      value={formValues[field.field_key] || ''}
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
                      required={field.is_required && !isReadOnly}
                      disabled={isReadOnly}
                    />
                  );
                case 'NUMBER':
                  return (
                    <input
                      type="number"
                      className="dynamic-input"
                      {...numberInputAttrs(field)}
                      value={formValues[field.field_key] || ''}
                      onChange={(e) =>
                        handleFieldChange(
                          field.field_key,
                          sanitizeNumberValue(e.target.value, field, formValues[field.field_key])
                        )
                      }
                      required={field.is_required && !isReadOnly}
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
                      required={field.is_required && !isReadOnly}
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
                      required={field.is_required && !isReadOnly}
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
                      required={field.is_required && !isReadOnly}
                      disabled={isReadOnly}
                    />
                  );
                case 'DROPDOWN':
                  return (
                    <select
                      className="dynamic-select"
                      value={formValues[field.field_key] || ''}
                      onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
                      required={field.is_required && !isReadOnly}
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
                            required={field.is_required && !isReadOnly}
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
                case 'PRESCHOOL': {
                  const udise = String(formValues[field.field_key] || '').trim();
                  const schoolName = preschoolLabels[udise];
                  return (
                    <div className="preschool-selector-container">
                      <div className="preschool-selector-row">
                        <div className="selected-school-info" style={{ width: '100%' }}>
                          <div className="selected-school-name">
                            {udise
                              ? (schoolName ? `${schoolName} (UDISE: ${udise})` : `UDISE: ${udise}`)
                              : 'No school selected'}
                          </div>
                        </div>
                      </div>
                      {field.is_required && !udise && (
                        <small className="field-hint">Required: Previous school not selected</small>
                      )}
                    </div>
                  );
                }
                case 'FILE':
                  if (isPhotoField(field) || isSignatureField(field)) {
                    const fileValue = formValues[field.field_key];
                    const previewUrl = localPreviewUrls[field.field_key];
                    const persistedUrl = fileValue ? resolveFileUrl(fileValue) : '';
                    const imageUrl = previewUrl || persistedUrl;

                    return (
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
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          ref={(el) => {
                            fileInputRefs.current[field.field_key] = el;
                          }}
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(field, file);
                          }}
                          disabled={isReadOnly || fileUploading[field.field_key]}
                        />
                        {imageUrl ? (
                          <img src={imageUrl} alt={field.field_label || 'Uploaded file'} />
                        ) : (
                          <span className="candidate-image-empty">No image uploaded</span>
                        )}
                      </div>
                    );
                  }

                  if (isReadOnly) {
                    const fileValue = formValues[field.field_key];
                    return (
                      <div className="file-uploaded-info">
                        {fileValue ? <FileAttachment value={fileValue} compact /> : <span className="candidate-image-empty">No File Uploaded</span>}
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
                          <span className="file-status-icon">OK</span>
                          <span className="file-status-text">File uploaded</span>
                          <span className="file-path-hint">
                            {typeof formValues[field.field_key] === 'string'
                              ? formValues[field.field_key].split('/').pop()
                              : formValues[field.field_key]?.name || 'file'}
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
                          <span className="loading-spinner">Loading</span>
                          <span>Uploading...</span>
                        </div>
                      )}
                    </div>
                  );
                default:
                  return null;
              }
            };

            const findField = (matchers) =>
              fieldsToRender.find((f) => {
                const key = normalizeKey(f.field_key);
                const label = normalizeKey(f.field_label);
                return matchers.some((m) => key.includes(m) || label.includes(m));
              });

            const nameField = findField(['name', 'student_name', 'candidate_name']);
            const fatherField = findField(['father', 'father_name']);
            const motherField = findField(['mother', 'mother_name']);
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

            const rows = [];
            let currentRow = [];

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
                  {field.field_label}
                  {field.is_required && <span className="required">*</span>}
                </label>
                {renderFieldInput(field)}
              </div>
            );

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
                      <button type="button" className="form-submit-btn" onClick={handleNextStep} disabled={saving}>
                        Uploads
                      </button>
                    ) : (
                      <button type="button" className="save-draft-btn" onClick={() => setCurrentStep(1)}>
                        Back to Form
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
              disabled={isReadOnly || saving}
            >
              {saving ? 'Saving...' : isReadOnly ? 'Save disabled' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
