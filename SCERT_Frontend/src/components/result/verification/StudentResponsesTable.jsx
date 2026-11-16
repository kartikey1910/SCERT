import { useCallback, useEffect, useState } from 'react';
import { getStudentResponses } from '../../../api/result.api';
import { VerificationPager } from './VerificationPager';

const inputStyle = {
  padding: '10px 14px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  width: '100%',
  maxWidth: '220px',
  fontSize: '14px',
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

const LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;

export function StudentResponsesTable({ session_id, scholarship_id, classValue, refreshTrigger }) {
  const [data, setData] = useState({ rows: [], total: 0, papers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rollInput, setRollInput] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [paperCode, setPaperCode] = useState('');
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const [page, setPage] = useState(1);

  const canQuery = Boolean(session_id && scholarship_id && classValue);

  // A roll-number search fires a fresh scoped query per keystroke, so it is
  // debounced rather than filtering an already-fetched page client-side.
  useEffect(() => {
    const timer = setTimeout(() => setRollNumber(rollInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rollInput]);

  const fetchData = useCallback(async () => {
    if (!canQuery) return;
    setLoading(true);
    setError('');
    try {
      const res = await getStudentResponses({
        session_id, scholarship_id, class: classValue,
        paper_code: paperCode || undefined,
        roll_number: rollNumber || undefined,
        only_invalid: onlyInvalid || undefined,
        page, limit: LIMIT,
      });
      setData({ rows: res?.rows || [], total: res?.total || 0, papers: res?.papers || [] });
    } catch (err) {
      setError(err.message || 'Could not load student responses.');
      setData({ rows: [], total: 0, papers: [] });
    } finally {
      setLoading(false);
    }
  }, [canQuery, session_id, scholarship_id, classValue, paperCode, rollNumber, onlyInvalid, page]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  useEffect(() => { setPage(1); }, [paperCode, rollNumber, onlyInvalid, session_id, scholarship_id, classValue]);

  if (!canQuery) {
    return (
      <div style={{ padding: '20px', color: '#6b7280' }}>
        Select a session, scholarship and class to view student responses.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by roll number…"
          value={rollInput}
          onChange={(e) => setRollInput(e.target.value)}
          style={inputStyle}
        />
        <select value={paperCode} onChange={(e) => setPaperCode(e.target.value)} style={inputStyle}>
          <option value="">All papers</option>
          {data.papers.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151' }}>
          <input type="checkbox" checked={onlyInvalid} onChange={(e) => setOnlyInvalid(e.target.checked)} />
          Score mismatches only
        </label>
      </div>

      {error && <div style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}

      <div style={{ ...tableContainerStyle, maxHeight: '600px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Roll Number</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Paper</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Question</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Marked</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Result</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Score check</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ ...tdStyle, textAlign: 'center' }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan="6" style={{ ...tdStyle, textAlign: 'center' }}>No responses match this filter.</td></tr>
            ) : (
              data.rows.map((row, idx) => (
                <tr key={`${row.roll_number}-${row.paper_code}-${row.question_number}-${idx}`}>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.roll_number}</td>
                  <td style={tdStyle}>{row.paper_code}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>
                    Q{String(row.question_number).padStart(3, '0')}
                  </td>
                  <td style={tdStyle}>{row.marked_answer || '—'}</td>
                  <td style={tdStyle}>
                    {row.is_correct
                      ? <span style={{ color: '#10b981', fontWeight: 600 }}>Correct</span>
                      : <span style={{ color: '#ef4444', fontWeight: 600 }}>Incorrect</span>}
                  </td>
                  <td style={tdStyle}>
                    {row.score_validated
                      ? <span style={{ color: '#10b981', background: '#d1fae5', padding: '3px 8px', borderRadius: '4px', fontSize: '12px' }}>Matches sheet</span>
                      : <span style={{ color: '#ef4444', background: '#fee2e2', padding: '3px 8px', borderRadius: '4px', fontSize: '12px' }}>Mismatch</span>}
                  </td>
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
