import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';

export function ScertAbsenteePage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, selectedScholarshipId, scholarships } = useSession();

  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId);
  const scholarshipName =
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || '';
  const isCmScholarship = /\bCM\b/i.test(scholarshipName) || /CHIEF\s*MINISTER/i.test(scholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(scholarshipName) || /\bNMMS\b/i.test(scholarshipName);
  const firstClassFilter = isNmmssScholarship ? '8' : '6';
  const secondClassFilter = isCmScholarship ? '9' : null;
  const firstClassLabel = `Class ${firstClassFilter}`;
  const showSecondClassGroup = String(selectedScholarshipId) !== '6' && Boolean(secondClassFilter);
  const secondClassLabel = secondClassFilter ? `Class ${secondClassFilter}` : '';

  const fetchCentersWithAttendanceSummary = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);

      const centersData = await get(`/api/scert/centers?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      const centersList = Array.isArray(centersData.centers) ? centersData.centers : [];

      const enrichedCentersPromises = centersList.map(async (center) => {
        try {
          let firstClassSummary = null;
          try {
            const firstClassData = await get(
              `/api/scert/centers/${center.center_id}/attendance-summary?scholarship_id=${selectedScholarshipId}&class_filter=${firstClassFilter}`,
              { token: auth?.token, sessionId }
            );
            firstClassSummary = firstClassData?.summary || null;
          } catch {
            firstClassSummary = null;
          }

          let secondClassSummary = null;
          if (secondClassFilter) {
            try {
              const secondClassData = await get(
                `/api/scert/centers/${center.center_id}/attendance-summary?scholarship_id=${selectedScholarshipId}&class_filter=${secondClassFilter}`,
                { token: auth?.token, sessionId }
              );
              secondClassSummary = secondClassData?.summary || null;
            } catch {
              secondClassSummary = null;
            }
          }

          // "Registered" counts applications the BEO has submitted to SCERT (and that
          // have not been returned), not only those SCERT has approved.
          return {
            ...center,
            first_class_registered: Number(center.first_class_submitted || 0),
            first_class_mat_present: Number(firstClassSummary?.mat_present || 0),
            first_class_mat_absent: Number(firstClassSummary?.mat_absent || 0),
            first_class_sat_present: Number(firstClassSummary?.sat_present || 0),
            first_class_sat_absent: Number(firstClassSummary?.sat_absent || 0),
            second_class_registered: Number(center.second_class_submitted || 0),
            second_class_mat_present: Number(secondClassSummary?.mat_present || 0),
            second_class_mat_absent: Number(secondClassSummary?.mat_absent || 0),
            second_class_sat_present: Number(secondClassSummary?.sat_present || 0),
            second_class_sat_absent: Number(secondClassSummary?.sat_absent || 0),
          };
        } catch (err) {
          console.warn(`Attendance summary not available for center ${center.center_id}`);
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
          };
        }
      });

      const enrichedCenters = await Promise.all(enrichedCentersPromises);
      setCenters(enrichedCenters);
    } catch (err) {
      console.error('Failed to fetch centers:', err);
      setError(err.message || 'Failed to load centers');
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
      setCenters([]);
    } finally {
      setLoading(false);
    }
  }, [
    canFetch,
    selectedScholarshipId,
    auth?.token,
    sessionId,
    toast,
    firstClassFilter,
    secondClassFilter,
  ]);

  useEffect(() => {
    if (canFetch) {
      fetchCentersWithAttendanceSummary();
    } else {
      setCenters([]);
    }
  }, [sessionId, selectedScholarshipId, canFetch, fetchCentersWithAttendanceSummary]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, centers.length]);

  const attendanceTotals = useMemo(
    () =>
      centers.reduce(
        (acc, center) => {
          acc.first_class_registered += Number(center.first_class_registered || 0);
          acc.first_class_mat_present += Number(center.first_class_mat_present || 0);
          acc.first_class_mat_absent += Number(center.first_class_mat_absent || 0);
          acc.first_class_sat_present += Number(center.first_class_sat_present || 0);
          acc.first_class_sat_absent += Number(center.first_class_sat_absent || 0);

          if (showSecondClassGroup) {
            acc.second_class_registered += Number(center.second_class_registered || 0);
            acc.second_class_mat_present += Number(center.second_class_mat_present || 0);
            acc.second_class_mat_absent += Number(center.second_class_mat_absent || 0);
            acc.second_class_sat_present += Number(center.second_class_sat_present || 0);
            acc.second_class_sat_absent += Number(center.second_class_sat_absent || 0);
          }

          return acc;
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
        }
      ),
    [centers, showSecondClassGroup]
  );

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }
  const totalRows = centers.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE);
  const pageCenters = centers.slice(startIdx, endIdx);

  const handleDownloadPdf = () => {
    if (centers.length === 0) {
      toast.error('No centers data to download');
      return;
    }

    try {
      const headerTop = `
        <tr>
          <th rowspan="3">S.No</th>
          <th rowspan="3">District Code</th>
          <th rowspan="3">District Name</th>
          <th rowspan="3">Block Code</th>
          <th rowspan="3">Block Name</th>
          <th rowspan="3">Centre Code</th>
          <th rowspan="3">Name of Examination Centre</th>
          <th colspan="5">${firstClassLabel}</th>
          ${showSecondClassGroup ? `<th colspan="5">${secondClassLabel}</th>` : ''}
          <th rowspan="3">Name of Center Superintendent</th>
          <th rowspan="3">Mobile No</th>
        </tr>
      `;

      const headerMid = `
        <tr>
          <th rowspan="2">Registered</th>
          <th colspan="2">MAT</th>
          <th colspan="2">SAT</th>
          ${showSecondClassGroup ? `
            <th rowspan="2">Registered</th>
            <th colspan="2">MAT</th>
            <th colspan="2">SAT</th>
          ` : ''}
        </tr>
      `;

      const headerLow = `
        <tr>
          <th>Present</th>
          <th>Absent</th>
          <th>Present</th>
          <th>Absent</th>
          ${showSecondClassGroup ? `
            <th>Present</th>
            <th>Absent</th>
            <th>Present</th>
            <th>Absent</th>
          ` : ''}
        </tr>
      `;

      const rowsHtml = centers
        .map((center, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${center.district_code || '—'}</td>
            <td>${center.district_name || '—'}</td>
            <td>${center.block_code || '—'}</td>
            <td>${center.block_name || '—'}</td>
            <td>${center.center_order || '—'}</td>
            <td>${center.school_name || '—'}</td>
            <td>${center.first_class_registered || 0}</td>
            <td>${center.first_class_mat_present || 0}</td>
            <td>${center.first_class_mat_absent || 0}</td>
            <td>${center.first_class_sat_present || 0}</td>
            <td>${center.first_class_sat_absent || 0}</td>
            ${showSecondClassGroup ? `
              <td>${center.second_class_registered || 0}</td>
              <td>${center.second_class_mat_present || 0}</td>
              <td>${center.second_class_mat_absent || 0}</td>
              <td>${center.second_class_sat_present || 0}</td>
              <td>${center.second_class_sat_absent || 0}</td>
            ` : ''}
            <td>${center.superintendent_name || '—'}</td>
            <td>${center.superintendent_mobile || '—'}</td>
          </tr>
        `)
        .join('');

      const totals = centers.reduce(
        (acc, center) => ({
          first_class_registered: acc.first_class_registered + Number(center.first_class_registered || 0),
          first_class_mat_present: acc.first_class_mat_present + Number(center.first_class_mat_present || 0),
          first_class_mat_absent: acc.first_class_mat_absent + Number(center.first_class_mat_absent || 0),
          first_class_sat_present: acc.first_class_sat_present + Number(center.first_class_sat_present || 0),
          first_class_sat_absent: acc.first_class_sat_absent + Number(center.first_class_sat_absent || 0),
          second_class_registered: acc.second_class_registered + Number(center.second_class_registered || 0),
          second_class_mat_present: acc.second_class_mat_present + Number(center.second_class_mat_present || 0),
          second_class_mat_absent: acc.second_class_mat_absent + Number(center.second_class_mat_absent || 0),
          second_class_sat_present: acc.second_class_sat_present + Number(center.second_class_sat_present || 0),
          second_class_sat_absent: acc.second_class_sat_absent + Number(center.second_class_sat_absent || 0),
        }),
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
        }
      );

      const totalsRowHtml = `
        <tr style="font-weight:700;background:#f8fafc;">
          <td colspan="7">Total</td>
          <td>${totals.first_class_registered}</td>
          <td>${totals.first_class_mat_present}</td>
          <td>${totals.first_class_mat_absent}</td>
          <td>${totals.first_class_sat_present}</td>
          <td>${totals.first_class_sat_absent}</td>
          ${showSecondClassGroup ? `
            <td>${totals.second_class_registered}</td>
            <td>${totals.second_class_mat_present}</td>
            <td>${totals.second_class_mat_absent}</td>
            <td>${totals.second_class_sat_present}</td>
            <td>${totals.second_class_sat_absent}</td>
          ` : ''}
          <td>—</td>
          <td>—</td>
        </tr>
      `;

      const html = `
        <html>
          <head>
            <title>Absentee During Examination</title>
            <style>
              @media print { @page { size: A4 portrait; margin: 10mm; } }
              body { font-family: Arial, sans-serif; margin: 10px; }
              h2 { text-align: center; margin: 0 0 10px; font-size: 16px; }
              table { width: 100%; border-collapse: collapse; font-size: 10px; }
              th, td { border: 1px solid #000; padding: 4px 3px; text-align: center; vertical-align: middle; }
              th { background: #f3f4f6; font-weight: 700; }
            </style>
          </head>
          <body>
            <h2>Absentee During Examination</h2>
            <table>
              <thead>
                ${headerTop}
                ${headerMid}
                ${headerLow}
              </thead>
              <tbody>${rowsHtml}${totalsRowHtml}</tbody>
            </table>
          </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Please allow pop-ups to download PDF');
        return;
      }
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 250);
      toast.success('PDF opened successfully');
    } catch (err) {
      console.error('Failed to download PDF:', err);
      toast.error(`Failed to download PDF: ${err.message || 'Unknown error'}`);
    }
  };

  const handleDownloadCsv = () => {
    if (centers.length === 0) {
      toast.error('No centers data to download');
      return;
    }

    const escapeCsv = (value) => {
      const str = String(value ?? '');
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

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
      'Name of Center Superintendent',
      'Mobile No',
    ];

    const rows = centers.map((center, idx) => [
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
      center.superintendent_name || '—',
      center.superintendent_mobile || '—',
    ]);

    const totals = centers.reduce(
      (acc, center) => ({
        first_class_registered: acc.first_class_registered + Number(center.first_class_registered || 0),
        first_class_mat_present: acc.first_class_mat_present + Number(center.first_class_mat_present || 0),
        first_class_mat_absent: acc.first_class_mat_absent + Number(center.first_class_mat_absent || 0),
        first_class_sat_present: acc.first_class_sat_present + Number(center.first_class_sat_present || 0),
        first_class_sat_absent: acc.first_class_sat_absent + Number(center.first_class_sat_absent || 0),
        second_class_registered: acc.second_class_registered + Number(center.second_class_registered || 0),
        second_class_mat_present: acc.second_class_mat_present + Number(center.second_class_mat_present || 0),
        second_class_mat_absent: acc.second_class_mat_absent + Number(center.second_class_mat_absent || 0),
        second_class_sat_present: acc.second_class_sat_present + Number(center.second_class_sat_present || 0),
        second_class_sat_absent: acc.second_class_sat_absent + Number(center.second_class_sat_absent || 0),
      }),
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
      }
    );

    rows.push([
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.first_class_registered,
      totals.first_class_mat_present,
      totals.first_class_mat_absent,
      totals.first_class_sat_present,
      totals.first_class_sat_absent,
      ...(showSecondClassGroup
        ? [
            totals.second_class_registered,
            totals.second_class_mat_present,
            totals.second_class_mat_absent,
            totals.second_class_sat_present,
            totals.second_class_sat_absent,
          ]
        : []),
      '—',
      '—',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scert_absentee_during_exam_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded successfully');
  };

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Absentee During Examination</h3>
              
            </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="scert-btn-primary"
              onClick={() => setDownloadMenuOpen((prev) => !prev)}
              disabled={loading || centers.length === 0}
            >
              Download
            </button>
            {downloadMenuOpen ? (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 6px)',
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
                  minWidth: '140px',
                  zIndex: 20,
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  className="scert-btn-secondary"
                  style={{ width: '100%', border: 'none', borderRadius: 0, textAlign: 'left' }}
                  onClick={() => {
                    setDownloadMenuOpen(false);
                    handleDownloadPdf();
                  }}
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  className="scert-btn-secondary"
                  style={{ width: '100%', border: 'none', borderRadius: 0, textAlign: 'left' }}
                  onClick={() => {
                    setDownloadMenuOpen(false);
                    handleDownloadCsv();
                  }}
                >
                  Download CSV
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchCentersWithAttendanceSummary}
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
          <div className="smart-table-wrap scert-list-centers-table-wrap" style={{ overflowX: 'auto' }}>
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
                {pageCenters.map((center, idx) => (
                  <tr key={center.center_id} className={window.getSubmissionRoleRowClass(center)}>
                    <td style={{ borderRight: '2px solid #ccc' }}>{startIdx + idx + 1}</td>
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

                    <td style={{ borderRight: '2px solid #ccc' }}>{center.superintendent_name || '—'}</td>
                    <td>{center.superintendent_mobile || '—'}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                  <td colSpan={7} style={{ textAlign: 'left' }}>Total</td>
                  <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.first_class_registered}</td>
                  <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.first_class_mat_present}</td>
                  <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.first_class_mat_absent}</td>
                  <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.first_class_sat_present}</td>
                  <td style={{ borderRight: '2px solid #ccc' }}>{attendanceTotals.first_class_sat_absent}</td>

                  {showSecondClassGroup && (
                    <>
                      <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.second_class_registered}</td>
                      <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.second_class_mat_present}</td>
                      <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.second_class_mat_absent}</td>
                      <td style={{ borderRight: '1px solid #ddd' }}>{attendanceTotals.second_class_sat_present}</td>
                      <td style={{ borderRight: '2px solid #ccc' }}>{attendanceTotals.second_class_sat_absent}</td>
                    </>
                  )}

                  <td style={{ borderRight: '2px solid #ccc' }}>—</td>
                  <td>—</td>
                </tr>
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

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{centers.length}</strong> center(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
