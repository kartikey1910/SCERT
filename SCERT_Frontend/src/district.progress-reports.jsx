import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { API_BASE_URL, get } from './apiClient.js'
import { useToast } from './ToastContext.jsx'
import { ScertNmmssDashboard } from './ScertNmmssSummary.jsx'
import { districtNmmssCards } from './utils/districtNmmssCards.js'

function sumTotals(rows, kind) {
  if (!Array.isArray(rows)) return null
  return rows.reduce(
    (acc, r) => {
      acc.class6_strength += Number(r.class6_strength || 0)
      acc.class6_registered += Number(r.class6_registered || 0)
      acc.class8_strength += Number(r.class8_strength || 0)
      acc.class8_registered += Number(r.class8_registered || 0)
      acc.class9_strength += Number(r.class9_strength || 0)
      acc.class9_registered += Number(r.class9_registered || 0)
      acc.total_registration += Number(r.total_registration || 0)
      return acc
    },
    {
      kind,
      class6_strength: 0,
      class6_registered: 0,
      class8_strength: 0,
      class8_registered: 0,
      class9_strength: 0,
      class9_registered: 0,
      total_registration: 0,
    }
  )
}

export function DistrictProgressReports({ sessionId, selectedScholarshipId, selectedScholarshipName = '', onNavigate }) {
  const { auth } = useAuth()
  const toast = useToast()

  // NMMSS has no class-strength breakdown (it is Class 8 only) - it shows the
  // same district-home table (block -> school drill-down) instead, so a
  // district does not have to leave Reports to see those figures.
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName)

  const [level, setLevel] = useState('block') // 'block' | 'school'
  const [selectedBlock, setSelectedBlock] = useState(null) // { block_code, block_name }
  const [districtCode, setDistrictCode] = useState(null)

  const [rows, setRows] = useState([])
  const [targetClasses, setTargetClasses] = useState([6, 9])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const normalizeTargetClasses = (value) => {
    if (!value) return []
    if (Array.isArray(value)) {
      return value.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => Number(String(s).trim()))
        .filter((n) => Number.isFinite(n))
    }
    return []
  }

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId)

  const fetchBlocks = async () => {
    if (!canFetch) return

    setLoading(true)
    setError('')

    try {
      const data = await get(
        `/api/district/progress-reports/registration/blocks?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
        { token: auth.token, sessionId }
      )
      setDistrictCode(data?.district_code ?? null)
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [])

      const nextTarget = normalizeTargetClasses(data?.targetClasses ?? data?.target_classes)
      setTargetClasses(nextTarget.length ? nextTarget : [6, 9])
    } catch (err) {
      console.error('Failed to fetch block progress report:', err)
      setError(err.message || 'Failed to load block progress report')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const fetchSchools = async (blockCode) => {
    if (!canFetch) return

    setLoading(true)
    setError('')

    try {
      const data = await get(
        `/api/district/progress-reports/registration/schools?scholarship_id=${encodeURIComponent(
          selectedScholarshipId
        )}&block_code=${encodeURIComponent(blockCode)}`,
        { token: auth.token, sessionId }
      )
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [])

      const nextTarget = normalizeTargetClasses(data?.targetClasses ?? data?.target_classes)
      setTargetClasses(nextTarget.length ? nextTarget : [6, 9])
    } catch (err) {
      console.error('Failed to fetch school progress report:', err)
      setError(err.message || 'Failed to load school progress report')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPdf = async () => {
    if (!canFetch) return

    const isBlockView = level === 'block'

    const params = new URLSearchParams()
    params.append('scholarship_id', selectedScholarshipId)

    let endpoint = '/api/district/progress-reports/registration/blocks.pdf'
    let filename = `district_progress_report_blocks_${districtCode || 'district'}_${sessionId}_${selectedScholarshipId}.pdf`

    if (!isBlockView) {
      const bc = selectedBlock?.block_code
      if (!bc) return
      params.append('block_code', bc)
      endpoint = '/api/district/progress-reports/registration/schools.pdf'
      filename = `district_progress_report_schools_${bc}_${sessionId}_${selectedScholarshipId}.pdf`
    }

    const url = `${API_BASE_URL}${endpoint}?${params.toString()}`

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'x-session-id': sessionId,
        },
      })

      if (!res.ok) {
        let msg = `Download failed (${res.status})`
        try {
          const data = await res.json()
          if (data?.message) msg = data.message
        } catch {
          // ignore
        }
        throw new Error(msg)
      }

      const blob = await res.blob()
      const blobUrl = window.URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      link.click()

      window.URL.revokeObjectURL(blobUrl)
    } catch (e) {
      console.error('Progress report PDF download failed:', e)
      toast.error(toast.getErrorMessage(e, 'Failed to download PDF'))
    }
  }

  useEffect(() => {
    // Reset to block view when scholarship or session changes
    setLevel('block')
    setSelectedBlock(null)
    setPage(1)
    if (selectedScholarshipId && !isNmmssScholarship) fetchBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedScholarshipId, isNmmssScholarship])

  const totals = useMemo(() => sumTotals(rows, level), [rows, level])
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const endIdx = Math.min(rows.length, startIdx + PAGE_SIZE)
  const pageRows = useMemo(() => rows.slice(startIdx, endIdx), [rows, startIdx, endIdx])

  useEffect(() => {
    setPage(1)
  }, [level, selectedBlock?.block_code, rows.length])

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>
  }

  if (isNmmssScholarship) {
    return (
      <div className="applications-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">Progress Reports</h3>
          </div>
        </div>
        <ScertNmmssDashboard
          sessionId={sessionId}
          scholarshipId={selectedScholarshipId}
          onNavigate={onNavigate}
          endpoint="/api/district/dashboard/nmmss-summary"
          rootLevel="block"
          buildCards={districtNmmssCards}
          boldCounts
          pdfEndpoint="/api/district/dashboard/nmmss-summary.pdf"
        />
      </div>
    )
  }

  const isBlockView = level === 'block'

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Progress Reports</h3>
          <p className="view-subtitle">
            {isBlockView
              ? 'Block-wise strength vs scholarship registrations.'
              : `School-wise strength vs scholarship registrations — ${selectedBlock?.block_name || ''}`}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!isBlockView && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('block')
                setSelectedBlock(null)
                fetchBlocks()
              }}
              disabled={loading}
            >
              ← Back
            </button>
          )}

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleDownloadPdf}
            disabled={!canFetch || loading}
            title="Download as PDF"
          >
            Download PDF
          </button>

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              if (isBlockView) fetchBlocks()
              else if (selectedBlock?.block_code) fetchSchools(selectedBlock.block_code)
            }}
            disabled={!canFetch || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading progress report...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No data found.</div>
      ) : (
        <>
        <div className="smart-table-wrap district-dashboard-progress-table-wrap beo-submitted-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>S.No</th>
                <th>{isBlockView ? 'Name of the Block' : 'Name of the School'}</th>
                {targetClasses.includes(6) && (
                  <>
                    <th>Students in Class 6</th>
                    <th>Registered for Scholarship (Class 6)</th>
                  </>
                )}
                {targetClasses.includes(8) && (
                  <>
                    <th>Students in Class 8</th>
                    <th>Registered for Scholarship (Class 8)</th>
                  </>
                )}
                {targetClasses.includes(9) && (
                  <>
                    <th>Students in Class 9</th>
                    <th>Registered for Scholarship (Class 9)</th>
                  </>
                )}
                <th>Total Registration</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, idx) => (
                <tr
                  key={String((isBlockView ? r.block_code : r.school_user_id || r.udise_code) || (startIdx + idx))}
                  onClick={() => {
                    if (!isBlockView) return
                    setSelectedBlock({
                      block_code: r.block_code,
                      block_name: r.block_name,
                    })
                    setLevel('school')
                    setPage(1)
                    fetchSchools(r.block_code)
                  }}
                  style={isBlockView ? { cursor: 'pointer' } : undefined}
                  title={isBlockView ? 'Click to view school-wise report' : undefined}
                >
                  <td className="smart-table-strong">{startIdx + idx + 1}</td>
                  <td className="smart-table-strong">
                    {isBlockView ? r.block_name || '—' : r.school_name || '—'}
                  </td>
                  {targetClasses.includes(6) && (
                    <>
                      <td>{r.class6_strength ?? 0}</td>
                      <td>{r.class6_registered ?? 0}</td>
                    </>
                  )}
                  {targetClasses.includes(8) && (
                    <>
                      <td>{r.class8_strength ?? 0}</td>
                      <td>{r.class8_registered ?? 0}</td>
                    </>
                  )}
                  {targetClasses.includes(9) && (
                    <>
                      <td>{r.class9_strength ?? 0}</td>
                      <td>{r.class9_registered ?? 0}</td>
                    </>
                  )}
                  <td className="smart-table-strong">{r.total_registration ?? 0}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td />
                  <td className="smart-table-strong">Total</td>
                  {targetClasses.includes(6) && (
                    <>
                      <td className="smart-table-strong">{totals.class6_strength}</td>
                      <td className="smart-table-strong">{totals.class6_registered}</td>
                    </>
                  )}
                  {targetClasses.includes(8) && (
                    <>
                      <td className="smart-table-strong">{totals.class8_strength}</td>
                      <td className="smart-table-strong">{totals.class8_registered}</td>
                    </>
                  )}
                  {targetClasses.includes(9) && (
                    <>
                      <td className="smart-table-strong">{totals.class9_strength}</td>
                      <td className="smart-table-strong">{totals.class9_registered}</td>
                    </>
                  )}
                  <td className="smart-table-strong">{totals.total_registration}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="pagination">
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            Previous
          </button>
          <span className="pagination-info">
            Showing {rows.length === 0 ? 0 : startIdx + 1}-{endIdx} of {rows.length} (Page {safePage} / {totalPages})
          </span>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            Next
          </button>
        </div>
        </>
      )}
    </div>
  )
}
