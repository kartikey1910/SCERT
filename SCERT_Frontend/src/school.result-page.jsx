import { useCallback, useEffect, useState } from 'react';
import { get, buildApiUrl } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';

/**
 * School → Reports → Result.
 *
 * Two tabs over this school's own students: the full All-Students list,
 * and the official selected-candidates list with PDF/XLSX download. The
 * school is resolved server-side from the signed-in user's profile, so
 * nothing here can widen the scope. Both tabs stay empty until SCERT
 * publishes the result.
 */

const PAGE_SIZE = 50;

function cellValue(row, key) {
  const v = row[key];
  if (v === null || v === undefined || v === '') return '-';
  if (key === 'is_selected' || key === 'is_absent' || key === 'is_divyang') return v ? 'Yes' : 'No';
  if (key === 'dob') {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
  }
  return String(v);
}

export function SchoolResultPage({ sessionId, selectedScholarshipId, sessionName, schemeName }) {
  const { auth } = useAuth();

  const [tab, setTab] = useState('all'); // 'all' | 'selected'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');

  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const scopeReady = Boolean(auth?.token && sessionId && selectedScholarshipId);

  const queryParams = useCallback((extra = {}) => {
    const p = new URLSearchParams({
      session_id: sessionId,
      scholarship_id: selectedScholarshipId,
      ...extra,
    });
    if (classFilter) p.append('class', classFilter);
    if (search) p.append('search', search);
    if (tab === 'all' && statusFilter) p.append('status', statusFilter);
    return p;
  }, [sessionId, selectedScholarshipId, classFilter, search, statusFilter, tab]);

  const load = useCallback(async () => {
    if (!scopeReady) return;
    setLoading(true);
    setError('');
    try {
      const endpoint = tab === 'selected' ? 'selected' : 'students';
      const params = queryParams({ page: String(page), page_size: String(PAGE_SIZE) });
      const res = await get(`/api/school/result/${endpoint}?${params.toString()}`, {
        token: auth.token,
        sessionId,
      });
      setData(res);
    } catch (err) {
      setError(err?.message || 'Unable to load result data.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scopeReady, auth?.token, sessionId, tab, page, queryParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab, classFilter, statusFilter, search]);

  /**
   * Downloads one student's official score card — the same format the
   * public View Result page shows, rendered server-side as a PDF.
   * Tracked per roll number so only the clicked row shows a spinner.
   */
  const [cardDownloading, setCardDownloading] = useState('');
  const downloadScoreCard = async (row) => {
    const roll = row.roll_number;
    if (!roll || cardDownloading) return;
    setCardDownloading(roll);
    setError('');
    try {
      const p = new URLSearchParams({
        session_id: sessionId,
        scholarship_id: selectedScholarshipId,
        roll_number: roll,
      });
      const res = await fetch(buildApiUrl(`/api/school/result/scorecard.pdf?${p.toString()}`), {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        let msg = 'Download failed.';
        try { msg = (await res.json())?.message || msg; } catch { /* non-JSON body */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `SCORECARD_${roll}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err?.message || 'Download failed.');
    } finally {
      setCardDownloading('');
    }
  };

  /** Downloads need the auth header, so fetch as a blob rather than a plain link. */
  const download = async (format) => {
    if (downloading) return;
    setDownloading(format);
    setError('');
    try {
      const url = buildApiUrl(`/api/school/result/selected.${format}?${queryParams().toString()}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
      if (!res.ok) {
        let msg = 'Download failed.';
        try { msg = (await res.json())?.message || msg; } catch { /* non-JSON body */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      const safe = String(data?.school?.school_name || 'school').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60);
      a.download = `SELECTED_STUDENTS_${safe}${classFilter ? `_CLASS${classFilter}` : ''}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err?.message || 'Download failed.');
    } finally {
      setDownloading('');
    }
  };

  if (!scopeReady) {
    return <div className="error-state">Please select a session and scholarship from the dropdown at the top.</div>;
  }

  const isSelectedTab = tab === 'selected';
  const columns = data?.columns || [];
  const rows = data?.rows || [];
  const summary = data?.summary;
  const totalPages = data?.total_pages || 1;

  const header = (
    <div className="view-header-row">
      <div>
        <h3 className="view-title">Result</h3>
        <p className="view-subtitle">
          Session: <strong>{sessionName}</strong> • Scheme: <strong>{schemeName}</strong>
          {data?.school?.school_name ? <> • School: <strong>{data.school.school_name}</strong></> : null}
        </p>
      </div>
      {isSelectedTab && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="scert-btn-secondary" onClick={() => download('pdf')} disabled={Boolean(downloading) || rows.length === 0}>
            {downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button type="button" className="scert-btn-secondary" onClick={() => download('xlsx')} disabled={Boolean(downloading) || rows.length === 0}>
            {downloading === 'xlsx' ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      )}
    </div>
  );

  const tabs = (
    <div className="result-toolbar result-toolbar--tabs">
      <button type="button" className={`result-tab-btn ${tab === 'all' ? 'result-tab-btn--active' : ''}`} onClick={() => setTab('all')}>
        All Students
      </button>
      <button type="button" className={`result-tab-btn ${isSelectedTab ? 'result-tab-btn--active' : ''}`} onClick={() => setTab('selected')}>
        Selected Students
      </button>
    </div>
  );

  if (data && data.published === false) {
    return (
      <div className="applications-view result-report-view">
        {header}
        {tabs}
        <div className="empty-state">{data.message || 'Results have not been declared yet.'}</div>
      </div>
    );
  }

  return (
    <div className="applications-view result-report-view">
      {header}
      {tabs}

      {!isSelectedTab && summary && (
        <div className="result-toolbar">
          <div className="result-stat">
            <span className="result-stat-label">Total Students</span>
            <span className="result-stat-value">{summary.total.toLocaleString('en-IN')}</span>
          </div>
          <div className="result-stat">
            <span className="result-stat-label">Appeared</span>
            <span className="result-stat-value">{summary.appeared.toLocaleString('en-IN')}</span>
          </div>
          <div className="result-stat">
            <span className="result-stat-label">Absent</span>
            <span className="result-stat-value">{summary.absent.toLocaleString('en-IN')}</span>
          </div>
          <div className="result-stat">
            <span className="result-stat-label">Selected</span>
            <span className="result-stat-value">{summary.selected.toLocaleString('en-IN')}</span>
          </div>
        </div>
      )}

      <div className="result-toolbar">
        <div className="result-field">
          <label className="result-field-label">Class</label>
          <select className="result-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All Classes</option>
            <option value="6">Class 6</option>
            <option value="9">Class 9</option>
          </select>
        </div>

        {!isSelectedTab && (
          <div className="filter-group">
            <label className="filter-label">Status</label>
            <select className="result-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="SELECTED">Selected</option>
              <option value="NOT_SELECTED">Not Selected</option>
              <option value="ABSENT">Absent</option>
            </select>
          </div>
        )}

        <form className="result-field" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}>
          <label className="result-field-label">Search</label>
          <div className="result-field-control">
            <input
              className="result-input"
              type="text"
              placeholder="Roll no. or student name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              />
            <button type="submit" className="scert-btn-secondary">Go</button>
            {search && (
              <button type="button" className="scert-btn-secondary" onClick={() => { setSearchInput(''); setSearch(''); }}>
                Clear
              </button>
            )}
          </div>
        </form>

        {isSelectedTab && (
          <div className="result-stat">
            <span className="result-stat-label">Total Selected</span>
            <span className="result-stat-value">{(data?.total || 0).toLocaleString('en-IN')}</span>
          </div>
        )}
      </div>

      {error && <div className="error-state">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading result data…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          {isSelectedTab
            ? 'No selected students found for the selected criteria.'
            : 'No students from this school appear in the declared results.'}
        </div>
      ) : (
        <>
          <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table" style={{ minWidth: isSelectedTab ? '1700px' : '3200px' }}>
              <thead>
                <tr>
                  {!isSelectedTab && <th style={{ width: '60px' }}>S.No</th>}
                  {!isSelectedTab && <th style={{ width: '70px' }}>Class</th>}
                  <th style={{ width: '110px' }}>Download</th>
                  {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.result_student_id || `${row.roll_number}-${row.sno}`}>
                    {!isSelectedTab && <td>{(page - 1) * PAGE_SIZE + i + 1}</td>}
                    {!isSelectedTab && <td>{row.class_value}</td>}
                    <td>
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        style={{ whiteSpace: 'nowrap', padding: '5px 12px', fontSize: '12.5px' }}
                        onClick={() => downloadScoreCard(row)}
                        disabled={Boolean(cardDownloading)}
                        title={`Download score card for ${row.roll_number}`}
                      >
                        {cardDownloading === row.roll_number ? 'Preparing…' : 'Result'}
                      </button>
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.key === 'roll_number' || c.key === 'student_name' ? 'smart-table-strong' : undefined}
                        style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                      >
                        {isSelectedTab ? row[c.key] : cellValue(row, c.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="result-toolbar result-toolbar--pager">
            <span className="result-pager-text">
              Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString('en-IN')}
              –{Math.min(page * PAGE_SIZE, data.total).toLocaleString('en-IN')} of {data.total.toLocaleString('en-IN')}
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button type="button" className="scert-btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <span className="result-pager-text">Page {page} of {totalPages}</span>
              <button type="button" className="scert-btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default SchoolResultPage;
