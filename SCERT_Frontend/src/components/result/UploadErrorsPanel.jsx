import { useCallback, useEffect, useState } from 'react';
import { getResultUploadErrors } from '../../api/result.api.js';

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
  UNMATCHED_ROLL: '#b45309',
  DUPLICATE_ROLL: '#b45309',
  MISSING_ROLL: '#b45309',
  MISSING_ANSWER_KEY: '#b91c1c',
  SCORE_MISMATCH: '#b91c1c',
  BAD_VALUE: '#b45309',
  UNKNOWN_SHEET: '#6b7280',
};

const thStyle = {
  padding: '10px 14px',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  color: '#374151',
  fontWeight: 600,
  fontSize: '13px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid #f1f5f9',
  color: '#4b5563',
  fontSize: '13px',
  verticalAlign: 'top',
};

const PAGE_SIZE = 50;

export function UploadErrorsPanel({ uploadId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');

  const fetchErrors = useCallback(async () => {
    if (!uploadId) return;
    setLoading(true);
    setError('');
    try {
      const result = await getResultUploadErrors(uploadId, {
        page,
        limit: PAGE_SIZE,
        error_type: typeFilter || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err.message || 'Could not load the flagged rows.');
    } finally {
      setLoading(false);
    }
  }, [uploadId, page, typeFilter]);

  useEffect(() => { fetchErrors(); }, [fetchErrors]);

  if (!uploadId) return null;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)', padding: '16px', width: '100%',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#111827' }}>
          Flagged rows — upload #{uploadId}
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #d1d5db', background: '#fff', borderRadius: '8px',
              padding: '6px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#374151',
            }}
          >
            Close
          </button>
        )}
      </div>

      {data?.by_type?.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0' }}>
          <button
            type="button"
            onClick={() => { setTypeFilter(''); setPage(1); }}
            style={{
              border: `1px solid ${typeFilter === '' ? '#7c3aed' : '#e5e7eb'}`,
              background: typeFilter === '' ? '#f5f3ff' : '#fff',
              color: '#374151', borderRadius: '999px', padding: '5px 12px',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            All ({data.total})
          </button>
          {data.by_type.map((entry) => (
            <button
              key={entry.error_type}
              type="button"
              onClick={() => { setTypeFilter(entry.error_type); setPage(1); }}
              style={{
                border: `1px solid ${typeFilter === entry.error_type ? '#7c3aed' : '#e5e7eb'}`,
                background: typeFilter === entry.error_type ? '#f5f3ff' : '#fff',
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

      {loading && <p style={{ color: '#6b7280', fontSize: '13px' }}>Loading flagged rows…</p>}
      {error && <p style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</p>}

      {!loading && !error && data && (
        data.errors.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: '13px' }}>No flagged rows for this upload.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '10px', marginTop: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Sheet</th>
                    <th style={thStyle}>Row</th>
                    <th style={thStyle}>Roll number</th>
                    <th style={thStyle}>Issue</th>
                    <th style={thStyle}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((row) => (
                    <tr key={row.error_id}>
                      <td style={tdStyle}>{row.sheet_name || '—'}</td>
                      <td style={tdStyle}>{row.row_number ?? '—'}</td>
                      <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.roll_number || '—'}</td>
                      <td style={{ ...tdStyle, color: ERROR_TONES[row.error_type] || '#4b5563', fontWeight: 600 }}>
                        {ERROR_LABELS[row.error_type] || row.error_type}
                      </td>
                      <td style={tdStyle}>{row.error_detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{
                    border: '1px solid #d1d5db', background: '#fff', borderRadius: '8px',
                    padding: '6px 12px', fontSize: '13px', cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    opacity: page <= 1 ? 0.5 : 1,
                  }}
                >
                  Previous
                </button>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={{
                    border: '1px solid #d1d5db', background: '#fff', borderRadius: '8px',
                    padding: '6px 12px', fontSize: '13px', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                    opacity: page >= totalPages ? 0.5 : 1,
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
