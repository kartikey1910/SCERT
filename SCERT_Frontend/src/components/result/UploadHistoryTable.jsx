import { useCallback, useEffect, useState } from 'react';
import { listResultUploads } from '../../api/result.api';

const tableContainerStyle = {
  width: '100%',
  overflowX: 'auto',
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: '14px',
  minWidth: '900px',
};

const thStyle = {
  padding: '12px 16px',
  backgroundColor: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  color: '#374151',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 16px',
  borderBottom: '1px solid #f1f5f9',
  color: '#4b5563',
  whiteSpace: 'nowrap',
};

const linkBtnStyle = {
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: '6px',
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 600,
};

const TYPE_LABELS = {
  ALL_STUDENTS: 'All Students',
  SELECTED_STUDENTS: 'Selected Students',
  ANSWER_KEY: 'Answer Key',
  STUDENT_RESPONSES: 'Student Responses',
  BLOCK_SUMMARY: 'Block Summary',
};

const STATUS_STYLES = {
  SUCCESS: { background: '#dcfce7', color: '#166534' },
  PARTIAL: { background: '#fef3c7', color: '#92400e' },
  FAILED: { background: '#fee2e2', color: '#b91c1c' },
  PROCESSING: { background: '#e0e7ff', color: '#3730a3' },
};

function StatusPill({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.PROCESSING;
  return (
    <span style={{
      ...style, borderRadius: '999px', padding: '3px 10px',
      fontSize: '12px', fontWeight: 700, textTransform: 'capitalize',
    }}>
      {String(status || '').toLowerCase()}
    </span>
  );
}

export function UploadHistoryTable({
  refreshTrigger,
  onViewErrors,
  sessionId,
  scholarshipId,
}) {
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUploads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listResultUploads({
        session_id: sessionId || undefined,
        scholarship_id: scholarshipId || undefined,
        limit: 50,
      });
      setUploads(Array.isArray(data?.uploads) ? data.uploads : []);
    } catch (err) {
      setError(err.message || 'Could not load the upload history.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, scholarshipId]);

  useEffect(() => { fetchUploads(); }, [fetchUploads, refreshTrigger]);

  if (loading) {
    return <div style={{ padding: '20px', color: '#6b7280' }}>Loading upload history…</div>;
  }

  if (error) {
    return <div style={{ padding: '20px', color: '#b91c1c' }}>{error}</div>;
  }

  if (uploads.length === 0) {
    return (
      <div style={{
        padding: '40px 20px', textAlign: 'center', color: '#6b7280',
        background: '#f9fafb', borderRadius: '12px', border: '1px dashed #d1d5db',
      }}>
        Nothing uploaded yet for this session and scholarship.
      </div>
    );
  }

  return (
    <div style={tableContainerStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Class</th>
            <th style={thStyle}>File</th>
            <th style={thStyle}>Sheets</th>
            <th style={thStyle}>Rows</th>
            <th style={thStyle}>Matched</th>
            <th style={thStyle}>Flagged</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Action</th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((upload) => {
            const flagged = Number(upload.error_records) || 0;
            return (
              <tr key={upload.upload_id}>
                <td style={tdStyle}>{new Date(upload.created_at).toLocaleString()}</td>
                <td style={tdStyle}>{TYPE_LABELS[upload.upload_type] || upload.upload_type}</td>
                <td style={tdStyle}>{upload.class}</td>
                <td style={{ ...tdStyle, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {upload.file_name}
                </td>
                <td style={tdStyle}>
                  {Array.isArray(upload.sheet_names) && upload.sheet_names.length
                    ? upload.sheet_names.join(', ')
                    : '—'}
                </td>
                <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{upload.total_records}</td>
                <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                  {upload.matched_records ?? '—'}
                </td>
                <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                  {flagged > 0
                    ? <span style={{ color: '#b45309', fontWeight: 700 }}>{flagged}</span>
                    : <span style={{ color: '#10b981' }}>0</span>}
                </td>
                <td style={tdStyle}><StatusPill status={upload.status} /></td>
                <td style={tdStyle}>
                  {flagged > 0 && onViewErrors ? (
                    <button
                      type="button"
                      style={linkBtnStyle}
                      onClick={() => onViewErrors(upload.upload_id)}
                    >
                      View {flagged} issue{flagged === 1 ? '' : 's'}
                    </button>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
