import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
import { FileAttachment } from './FileAttachment.jsx';

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

const formatValue = (field, rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') return '—';

  const fieldType = String(field.field_type || '').toUpperCase();

  if (fieldType === 'DATE' && typeof rawValue === 'string' && rawValue.includes('T')) {
    return rawValue.slice(0, 10);
  }

  if (fieldType === 'CHECKBOX') {
    if (Array.isArray(rawValue)) return rawValue.join(', ') || '—';

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.join(', ') || '—';
          return String(parsed);
        } catch {
          // fallthrough
        }
      }

      return trimmed || '—';
    }
  }

  return String(rawValue);
};

export function SchoolApplicationViewer({ applicationId, onBack, prefetchedData = null }) {
  const { auth } = useAuth();
  const dashboard = useDashboard();
  const selectedSessionId = dashboard?.selectedSessionId;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preschoolNameByUdise, setPreschoolNameByUdise] = useState({});

  useEffect(() => {
    const fetchApplication = async () => {
      setLoading(true);
      setError('');

      try {
        const res = await get(`/api/school/applications/${applicationId}`, {
          token: auth?.token,
          sessionId: selectedSessionId,
        });

        if (!res || typeof res !== 'object') {
          throw new Error('Invalid server response while loading application');
        }

        setData(res);
      } catch (e) {
        console.error('Failed to fetch school application:', e);
        setError(e?.message || 'Failed to load application');
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    if (prefetchedData && typeof prefetchedData === 'object') {
      setData(prefetchedData);
      setError('');
      setLoading(false);
      return;
    }

    if (auth?.token && applicationId !== null && applicationId !== undefined) {
      fetchApplication();
    }
  }, [auth?.token, applicationId, selectedSessionId, prefetchedData]);

  useEffect(() => {
    const resolveSchoolNames = async () => {
      const form = Array.isArray(data?.form) ? data.form : [];
      const targetFields = form.filter((field) => {
        const fieldType = String(field?.field_type || '').toUpperCase();
        const fieldKey = normalizeKey(field?.field_key);
        return fieldType === 'PRESCHOOL' || fieldKey.includes('previous_school_udise');
      });

      const udiseCodes = Array.from(
        new Set(
          targetFields
            .map((f) => String(f?.value ?? '').trim())
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
            const resp = await get(`/api/preschools?search=${encodeURIComponent(udise)}&page=1&limit=20`, {
              token: auth?.token,
            });
            const rows = Array.isArray(resp?.data) ? resp.data : [];
            const exact = rows.find((r) => String(r?.udise_code || '').trim() === udise);
            if (exact?.school_name) resolved[udise] = exact.school_name;
          } catch {
            // best effort only
          }
        })
      );

      setPreschoolNameByUdise(resolved);
    };

    resolveSchoolNames();
  }, [data?.form, auth?.token]);

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

  if (!data) {
    return (
      <div className="application-viewer">
        <div className="error-state">No application data received.</div>
        <button type="button" className="scert-btn-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
    );
  }

  const app = data.application || {};
  const scholarship = data.scholarship || {};
  const student = data.student || {};
  const form = Array.isArray(data.form) ? data.form : [];

  const disabilityField = form.find(isDisabilityField);
  const disabilityValue = String(disabilityField?.value || '').toLowerCase();
  const disabilityYes = disabilityValue === 'yes';
  const visibleForm = disabilityYes ? form : form.filter((f) => !isTypeField(f));

  return (
    <div className="application-viewer">
      

      <div className="application-info-card">
        <div className="info-section">
          <h4 className="info-section-title">Application Information</h4>
          <div className="info-grid">
            <div className="info-item">
              <label>Application ID</label>
              <p>{window.getDisplayApplicationId(app)}</p>
            </div>
            <div className="info-item">
              <label>Status</label>
              <p>
                <span className={`status-pill status-${String(app.status || '').toLowerCase()}`}>
                  {app.status || '—'}
                </span>
              </p>
            </div>
            <div className="info-item">
              <label>Stage</label>
              <p>
                <span className="status-pill">{app.current_stage || '—'}</span>
              </p>
            </div>
            <div className="info-item">
              <label>Submitted At</label>
              <p>{app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</p>
            </div>
          </div>
        </div>

        <div className="info-section">
          <h4 className="info-section-title">Scholarship & Student</h4>
          <div className="info-grid">
            <div className="info-item">
              <label>Scholarship</label>
              <p>{scholarship.scholarship_name || '—'}</p>
            </div>
            <div className="info-item">
              <label>Student Name</label>
              <p>{student.student_name || '—'}</p>
            </div>
            <div className="info-item">
              <label>Gender</label>
              <p>{student.gender || '—'}</p>
            </div>
            <div className="info-item">
              <label>Age</label>
              <p>{student.age || '—'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="application-form-data">
        <h4 className="form-data-title">Application Form Data</h4>
        <div className="form-data-grid">
          {visibleForm.map((field) => (
            <div key={field.field_id} className="form-field-display-compact">
              <label className="form-field-label">{field.field_label}</label>
              <div className="form-field-value">
                {(() => {
                  const fieldType = String(field.field_type || '').toUpperCase();
                  const fieldKey = normalizeKey(field?.field_key);
                  const rawValue = field?.value ?? null;
                  const rawText = String(rawValue ?? '').trim();
                  const isUdiseField = fieldType === 'PRESCHOOL' || fieldKey.includes('previous_school_udise');

                  if (fieldType === 'FILE' && field.value) {
                    return <FileAttachment value={field.value} compact />;
                  }

                  if (isUdiseField && rawText && preschoolNameByUdise[rawText]) {
                    return preschoolNameByUdise[rawText];
                  }

                  return formatValue(field, field.value);
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
