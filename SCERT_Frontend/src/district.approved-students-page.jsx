import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { get } from './apiClient.js'
import { HiOutlineEye } from 'react-icons/hi'
import { DistrictApplicationViewer } from './district.application-viewer.jsx'

const formatMaybeDate = (value) => {
  if (!value) return '—'
  const str = String(value).split('T')[0];
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-GB')
}

export function DistrictApprovedStudentsPage({ sessionId, selectedScholarshipId, selectedScholarshipName = '' }) {
  const { auth } = useAuth()

  const [applications, setApplications] = useState([])
  const [blocks, setBlocks] = useState([])
  const [selectedBlockCode, setSelectedBlockCode] = useState('')
  // Roll number: typed into rollInput, applied (rollQuery) shortly after typing stops.
  const [rollInput, setRollInput] = useState('')
  const [rollQuery, setRollQuery] = useState('')
  const [classFilter, setClassFilter] = useState('6')
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 20
  const [viewingApplicationId, setViewingApplicationId] = useState(null)
  const [viewingApplicationData, setViewingApplicationData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const getRollSerial = (row) => {
    const roll = String(row?.roll_number ?? '').replace(/\D/g, '')
    if (!roll) return Number.POSITIVE_INFINITY
    const serial = Number(roll.slice(-4))
    return Number.isFinite(serial) ? serial : Number.POSITIVE_INFINITY
  }

  const sortApplications = (items) =>
    [...items].sort((a, b) => {
      const aSerial = getRollSerial(a)
      const bSerial = getRollSerial(b)
      if (aSerial !== bSerial) return aSerial - bSerial

      const aRoll = String(a?.roll_number ?? '').trim()
      const bRoll = String(b?.roll_number ?? '').trim()
      if (aRoll !== bRoll) return aRoll.localeCompare(bRoll, undefined, { numeric: true })

      const aDisplayId = String(a?.application_display_id ?? '').trim()
      const bDisplayId = String(b?.application_display_id ?? '').trim()
      if (aDisplayId !== bDisplayId) return aDisplayId.localeCompare(bDisplayId, undefined, { numeric: true })

      return Number(a?.application_id || 0) - Number(b?.application_id || 0)
    })

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId)
  const scholarshipName = String(selectedScholarshipName || '')
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(scholarshipName) ||
    /\bNMMS\b/i.test(scholarshipName) ||
    /\bSNSS\b/i.test(scholarshipName) ||
    /\bSSSS\b/i.test(scholarshipName) ||
    /\bCLASS\s*8\b/i.test(scholarshipName)
  const isCmScholarship =
    /\bCM\b/i.test(scholarshipName) || /CHIEF\s*MINISTER/i.test(scholarshipName)
  const pickFirst = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key]
      if (value !== null && value !== undefined && String(value).trim() !== '') return value
    }
    return null
  }

  const formatDivyangta = (value, row = null) => {
    let v = String(value ?? '').trim()
    if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).trim()
    }
    if ((!v || v.toLowerCase() === 'null') && row) {
      const fallback = [
        row?.type_of_divyangta,
        row?.type_of_disability,
        row?.divyangta_code,
        row?.disability_code,
        row?.type_of_divyangta_code,
        row?.type_of_disability_code,
        row?.disability_type_code,
        row?.divyangta_type_code,
        row?.disability_type,
        row?.divyangta_type,
        row?.disability,
        row?.divyangta,
      ].find((item) => item !== null && item !== undefined && String(item).trim() !== '')
      v = String(fallback ?? '').trim()
    }
    return v || 'No divyangta'
  }

  const formatAttendanceFlag = (value) => {
    const normalized = String(value || '').trim().toUpperCase()
    if (!normalized) return '-'
    if (normalized === 'ABSENT' || normalized === 'A') return 'A'
    if (normalized === 'PRESENT' || normalized === 'P') return 'P'
    return normalized
  }

  const getStudentRegistrationNo = (row) =>
    row?.student_registration_no ||
    row?.student_registration ||
    row?.student_registration_number ||
    row?.student_registrations ||
    row?.student_registration_id ||
    row?.student_reg_no ||
    row?.registration_no ||
    row?.registration_number ||
    row?.sr_no ||
    row?.sr_number ||
    '-'

  const fetchApplications = useCallback(async () => {
    if (!canFetch) return

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams()
      params.append('scholarship_id', selectedScholarshipId)
      if (!isNmmssScholarship && classFilter) {
        params.append('class_filter', classFilter)
      }
      if (selectedBlockCode) params.append('block_code', selectedBlockCode)
      if (rollQuery) params.append('roll_number', rollQuery)

      const data = await get(
        `/api/district/applications/approved?${params.toString()}`,
        { token: auth.token, sessionId }
      )

      setBlocks(Array.isArray(data.blocks) ? data.blocks : [])
      setApplications(sortApplications(Array.isArray(data.applications) ? data.applications : []))
    } catch (err) {
      console.error('Failed to fetch approved applications:', err)
      setError(err.message || 'Failed to load approved applications')
      setApplications([])
    } finally {
      setLoading(false)
    }
  }, [auth?.token, canFetch, classFilter, selectedBlockCode, rollQuery, selectedScholarshipId, sessionId, isNmmssScholarship])

  useEffect(() => {
    fetchApplications()
  }, [fetchApplications])

  useEffect(() => {
    if (isNmmssScholarship) {
      setClassFilter('8')
      return
    }
    if (isCmScholarship) {
      setClassFilter('6')
      return
    }
    setClassFilter('6')
  }, [isCmScholarship, isNmmssScholarship, selectedScholarshipId])

  // If the selected block disappears (rare), reset to All Blocks
  useEffect(() => {
    if (!selectedBlockCode) return
    const exists = blocks.some((b) => String(b.block_code) === String(selectedBlockCode))
    if (!exists) setSelectedBlockCode('')
  }, [blocks, selectedBlockCode])

  useEffect(() => {
    setCurrentPage(1)
  }, [sessionId, selectedScholarshipId, classFilter, selectedBlockCode, rollQuery, applications.length])

  // Roll number: apply 350 ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setRollQuery(rollInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [rollInput])

  // A roll number searched under one scholarship / session does not carry over to another.
  useEffect(() => {
    setRollInput('')
    setRollQuery('')
  }, [sessionId, selectedScholarshipId])

  const filtersActive = Boolean(selectedBlockCode || rollQuery)
  const clearFilters = () => {
    setSelectedBlockCode('')
    setRollInput('')
    setRollQuery('')
  }

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>
  }

  const totalRows = applications.length
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE)
  const pageApplications = applications.slice(startIdx, endIdx)

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Approved Applications</h3>
              
            </div>
          <p className="view-subtitle">View-only list of applications finally approved by SCERT for this district.</p>
        </div>

        {viewingApplicationId ? (
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              setViewingApplicationId(null)
              setViewingApplicationData(null)
            }}
          >
            Back to Approved List
          </button>
        ) : (
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchApplications}
            disabled={loading || !canFetch}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {!viewingApplicationId ? <div className="filters-bar" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
        {!isNmmssScholarship ? (
          <div className="filter-group">
            <label className="filter-label">Class</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                onClick={() => setClassFilter('6')}
              >
                Class 6
              </button>
              <button
                type="button"
                className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                onClick={() => setClassFilter('9')}
              >
                Class 9
              </button>
            </div>
          </div>
        ) : null}

        <div className="filter-group">
          <label className="filter-label">Block</label>
          <select
            className="topbar-filter-select"
            value={selectedBlockCode}
            onChange={(e) => setSelectedBlockCode(e.target.value)}
            disabled={!canFetch}
            style={{ minWidth: 260 }}
          >
            <option value="">All Blocks</option>
            {blocks.map((b) => (
              <option key={String(b.block_code)} value={String(b.block_code)}>
                {b.block_name ? `${b.block_name} (${b.block_code})` : String(b.block_code)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="district-approved-roll-filter">Roll Number</label>
          <input
            id="district-approved-roll-filter"
            type="search"
            className="form-input"
            inputMode="numeric"
            maxLength={10}
            value={rollInput}
            onChange={(e) => setRollInput(e.target.value.replace(/\D/g, ''))}
            disabled={!canFetch}
            placeholder="Search by roll number"
            style={{ minWidth: 200 }}
          />
        </div>

        {filtersActive ? (
          <div className="filter-group">
            <button type="button" className="scert-btn-secondary" onClick={clearFilters}>
              Clear Filters
            </button>
          </div>
        ) : null}
      </div> : null}

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
          <div className="loading-state">Loading approved applications...</div>
        </div>
      ) : viewingApplicationId ? (
        <div className="application-viewer">
          <DistrictApplicationViewer
            key={String(viewingApplicationId)}
            applicationId={viewingApplicationId}
            prefetchedData={viewingApplicationData}
            sessionId={sessionId}
            onBack={() => {
              setViewingApplicationId(null)
              setViewingApplicationData(null)
            }}
          />
        </div>
      ) : applications.length === 0 ? (
        <div className="empty-state">No approved applications found for the selected criteria.</div>
      ) : (
        <>
        <div className="smart-table-wrap district-approved-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
          <table className="smart-table" style={{ minWidth: isNmmssScholarship ? '3000px' : '2600px' }}>
            <thead>
              {isNmmssScholarship ? (
                <tr>
                  <th style={{ minWidth: 90 }}>Action</th>
                  <th style={{ minWidth: 70 }}>S. No.</th>
                  <th style={{ minWidth: 100 }}>BlockCode</th>
                  <th style={{ minWidth: 100 }}>Exam Code</th>
                  <th style={{ minWidth: 120 }}>Application ID</th>
                  <th style={{ minWidth: 170 }}>ROLL. No. (10 Digit)</th>
                  <th style={{ minWidth: 140 }}>SR No. of students</th>
                  <th style={{ minWidth: 170 }}>Student&apos;s Name</th>
                  <th style={{ minWidth: 160 }}>Father&apos;s Name</th>
                  <th style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                  <th style={{ minWidth: 130 }}>Date of Birth</th>
                  <th style={{ minWidth: 90 }}>Sex</th>
                  <th style={{ minWidth: 140 }}>Caste Category</th>
                  <th style={{ minWidth: 140 }}>Divyangta code</th>
                  <th style={{ minWidth: 220 }}>Percentage of marks in Class 7th</th>
                  <th style={{ minWidth: 200 }}>Parental Income Code 1 or 2</th>
                  <th style={{ minWidth: 160 }}>Aadhaar Number</th>
                  <th style={{ minWidth: 180 }}>School Name</th>
                  <th style={{ minWidth: 130 }}>Block</th>
                  <th style={{ minWidth: 150 }}>District</th>
                  <th style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                  <th style={{ minWidth: 220 }}>School Catogary (Urban, Rural)</th>
                  <th style={{ minWidth: 150 }}>Exam Center Code</th>
                  <th style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                  <th style={{ minWidth: 130 }}>Contact No</th>
                  <th style={{ minWidth: 90 }}>MAT</th>
                  <th style={{ minWidth: 90 }}>SAT</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ minWidth: 90 }}>Action</th>
                  <th style={{ minWidth: 70 }}>S. No.</th>
                  <th style={{ minWidth: 100 }}>Block Code</th>
                  <th style={{ minWidth: 120 }}>Application ID</th>
                  <th style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                  <th style={{ minWidth: 130 }}>SR No. of students</th>
                  <th style={{ minWidth: 170 }}>Student&apos;s Name</th>
                  <th style={{ minWidth: 160 }}>Father&apos;s Name</th>
                  <th style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                  <th style={{ minWidth: 130 }}>Date of Birth</th>
                  <th style={{ minWidth: 90 }}>Sex</th>
                  <th style={{ minWidth: 140 }}>Caste Category</th>
                  <th style={{ minWidth: 170 }}>Type of Divyangta</th>
                  <th style={{ minWidth: 150 }}>Aadhaar Number</th>
                  <th style={{ minWidth: 180 }}>School Name</th>
                  <th style={{ minWidth: 130 }}>Block</th>
                  <th style={{ minWidth: 150 }}>District</th>
                  <th style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                  <th style={{ minWidth: 220 }}>School Category (Urban, Rural)</th>
                  <th style={{ minWidth: 180 }}>Previous School Name</th>
                  <th style={{ minWidth: 300 }}>Previous School Type (Govt, Govt aided, Local body)</th>
                  <th style={{ minWidth: 150 }}>Exam Center Code</th>
                  <th style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                  <th style={{ minWidth: 130 }}>Contact No</th>
                  {isCmScholarship ? <th style={{ minWidth: 90 }}>MAT</th> : null}
                  {isCmScholarship ? <th style={{ minWidth: 90 }}>SAT</th> : null}
                </tr>
              )}
            </thead>
            <tbody>
              {pageApplications.map((app, index) =>
                isNmmssScholarship ? (
                  <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                    <td>
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        style={{ padding: '0.45rem 0.65rem' }}
                        onClick={() => {
                          setViewingApplicationId(app.application_id)
                          setViewingApplicationData(null)
                        }}
                        title="View application details"
                      >
                        <HiOutlineEye />
                      </button>
                    </td>
                    <td>{startIdx + index + 1}</td>
                    <td>{app.block_code || '-'}</td>
                    <td>{pickFirst(app, ['exam_code']) || '-'}</td>
                    <td><code className="smart-table-id">{window.getDisplayApplicationId(app)}</code></td>
                    <td className="smart-table-strong">{app.roll_number || '-'}</td>
                    <td>{getStudentRegistrationNo(app)}</td>
                    <td>{app.candidate_name || app.student_name || '-'}</td>
                    <td>{app.father_name || '-'}</td>
                    <td>{app.mother_name || '-'}</td>
                    <td>{formatMaybeDate(app.date_of_birth || app.dob)}</td>
                    <td>{app.sex || app.gender || '-'}</td>
                    <td>{app.caste_category || '-'}</td>
                    <td>{formatDivyangta(app.type_of_divyangta, app)}</td>
                    <td>{pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7']) || '-'}</td>
                    <td>{pickFirst(app, ['parental_income_code', 'income_code']) || '-'}</td>
                    <td>{app.aadhaar_number || '-'}</td>
                    <td>{app.school_name || app.origin_school || '-'}</td>
                    <td>{app.block_name || '-'}</td>
                    <td>{app.district_name || app.district || app.district_code || '-'}</td>
                    <td>{app.school_type || '-'}</td>
                    <td>{app.school_category || '-'}</td>
                    <td>{app.center_order || '-'}</td>
                    <td>{app.center_name || '-'}</td>
                    <td>{app.contact_no || '-'}</td>
                    <td>{formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td>
                    <td>{formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td>
                  </tr>
                ) : (
                  <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                    <td>
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        style={{ padding: '0.45rem 0.65rem' }}
                        onClick={() => {
                          setViewingApplicationId(app.application_id)
                          setViewingApplicationData(null)
                        }}
                        title="View application details"
                      >
                        <HiOutlineEye />
                      </button>
                    </td>
                    <td>{startIdx + index + 1}</td>
                    <td>{app.block_code || '-'}</td>
                    <td><code className="smart-table-id">{window.getDisplayApplicationId(app)}</code></td>
                    <td className="smart-table-strong">{app.roll_number || '-'}</td>
                    <td>{getStudentRegistrationNo(app)}</td>
                    <td>{app.candidate_name || app.student_name || '-'}</td>
                    <td>{app.father_name || '-'}</td>
                    <td>{app.mother_name || '-'}</td>
                    <td>{formatMaybeDate(app.date_of_birth || app.dob)}</td>
                    <td>{app.sex || app.gender || '-'}</td>
                    <td>{app.caste_category || '-'}</td>
                    <td>{formatDivyangta(app.type_of_divyangta, app)}</td>
                    <td>{app.aadhaar_number || '-'}</td>
                    <td>{app.school_name || app.origin_school || '-'}</td>
                    <td>{app.block_name || '-'}</td>
                    <td>{app.district_name || app.district || app.district_code || '-'}</td>
                    <td>{app.school_type || '-'}</td>
                    <td>{app.school_category || '-'}</td>
                    <td>{app.previous_school_name || '-'}</td>
                    <td>{app.previous_school_type || '-'}</td>
                    <td>{app.center_order || '-'}</td>
                    <td>{app.center_name || '-'}</td>
                    <td>{app.contact_no || '-'}</td>
                    {isCmScholarship ? <td>{formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td> : null}
                    {isCmScholarship ? <td>{formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td> : null}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={safePage <= 1}
          >
            Previous
          </button>
          <span className="pagination-info">
            Showing {totalRows === 0 ? 0 : startIdx + 1}-{endIdx} of {totalRows} (Page {safePage} / {totalPages})
          </span>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={safePage >= totalPages}
          >
            Next
          </button>
        </div>
        </>
      )}

      {!viewingApplicationId ? (
        <div className="table-footer">
          <span className="table-count">
            Total: <strong>{applications.length}</strong> application(s)
          </span>
        </div>
      ) : null}
    </div>
  )
}
