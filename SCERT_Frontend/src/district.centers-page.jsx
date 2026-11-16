import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { get } from './apiClient.js'
import { useToast } from './ToastContext.jsx'

export function DistrictCentersPage({ sessionId, selectedScholarshipId, selectedScholarshipName = '' }) {
  const { auth } = useAuth()
  const toast = useToast()

  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId)
  const scholarshipName = String(selectedScholarshipName || '')
  const isNmmssScholarship =
    String(selectedScholarshipId) === '6' ||
    /\bNMMSS\b/i.test(scholarshipName) ||
    /\bNMMS\b/i.test(scholarshipName) ||
    /\bSNSS\b/i.test(scholarshipName) ||
    /\bSSSS\b/i.test(scholarshipName) ||
    /\bCLASS\s*8\b/i.test(scholarshipName)
  const firstClassFilter = isNmmssScholarship ? '8' : '6'
  const secondClassFilter = isNmmssScholarship ? null : '9'
  const firstClassLabel = `Class ${firstClassFilter}`
  const showSecondClassGroup = Boolean(secondClassFilter)
  const secondClassLabel = secondClassFilter ? `Class ${secondClassFilter}` : ''
  // NMMSS has only one class (8), so "Total Registered" would just repeat
  // the Class 8 Registered figure next to it - only useful for CM, which
  // splits registration across Class 6 and Class 9.
  const showTotalRegisteredColumn = !isNmmssScholarship
  const attendanceTotals = useMemo(
    () =>
      centers.reduce(
        (acc, center) => {
          acc.first_class_registered += Number(center.first_class_registered || 0)
          acc.first_class_mat_present += Number(center.first_class_mat_present || 0)
          acc.first_class_mat_absent += Number(center.first_class_mat_absent || 0)
          acc.first_class_sat_present += Number(center.first_class_sat_present || 0)
          acc.first_class_sat_absent += Number(center.first_class_sat_absent || 0)

          if (showSecondClassGroup) {
            acc.second_class_registered += Number(center.second_class_registered || 0)
            acc.second_class_mat_present += Number(center.second_class_mat_present || 0)
            acc.second_class_mat_absent += Number(center.second_class_mat_absent || 0)
            acc.second_class_sat_present += Number(center.second_class_sat_present || 0)
            acc.second_class_sat_absent += Number(center.second_class_sat_absent || 0)
          }

          acc.total_registered += Number(center.total_registered || 0)
          return acc
        },
        {
          first_class_registered: 0,
          first_class_mat_present: 0,
          first_class_mat_absent: 0,
          first_class_sat_present: 0,
          first_class_sat_absent: 0,
          second_class_registered: 0,
          second_class_mat_present: 0,
          second_class_mat_absent: 0,
          second_class_sat_present: 0,
          second_class_sat_absent: 0,
          total_registered: 0,
        }
      ),
    [centers, showSecondClassGroup]
  )

  const fetchCentersWithAttendance = useCallback(async () => {
    if (!canFetch) return

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams()
      params.append('scholarship_id', selectedScholarshipId)

      const centersData = await get(`/api/district/centers?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      })

      const centersList = Array.isArray(centersData.centers) ? centersData.centers : []

      const enrichedCentersPromises = centersList.map(async (center) => {
        try {
          let firstClassAttendance = []
          try {
            const firstClassData = await get(
              `/api/district/centers/${center.center_id}/attendance?scholarship_id=${selectedScholarshipId}&class_filter=${firstClassFilter}`,
              { token: auth?.token, sessionId }
            )
            firstClassAttendance = Array.isArray(firstClassData?.students) ? firstClassData.students : []
          } catch {
            firstClassAttendance = []
          }

          let secondClassAttendance = []
          if (secondClassFilter) {
            try {
              const secondClassData = await get(
                `/api/district/centers/${center.center_id}/attendance?scholarship_id=${selectedScholarshipId}&class_filter=${secondClassFilter}`,
                { token: auth?.token, sessionId }
              )
              secondClassAttendance = Array.isArray(secondClassData?.students) ? secondClassData.students : []
            } catch {
              secondClassAttendance = []
            }
          }

          const firstClassStats = {
            registered: firstClassAttendance.length,
            mat_present: firstClassAttendance.filter((s) => s.mat_status === 'PRESENT').length,
            mat_absent: firstClassAttendance.filter((s) => s.mat_status === 'ABSENT').length,
            sat_present: firstClassAttendance.filter((s) => s.sat_status === 'PRESENT').length,
            sat_absent: firstClassAttendance.filter((s) => s.sat_status === 'ABSENT').length,
          }

          const secondClassStats = {
            registered: secondClassAttendance.length,
            mat_present: secondClassAttendance.filter((s) => s.mat_status === 'PRESENT').length,
            mat_absent: secondClassAttendance.filter((s) => s.mat_status === 'ABSENT').length,
            sat_present: secondClassAttendance.filter((s) => s.sat_status === 'PRESENT').length,
            sat_absent: secondClassAttendance.filter((s) => s.sat_status === 'ABSENT').length,
          }

          // Registered = applications the BEO has submitted to SCERT (and that have
          // not been returned), the same count the BEO's List of Centers uses.
          return {
            ...center,
            first_class_registered: Number(center.first_class_submitted || 0),
            first_class_mat_present: firstClassStats.mat_present,
            first_class_mat_absent: firstClassStats.mat_absent,
            first_class_sat_present: firstClassStats.sat_present,
            first_class_sat_absent: firstClassStats.sat_absent,
            second_class_registered: Number(center.second_class_submitted || 0),
            second_class_mat_present: secondClassStats.mat_present,
            second_class_mat_absent: secondClassStats.mat_absent,
            second_class_sat_present: secondClassStats.sat_present,
            second_class_sat_absent: secondClassStats.sat_absent,
            total_registered: Number(center.total_submitted || 0),
          }
        } catch {
          return {
            ...center,
            first_class_registered: Number(center.first_class_submitted || 0),
            first_class_mat_present: 0,
            first_class_mat_absent: 0,
            first_class_sat_present: 0,
            first_class_sat_absent: 0,
            second_class_registered: Number(center.second_class_submitted || 0),
            second_class_mat_present: 0,
            second_class_mat_absent: 0,
            second_class_sat_present: 0,
            second_class_sat_absent: 0,
            total_registered: Number(center.total_submitted || 0),
          }
        }
      })

      const enrichedCenters = await Promise.all(enrichedCentersPromises)
      setCenters(enrichedCenters)
    } catch (err) {
      console.error('Failed to fetch district centers:', err)
      setError(err.message || 'Failed to load centers')
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`)
      setCenters([])
    } finally {
      setLoading(false)
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId, toast, firstClassFilter, secondClassFilter])

  useEffect(() => {
    if (canFetch) {
      fetchCentersWithAttendance()
    } else {
      setCenters([])
    }
  }, [sessionId, selectedScholarshipId, canFetch, fetchCentersWithAttendance])

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>
  }

  const handleDownloadPdf = async () => {
    if (centers.length === 0) {
      toast.error('No centers data to download')
      return
    }

    try {
      const headers = [
        'S.No',
        'District Code',
        'District Name',
        'Block Code',
        'Block Name',
        'Centre Code',
        'Name of Examination Centre',
        `${firstClassLabel} Registered`,
        `${firstClassLabel} MAT Present`,
        `${firstClassLabel} MAT Absent`,
        `${firstClassLabel} SAT Present`,
        `${firstClassLabel} SAT Absent`,
        ...(showSecondClassGroup
          ? [
              `${secondClassLabel} Registered`,
              `${secondClassLabel} MAT Present`,
              `${secondClassLabel} MAT Absent`,
              `${secondClassLabel} SAT Present`,
              `${secondClassLabel} SAT Absent`,
            ]
          : []),
        ...(showTotalRegisteredColumn ? ['Total Registered'] : []),
        'Name of Center Superintendent',
        'Mobile No',
      ]

      const escapeHtml = (value) =>
        String(value ?? '—')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')

      const rowsHtml = centers
        .map((center, idx) => {
          const row = [
            idx + 1,
            center.district_code || '—',
            center.district_name || '—',
            center.block_code || '—',
            center.block_name || '—',
            center.center_order || '—',
            center.school_name || '—',
            center.first_class_registered || 0,
            center.first_class_mat_present || 0,
            center.first_class_mat_absent || 0,
            center.first_class_sat_present || 0,
            center.first_class_sat_absent || 0,
            ...(showSecondClassGroup
              ? [
                  center.second_class_registered || 0,
                  center.second_class_mat_present || 0,
                  center.second_class_mat_absent || 0,
                  center.second_class_sat_present || 0,
                  center.second_class_sat_absent || 0,
                ]
              : []),
            ...(showTotalRegisteredColumn ? [center.total_registered || 0] : []),
            center.superintendent_name || '—',
            center.superintendent_mobile || '—',
          ]
          return `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
        })
        .join('')
      const totalLabelColSpan = 7
      const secondClassTotalsHtml = showSecondClassGroup
        ? `
        <td>${escapeHtml(attendanceTotals.second_class_registered)}</td>
        <td>${escapeHtml(attendanceTotals.second_class_mat_present)}</td>
        <td>${escapeHtml(attendanceTotals.second_class_mat_absent)}</td>
        <td>${escapeHtml(attendanceTotals.second_class_sat_present)}</td>
        <td style="border-right:2px solid #000;">${escapeHtml(attendanceTotals.second_class_sat_absent)}</td>
        `
        : ''
      const totalRowHtml = `<tr>
        <td colspan="${totalLabelColSpan}" style="text-align:left;font-weight:700;">Total Registered</td>
        <td>${escapeHtml(attendanceTotals.first_class_registered)}</td>
        <td>${escapeHtml(attendanceTotals.first_class_mat_present)}</td>
        <td>${escapeHtml(attendanceTotals.first_class_mat_absent)}</td>
        <td>${escapeHtml(attendanceTotals.first_class_sat_present)}</td>
        <td style="border-right:2px solid #000;">${escapeHtml(attendanceTotals.first_class_sat_absent)}</td>
        ${secondClassTotalsHtml}
        ${showTotalRegisteredColumn ? `<td style="font-weight:700;">${escapeHtml(attendanceTotals.total_registered)}</td>` : ''}
        <td>—</td>
        <td>—</td>
      </tr>`

      const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>District List of Centers</title>
    <style>
      @media print { @page { size: A4 landscape; margin: 10mm; } }
      body { font-family: Arial, sans-serif; margin: 0; color: #111; }
      h2 { margin: 0 0 8px; text-align: center; font-size: 18px; }
      .meta { margin: 0 0 12px; text-align: center; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; table-layout: auto; }
      th, td { border: 1px solid #000; padding: 4px 6px; font-size: 11px; text-align: center; vertical-align: middle; }
      th { background: #f4f4f4; font-weight: 700; }
      tbody td:nth-child(7) { text-align: left; }
    </style>
  </head>
  <body>
    <h2>District List of Centers</h2>
    <p class="meta">Generated on ${new Date().toLocaleString()}</p>
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rowsHtml}
        ${totalRowHtml}
      </tbody>
    </table>
  </body>
</html>`

      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        toast.error('Please allow pop-ups to download PDF')
        return
      }
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => printWindow.print(), 250)
      toast.success('PDF ready for download')
    } catch (err) {
      console.error('Failed to download PDF:', err)
      toast.error(`Failed to download PDF: ${err.message || 'Unknown error'}`)
    }
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">List of Centers</h3>
              
            </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="scert-btn-primary"
            onClick={handleDownloadPdf}
            disabled={loading || centers.length === 0}
          >
            Download PDF
          </button>

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchCentersWithAttendance}
            disabled={!canFetch || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading centers...</div>
      ) : centers.length === 0 ? (
        <div className="empty-state">No centers found for the selected scholarship.</div>
      ) : (
        <>
          <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table">
              <thead>
                <tr>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>S.No</th>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>District Code</th>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>District Name</th>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>Block Code</th>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>Block Name</th>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>Centre Code</th>
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>Name of Examination Centre</th>

                  <th colSpan="5" style={{ textAlign: 'center', borderRight: '2px solid #ccc' }}>
                    {firstClassLabel}
                  </th>
                  {showSecondClassGroup && (
                    <th colSpan="5" style={{ textAlign: 'center', borderRight: '2px solid #ccc' }}>
                      {secondClassLabel}
                    </th>
                  )}

                  {showTotalRegisteredColumn && (
                    <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>Total Registered</th>
                  )}
                  <th rowSpan="3" style={{ borderRight: '2px solid #ccc' }}>Name of Center Superintendent</th>
                  <th rowSpan="3">Mobile No</th>
                </tr>

                <tr>
                  <th rowSpan="2" style={{ borderRight: '1px solid #ddd' }}>Registered</th>
                  <th colSpan="2" style={{ textAlign: 'center', borderRight: '1px solid #ddd' }}>MAT</th>
                  <th colSpan="2" style={{ textAlign: 'center', borderRight: '2px solid #ccc' }}>SAT</th>

                  {showSecondClassGroup && (
                    <>
                      <th rowSpan="2" style={{ borderRight: '1px solid #ddd' }}>Registered</th>
                      <th colSpan="2" style={{ textAlign: 'center', borderRight: '1px solid #ddd' }}>MAT</th>
                      <th colSpan="2" style={{ textAlign: 'center', borderRight: '2px solid #ccc' }}>SAT</th>
                    </>
                  )}
                </tr>

                <tr>
                  <th style={{ borderRight: '1px solid #ddd' }}>Present</th>
                  <th style={{ borderRight: '1px solid #ddd' }}>Absent</th>
                  <th style={{ borderRight: '1px solid #ddd' }}>Present</th>
                  <th style={{ borderRight: '2px solid #ccc' }}>Absent</th>

                  {showSecondClassGroup && (
                    <>
                      <th style={{ borderRight: '1px solid #ddd' }}>Present</th>
                      <th style={{ borderRight: '1px solid #ddd' }}>Absent</th>
                      <th style={{ borderRight: '1px solid #ddd' }}>Present</th>
                      <th style={{ borderRight: '2px solid #ccc' }}>Absent</th>
                    </>
                  )}
                </tr>
              </thead>

              <tbody>
                {centers.map((center, idx) => (
                  <tr key={center.center_id} className={window.getSubmissionRoleRowClass(center)}>
                    <td style={{ borderRight: '2px solid #ccc' }}>{idx + 1}</td>
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.district_code || '—'}</td>
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.district_name || '—'}</td>
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.block_code || '—'}</td>
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.block_name || '—'}</td>
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.center_order || '—'}</td>
                    <td className="smart-table-strong" style={{ borderRight: '2px solid #ccc' }}>
                      {center.school_name || '—'}
                    </td>

                    <td style={{ borderRight: '1px solid #ddd' }}>{center.first_class_registered || 0}</td>
                    <td style={{ borderRight: '1px solid #ddd' }}>{center.first_class_mat_present || 0}</td>
                    <td style={{ borderRight: '1px solid #ddd' }}>{center.first_class_mat_absent || 0}</td>
                    <td style={{ borderRight: '1px solid #ddd' }}>{center.first_class_sat_present || 0}</td>
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.first_class_sat_absent || 0}</td>

                    {showSecondClassGroup && (
                      <>
                        <td style={{ borderRight: '1px solid #ddd' }}>{center.second_class_registered || 0}</td>
                        <td style={{ borderRight: '1px solid #ddd' }}>{center.second_class_mat_present || 0}</td>
                        <td style={{ borderRight: '1px solid #ddd' }}>{center.second_class_mat_absent || 0}</td>
                        <td style={{ borderRight: '1px solid #ddd' }}>{center.second_class_sat_present || 0}</td>
                        <td style={{ borderRight: '2px solid #ccc' }}>{center.second_class_sat_absent || 0}</td>
                      </>
                    )}

                    {showTotalRegisteredColumn && (
                      <td style={{ borderRight: '2px solid #ccc' }}>{center.total_registered || 0}</td>
                    )}
                    <td style={{ borderRight: '2px solid #ccc' }}>{center.superintendent_name || '—'}</td>
                    <td>{center.superintendent_mobile || '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={7} style={{ textAlign: 'left', fontWeight: 700 }}>Total Registered</td>
                  <td>{attendanceTotals.first_class_registered}</td>
                  <td>{attendanceTotals.first_class_mat_present}</td>
                  <td>{attendanceTotals.first_class_mat_absent}</td>
                  <td>{attendanceTotals.first_class_sat_present}</td>
                  <td style={{ borderRight: '2px solid #ccc' }}>{attendanceTotals.first_class_sat_absent}</td>
                  {showSecondClassGroup && (
                    <>
                      <td>{attendanceTotals.second_class_registered}</td>
                      <td>{attendanceTotals.second_class_mat_present}</td>
                      <td>{attendanceTotals.second_class_mat_absent}</td>
                      <td>{attendanceTotals.second_class_sat_present}</td>
                      <td style={{ borderRight: '2px solid #ccc' }}>{attendanceTotals.second_class_sat_absent}</td>
                    </>
                  )}
                  {showTotalRegisteredColumn && (
                    <td style={{ borderRight: '2px solid #ccc', fontWeight: 700 }}>{attendanceTotals.total_registered}</td>
                  )}
                  <td style={{ borderRight: '2px solid #ccc' }}>—</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{centers.length}</strong> center(s)
            </span>
          </div>
        </>
      )}
    </div>
  )
}
