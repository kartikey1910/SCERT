import { useCallback, useEffect, useState } from 'react';
import { getGeneratedScores } from '../../../api/result.api';
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

export function GeneratedScoresTable({ session_id, scholarship_id, classValue, refreshTrigger }) {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rollInput, setRollInput] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [page, setPage] = useState(1);

  const canQuery = Boolean(session_id && scholarship_id && classValue);

  useEffect(() => {
    const timer = setTimeout(() => setRollNumber(rollInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rollInput]);

  const fetchData = useCallback(async () => {
    if (!canQuery) return;
    setLoading(true);
    setError('');
    try {
      const res = await getGeneratedScores({
        session_id, scholarship_id, class: classValue,
        roll_number: rollNumber || undefined, page, limit: LIMIT,
      });
      setData({ rows: res?.rows || [], total: res?.total || 0 });
    } catch (err) {
      setError(err.message || 'Could not load the generated scores.');
      setData({ rows: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [canQuery, session_id, scholarship_id, classValue, rollNumber, page]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  useEffect(() => { setPage(1); }, [rollNumber, session_id, scholarship_id, classValue]);

  if (!canQuery) {
    return (
      <div style={{ padding: '20px', color: '#6b7280' }}>
        Select a session, scholarship and class to view generated scores.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <input
        type="text"
        placeholder="Search by roll number…"
        value={rollInput}
        onChange={(e) => setRollInput(e.target.value)}
        style={inputStyle}
      />

      {error && <div style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}

      <div style={{ ...tableContainerStyle, maxHeight: '600px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Roll Number</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>MAT Paper</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>MAT Score</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>SAT Paper</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>SAT Score</th>
              <th style={{ ...thStyle, position: 'sticky', top: 0 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ ...tdStyle, textAlign: 'center' }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ ...tdStyle, textAlign: 'center' }}>
                  No scores computed yet — upload student responses first.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.roll_number}>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.roll_number}</td>
                  <td style={tdStyle}>{row.mat_paper_code || '—'}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.mat_score ?? '—'}</td>
                  <td style={tdStyle}>{row.sat_paper_code || '—'}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.sat_score ?? '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{row.total_score ?? '—'}</td>
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
