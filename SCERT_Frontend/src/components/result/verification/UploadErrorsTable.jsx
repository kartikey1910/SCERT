import { useCallback, useEffect, useState } from 'react';
import { getUploadErrors } from '../../../api/result.api';
import { VerificationPager } from './VerificationPager';

const ERROR_LABELS = {
  UNMATCHED_ROLL: 'No matching application',
  DUPLICATE_ROLL: 'Duplicate roll number',
  MISSING_ROLL: 'Missing roll number',
  MISSING_ANSWER_KEY: 'No answer key for paper',
  SCORE_MISMATCH: 'Score does not match sheet',
  BAD_VALUE: 'Inconsistent value',
  UNKNOWN_SHEET: 'Sheet skipped',
};

const ERROR_TONES = {
  MISSING_ANSWER_KEY: '#b91c1c',
  SCORE_MISMATCH: '#b91c1c',
};

const tableContainerStyle = {
  width: '100%',
  overflowX: 'auto',
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  maxHeight: '600px',
};

const thStyle = {
  padding: '12px 16px',
  backgroundColor: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  color: '#374151',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
};

const tdStyle = {
  padding: '12px 16px',
  borderBottom: '1px solid #f1f5f9',
  color: '#4b5563',
};

const LIMIT = 25;

export function UploadErrorsTable({ session_id, scholarship_id, classValue, refreshTrigger }) {
  const [data, setData] = useState({ rows: [], total: 0, by_type: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState('');
  const [page, setPage] = useState(1);

  const canQuery = Boolean(session_id && scholarship_id && classValue);

  const fetchData = useCallback(async () => {
    if (!canQuery) return;
    setLoading(true);
    setError('');
    try {
      const res = await getUploadErrors({
        session_id, scholarship_id, class: classValue,
        error_type: errorType || undefined, page, limit: LIMIT,
      });
      setData({ rows: res?.rows || [], total: res?.total || 0, by_type: res?.by_type || [] });
    } catch (err) {
      setError(err.message || 'Could not load upload errors.');
      setData({ rows: [], total: 0, by_type: [] });
    } finally {
      setLoading(false);
    }
  }, [canQuery, session_id, scholarship_id, classValue, errorType, page]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  useEffect(() => { setPage(1); }, [errorType, session_id, scholarship_id, classValue]);

  if (!canQuery) {
    return (
      <div style={{ padding: '20px', color: '#6b7280' }}>
        Select a session, scholarship and class to view upload errors.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {data.by_type.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setErrorType('')}
            style={{
              border: `1px solid ${errorType === '' ? '#7c3aed' : '#e5e7eb'}`,
              background: errorType === '' ? '#f5f3ff' : '#fff',
              color: '#374151', borderRadius: '999px', padding: '5px 12px',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            All ({data.by_type.reduce((sum, t) => sum + t.count, 0)})
          </button>
          {data.by_type.map((entry) => (
            <button
              key={entry.error_type}
              type="button"
              onClick={() => setErrorType(entry.error_type)}
              style={{
                border: `1px solid ${errorType === entry.error_type ? '#7c3aed' : '#e5e7eb'}`,
                background: errorType === entry.error_type ? '#f5f3ff' : '#fff',
                color: ERROR_TONES[entry.error_type] || '#374151',
                borderRadius: '999px', padding: '5px 12px',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {ERROR_LABELS[entry.error_type] || entry.error_type} ({entry.count})
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}

      <div style={tableContainerStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th style={thStyle}>Upload</th>
              <th style={thStyle}>Sheet</th>
              <th style={thStyle}>Row</th>
              <th style={thStyle}>Roll Number</th>
              <th style={thStyle}>Paper</th>
              <th style={thStyle}>Issue</th>
              <th style={thStyle}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ ...tdStyle, textAlign: 'center' }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan="7" style={{ ...tdStyle, textAlign: 'center' }}>No flagged rows.</td></tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.error_id}>
                  <td style={tdStyle}>#{row.upload_id} · {row.upload_type}</td>
                  <td style={tdStyle}>{row.sheet_name || '—'}</td>
                  <td style={tdStyle}>{row.row_number ?? '—'}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.roll_number || '—'}</td>
                  <td style={tdStyle}>{row.paper_code || '—'}</td>
                  <td style={{ ...tdStyle, color: ERROR_TONES[row.error_type] || '#4b5563', fontWeight: 600 }}>
                    {ERROR_LABELS[row.error_type] || row.error_type}
                  </td>
                  <td style={tdStyle}>{row.error_detail}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <VerificationPager page={page} total={data.total} limit={LIMIT} onPageChange={setPage} />
    </div>
  );
}
