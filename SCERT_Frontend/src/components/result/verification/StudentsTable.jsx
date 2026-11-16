import { useCallback, useEffect, useState } from 'react';
import { getResultStudents } from '../../../api/result.api';
import { VerificationPager } from './VerificationPager';

const inputStyle = {
  padding: '10px 14px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  width: '100%',
  maxWidth: '240px',
  fontSize: '14px',
};

const tableContainerStyle = {
  width: '100%',
  overflowX: 'auto',
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  maxHeight: '640px',
};

const thStyle = {
  padding: '12px 14px',
  backgroundColor: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
  color: '#374151',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
};

const tdStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid #f1f5f9',
  color: '#4b5563',
  whiteSpace: 'nowrap',
};

const statCardStyle = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '10px 16px',
  minWidth: '110px',
};

const LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;

function Pill({ ok, okLabel, badLabel }) {
  return ok ? (
    <span style={{ color: '#10b981', background: '#d1fae5', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>{okLabel}</span>
  ) : (
    <span style={{ color: '#ef4444', background: '#fee2e2', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>{badLabel}</span>
  );
}

/**
 * Backs both the "All Students" and "Selected Students" tabs. Both source
 * sheets write into the same result_students table — SELECTED_STUDENTS
 * merges into existing rows rather than creating separate ones — so
 * "Selected Students" is this same view pinned to is_selected = TRUE.
 */
export function StudentsTable({ session_id, scholarship_id, classValue, refreshTrigger, selectedOnly }) {
  const [data, setData] = useState({ rows: [], total: 0, summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [onlyAbsent, setOnlyAbsent] = useState(false);
  const [page, setPage] = useState(1);

  const canQuery = Boolean(session_id && scholarship_id && classValue);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchData = useCallback(async () => {
    if (!canQuery) return;
    setLoading(true);
    setError('');
    try {
      const res = await getResultStudents({
        session_id, scholarship_id, class: classValue,
        search: search || undefined,
        only_selected: selectedOnly || undefined,
        only_unmatched: onlyUnmatched || undefined,
        only_absent: onlyAbsent || undefined,
        page, limit: LIMIT,
      });
      setData({ rows: res?.rows || [], total: res?.total || 0, summary: res?.summary || null });
    } catch (err) {
      setError(err.message || 'Could not load the uploaded students.');
      setData({ rows: [], total: 0, summary: null });
    } finally {
      setLoading(false);
    }
  }, [canQuery, session_id, scholarship_id, classValue, search, selectedOnly, onlyUnmatched, onlyAbsent, page]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  useEffect(() => { setPage(1); }, [search, onlyUnmatched, onlyAbsent, session_id, scholarship_id, classValue]);

  if (!canQuery) {
    return (
      <div style={{ padding: '20px', color: '#6b7280' }}>
        Select a session, scholarship and class to view uploaded students.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {data.summary && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{data.summary.total}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Selected</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#7c3aed', fontVariantNumeric: 'tabular-nums' }}>{data.summary.selected}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Matched</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>{data.summary.matched}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Absent</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#b45309', fontVariantNumeric: 'tabular-nums' }}>{data.summary.absent}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by roll number or name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={inputStyle}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151' }}>
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          Unmatched only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151' }}>
          <input type="checkbox" checked={onlyAbsent} onChange={(e) => setOnlyAbsent(e.target.checked)} />
          Absent only
        </label>
      </div>

      {error && <div style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}

      <div style={tableContainerStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
          <thead>
            <tr>
              <th style={thStyle}>Roll No.</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Father's Name</th>
              <th style={thStyle}>DOB</th>
              <th style={thStyle}>Gender</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>District</th>
              <th style={thStyle}>Block</th>
              <th style={thStyle}>School</th>
              <th style={thStyle}>MAT</th>
              <th style={thStyle}>SAT</th>
              <th style={thStyle}>Total</th>
              <th style={thStyle}>Selected</th>
              <th style={thStyle}>Attendance</th>
              <th style={thStyle}>Matched</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="15" style={{ ...tdStyle, textAlign: 'center' }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan="15" style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'normal' }}>
                  {selectedOnly
                    ? 'No selected students yet — upload the Selected Students sheet, or the All Students sheet already flags who is selected.'
                    : 'No students uploaded yet for this session, scholarship and class.'}
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.roll_number}>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.roll_number}</td>
                  <td style={tdStyle}>{row.student_name || '—'}</td>
                  <td style={tdStyle}>{row.father_name || '—'}</td>
                  <td style={tdStyle}>
                    {row.dob || (row.dob_invalid ? <span style={{ color: '#b45309' }}>invalid</span> : '—')}
                  </td>
                  <td style={tdStyle}>{row.gender || '—'}</td>
                  <td style={tdStyle}>{row.category || '—'}</td>
                  <td style={tdStyle}>{row.district_name || '—'}</td>
                  <td style={tdStyle}>{row.block_name || '—'}</td>
                  <td style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.school_name || '—'}
                  </td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.mat_marks ?? '—'}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{row.sat_marks ?? '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{row.total_marks ?? '—'}</td>
                  <td style={tdStyle}>
                    {row.is_selected
                      ? <span style={{ color: '#7c3aed', background: '#ede9fe', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>Selected</span>
                      : <span style={{ color: '#6b7280' }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    <Pill ok={!row.is_absent} okLabel="Present" badLabel="Absent" />
                  </td>
                  <td style={tdStyle}>
                    <Pill ok={row.is_matched} okLabel="Matched" badLabel="Unmatched" />
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
