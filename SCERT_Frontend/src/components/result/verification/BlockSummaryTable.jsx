import { useCallback, useEffect, useState } from 'react';
import { getResultBlockSummaryList } from '../../../api/result.api';
import { VerificationPager } from './VerificationPager';

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
  fontVariantNumeric: 'tabular-nums',
};

const statCardStyle = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '10px 16px',
  minWidth: '110px',
};

const LIMIT = 100;

export function BlockSummaryTable({ session_id, scholarship_id, classValue, refreshTrigger }) {
  const [data, setData] = useState({ rows: [], total: 0, totals: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const canQuery = Boolean(session_id && scholarship_id && classValue);

  const fetchData = useCallback(async () => {
    if (!canQuery) return;
    setLoading(true);
    setError('');
    try {
      const res = await getResultBlockSummaryList({
        session_id, scholarship_id, class: classValue, page, limit: LIMIT,
      });
      setData({ rows: res?.rows || [], total: res?.total || 0, totals: res?.totals || null });
    } catch (err) {
      setError(err.message || 'Could not load the block summary.');
      setData({ rows: [], total: 0, totals: null });
    } finally {
      setLoading(false);
    }
  }, [canQuery, session_id, scholarship_id, classValue, page]);

  useEffect(() => { fetchData(); }, [fetchData, refreshTrigger]);
  useEffect(() => { setPage(1); }, [session_id, scholarship_id, classValue]);

  if (!canQuery) {
    return (
      <div style={{ padding: '20px', color: '#6b7280' }}>
        Select a session, scholarship and class to view the block summary.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {data.totals && data.total > 0 && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Blocks</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{data.total}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Registered</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{data.totals.registered}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Present</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>{data.totals.present}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Absent</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#b45309', fontVariantNumeric: 'tabular-nums' }}>{data.totals.absent}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Selected</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#7c3aed', fontVariantNumeric: 'tabular-nums' }}>{data.totals.selected}</div>
          </div>
        </div>
      )}

      {error && <div style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}

      <div style={tableContainerStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th style={thStyle}>District</th>
              <th style={thStyle}>Block</th>
              <th style={thStyle}>Registered</th>
              <th style={thStyle}>Absent</th>
              <th style={thStyle}>Present</th>
              <th style={thStyle}>Selected</th>
              <th style={thStyle}>GEN</th>
              <th style={thStyle}>OBC</th>
              <th style={thStyle}>SC</th>
              <th style={thStyle}>ST</th>
              <th style={thStyle}>EWS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="11" style={{ ...tdStyle, textAlign: 'center' }}>Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr>
                <td colSpan="11" style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'normal' }}>
                  No block summary uploaded yet for this session, scholarship and class.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={`${row.district_name}-${row.block_name}`}>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'inherit' }}>{row.district_name}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'inherit' }}>{row.block_name}</td>
                  <td style={tdStyle}>{row.registered}</td>
                  <td style={tdStyle}>{row.absent}</td>
                  <td style={tdStyle}>{row.present}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{row.selected}</td>
                  <td style={tdStyle}>{row.selected_gen}</td>
                  <td style={tdStyle}>{row.selected_obc}</td>
                  <td style={tdStyle}>{row.selected_sc}</td>
                  <td style={tdStyle}>{row.selected_st}</td>
                  <td style={tdStyle}>{row.selected_ews}</td>
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
