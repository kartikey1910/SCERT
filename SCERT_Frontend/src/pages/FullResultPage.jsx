import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import {
  getFullResult,
  getFullResultFilterOptions,
  downloadFullResultFile,
} from '../api/result.api.js';

/**
 * Full Result — the exam agency's ALL DATA workbook, read back on screen.
 *
 * Columns, header spellings and values come straight from the server —
 * which derives them from the uploaded sheet itself rather than any fixed
 * layout (see services/result/fullResultSheet.js). Several column layouts
 * are in circulation, so this page deliberately renders whatever it is
 * handed instead of assuming a shape.
 */

const PAGE_SIZE = 100;

export function FullResultPage({ classValue }) {
  const {
    sessionId: selectedSessionId,
    sessionName,
    scholarships = [],
    selectedScholarshipId,
  } = useSession() || {};

  const scholarshipName = useMemo(
    () => scholarships.find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || 'Scholarship',
    [scholarships, selectedScholarshipId]
  );

  const [filters, setFilters] = useState({ district: '', block: '', school: '' });
  const [options, setOptions] = useState({ districts: [], blocks: [], schools: [] });
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Kept apart from `error`: that one means the table has no data to show,
  // so it replaces the table. An export failing says nothing about the rows
  // already on screen, and blanking them left the user with no way back
  // except reloading the page.
  const [exportError, setExportError] = useState('');
  const [downloading, setDownloading] = useState('');

  const scopeReady = Boolean(selectedSessionId && selectedScholarshipId && classValue);

  // Selecting a district invalidates any block/school chosen under the
  // previous one, so those reset rather than silently filtering to nothing.
  const changeFilter = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'district') { next.block = ''; next.school = ''; }
      if (key === 'block') { next.school = ''; }
      return next;
    });
    setPage(1);
  };

  const baseParams = useCallback(() => ({
    session_id: selectedSessionId,
    scholarship_id: selectedScholarshipId,
    class: classValue,
    district: filters.district || undefined,
    block: filters.block || undefined,
    school: filters.school || undefined,
  }), [selectedSessionId, selectedScholarshipId, classValue, filters]);

  const loadOptions = useCallback(async () => {
    if (!scopeReady) return;
    try {
      const res = await getFullResultFilterOptions({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
        class: classValue,
        district: filters.district || undefined,
        block: filters.block || undefined,
      });
      setOptions({
        districts: res?.districts || [],
        blocks: res?.blocks || [],
        schools: res?.schools || [],
      });
    } catch {
      setOptions({ districts: [], blocks: [], schools: [] });
    }
  }, [scopeReady, selectedSessionId, selectedScholarshipId, classValue, filters.district, filters.block]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const loadRows = useCallback(async () => {
    if (!scopeReady) return;
    setLoading(true);
    setError('');
    setExportError('');
    try {
      const res = await getFullResult({ ...baseParams(), page, page_size: PAGE_SIZE });
      setData(res);
    } catch (err) {
      setData(null);
      setError(err?.message || 'Unable to load the full result.');
    } finally {
      setLoading(false);
    }
  }, [scopeReady, baseParams, page]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const handleExport = async (format) => {
    if (downloading) return;
    setDownloading(format);
    setExportError('');
    try {
      const blob = await downloadFullResultFile(format, baseParams());
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const suffix = [filters.district, filters.block, filters.school]
        .filter(Boolean).join('_').replace(/[^A-Za-z0-9]+/g, '_');
      a.download = `FULL_RESULT_CLASS_${classValue}${suffix ? `_${suffix}` : ''}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err?.message || 'Download failed.');
    } finally {
      setDownloading('');
    }
  };

  if (!scopeReady) {
    return (
      <div style={styles.page}>
        <div style={styles.placeholder}>
          Please select a session and scholarship from the dropdown at the top.
        </div>
      </div>
    );
  }

  const columns = data?.columns || [];
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;
  const activeFilters = [filters.district, filters.block, filters.school].filter(Boolean).length;

  return (
    <div style={styles.page}>
      <section style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Full Result — Class {classValue}</h1>
            <p style={styles.subtitle}>
              {scholarshipName} · Session {sessionName || selectedSessionId} · the uploaded All-Data sheet, as received
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              disabled={Boolean(downloading) || total === 0}
              style={{ ...styles.exportBtn, ...(downloading || total === 0 ? styles.btnDisabled : {}) }}
            >
              {downloading === 'xlsx' ? 'Preparing…' : 'Export Excel'}
            </button>
            <button
              type="button"
              onClick={() => handleExport('pdf')}
              disabled={Boolean(downloading) || total === 0}
              style={{ ...styles.exportSecondaryBtn, ...(downloading || total === 0 ? styles.btnDisabled : {}) }}
            >
              {downloading === 'pdf' ? 'Preparing…' : 'Export PDF'}
            </button>
          </div>
        </div>

        <div style={styles.filterRow}>
          <div style={styles.field}>
            <label style={styles.label}>District</label>
            <select style={styles.select} value={filters.district} onChange={(e) => changeFilter('district', e.target.value)}>
              <option value="">All Districts</option>
              {options.districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Block</label>
            <select style={styles.select} value={filters.block} onChange={(e) => changeFilter('block', e.target.value)}>
              <option value="">All Blocks</option>
              {options.blocks.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>School</label>
            <select style={styles.select} value={filters.school} onChange={(e) => changeFilter('school', e.target.value)}>
              <option value="">All Schools</option>
              {options.schools.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {activeFilters > 0 && (
            <button
              type="button"
              style={styles.clearBtn}
              onClick={() => { setFilters({ district: '', block: '', school: '' }); setPage(1); }}
            >
              Clear filters
            </button>
          )}
          <div style={styles.count}>
            <span style={styles.countLabel}>Students</span>
            <span style={styles.countValue}>{total.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </section>

      <section style={styles.card}>
        {exportError && (
          <div style={styles.exportError} role="alert">
            <span style={styles.exportErrorText}>{exportError}</span>
            <button
              type="button"
              onClick={() => setExportError('')}
              style={styles.exportErrorClose}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {loading && <div style={styles.placeholder}>Loading…</div>}
        {!loading && error && <div style={{ ...styles.placeholder, color: '#dc2626' }}>{error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div style={styles.placeholder}>No rows match the selected filters.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} style={{ ...styles.th, textAlign: c.align || 'left' }}>{c.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.rollno || i} style={i % 2 ? styles.trAlt : undefined}>
                      {columns.map((c) => (
                        <td key={c.key} style={{ ...styles.td, textAlign: c.align || 'left' }}>{row[c.key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={styles.pager}>
              <button
                type="button"
                style={{ ...styles.pageBtn, ...(page <= 1 ? styles.btnDisabled : {}) }}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>Page {page} of {totalPages.toLocaleString('en-IN')}</span>
              <button
                type="button"
                style={{ ...styles.pageBtn, ...(page >= totalPages ? styles.btnDisabled : {}) }}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' },
  card: {
    background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '16px',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)', padding: '18px',
  },
  headerRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    flexWrap: 'wrap', gap: '14px',
  },
  title: { margin: 0, fontSize: '24px', fontWeight: 800, color: '#111827' },
  subtitle: { margin: '6px 0 0 0', fontSize: '13px', color: '#6b7280' },
  exportBtn: {
    background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px',
    padding: '10px 20px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
  },
  exportSecondaryBtn: {
    background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px',
    padding: '10px 20px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  filterRow: {
    display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap',
    marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '180px' },
  label: { fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: {
    border: '1px solid #d1d5db', borderRadius: '8px', padding: '9px 10px',
    fontSize: '13px', color: '#111827', background: '#fff', maxWidth: '260px',
  },
  clearBtn: {
    border: '1px solid #d1d5db', background: '#fff', color: '#374151',
    borderRadius: '8px', padding: '9px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
  },
  count: { marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  countLabel: { fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' },
  countValue: { fontSize: '20px', fontWeight: 800, color: '#0f172a' },
  tableWrap: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' },
  table: { borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap', minWidth: '100%' },
  th: {
    position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
    borderRight: '1px solid #eef2f7', padding: '9px 10px', fontWeight: 800,
    color: '#334155', fontSize: '11px', letterSpacing: '0.02em',
  },
  td: { borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f8fafc', padding: '8px 10px', color: '#334155' },
  trAlt: { background: '#fcfdfe' },
  pager: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', paddingTop: '14px' },
  pageBtn: {
    border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: '8px',
    padding: '8px 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
  },
  pageInfo: { fontSize: '13px', color: '#64748b', fontWeight: 600 },
  placeholder: { textAlign: 'center', padding: '48px 20px', color: '#64748b', fontSize: '14px' },
  exportError: {
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px',
    padding: '12px 14px', marginBottom: '14px',
  },
  exportErrorText: { flex: 1, fontSize: '13px', lineHeight: 1.5, color: '#b91c1c' },
  exportErrorClose: {
    background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer',
    fontSize: '18px', lineHeight: 1, padding: '0 2px', fontWeight: 700,
  },
};
