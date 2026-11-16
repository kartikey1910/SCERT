import { useState } from 'react';
import { useAuth } from '../../AuthContext.jsx';
import { API_BASE_URL } from '../../apiClient.js';

const wrapStyle = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const buttonStyle = {
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: '10px',
  padding: '9px 16px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
};

const disabledButtonStyle = { ...buttonStyle, opacity: 0.55, cursor: 'not-allowed' };

/**
 * Downloads the full Selected Students listing (PDF or XLSX) for the
 * current session + scholarship + class + any applied filters — same
 * scope as the rest of the Selection Summary page, so switching the class
 * dropdown or a filter changes what gets downloaded without extra state
 * here.
 */
export function SelectedStudentsDownload({ sessionId, scholarshipId, classValue, filters = {} }) {
  const { auth } = useAuth();
  const [downloading, setDownloading] = useState(null); // null | 'pdf' | 'xlsx'
  const [error, setError] = useState('');

  const canDownload = Boolean(sessionId && scholarshipId && classValue);

  const handleDownload = async (format) => {
    if (!canDownload || downloading) return;
    setDownloading(format);
    setError('');

    const params = new URLSearchParams();
    params.append('session_id', sessionId);
    params.append('scholarship_id', scholarshipId);
    params.append('class', classValue);
    params.append('format', format);
    if (filters.district) params.append('district', filters.district);
    if (filters.block) params.append('block', filters.block);
    if (filters.school) params.append('school', filters.school);
    if (filters.category) params.append('category', filters.category);
    if (filters.gender) params.append('gender', filters.gender);

    try {
      const res = await fetch(`${API_BASE_URL}/api/results/selected-students/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${auth?.token}` },
      });

      if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.message) message = data.message;
        } catch {
          // response wasn't JSON — keep the generic message
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `selected_students_class${classValue}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err.message || 'Download failed. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div style={wrapStyle}>
      <button
        type="button"
        onClick={() => handleDownload('pdf')}
        disabled={!canDownload || Boolean(downloading)}
        style={!canDownload || downloading ? disabledButtonStyle : buttonStyle}
      >
        {downloading === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
      </button>
      <button
        type="button"
        onClick={() => handleDownload('xlsx')}
        disabled={!canDownload || Boolean(downloading)}
        style={!canDownload || downloading ? disabledButtonStyle : buttonStyle}
      >
        {downloading === 'xlsx' ? 'Preparing XLSX…' : 'Download XLSX'}
      </button>
      {error && <span style={{ fontSize: '12.5px', color: '#b91c1c' }}>{error}</span>}
    </div>
  );
}
