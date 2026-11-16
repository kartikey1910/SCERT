import { useCallback, useEffect, useState } from 'react'
import { get } from './apiClient.js'
import { useAuth } from './AuthContext.jsx'

/**
 * District → Reports → Result.
 *
 * Every uploaded All-Students row whose SCHOOL is in this district, listed
 * block-wise. The district is resolved server-side from the signed-in
 * user's profile, so nothing here can widen the scope past their own
 * district.
 *
 * Paginated on the server: a single district runs to a few thousand rows
 * per class, which is too much to ship and slice in the browser.
 */

const PAGE_SIZE = 50

function cellValue(row, key) {
  const v = row[key]
  if (v === null || v === undefined || v === '') return '-'
  if (key === 'is_selected') return v ? 'Yes' : 'No'
  if (key === 'is_absent') return v ? 'Yes' : 'No'
  if (key === 'is_divyang') return v ? 'Yes' : 'No'
  if (key === 'dob') {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v)
  }
  return String(v)
}

export function DistrictResultPage({ sessionId, selectedScholarshipId, sessionName, schemeName }) {
  // apiClient does NOT attach auth automatically — every caller passes the
  // token explicitly (see district.approved-students-page.jsx). Omitting it
  // yields a 401, which the client turns into an app-wide auto-logout.
  const { auth } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [classFilter, setClassFilter] = useState('')
  const [blockFilter, setBlockFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const scopeReady = Boolean(auth?.token && sessionId && selectedScholarshipId)

  const load = useCallback(async () => {
    if (!scopeReady) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        session_id: sessionId,
        scholarship_id: selectedScholarshipId,
        page: String(page),
        page_size: String(PAGE_SIZE),
      })
      if (classFilter) params.append('class', classFilter)
      if (blockFilter) params.append('block', blockFilter)
      if (statusFilter) params.append('status', statusFilter)
      if (search) params.append('search', search)

      const res = await get(`/api/district/result/students?${params.toString()}`, {
        token: auth.token,
        sessionId,
      })
      setData(res)
    } catch (err) {
      setError(err?.message || 'Unable to load result data.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [scopeReady, auth?.token, sessionId, selectedScholarshipId, page, classFilter, blockFilter, statusFilter, search])

  useEffect(() => { load() }, [load])

  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1) }, [classFilter, blockFilter, statusFilter, search])

  const submitSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }

  if (!scopeReady) {
    return <div className="error-state">Please select a session and scholarship from the dropdown at the top.</div>
  }

  // SCERT has not declared the results yet — show nothing, not even counts.
  if (data && data.published === false) {
    return (
      <div className="applications-view result-report-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">Result</h3>
            <p className="view-subtitle">
              Session: <strong>{sessionName}</strong> • Scheme: <strong>{schemeName}</strong>
            </p>
          </div>
        </div>
        <div className="empty-state">
          {data.message || 'Results have not been declared yet.'}
        </div>
      </div>
    )
  }

  const columns = data?.columns || []
  const rows = data?.rows || []
  const blocks = data?.blocks || []
  const summary = data?.summary
  const totalPages = data?.total_pages || 1

  return (
    <div className="applications-view result-report-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Result</h3>
          <p className="view-subtitle">
            Session: <strong>{sessionName}</strong> • Scheme: <strong>{schemeName}</strong>
            {data?.district?.district_name ? <> • District: <strong>{data.district.district_name}</strong></> : null}
          </p>
        </div>
      </div>

      {summary && (
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

        <div className="result-field">
          <label className="result-field-label">Block</label>
          <select className="result-select" value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}>
            <option value="">All Blocks</option>
            {blocks.map((b) => (
              <option key={b.block_name} value={b.block_name}>
                {b.block_name} ({b.student_count.toLocaleString('en-IN')})
              </option>
            ))}
          </select>
        </div>

        <div className="result-field">
          <label className="result-field-label">Status</label>
          <select className="result-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="SELECTED">Selected</option>
            <option value="NOT_SELECTED">Not Selected</option>
            <option value="ABSENT">Absent</option>
          </select>
        </div>

        <form className="result-field" onSubmit={submitSearch}>
          <label className="result-field-label">Search</label>
          <div className="result-field-control">
            <input
              className="result-input"
              type="text"
              placeholder="Roll no., name or school"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              />
            <button type="submit" className="scert-btn-secondary">Go</button>
            {search && (
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => { setSearchInput(''); setSearch('') }}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>

      {error && <div className="error-state">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading result data…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          No result data found for this district. The All Students sheet may not have been uploaded yet.
        </div>
      ) : (
        <>
          <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table" style={{ minWidth: '3200px' }}>
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>S.No</th>
                  <th style={{ width: '70px' }}>Class</th>
                  {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.result_student_id}>
                    <td>{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td>{row.class_value}</td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.key === 'roll_number' || c.key === 'student_name' ? 'smart-table-strong' : undefined}
                      >
                        {cellValue(row, c.key)}
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
              <button
                type="button"
                className="scert-btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="result-pager-text">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="scert-btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default DistrictResultPage
