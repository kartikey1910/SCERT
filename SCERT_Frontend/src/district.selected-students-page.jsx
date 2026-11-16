import { useCallback, useEffect, useState } from 'react'
import { get, buildApiUrl } from './apiClient.js'
import { useAuth } from './AuthContext.jsx'

/**
 * District → Reports → Selected Students.
 *
 * The official "चयनित अभ्यर्थियों की सूची" list, scoped to this district and
 * ordered block-wise then by merit. Columns and their order match the
 * published selected-candidate list, including the numeric GENDER / CASTE /
 * SCHOOL TYPE codes the official document carries.
 *
 * Only available once SCERT publishes the result — the server enforces
 * that; this page just renders whichever state it returns.
 */

const PAGE_SIZE = 50

export function DistrictSelectedStudentsPage({ sessionId, selectedScholarshipId, sessionName, schemeName }) {
  const { auth } = useAuth()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState('')

  const [classFilter, setClassFilter] = useState('')
  const [blockFilter, setBlockFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const scopeReady = Boolean(auth?.token && sessionId && selectedScholarshipId)

  const queryParams = useCallback((extra = {}) => {
    const p = new URLSearchParams({
      session_id: sessionId,
      scholarship_id: selectedScholarshipId,
      ...extra,
    })
    if (classFilter) p.append('class', classFilter)
    if (blockFilter) p.append('block', blockFilter)
    if (search) p.append('search', search)
    return p
  }, [sessionId, selectedScholarshipId, classFilter, blockFilter, search])

  const load = useCallback(async () => {
    if (!scopeReady) return
    setLoading(true)
    setError('')
    try {
      const params = queryParams({ page: String(page), page_size: String(PAGE_SIZE) })
      const res = await get(`/api/district/result/selected?${params.toString()}`, {
        token: auth.token,
        sessionId,
      })
      setData(res)
    } catch (err) {
      setError(err?.message || 'Unable to load selected students.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [scopeReady, auth?.token, sessionId, page, queryParams])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [classFilter, blockFilter, search])

  /**
   * The download endpoints need the Authorization header, so a plain <a
   * href> cannot be used — fetch the file as a blob and click a synthetic
   * link, matching how ScertProgressReports.jsx handles its downloads.
   */
  const download = async (format) => {
    if (downloading) return
    setDownloading(format)
    setError('')
    try {
      const params = queryParams()
      const url = buildApiUrl(`/api/district/result/selected.${format}?${params.toString()}`)
      const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } })
      if (!res.ok) {
        let msg = 'Download failed.'
        try { msg = (await res.json())?.message || msg } catch { /* non-JSON error body */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `SELECTED_STUDENTS_${data?.district?.district_name || 'district'}${classFilter ? `_CLASS${classFilter}` : ''}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(err?.message || 'Download failed.')
    } finally {
      setDownloading('')
    }
  }

  if (!scopeReady) {
    return <div className="error-state">Please select a session and scholarship from the dropdown at the top.</div>
  }

  if (data && data.published === false) {
    return (
      <div className="applications-view result-report-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">Selected Students</h3>
            <p className="view-subtitle">
              Session: <strong>{sessionName}</strong> • Scheme: <strong>{schemeName}</strong>
            </p>
          </div>
        </div>
        <div className="empty-state">{data.message || 'Results have not been declared yet.'}</div>
      </div>
    )
  }

  const columns = data?.columns || []
  const rows = data?.rows || []
  const blocks = data?.blocks || []
  const totalPages = data?.total_pages || 1

  return (
    <div className="applications-view result-report-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Selected Students</h3>
          <p className="view-subtitle">
            Session: <strong>{sessionName}</strong> • Scheme: <strong>{schemeName}</strong>
            {data?.district?.district_name ? <> • District: <strong>{data.district.district_name}</strong></> : null}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => download('pdf')}
            disabled={Boolean(downloading) || rows.length === 0}
          >
            {downloading === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => download('xlsx')}
            disabled={Boolean(downloading) || rows.length === 0}
          >
            {downloading === 'xlsx' ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

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

        <form className="result-field" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()) }}>
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
              <button type="button" className="scert-btn-secondary" onClick={() => { setSearchInput(''); setSearch('') }}>
                Clear
              </button>
            )}
          </div>
        </form>

        <div className="result-stat">
            <span className="result-stat-label">Total Selected</span>
            <span className="result-stat-value">{(data?.total || 0).toLocaleString('en-IN')}</span>
          </div>
      </div>

      {error && <div className="error-state">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading selected students…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No selected students found for the selected criteria.</div>
      ) : (
        <>
          <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table" style={{ minWidth: '1700px' }}>
              <thead>
                <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.roll_number}-${row.sno}`}>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.key === 'roll_number' || c.key === 'total_marks' ? 'smart-table-strong' : undefined}
                        style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                      >
                        {row[c.key]}
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
  )
}

export default DistrictSelectedStudentsPage
