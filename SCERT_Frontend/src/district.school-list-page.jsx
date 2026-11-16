import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { get } from './apiClient.js'

const PAGE_SIZE = 50

const normalizeSchoolTypeLabel = (value) => {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return '-'
  if (v.includes('dept') || v.includes('department') || v.includes('edu')) return 'Dept of Edu'
  if (v.includes('aided')) return 'Govt Aided'
  if (v.includes('local')) return 'Local Body'
  return value
}

export function DistrictSchoolListPage({ selectedScholarshipId, sessionId }) {
  const { auth } = useAuth()
  const [schoolsData, setSchoolsData] = useState({ data: [], pagination: null })
  const [schoolsLoading, setSchoolsLoading] = useState(false)
  const [schoolsError, setSchoolsError] = useState('')
  const [schoolsPage, setSchoolsPage] = useState(1)
  const [selectedBlockFilter, setSelectedBlockFilter] = useState('ALL')
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('ALL')

  const fetchDistrictSchools = async () => {
    if (!selectedScholarshipId) {
      setSchoolsData({ data: [], pagination: null })
      setSchoolsError('')
      return
    }

    setSchoolsLoading(true)
    setSchoolsError('')
    try {
      const blockResp = await get(
        `/api/district/progress-reports/registration/blocks?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
        { token: auth.token, sessionId }
      )
      const blocks = Array.isArray(blockResp?.rows) ? blockResp.rows : []
      const blockCodes = blocks.map((b) => String(b?.block_code || '').trim()).filter(Boolean)

      if (!blockCodes.length) {
        setSchoolsData({ data: [], pagination: null })
        setSchoolsPage(1)
        return
      }

      const schoolResponses = await Promise.all(
        blockCodes.map((blockCode) =>
          get(
            `/api/district/progress-reports/registration/schools?scholarship_id=${encodeURIComponent(
              selectedScholarshipId
            )}&block_code=${encodeURIComponent(blockCode)}`,
            { token: auth.token, sessionId }
          ).catch(() => ({ rows: [] }))
        )
      )

      const merged = []
      const seen = new Set()
      schoolResponses.forEach((resp, idx) => {
        const rows = Array.isArray(resp?.rows) ? resp.rows : []
        const blockNameFallback = blocks[idx]?.block_name || '-'
        rows.forEach((r) => {
          const uid = String(r?.school_user_id || '').trim()
          const udise = String(r?.udise_code || '').trim()
          const schoolName = String(r?.school_name || '').trim()
          const dedupeKey = uid || udise || schoolName
          if (!dedupeKey || seen.has(dedupeKey)) return
          seen.add(dedupeKey)

          merged.push({
            school_name: schoolName || '-',
            udise_code: udise || '-',
            block_name: String(r?.block_name || blockNameFallback || '-'),
            block_code: String(r?.block_code || blocks[idx]?.block_code || ''),
            school_type: normalizeSchoolTypeLabel(r?.school_type || ''),
            head_of_institution_name: r?.head_of_institution_name || '-',
            head_of_institution_mobile: r?.head_of_institution_mobile || '-',
          })
        })
      })

      merged.sort((a, b) => {
        const aBlock = Number(String(a.block_code || '').replace(/\D+/g, ''))
        const bBlock = Number(String(b.block_code || '').replace(/\D+/g, ''))
        if (Number.isFinite(aBlock) && Number.isFinite(bBlock) && aBlock !== bBlock) return aBlock - bBlock
        if ((a.block_code || '') !== (b.block_code || '')) return String(a.block_code || '').localeCompare(String(b.block_code || ''))
        return String(a.school_name || '').localeCompare(String(b.school_name || ''))
      })

      setSchoolsData({
        data: merged,
        pagination: { total: merged.length, totalPages: Math.max(1, Math.ceil(merged.length / PAGE_SIZE)), page: 1 },
      })
      setSchoolsPage(1)
    } catch (err) {
      console.error('Failed to fetch district schools:', err)
      setSchoolsError(err.message || 'Failed to load district schools')
      setSchoolsData({ data: [], pagination: null })
    } finally {
      setSchoolsLoading(false)
    }
  }

  useEffect(() => {
    fetchDistrictSchools()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, selectedScholarshipId, sessionId])

  useEffect(() => {
    setSchoolsPage(1)
  }, [selectedBlockFilter, selectedTypeFilter])

  const blockFilterOptions = useMemo(() => {
    const set = new Set()
    ;(schoolsData.data || []).forEach((s) => {
      const name = String(s.block_name || '').trim()
      if (name) set.add(name)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [schoolsData.data])

  const filteredSchools = useMemo(() => {
    return (schoolsData.data || []).filter((s) => {
      if (selectedBlockFilter !== 'ALL' && String(s.block_name || '') !== selectedBlockFilter) return false
      if (selectedTypeFilter !== 'ALL' && String(s.school_type || '') !== selectedTypeFilter) return false
      return true
    })
  }, [schoolsData.data, selectedBlockFilter, selectedTypeFilter])

  const totalSchools = Array.isArray(filteredSchools) ? filteredSchools.length : 0
  const totalPages = Math.max(1, Math.ceil(totalSchools / PAGE_SIZE))
  const safePage = Math.min(Math.max(schoolsPage, 1), totalPages)
  const pagedSchools = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return (filteredSchools || []).slice(start, start + PAGE_SIZE)
  }, [filteredSchools, safePage])

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">School List</h3>
          <p className="view-subtitle">Schools mapped under your district</p>
        </div>
      </div>

      <div className="filters-bar" style={{ marginBottom: '0.75rem' }}>
        <div className="filter-group">
          <label className="filter-label">Filters</label>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`filter-btn ${selectedBlockFilter === 'ALL' && selectedTypeFilter === 'ALL' ? 'filter-btn-active' : ''}`}
              onClick={() => {
                setSelectedBlockFilter('ALL')
                setSelectedTypeFilter('ALL')
              }}
            >
              All
            </button>
            <select className="topbar-filter-select" value={selectedBlockFilter} onChange={(e) => setSelectedBlockFilter(e.target.value)}>
              <option value="ALL">Block</option>
              {blockFilterOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <select className="topbar-filter-select" value={selectedTypeFilter} onChange={(e) => setSelectedTypeFilter(e.target.value)}>
              <option value="ALL">School Type</option>
              <option value="Dept of Edu">Dept of Edu</option>
              <option value="Govt Aided">Govt Aided</option>
              <option value="Local Body">Local Body</option>
            </select>
          </div>
        </div>
      </div>

      {!selectedScholarshipId ? (
        <div className="empty-state">Select a scholarship from the top bar to load district schools.</div>
      ) : schoolsError ? (
        <div className="error-state">{schoolsError}</div>
      ) : schoolsLoading && schoolsData.data.length === 0 ? (
        <div className="loading-state">Loading schools...</div>
      ) : filteredSchools.length === 0 ? (
        <div className="empty-state">No schools found for selected filters.</div>
      ) : (
        <div className="smart-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>School Name</th>
                <th style={{ textAlign: 'left' }}>UDISE</th>
                <th style={{ textAlign: 'left' }}>Block</th>
                <th style={{ textAlign: 'left' }}>School Type</th>
                <th style={{ textAlign: 'left' }}>Head of Institute Name</th>
                <th style={{ textAlign: 'left' }}>Mobile Number</th>
              </tr>
            </thead>
            <tbody>
              {pagedSchools.map((s) => (
                <tr key={`${s.udise_code}-${s.school_name}`}>
                  <td className="smart-table-strong" style={{ textAlign: 'left' }}>{s.school_name || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{s.udise_code || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{s.block_name || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{s.school_type || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{s.head_of_institution_name || '-'}</td>
                  <td style={{ textAlign: 'left' }}>{s.head_of_institution_mobile || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div className="table-footer" style={{ marginTop: '0.75rem' }}>
              <span className="table-count">Total: <strong>{totalSchools}</strong> | Page {safePage} of {totalPages}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="scert-btn-secondary" onClick={() => setSchoolsPage((p) => Math.max(1, p - 1))} disabled={schoolsLoading || safePage <= 1}>Previous</button>
                <button className="scert-btn-secondary" onClick={() => setSchoolsPage((p) => Math.min(totalPages, p + 1))} disabled={schoolsLoading || safePage >= totalPages}>Next</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
