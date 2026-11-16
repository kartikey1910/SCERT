import { useCallback, useEffect, useState } from 'react';
import { getAnswerKeys } from '../../../api/result.api';
import { VerificationPager } from './VerificationPager';

const selectStyle = {
  padding: '10px 14px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  width: '100%',
  maxWidth: '220px',
  fontSize: '14px',
  background: '#fff',
};

const tableContainerStyle = {
  width: '100%',
  overflowX: 'auto',
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
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
};

const LIMIT = 20;

export function AnswerKeysTable({ session_id, scholarship_id, classValue, refreshTrigger }) {
  const [data, setData] = useState({ rows: [], total: 0, papers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paperCode, setPaperCode] = useState('');
  const [page, setPage] = useState(1);

  const canQuery = Boolean(session_id && scholarship_id && classValue);

  const fetchData = useCallback(async () => {
    if (!canQuery) return;
    setLoading(true);
    setError('');
    try {
      const res = await getAnswerKeys({
        session_id, scholarship_id, class: classValue,
        paper_code: paperCode || undefined, page, limit: LIMIT,
      });
      setData({ rows: res?.rows || [], total: res?.total || 0, papers: res?.papers || [] });
    } catch (err) {
      setError(err.message || 'Could not load the answer keys.');
      setData({ rows: [], total: 0, papers: [] });
    } finally {
      setLoading(false);
    }
  }, [canQuery, session_id, scholarship_id, classValue, paperCode, page]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  useEffect(() => { setPage(1); }, [paperCode, session_id, scholarship_id, classValue]);

  if (!canQuery) {
    return (
      <div style={{ padding: '20px', color: '#6b7280' }}>
        Select a session, scholarship and class to view answer keys.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <select value={paperCode} onChange={(e) => setPaperCode(e.target.value)} style={selectStyle}>
        <option value="">All papers</option>
        {data.papers.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>

      {error && <div style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}

      <div style={tableContainerStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th style={thStyle}>Paper Code</th>
              <th style={thStyle}>Exam Type</th>
              <th style={thStyle}>Booklet</th>
              <th style={thStyle}>Question No.</th>
              <th style={thStyle}>Correct Answer</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" style={{ ...tdStyle, textAlign: 'center' }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ ...tdStyle, textAlign: 'center' }}>
                  No answer key uploaded yet for this session, scholarship and class.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={`${row.paper_code}-${row.question_number}`}>
                  <td style={tdStyle}>{row.paper_code}</td>
                  <td style={tdStyle}>{row.exam_type}</td>
                  <td style={tdStyle}>{row.booklet_code || '—'}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                    Q{String(row.question_number).padStart(3, '0')}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{row.correct_answer}</td>
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
