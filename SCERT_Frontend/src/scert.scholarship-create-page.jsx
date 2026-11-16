import { useState } from 'react';
import { post } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { ScertFormBuilder } from './ScertFormBuilder.jsx';

export function ScertScholarshipCreatePage({ onCreated, onCancel }) {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, sessions } = useSession();

  const [formData, setFormData] = useState({
    scholarship_name: '',
    scholarship_details: '',
    eligibility: '',
    last_date: '',
    exam_date: '',
    circular_file_path: '',
    circular_original_name: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createdScholarshipId, setCreatedScholarshipId] = useState(null);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (
      !formData.scholarship_name ||
      !formData.scholarship_details ||
      !formData.eligibility ||
      !formData.last_date
    ) {
      setError('All fields are required.');
      toast.error('All fields are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await post('/api/scert/scholarships', formData, {
        token: auth.token,
        sessionId: sessionId,
      });

      setSuccess(`Scholarship created successfully (ID: ${response.scholarship_id}).`);
      toast.success('Scholarship created successfully.');
      setCreatedScholarshipId(response.scholarship_id);
    } catch (err) {
      setError(err.message || 'Failed to create scholarship.');
      toast.error(`Failed to create scholarship: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // If scholarship created, show form builder
  if (createdScholarshipId) {
    return (
      <ScertFormBuilder
        scholarshipId={createdScholarshipId}
        onDoLater={() => {
          if (onCreated) {
            onCreated({ scholarship_id: createdScholarshipId });
          }
        }}
      />
    );
  }

  const selectedSession = sessions.find(s => s.session_id === sessionId);

  return (
    <div className="scert-page">
      <div className="scert-page-header">
        <h1 className="scert-page-title">Create New Scholarship</h1>
        <p className="scert-page-subtitle">
          Define the scholarship name, details, eligibility criteria and application deadline.
          {selectedSession && (
            <span style={{ display: 'block', marginTop: '0.5rem', fontWeight: 600, color: '#4f46e5' }}>
              Session: {selectedSession.session_name}
            </span>
          )}
        </p>
      </div>

      <form className="scert-form" onSubmit={handleSubmit}>
        <div className="scert-form-field full-width">
          <label className="scert-form-label" htmlFor="scholarship_name">
            Scholarship Name <span className="scert-form-required">*</span>
          </label>
          <input
            id="scholarship_name"
            name="scholarship_name"
            className="scert-form-input"
            placeholder="e.g. Merit Scholarship for Class 10"
            value={formData.scholarship_name}
            onChange={handleChange}
          />
        </div>

        <div className="scert-form-field full-width">
          <label className="scert-form-label" htmlFor="scholarship_details">
            Scholarship Details <span className="scert-form-required">*</span>
          </label>
          <textarea
            id="scholarship_details"
            name="scholarship_details"
            className="scert-form-textarea"
            rows="4"
            placeholder="Provide a brief description of the scholarship..."
            value={formData.scholarship_details}
            onChange={handleChange}
          />
        </div>

        <div className="scert-form-field full-width">
          <label className="scert-form-label" htmlFor="eligibility">
            Eligibility Criteria <span className="scert-form-required">*</span>
          </label>
          <textarea
            id="eligibility"
            name="eligibility"
            className="scert-form-textarea"
            rows="3"
            placeholder="Describe eligibility requirements (e.g., Marks, Class, Category...)"
            value={formData.eligibility}
            onChange={handleChange}
          />
        </div>

        <div className="scert-form-field">
          <label className="scert-form-label" htmlFor="last_date">
            Application Deadline <span className="scert-form-required">*</span>
          </label>
          <input
            id="last_date"
            name="last_date"
            type="date"
            className="scert-form-input"
            value={formData.last_date}
            onChange={handleChange}
          />
        </div>

        <div className="scert-form-field">
          <label className="scert-form-label" htmlFor="exam_date">
            Examination Date (optional)
          </label>
          <input
            id="exam_date"
            name="exam_date"
            type="date"
            className="scert-form-input"
            value={formData.exam_date}
            onChange={handleChange}
          />
        </div>

        <div className="scert-form-field full-width">
          <label className="scert-form-label" htmlFor="circular_file_path">
            Circular File (optional)
          </label>
          <input
            id="circular_file_path"
            name="circular_file_path"
            className="scert-form-input"
            placeholder="Storage path or document URL (can be set after upload)"
            value={formData.circular_file_path}
            onChange={handleChange}
          />
          <small style={{ fontSize: '0.8rem', color: '#6b7280' }}>
            This value should match where the circular document is stored in your file system or CDN.
          </small>
        </div>

        <div className="scert-form-field full-width">
          <label className="scert-form-label" htmlFor="circular_original_name">
            Circular Original Name (optional)
          </label>
          <input
            id="circular_original_name"
            name="circular_original_name"
            className="scert-form-input"
            placeholder="e.g. Scholarship_Circular_2025.pdf"
            value={formData.circular_original_name}
            onChange={handleChange}
          />
        </div>

        {error && <div className="scert-form-error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
        {success && <div className="scert-form-success" style={{ gridColumn: '1 / -1' }}>{success}</div>}

        <div className="scert-form-actions" style={{ gridColumn: '1 / -1' }}>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => onCancel && onCancel()}
          >
            Cancel
          </button>
          <button type="submit" className="scert-btn-violet" disabled={loading}>
            {loading ? 'Creating...' : 'Create Scholarship'}
          </button>
        </div>
      </form>
    </div>
  );
}
