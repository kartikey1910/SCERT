import { useState, useEffect } from 'react';
import { HiOutlinePencil, HiOutlineCheckCircle, HiOutlineXCircle } from 'react-icons/hi';
import { get, put, buildApiUrl, API_BASE_URL } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { ScertFormBuilder } from './ScertFormBuilder.jsx';
import { useToast } from './ToastContext.jsx';

export function ScertScholarshipDetails({ scholarshipId, onBack }) {
  const { auth } = useAuth();
  const { sessionId, sessions } = useSession();
  const toast = useToast();
  const [scholarship, setScholarship] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [targetStatus, setTargetStatus] = useState(null);
  const [working, setWorking] = useState(false);
  const [editFormData, setEditFormData] = useState({});

  const isImageInstructions = (str) => {
    if (!str) return false;
    const parts = str.split(',');
    return parts[0].trim().startsWith('/api/uploads/') || parts[0].trim().startsWith('/uploads/') || parts[0].trim().startsWith('cms-private/');
  };

  const getInstructionsImageUrl = (str) => {
    if (!str) return '';
    if (str.startsWith('cms-private/')) {
      const parts = str.split('/');
      if (parts.length >= 4) {
        return `${API_BASE_URL}/api/public/cms-files/${parts[1]}/${parts[2]}/${parts.slice(3).join('/')}`;
      }
    }
    return `${API_BASE_URL}${str.replace('/api/uploads/', '/uploads/')}`;
  };

  useEffect(() => {
    fetchScholarshipDetails();
  }, [scholarshipId]);

  const fetchScholarshipDetails = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError('');
    try {
      const data = await get(`/api/scert/scholarships/${scholarshipId}`, { 
        token: auth.token,
        sessionId: sessionId
      });
      setScholarship(data);
      setEditFormData({
        scholarship_name: data.scholarship_name || '',
        scholarship_details: data.scholarship_details || '',
        eligibility: data.eligibility || '',
        last_date: data.last_date ? data.last_date.split('T')[0] : '',
        exam_date: data.exam_date ? data.exam_date.split('T')[0] : '',
        exam_instructions: data.exam_instructions || '',
        mat_start_time: data.mat_start_time || '',
        mat_end_time: data.mat_end_time || '',
        sat_start_time: data.sat_start_time || '',
        sat_end_time: data.sat_end_time || '',
      });
    } catch (err) {
      setError(err.message || 'Failed to load scholarship details');
      toast.error(`Failed to load scholarship details: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async () => {
    if (!targetStatus) return;
    
    setWorking(true);
    try {
      await put(
        `/api/scert/scholarships/${scholarshipId}/status`,
        { status: targetStatus },
        { token: auth.token, sessionId }
      );
      await fetchScholarshipDetails();
      setShowStatusModal(false);
      setTargetStatus(null);
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to update scholarship status'));
    } finally {
      setWorking(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setWorking(true);
    try {
      await put(
        `/api/scert/scholarships/${scholarshipId}`,
        editFormData,
        { token: auth.token, sessionId }
      );
      await fetchScholarshipDetails();
      setShowEditModal(false);
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to update scholarship'));
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="scert-page">
        <div className="scert-placeholder">Loading scholarship details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="scert-page">
        <button className="scert-btn-secondary" onClick={onBack}>
          ← Back to Scholarships
        </button>
        <div className="scert-form-error">{error}</div>
      </div>
    );
  }

  if (showFormBuilder) {
    return (
      <ScertFormBuilder
        scholarshipId={scholarshipId}
        onDoLater={() => {
          setShowFormBuilder(false);
          onBack();
        }}
      />
    );
  }

  return (
    <div className="scert-page">
      <div className="scert-page-header">
        <div className="scert-title-row">
          <h1 className="scert-page-title">{scholarship.scholarship_name}</h1>
          <span className={`scert-status-badge scert-status-${scholarship.status.toLowerCase()}`}>
            {scholarship.status}
          </span>
        </div>

        <div className="scert-page-header-actions">
          <button className="scert-btn-secondary" onClick={onBack}>
            ← Back to Scholarships
          </button>
          {scholarship.status !== 'ACTIVE' && (
            <button
              className="scert-btn-primary scert-btn-with-icon"
              onClick={() => {
                setTargetStatus('ACTIVE');
                setShowStatusModal(true);
              }}
            >
              <HiOutlineCheckCircle className="btn-icon" />
              Activate
            </button>
          )}
          {scholarship.status === 'ACTIVE' && (
            <button
              className="scert-btn-secondary scert-btn-with-icon"
              onClick={() => {
                setTargetStatus('INACTIVE');
                setShowStatusModal(true);
              }}
            >
              <HiOutlineXCircle className="btn-icon" />
              Deactivate
            </button>
          )}
          <button
            className="scert-btn-violet scert-btn-with-icon"
            onClick={() => setShowEditModal(true)}
          >
            <HiOutlinePencil className="btn-icon" />
            Edit Details
          </button>
          <button
            className="scert-btn-violet scert-btn-with-icon"
            onClick={() => setShowFormBuilder(true)}
          >
            <HiOutlinePencil className="btn-icon" />
            Edit Form Builder
          </button>
        </div>
      </div>

      <div className="scholarship-details-container">
        <div className="scholarship-two-column-layout">
          {/* Left Column - Form Details */}
          <div className="scholarship-left-panel">
            <h3 className="detail-section-title">Scholarship Information</h3>
            
            <div className="form-field-display">
              <label className="form-label">Scholarship Name</label>
              <div className="form-value">{scholarship.scholarship_name}</div>
            </div>

            <div className="form-field-display">
              <label className="form-label">Scholarship Details</label>
              <div className="form-value">{scholarship.scholarship_details}</div>
            </div>

            <div className="form-field-display">
              <label className="form-label">Eligibility Criteria</label>
              <div className="form-value">{scholarship.eligibility}</div>
            </div>

            <div className="form-row-display">
              <div className="form-field-display">
                <label className="form-label">Application Deadline</label>
                <div className="form-value">{new Date(scholarship.last_date).toLocaleDateString('en-IN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}</div>
              </div>

              {scholarship.exam_date && (
                <div className="form-field-display">
                  <label className="form-label">Examination Date</label>
                  <div className="form-value">{new Date(scholarship.exam_date).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}</div>
                </div>
              )}
            </div>

            {(scholarship.mat_start_time || scholarship.mat_end_time) && (
              <div className="form-row-display">
                <div className="form-field-display">
                  <label className="form-label">MAT Start Time</label>
                  <div className="form-value">{scholarship.mat_start_time || '—'}</div>
                </div>

                <div className="form-field-display">
                  <label className="form-label">MAT End Time</label>
                  <div className="form-value">{scholarship.mat_end_time || '—'}</div>
                </div>
              </div>
            )}

            {(scholarship.sat_start_time || scholarship.sat_end_time) && (
              <div className="form-row-display">
                <div className="form-field-display">
                  <label className="form-label">SAT Start Time</label>
                  <div className="form-value">{scholarship.sat_start_time || '—'}</div>
                </div>

                <div className="form-field-display">
                  <label className="form-label">SAT End Time</label>
                  <div className="form-value">{scholarship.sat_end_time || '—'}</div>
                </div>
              </div>
            )}

            {scholarship.session_id && (
              <div className="form-field-display">
                <label className="form-label">Academic Session</label>
                <div className="form-value">{sessions.find(s => s.session_id === scholarship.session_id)?.session_name || scholarship.session_id}</div>
              </div>
            )}

            {scholarship.circular_file_path && (
              <div className="form-field-display">
                <label className="form-label">Circular File</label>
                <div className="form-value">{scholarship.circular_original_name || scholarship.circular_file_path}</div>
              </div>
            )}

            <div className="form-field-display">
              <label className="form-label">Created On</label>
              <div className="form-value">{new Date(scholarship.created_at).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}</div>
            </div>
          </div>

          {/* Right Column - Exam Instructions */}
          <div className="scholarship-right-panel">
            <h3 className="detail-section-title">Exam Instructions</h3>
            <div className="exam-instructions-display">
              {scholarship.exam_instructions ? (
                isImageInstructions(scholarship.exam_instructions) ? (
                  <div className="form-value" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {scholarship.exam_instructions.split(',').map((img, idx) => (
                      <img 
                        key={idx}
                        src={getInstructionsImageUrl(img.trim())} 
                        alt={`Instructions ${idx + 1}`} 
                        style={{ maxWidth: '100%', height: 'auto', border: '1px solid #ddd', borderRadius: '4px' }} 
                      />
                    ))}
                  </div>
                ) : (
                  <div className="form-value" style={{ whiteSpace: 'pre-wrap' }}>{scholarship.exam_instructions}</div>
                )
              ) : (
                <div className="empty-instructions">No exam instructions provided</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Confirmation Modal */}
      {showStatusModal && (
        <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {targetStatus === 'ACTIVE' ? 'Activate Scholarship?' : 'Deactivate Scholarship?'}
            </h3>
            <p className="modal-message">
              {targetStatus === 'ACTIVE'
                ? 'This will make the scholarship available for applications. Are you sure?'
                : 'This will prevent new applications. Existing applications will not be affected. Are you sure?'}
            </p>
            <div className="modal-actions">
              <button
                className="scert-btn-secondary"
                onClick={() => setShowStatusModal(false)}
                disabled={working}
              >
                Cancel
              </button>
              <button
                className={targetStatus === 'ACTIVE' ? 'scert-btn-primary' : 'scert-btn-secondary'}
                onClick={handleStatusChange}
                disabled={working}
              >
                {working ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Scholarship Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Edit Scholarship Details</h3>
            <form onSubmit={handleEditSubmit} className="scert-form">
              <div className="form-field">
                <label className="form-label">Scholarship Name *</label>
                <input
                  type="text"
                  className="form-input"
                  value={editFormData.scholarship_name}
                  onChange={(e) => setEditFormData({ ...editFormData, scholarship_name: e.target.value })}
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label">Scholarship Details *</label>
                <textarea
                  className="form-input"
                  rows="3"
                  value={editFormData.scholarship_details}
                  onChange={(e) => setEditFormData({ ...editFormData, scholarship_details: e.target.value })}
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label">Eligibility Criteria *</label>
                <textarea
                  className="form-input"
                  rows="3"
                  value={editFormData.eligibility}
                  onChange={(e) => setEditFormData({ ...editFormData, eligibility: e.target.value })}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">Application Deadline *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={editFormData.last_date}
                    onChange={(e) => setEditFormData({ ...editFormData, last_date: e.target.value })}
                    required
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">Examination Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={editFormData.exam_date}
                    onChange={(e) => setEditFormData({ ...editFormData, exam_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">MAT Start Time</label>
                  <input
                    type="time"
                    className="form-input"
                    value={editFormData.mat_start_time}
                    onChange={(e) => setEditFormData({ ...editFormData, mat_start_time: e.target.value })}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">MAT End Time</label>
                  <input
                    type="time"
                    className="form-input"
                    value={editFormData.mat_end_time}
                    onChange={(e) => setEditFormData({ ...editFormData, mat_end_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">SAT Start Time</label>
                  <input
                    type="time"
                    className="form-input"
                    value={editFormData.sat_start_time}
                    onChange={(e) => setEditFormData({ ...editFormData, sat_start_time: e.target.value })}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">SAT End Time</label>
                  <input
                    type="time"
                    className="form-input"
                    value={editFormData.sat_end_time}
                    onChange={(e) => setEditFormData({ ...editFormData, sat_end_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Exam Instructions (Text or Image)</label>
                {isImageInstructions(editFormData.exam_instructions) ? (
                  <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {editFormData.exam_instructions.split(',').map((img, idx) => (
                      <img 
                        key={idx}
                        src={getInstructionsImageUrl(img.trim())} 
                        alt={`Instructions Preview ${idx + 1}`} 
                        style={{ maxWidth: '100%', border: '1px solid #ddd', borderRadius: '4px', display: 'block' }} 
                      />
                    ))}
                    <button type="button" className="scert-btn-secondary" onClick={() => setEditFormData({ ...editFormData, exam_instructions: '' })}>
                      Clear All Images
                    </button>
                  </div>
                ) : (
                  <textarea
                    className="form-input"
                    rows="5"
                    value={editFormData.exam_instructions}
                    onChange={(e) => setEditFormData({ ...editFormData, exam_instructions: e.target.value })}
                    placeholder="Enter exam instructions, rules, and guidelines... OR upload an image below."
                  />
                )}
                
                <div style={{ marginTop: '10px' }}>
                  <label className="scert-btn-secondary scert-btn-with-icon" style={{ cursor: working ? 'not-allowed' : 'pointer', display: 'inline-flex' }}>
                    <input 
                      type="file" 
                      accept="image/*" 
                      multiple
                      style={{ display: 'none' }}
                      disabled={working}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files);
                        if (!files.length) return;
                        
                        setWorking(true);
                        try {
                          const uploadedPaths = [];
                          for (let file of files) {
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('page_name', 'home');
                            formData.append('section_name', 'exam_instructions');
                            
                            const res = await fetch(buildApiUrl('/api/scert/cms/upload-file'), {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${auth.token}` },
                              body: formData
                            });
                            if (!res.ok) throw new Error('Upload failed');
                            const data = await res.json();
                            const path = data.file_path || data.url || data.filePath;
                            if (path) uploadedPaths.push(path);
                          }
                          
                          if (uploadedPaths.length > 0) {
                            setEditFormData(prev => {
                              const current = prev.exam_instructions || '';
                              const currentArr = (isImageInstructions(current) && current) ? current.split(',') : [];
                              return { ...prev, exam_instructions: [...currentArr, ...uploadedPaths].join(',') };
                            });
                            toast.success(`${uploadedPaths.length} image(s) uploaded successfully!`);
                          }
                        } catch(err) {
                          toast.error('Image upload failed: ' + err.message);
                        } finally {
                          setWorking(false);
                          e.target.value = '';
                        }
                      }}
                    />
                    Upload Image
                  </label>
                  <div className="form-hint" style={{ marginTop: '5px', fontSize: '12px', color: '#666' }}>
                    Recommended: Upload a screenshot/image of your instructions from MS Word. This guarantees that Hindi fonts and figures are displayed perfectly on the Admit Card.
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="scert-btn-secondary"
                  onClick={() => setShowEditModal(false)}
                  disabled={working}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="scert-btn-primary"
                  disabled={working}
                >
                  {working ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
