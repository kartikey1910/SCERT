import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { get } from './apiClient.js'
import { HiOutlineEye } from 'react-icons/hi'
import { DistrictApplicationViewer } from './district.application-viewer.jsx'

const formatMaybeDate = (value) => {
  if (!value) return '-'
  const str = String(value).split('T')[0];
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-GB')
}

export function DistrictSubmittedApplicationsPage({
  sessionId,
  selectedScholarshipId,
  selectedScholarshipName = '',
}) {
  const { auth } = useAuth()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [blocks, setBlocks] = useState([])
  const [selectedBlock, setSelectedBlock] = useState(null)
  const [applications, setApplications] = useState([])
  const [classFilter, setClassFilter] = useState('')
  const [schoolFilter, setSchoolFilter] = useState('')
  const [examCodeFilter, setExamCodeFilter] = useState('')
  const [applicationIdQuery, setApplicationIdQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 20
  const [viewingApplicationId, setViewingApplicationId] = useState(null)

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
    row?.student_registration_number ||
    row?.student_registrations ||
    row?.registration_no ||
    row?.student_reg_no ||
    row?.student_registration ||
    row?.student_registration_id ||
    row?.sr_no ||
    '-'

  const fetchSummary = useCallback(async () => {
    if (!canFetch) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.append('scholarship_id', selectedScholarshipId)
      const data = await get(`/api/district/applications/submitted-summary?${params.toString()}`, {
        token: auth.token,
        sessionId,
      })
      setBlocks(Array.isArray(data?.blocks) ? data.blocks : [])
    } catch (err) {
      console.error('Failed to fetch submitted summary:', err)
      setError(err.message || 'Failed to load submitted applications summary')
      setBlocks([])
    } finally {
      setLoading(false)
    }
  }, [auth?.token, canFetch, selectedScholarshipId, sessionId])

  const fetchBlockApplications = useCallback(
    async (blockCode) => {
      if (!canFetch || !blockCode) return
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        params.append('scholarship_id', selectedScholarshipId)
        params.append('block_code', blockCode)
        const data = await get(`/api/district/applications/submitted?${params.toString()}`, {
          token: auth.token,
          sessionId,
        })
        setApplications(Array.isArray(data?.applications) ? data.applications : [])
      } catch (err) {
        console.error('Failed to fetch block submitted applications:', err)
        setError(err.message || 'Failed to load submitted applications')
        setApplications([])
      } finally {
        setLoading(false)
      }
    },
    [auth?.token, canFetch, selectedScholarshipId, sessionId]
  )

  useEffect(() => {
    setSelectedBlock(null)
    setApplications([])
    fetchSummary()
  }, [fetchSummary, sessionId, selectedScholarshipId])

  useEffect(() => {
    if (isNmmssScholarship) {
      setClassFilter('8')
      return
    }
    if (isCmScholarship) {
      setClassFilter('')
      return
    }
    setClassFilter('')
  }, [isCmScholarship, isNmmssScholarship, selectedScholarshipId])

  // A school picked in one block need not exist in the next.
  useEffect(() => {
    setSchoolFilter('')
    setExamCodeFilter('')
    setApplicationIdQuery('')
  }, [sessionId, selectedScholarshipId, selectedBlock?.block_code])

  const idQuery = applicationIdQuery.trim().toLowerCase()

  useEffect(() => {
    setCurrentPage(1)
  }, [sessionId, selectedScholarshipId, classFilter, schoolFilter, examCodeFilter, idQuery, selectedBlock?.block_code, applications.length, viewingApplicationId])

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>
  }

  const inDetailsView = Boolean(selectedBlock)
  const schoolLabel = (app) => app?.school_name || app?.origin_school || ''
  // One entry per school that has a submitted application in this block.
  const schoolOptions = Array.from(new Set(applications.map(schoolLabel).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  )
  const filtersActive = Boolean(schoolFilter || examCodeFilter || idQuery)
  const filteredApplications = applications.filter(
    (app) =>
      (isNmmssScholarship || !classFilter || String(app?.class ?? '') === String(classFilter)) &&
      (!schoolFilter || schoolLabel(app) === schoolFilter) &&
      (!examCodeFilter || String(app?.exam_code ?? '') === examCodeFilter) &&
      // Matches what the table shows in the Application ID column.
      (!idQuery || String(window.getDisplayApplicationId(app)).toLowerCase().includes(idQuery))
  )
  const totalRows = filteredApplications.length
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE)
  const pageApplications = filteredApplications.slice(startIdx, endIdx)

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">
            {inDetailsView ? `Submitted Applications - ${selectedBlock.block_name || selectedBlock.block_code}` : 'Submitted Applications'}
          </h3>
          {/* <p className="view-subtitle">
            {inDetailsView
              ? 'Applications submitted by BEO to SCERT in selected block.'
              : 'Block-wise submitted applications count (BEO to SCERT).'}
          </p> */}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {inDetailsView && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedBlock(null)
                setApplications([])
                setViewingApplicationId(null)
              }}
              disabled={loading}
            >
              Back
            </button>
          )}
          {inDetailsView && viewingApplicationId ? (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => setViewingApplicationId(null)}
              disabled={loading}
            >
              Back to Submitted List
            </button>
          ) : null}
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => (inDetailsView ? fetchBlockApplications(selectedBlock.block_code) : fetchSummary())}
            disabled={loading || !canFetch}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading...</div>
      ) : !inDetailsView ? (
        blocks.length === 0 ? (
          <div className="empty-state">No submitted applications found for this district.</div>
        ) : (
          <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>S.No</th>
                  <th>Block Name</th>
                  <th style={{ width: 160 }}>Block Code</th>
                  <th style={{ width: 220 }}>No. of Submitted Applications</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b, idx) => (
                  <tr
                    key={`${b.block_code}-${idx}`}
                    style={{ cursor: 'pointer' }}
                    title="Click to view submitted applications"
                    onClick={() => {
                      setSelectedBlock(b)
                      fetchBlockApplications(b.block_code)
                    }}
                  >
                    <td className="smart-table-strong">{idx + 1}</td>
                    <td className="smart-table-strong">{b.block_name || '-'}</td>
                    <td>{b.block_code || '-'}</td>
                    <td className="smart-table-strong">{b.submitted_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {!viewingApplicationId ? (
            <div className="filters-bar" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', maxWidth: '100%' }}>
              {!isNmmssScholarship ? (
                <div className="filter-group">
                  <label className="filter-label">Class</label>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      type="button"
                      className={`filter-btn ${classFilter === '' ? 'filter-btn-active' : ''}`}
                      onClick={() => setClassFilter('')}
                    >
                      All
                    </button>
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
                <label className="filter-label" htmlFor="district-submitted-school-filter">School</label>
                <select
                  id="district-submitted-school-filter"
                  className="form-input"
                  value={schoolFilter}
                  onChange={(e) => setSchoolFilter(e.target.value)}
                  style={{ minWidth: '260px', maxWidth: '100%' }}
                >
                  <option value="">All Schools</option>
                  {schoolOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              {isNmmssScholarship ? (
                <div className="filter-group">
                  <label className="filter-label" htmlFor="district-submitted-exam-code-filter">Exam Code</label>
                  <select
                    id="district-submitted-exam-code-filter"
                    className="form-input"
                    value={examCodeFilter}
                    onChange={(e) => setExamCodeFilter(e.target.value)}
                    style={{ minWidth: '200px' }}
                  >
                    <option value="">All Codes</option>
                    <option value="1">Code 1 (NMMSS)</option>
                    <option value="2">Code 2 (SNSS / SSSS)</option>
                  </select>
                </div>
              ) : null}
              <div className="filter-group">
                <label className="filter-label" htmlFor="district-submitted-id-filter">Application ID</label>
                <input
                  id="district-submitted-id-filter"
                  type="search"
                  className="form-input"
                  value={applicationIdQuery}
                  onChange={(e) => setApplicationIdQuery(e.target.value)}
                  placeholder="Search by Application ID"
                  style={{ minWidth: '180px', maxWidth: '100%' }}
                />
              </div>
              {filtersActive ? (
                <div className="filter-group">
                  <button
                    type="button"
                    className="scert-btn-secondary"
                    onClick={() => {
                      setSchoolFilter('')
                      setExamCodeFilter('')
                      setApplicationIdQuery('')
                    }}
                  >
                    Clear Filters
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {viewingApplicationId ? (
            <div className="application-viewer">
              <DistrictApplicationViewer
                key={String(viewingApplicationId)}
                applicationId={viewingApplicationId}
                sessionId={sessionId}
                onBack={() => setViewingApplicationId(null)}
              />
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="empty-state">
              {filtersActive
                ? 'No submitted applications found for the selected filters.'
                : 'No submitted applications found for selected block.'}
            </div>
          ) : (
            <>
            <div className="smart-table-wrap district-submitted-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
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
              {pageApplications.map((row, idx) =>
                isNmmssScholarship ? (
                  <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                    <td>
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        style={{ padding: '0.45rem 0.65rem' }}
                        onClick={() => setViewingApplicationId(row.application_id)}
                        title="View application details"
                      >
                        <HiOutlineEye />
                      </button>
                    </td>
                    <td>{startIdx + idx + 1}</td>
                    <td>{row.block_code || '-'}</td>
                    <td>{pickFirst(row, ['exam_code']) || '-'}</td>
                    <td><code className="smart-table-id smart-table-id--strong">{window.getDisplayApplicationId(row)}</code></td>
                    <td className="smart-table-strong">{row.roll_number || '-'}</td>
                    <td>{getStudentRegistrationNo(row)}</td>
                    <td>{row.candidate_name || row.student_name || '-'}</td>
                    <td>{row.father_name || '-'}</td>
                    <td>{row.mother_name || '-'}</td>
                    <td>{formatMaybeDate(row.date_of_birth || row.dob)}</td>
                    <td>{row.sex || row.gender || '-'}</td>
                    <td>{row.caste_category || '-'}</td>
                    <td>{formatDivyangta(row.type_of_divyangta, row)}</td>
                    <td>{pickFirst(row, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7']) || '-'}</td>
                    <td>{pickFirst(row, ['parental_income_code', 'income_code']) || '-'}</td>
                    <td>{row.aadhaar_number || '-'}</td>
                    <td>{row.school_name || row.origin_school || '-'}</td>
                    <td>{row.block_name || '-'}</td>
                    <td>{row.district_name || row.district || row.district_code || '-'}</td>
                    <td>{row.school_type || '-'}</td>
                    <td>{row.school_category || '-'}</td>
                    <td>{row.center_order || '-'}</td>
                    <td>{row.center_name || '-'}</td>
                    <td>{row.contact_no || '-'}</td>
                    <td>{formatAttendanceFlag(pickFirst(row, ['mat', 'mat_status']))}</td>
                    <td>{formatAttendanceFlag(pickFirst(row, ['sat', 'sat_status']))}</td>
                  </tr>
                ) : (
                  <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                    <td>
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        style={{ padding: '0.45rem 0.65rem' }}
                        onClick={() => setViewingApplicationId(row.application_id)}
                        title="View application details"
                      >
                        <HiOutlineEye />
                      </button>
                    </td>
                    <td>{startIdx + idx + 1}</td>
                    <td>{row.block_code || '-'}</td>
                    <td><code className="smart-table-id smart-table-id--strong">{window.getDisplayApplicationId(row)}</code></td>
                    <td className="smart-table-strong">{row.roll_number || '-'}</td>
                    <td>{getStudentRegistrationNo(row)}</td>
                    <td>{row.candidate_name || row.student_name || '-'}</td>
                    <td>{row.father_name || '-'}</td>
                    <td>{row.mother_name || '-'}</td>
                    <td>{formatMaybeDate(row.date_of_birth || row.dob)}</td>
                    <td>{row.sex || row.gender || '-'}</td>
                    <td>{row.caste_category || '-'}</td>
                    <td>{formatDivyangta(row.type_of_divyangta, row)}</td>
                    <td>{row.aadhaar_number || '-'}</td>
                    <td>{row.school_name || row.origin_school || '-'}</td>
                    <td>{row.block_name || '-'}</td>
                    <td>{row.district_name || row.district || row.district_code || '-'}</td>
                    <td>{row.school_type || '-'}</td>
                    <td>{row.school_category || '-'}</td>
                    <td>{row.previous_school_name || '-'}</td>
                    <td>{row.previous_school_type || '-'}</td>
                    <td>{row.center_order || '-'}</td>
                    <td>{row.center_name || '-'}</td>
                    <td>{row.contact_no || '-'}</td>
                    {isCmScholarship ? <td>{formatAttendanceFlag(pickFirst(row, ['mat', 'mat_status']))}</td> : null}
                    {isCmScholarship ? <td>{formatAttendanceFlag(pickFirst(row, ['sat', 'sat_status']))}</td> : null}
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
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="pagination-info">
                Showing <strong>{totalRows === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
                <strong>{totalRows}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
              </span>
              <button
                type="button"
                className="pagination-btn"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
            </>
          )}
        </>
      )}

      {!viewingApplicationId ? (
        <div className="table-footer">
          <span className="table-count">
            Total: <strong>{inDetailsView ? filteredApplications.length : blocks.length}</strong>{' '}
            {inDetailsView ? 'application(s)' : 'block(s)'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
