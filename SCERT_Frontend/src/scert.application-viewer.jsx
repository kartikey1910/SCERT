import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, post, put, API_BASE_URL } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { FileAttachment } from './FileAttachment.jsx';
import { nmmssDocumentVisibility, readCasteValue, readIncomeUnderLimit } from './utils/nmmssDocumentRules.js';

const normalizeKey = (key) => String(key || '').trim().toLowerCase();
const DISABILITY_KEYS = new Set(['disability', 'divyangta', 'disability_status', 'divyangta_status']);
const TYPE_KEYS = new Set(['type_of_disability', 'type_of_divyangta']);

const isDisabilityField = (field) => {
  const key = normalizeKey(field?.field_key);
  if (DISABILITY_KEYS.has(key)) return true;
  const label = normalizeKey(field?.field_label);
  return label.includes('disability') || label.includes('divyang');
};

const isTypeField = (field) => {
  const key = normalizeKey(field?.field_key);
  if (TYPE_KEYS.has(key)) return true;
  const label = normalizeKey(field?.field_label);
  return label.includes('type of disability') || label.includes('type of divyang');
};

export function ScertApplicationViewer({ applicationId, onBack }) {
  const { auth } = useAuth();
  const toast = useToast();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnRemark, setReturnRemark] = useState('');
  
  const [showChangeCenterModal, setShowChangeCenterModal] = useState(false);
  const [newCenterId, setNewCenterId] = useState('');
  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [blockCode, setBlockCode] = useState('');
  const [preschoolNameByUdise, setPreschoolNameByUdise] = useState({});

  useEffect(() => {
    fetchApplication();
  }, [applicationId]);

  useEffect(() => {
    const resolvePreschoolNames = async () => {
      const form = Array.isArray(application?.form) ? application.form : [];
      const udiseCodes = Array.from(
        new Set(
          form
            .filter((field) => String(field?.field_type || '').toUpperCase() === 'PRESCHOOL')
            .map((field) => String(field?.value ?? field?.answer ?? '').trim())
            .filter(Boolean)
        )
      );

      if (!udiseCodes.length) {
        setPreschoolNameByUdise({});
        return;
      }

      const resolved = {};
      await Promise.all(
        udiseCodes.map(async (udise) => {
          try {
            const resp = await get(
              `/api/preschools?search=${encodeURIComponent(udise)}&page=1&limit=20`,
              { token: auth?.token }
            );
            const rows = Array.isArray(resp?.data) ? resp.data : [];
            const exact = rows.find((r) => String(r?.udise_code || '').trim() === udise);
            if (exact?.school_name) {
              resolved[udise] = exact.school_name;
            }
          } catch {
            // best-effort lookup; keep UDISE fallback
          }
        })
      );

      setPreschoolNameByUdise(resolved);
    };

    resolvePreschoolNames();
  }, [application?.form, auth?.token]);

  const fetchApplication = async () => {
    setLoading(true);
    setError('');
    
    try {
      const data = await get(`/api/scert/applications/${applicationId}`, { 
        token: auth.token 
      });
      setApplication(data);
    } catch (err) {
      console.error('Failed to fetch application:', err);
      setError(err.message || 'Failed to load application');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm('Are you sure you want to approve this application? This action is final and will lock the application.')) {
      return;
    }

    setActionLoading(true);
    try {
      await post(`/api/scert/applications/${applicationId}/approve`, {}, { 
        token: auth.token 
      });
      toast.success('Application approved successfully!');
      onBack();
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to approve application'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!returnRemark.trim()) {
      toast.warning('Please enter a remark');
      return;
    }

    setActionLoading(true);
    try {
      await post(
        `/api/scert/applications/${applicationId}/return`,
        { remark_text: returnRemark },
        { token: auth.token }
      );
      toast.success('Application returned to BEO successfully!');
      setShowReturnModal(false);
      onBack();
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to return application'));
    } finally {
      setActionLoading(false);
    }
  };

  const fetchCentersForBlock = async (block_code, scholarship_id) => {
    if (!block_code || !scholarship_id) return;
    
    setLoadingCenters(true);
    try {
      const data = await get(
        `/api/scert/centers?scholarship_id=${scholarship_id}&block_code=${block_code}`,
        { token: auth.token }
      );
      setCenters(data.centers || []);
    } catch (err) {
      console.error('Failed to fetch centers:', err);
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingCenters(false);
    }
  };

  const handleChangeCenter = async () => {
    if (!newCenterId) {
      toast.warning('Please select a center');
      return;
    }

    setActionLoading(true);
    try {
      await put(
        `/api/scert/applications/${applicationId}/change-center`,
        { new_center_id: newCenterId },
        { token: auth.token }
      );
      toast.success('Center changed successfully!');
      setShowChangeCenterModal(false);
      fetchApplication();
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to change center'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="application-viewer">
        <div className="loading-state">Loading application...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="application-viewer">
        <div className="error-state">{error}</div>
        <button type="button" className="scert-btn-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
    );
  }

  if (!application) {
    return null;
  }

  const isLocked = application.application.is_locked;
  const canTakeAction = !isLocked && application.application.status === 'SUBMITTED';

  const formatMaybeDate = (value) => {
    if (!value) return '—';
    const str = String(value).split('T')[0];
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString('en-GB');
  };

  const resolveFileUrl = (value) => {
    if (!value) return '';
    const s = String(value).trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('/api/uploads/')) return `${API_BASE_URL}${s}`;
    if (s.startsWith('/uploads/')) return `${API_BASE_URL}/api${s}`;
    if (s.startsWith('/')) return `${API_BASE_URL}${s}`;
    return `${API_BASE_URL}/api/uploads/${s}`;
  };

  const isPhotoField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return ['photo', 'photograph', 'image', 'candidate_image', 'student_image'].some(
      (k) => key.includes(k) || label.includes(k)
    );
  };

  const isSignatureField = (field) => {
    const key = normalizeKey(field?.field_key);
    const label = normalizeKey(field?.field_label);
    return ['signature', 'sign', 'candidate_signature'].some(
      (k) => key.includes(k) || label.includes(k)
    );
  };

  const getRawValue = (field) => field?.value ?? field?.answer ?? null;
  const fullForm = Array.isArray(application.form) ? application.form : [];
  const disabilityField = fullForm.find(isDisabilityField);
  const disabilityYes = String(getRawValue(disabilityField) || '').toLowerCase() === 'yes';
  const valuesByKey = Object.fromEntries(fullForm.map((f) => [f.field_key, getRawValue(f)]));
  const visibleForm = fullForm.filter((f) => {
    if (isTypeField(f) && !disabilityYes) return false;
    // A document the NMMSS rules hide (not this exam code, not this caste
    // category, no Divyangta) is never shown - there is nothing to say
    // "No File Uploaded" about.
    const nmmssRule = nmmssDocumentVisibility({
      field: f,
      scholarshipName: application.scholarship?.scholarship_name || '',
      examCode: application.application?.exam_code ?? null,
      casteValue: readCasteValue(valuesByKey, fullForm),
      incomeUnderLimit: readIncomeUnderLimit(valuesByKey, fullForm),
      disabilityYes,
    });
    if (nmmssRule === false) return false;
    return true;
  });

  const toLabelValue = (field, rawValue) => {
    const fieldType = String(field?.field_type || '').toUpperCase();
    if (rawValue === null || rawValue === undefined || rawValue === '') return '—';

    if (fieldType === 'DATE') return formatMaybeDate(rawValue);
    if (fieldType === 'PRESCHOOL') {
      const udise = String(rawValue).trim();
      if (!udise) return '—';
      const schoolName = preschoolNameByUdise[udise];
      return schoolName ? `${schoolName} (${udise})` : `UDISE: ${udise}`;
    }
    if (fieldType === 'DROPDOWN' || fieldType === 'RADIO') {
      const opt = (field.options || []).find(
        (o) => String(o.option_value || '').toLowerCase() === String(rawValue || '').toLowerCase()
      );
      return opt?.option_label || String(rawValue);
    }
    if (fieldType === 'CHECKBOX') {
      const arr = Array.isArray(rawValue) ? rawValue : [rawValue];
      const labels = arr
        .map((v) => {
          const opt = (field.options || []).find(
            (o) => String(o.option_value || '').toLowerCase() === String(v || '').toLowerCase()
          );
          return opt?.option_label || v;
        })
        .filter(Boolean);
      return labels.length ? labels.join(', ') : '—';
    }
    return String(rawValue);
  };

  const findField = (matchers) =>
    visibleForm.find((f) => {
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
  const photoField = visibleForm.find(isPhotoField);
  const signatureField = visibleForm.find(isSignatureField);

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

  const topLeftBaseFields = [
    nameField,
    fatherField,
    motherField,
    classField,
    dobField,
    studentRegistrationField,
  ].filter(Boolean);
  const topRightFields = [photoField, signatureField].filter(Boolean);
  const topLeftFieldSet = new Set([...topLeftBaseFields, ...topRightFields]);
  const topLeftExtraFields = visibleForm
    .filter((f) => !topLeftFieldSet.has(f) && !isFullWidthField(f))
    .slice(0, 4);
  const topLeftFields = [...topLeftBaseFields, ...topLeftExtraFields];
  const excluded = new Set([...topLeftFields, ...topRightFields].filter(Boolean));

  const rows = [];
  let currentRow = [];
  const flushRow = () => {
    if (currentRow.length) {
      rows.push(currentRow);
      currentRow = [];
    }
  };

  const orderedRemainingFields = visibleForm.filter((f) => !excluded.has(f));
  for (let idx = 0; idx < orderedRemainingFields.length; idx++) {
    const field = orderedRemainingFields[idx];
    if (sexField && casteField && (field === sexField || field === casteField)) {
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
    <div className="application-viewer">
      <div className="view-header-row">
        <h3 className="view-title">Application Details</h3>
        <button type="button" className="scert-btn-secondary" onClick={onBack}>
          ← Back to List
        </button>
      </div>

      {/* Application Info */}
      <div className="application-info-card">
        <div className="info-section">
          <h4 className="info-section-title">Application Information</h4>
          <div className="info-grid">
            <div className="info-item">
              <label>Application ID</label>
              <p><span className="flex items-center gap-2">#{application.application.application_id}{window.renderSubmissionRoleBadge(application)}</span></p>
            </div>
            <div className="info-item">
              <label>Serial No</label>
              <p>{application.application.app_serial_no || '—'}</p>
            </div>
            <div className="info-item">
              <label>Status</label>
              <p>
                <span className={`status-pill status-${application.application.status.toLowerCase()}`}>
                  {application.application.status === 'SUBMITTED' && application.application.current_stage === 'SCERT' 
                    ? 'Pending' 
                    : application.application.status}
                </span>
              </p>
            </div>
            <div className="info-item">
              <label>Submitted At</label>
              <p>{new Date(application.application.submitted_at).toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="info-section">
          <h4 className="info-section-title">Scholarship & Student</h4>
          <div className="info-grid">
            <div className="info-item">
              <label>Scholarship</label>
              <p>{application.scholarship.scholarship_name}</p>
            </div>
            <div className="info-item">
              <label>Student Name</label>
              <p>{application.student.name || '—'}</p>
            </div>
            <div className="info-item">
              <label>School</label>
              <p>{application.school.name || '—'}</p>
            </div>
          </div>
        </div>

        {application.center && (
          <div className="info-section">
            <h4 className="info-section-title">Exam Center</h4>
            <div className="info-grid">
              <div className="info-item">
                <label>Center Name</label>
                <p>{application.center.center_name}</p>
              </div>
              <div className="info-item">
                <label>Superintendent</label>
                <p>{application.center.superintendent_name || '—'}</p>
              </div>
              <div className="info-item">
                <label>Contact</label>
                <p>{application.center.superintendent_mobile || '—'}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Form Data */}
      <div className="application-form-data">
        <h4 className="form-data-title">Application Form Data</h4>
        <div className="dynamic-form school-application-form">
          <div className="form-fields-grid">
            {(topLeftFields.length || topRightFields.length) && (
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
                        <div className="dynamic-field">
                          <label className="dynamic-label">{field.field_label}</label>
                          <input className="dynamic-input" value={toLabelValue(field, getRawValue(field))} readOnly disabled />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="school-form-top-right">
                  {topRightFields.map((field) => {
                    const rawValue = getRawValue(field);
                    const imageUrl = resolveFileUrl(rawValue);
                    return (
                      <div
                        key={`top-right-${field.field_id}`}
                        className={`school-form-top-media-field ${isPhotoField(field) ? 'top-photo-field' : ''} ${isSignatureField(field) ? 'top-signature-field' : ''}`}
                      >
                        <div className="dynamic-field">
                          <label className="dynamic-label">{field.field_label}</label>
                          <div className="candidate-image-box" role="img" tabIndex={-1} style={{ cursor: 'default' }}>
                            {imageUrl ? <img src={imageUrl} alt={field.field_label || 'Uploaded file'} /> : <span className="candidate-image-empty">No image uploaded</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {rows.map((rowFields, idx) => (
              <div key={`form-row-${idx}`} className={`form-row${rowFields.length === 3 ? ' candidate-form-row' : ''}`}>
                {rowFields.map((field) => {
                  const fieldType = String(field.field_type || '').toUpperCase();
                  const rawValue = getRawValue(field);
                  return (
                    <div key={field.field_id} className="dynamic-field">
                      <label className="dynamic-label">{field.field_label}</label>
                      {fieldType === 'FILE' ? (
                        rawValue ? <FileAttachment value={rawValue} compact /> : <div className="file-uploaded-info"><span className="candidate-image-empty">No File Uploaded</span></div>
                      ) : fieldType === 'TEXTAREA' ? (
                        <textarea className="dynamic-textarea" rows="4" value={toLabelValue(field, rawValue)} readOnly disabled />
                      ) : (
                        <input className="dynamic-input" value={toLabelValue(field, rawValue)} readOnly disabled />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Remarks History */}
      {application.remarks && application.remarks.length > 0 && (
        <div className="remarks-section">
          <h4 className="remarks-title">Remarks History</h4>
          {application.remarks.map((remark, idx) => (
            <div key={idx} className="remark-item">
              <div className="remark-header">
                <span className="remark-action">{remark.action}</span>
                <span className="remark-stage">{remark.from_stage} → {remark.to_stage}</span>
                <span className="remark-date">{new Date(remark.created_at).toLocaleString()}</span>
              </div>
              <div className="remark-text">{remark.remark_text}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      {canTakeAction && (
        <div className="action-buttons">
          <button
            type="button"
            className="scert-btn-violet"
            onClick={handleApprove}
            disabled={actionLoading}
          >
            Approve Application
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              // Extract block_code from school data when opening modal
              const app_block = application.school?.block_code || '';
              setBlockCode(app_block);
              setShowChangeCenterModal(true);
              if (app_block && application.scholarship?.scholarship_id) {
                fetchCentersForBlock(app_block, application.scholarship.scholarship_id);
              }
            }}
            disabled={actionLoading}
          >
            Change Center
          </button>
          <button
            type="button"
            className="scert-btn-danger"
            onClick={() => setShowReturnModal(true)}
            disabled={actionLoading}
          >
           Return to BEO
          </button>
        </div>
      )}

      {isLocked && (
        <div className="locked-message">
          🔒 This application is locked and cannot be modified.
        </div>
      )}

      {/* Return Modal */}
      {showReturnModal && (
        <div className="modal-overlay" onClick={() => setShowReturnModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Return Application to BEO</h3>
            <div className="form-field">
              <label className="form-label">Remark</label>
              <textarea
                className="form-input"
                rows="4"
                placeholder="Enter reason for returning..."
                value={returnRemark}
                onChange={(e) => setReturnRemark(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="scert-btn-danger"
                onClick={handleReturn}
                disabled={actionLoading}
              >
                {actionLoading ? 'Returning...' : 'Confirm Return'}
              </button>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => setShowReturnModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Center Modal */}
      {showChangeCenterModal && (
        <div className="modal-overlay" onClick={() => setShowChangeCenterModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Change Exam Center</h3>
            
            <div className="form-field">
              <label className="form-label">Block Code (Auto-detected)</label>
              <input
                type="text"
                className="form-input"
                value={blockCode || 'Not detected'}
                disabled
                style={{ background: '#f3f4f6', color: '#6b7280' }}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Select New Center</label>
              {loadingCenters ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: '#6b7280' }}>
                  Loading centers...
                </div>
              ) : centers.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: '#dc2626' }}>
                  No centers available for this block
                </div>
              ) : (
                <select
                  className="form-input"
                  value={newCenterId}
                  onChange={(e) => setNewCenterId(e.target.value)}
                >
                  <option value="">-- Select Center --</option>
                  {centers.map((center) => (
                    <option key={center.center_id} value={center.center_id}>
                      {center.center_name} ({center.school_name})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="scert-btn-violet"
                onClick={handleChangeCenter}
                disabled={actionLoading || !newCenterId || loadingCenters}
              >
                {actionLoading ? 'Changing...' : 'Confirm Change'}
              </button>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => {
                  setShowChangeCenterModal(false);
                  setNewCenterId('');
                  setCenters([]);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
