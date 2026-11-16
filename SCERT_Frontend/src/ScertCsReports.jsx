import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { downloadXlsx } from './utils/xlsxExport.js';
import { sortStaffRows, displayStaffRole, isContingenceRole } from './utils/csStaffRoles.js';

export function ScertCsReports() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, sessions, selectedScholarshipId, scholarships } = useSession();
  const selectedSessionName = String(
    sessions?.find((s) => String(s?.session_id) === String(sessionId))?.session_name || ''
  );
  const selectedScholarshipName = String(
    scholarships?.find((s) => String(s?.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );
  const isCmScholarship =
    /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(selectedScholarshipName) ||
    /\bNMMS\b/i.test(selectedScholarshipName) ||
    /\bSNSS\b/i.test(selectedScholarshipName) ||
    /\bSSSS\b/i.test(selectedScholarshipName) ||
    /\bCLASS\s*8\b/i.test(selectedScholarshipName);
  const attendanceClassFilters = isNmmssScholarship ? ['8'] : isCmScholarship ? ['6', '9'] : ['8'];

  // Drilldown (same UX as “List of Centers”)
  const [level, setLevel] = useState('district'); // district | block | center
  const [selectedDistrict, setSelectedDistrict] = useState(null); // { district_code, district_name }
  const [selectedBlock, setSelectedBlock] = useState(null); // { block_code, block_name }

  const [districts, setDistricts] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [centers, setCenters] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');

  // Details view
  const [selectedCenterId, setSelectedCenterId] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [detailAttendanceSummary, setDetailAttendanceSummary] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportReloadNonce, setReportReloadNonce] = useState(0);
  const [downloadingDistrict, setDownloadingDistrict] = useState(false);

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId);
  const formatAmount = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2);
  };
  const toNumberSafe = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  // Invigilator and Reliever are shown as one column. Its rate is the sum of
  // their two configured rates (Rate Configuration); 200 + 0 until loaded.
  // The headcount next to it is the combined headcount of both roles (see
  // total_invigilators below), since the amount covers both.
  const [combinedRate, setCombinedRate] = useState(200);
  useEffect(() => {
    if (!auth?.token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/api/scert/rates/honorarium', { token: auth.token });
        const rates = Array.isArray(data?.rates) ? data.rates : [];
        const rateOf = (word) =>
          rates
            .filter((r) => String(r.staff_role || '').toLowerCase().includes(word))
            .reduce((sum, r) => sum + toNumberSafe(r.honorarium_per_unit), 0);
        const total = rateOf('invigilator') + rateOf('reliever');
        if (!cancelled && total > 0) setCombinedRate(total);
      } catch {
        // keep the default; the amounts themselves do not depend on it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  /**
   * Invigilator + Reliever amount of one centre; null while it has no report.
   * Combined headcount x the combined rate (not the sum of what was actually
   * entered per role) - a center with 8 invigilators and 1 reliever is paid
   * for 9 people at the combined rate, e.g. 9 x 200.
   */
  const invigilatorRelieverAmount = (c) => {
    const hasValue = (v) => v !== null && v !== undefined && v !== '';
    if (!hasValue(c?.invigilator_hon_amount) && !hasValue(c?.reliever_amount)) return null;
    return combinedRate * toNumberSafe(c.total_invigilators);
  };

  /**
   * Grand total for the list/PDF/Excel view: the stored grand_total_amount
   * was computed from the actual per-role Invigilator/Reliever amounts, so it
   * no longer matches the combined column above (which now shows count x
   * combined rate instead). Recompute it here from the columns actually on
   * screen so the row always adds up.
   */
  const grandTotalDisplay = (c) => {
    const hasValue = (v) => v !== null && v !== undefined && v !== '';
    if (!hasValue(c?.grand_total_amount)) return null;
    return (
      toNumberSafe(c.cent_sup_amount) +
      toNumberSafe(c.exam_incharge_amount) +
      combinedRate * toNumberSafe(c.total_invigilators) +
      toNumberSafe(c.office_asst_amount) +
      toNumberSafe(c.peon_amount) +
      toNumberSafe(c.observer_amount) +
      toNumberSafe(c.contingency_amount) +
      toNumberSafe(c.other_expenses_amount)
    );
  };
  const normalizeAttendanceRows = (rows = []) =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const totalEnrolled = toNumberSafe(row?.total_enrolled ?? row?.total_students);
      const matPresent = toNumberSafe(row?.mat_present);
      const matAbsent = toNumberSafe(row?.mat_absent);
      const satPresent = toNumberSafe(row?.sat_present);
      const satAbsent = toNumberSafe(row?.sat_absent);

      return {
        exam_class: String(row?.exam_class ?? row?.class_level ?? ''),
        total_enrolled: totalEnrolled,
        mat_present: matPresent,
        mat_absent: matAbsent,
        mat_total: toNumberSafe(row?.mat_total) || matPresent + matAbsent || totalEnrolled,
        sat_present: satPresent,
        sat_absent: satAbsent,
        sat_total: toNumberSafe(row?.sat_total) || satPresent + satAbsent || totalEnrolled,
      };
    });
  const buildDefaultAttendanceRows = () =>
    attendanceClassFilters.map((cls) => ({
      exam_class: String(cls),
      total_enrolled: 0,
      mat_present: 0,
      mat_absent: 0,
      mat_total: 0,
      sat_present: 0,
      sat_absent: 0,
      sat_total: 0,
    }));
  const mergeWithExpectedClasses = (rows = []) => {
    const byClass = new Map(
      normalizeAttendanceRows(rows).map((r) => [String(r.exam_class || ''), r])
    );
    return attendanceClassFilters.map(
      (cls) =>
        byClass.get(String(cls)) || {
          exam_class: String(cls),
          total_enrolled: 0,
          mat_present: 0,
          mat_absent: 0,
          mat_total: 0,
          sat_present: 0,
          sat_absent: 0,
          sat_total: 0,
        }
    );
  };

  const fetchDistricts = useCallback(async () => {
    if (!canFetch) return;

    setLoadingList(true);
    setError('');

    try {
      const data = await get(
        `/api/scert/list-centers/districts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
        { token: auth?.token, sessionId }
      );

      setDistricts(Array.isArray(data?.districts) ? data.districts : []);
    } catch (err) {
      console.error('Failed to fetch district summary:', err);
      setError(err?.message || 'Failed to load districts');
      toast.error(`Failed to load districts: ${toast.getErrorMessage(err)}`);
      setDistricts([]);
    } finally {
      setLoadingList(false);
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId]);

  const fetchBlocks = useCallback(
    async (districtCode) => {
      if (!canFetch) return;

      setLoadingList(true);
      setError('');

      try {
        const data = await get(
          `/api/scert/list-centers/blocks?scholarship_id=${encodeURIComponent(
            selectedScholarshipId
          )}&district_code=${encodeURIComponent(districtCode)}`,
          { token: auth?.token, sessionId }
        );

        setBlocks(Array.isArray(data?.blocks) ? data.blocks : []);
      } catch (err) {
        console.error('Failed to fetch block summary:', err);
        setError(err?.message || 'Failed to load blocks');
        toast.error(`Failed to load blocks: ${toast.getErrorMessage(err)}`);
        setBlocks([]);
      } finally {
        setLoadingList(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId]
  );

  const fetchCenters = useCallback(
    async ({ districtCode, blockCode }) => {
      if (!canFetch) return;

      setLoadingList(true);
      setError('');

      try {
        const params = new URLSearchParams();
        params.append('session_id', sessionId);
        params.append('scholarship_id', selectedScholarshipId);
        if (blockCode) params.append('block_code', blockCode);

        const data = await get(`/api/scert/center-superintendent-reports?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });

        setCenters(Array.isArray(data?.reports) ? data.reports : []);
      } catch (err) {
        console.error('Failed to fetch CS reports:', err);
        setError(err?.message || 'Failed to load CS reports');
        toast.error(`Failed to load CS reports: ${toast.getErrorMessage(err)}`);
        setCenters([]);
      } finally {
        setLoadingList(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId]
  );

  // Reset drilldown and fetch districts when scholarship/session changes
  useEffect(() => {
    setLevel('district');
    setSelectedDistrict(null);
    setSelectedBlock(null);
    setBlocks([]);
    setCenters([]);

    setSelectedCenterId('');
    setSelectedReport(null);
    setLoadingReport(false);

    if (canFetch) {
      fetchDistricts();
    } else {
      setDistricts([]);
    }
  }, [sessionId, selectedScholarshipId, canFetch, fetchDistricts]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, level, districts.length, blocks.length, centers.length, selectedCenterId]);

  // Fetch report when a center is clicked
  useEffect(() => {
    if (!selectedCenterId || !canFetch) {
      setSelectedReport(null);
      setDetailAttendanceSummary([]);
      setLoadingReport(false);
      return;
    }

    const fetchReportData = async () => {
      setLoadingReport(true);
      setError('');

      try {
        const url = `/api/beo/center-superintendent-reports?session_id=${encodeURIComponent(
          sessionId
        )}&scholarship_id=${encodeURIComponent(
          selectedScholarshipId
        )}&center_id=${encodeURIComponent(selectedCenterId)}`;

        const data = await get(url, { token: auth?.token, sessionId });
        setSelectedReport(data);

        // Fallback attendance source (same logic intent as BEO view):
        // if report payload lacks attendance_summary, derive class-wise summary
        // from absentee upload summary for expected scholarship classes.
        const summaryResponses = await Promise.all(
          attendanceClassFilters.map(async (cls) => {
            try {
              const summaryData = await get(
                `/api/scert/centers/${encodeURIComponent(
                  selectedCenterId
                )}/attendance-summary?scholarship_id=${encodeURIComponent(
                  selectedScholarshipId
                )}&class_filter=${encodeURIComponent(cls)}`,
                { token: auth?.token, sessionId }
              );
              return {
                exam_class: String(cls),
                total_enrolled: toNumberSafe(summaryData?.summary?.total_students),
                mat_present: toNumberSafe(summaryData?.summary?.mat_present),
                mat_absent: toNumberSafe(summaryData?.summary?.mat_absent),
                mat_total:
                  toNumberSafe(summaryData?.summary?.mat_total) ||
                  toNumberSafe(summaryData?.summary?.total_students),
                sat_present: toNumberSafe(summaryData?.summary?.sat_present),
                sat_absent: toNumberSafe(summaryData?.summary?.sat_absent),
                sat_total:
                  toNumberSafe(summaryData?.summary?.sat_total) ||
                  toNumberSafe(summaryData?.summary?.total_students),
              };
            } catch {
              return {
                exam_class: String(cls),
                total_enrolled: 0,
                mat_present: 0,
                mat_absent: 0,
                mat_total: 0,
                sat_present: 0,
                sat_absent: 0,
                sat_total: 0,
              };
            }
          })
        );
        setDetailAttendanceSummary(summaryResponses);
      } catch (err) {
        console.error('Failed to fetch CS report:', err);
        setError(err?.message || 'Failed to fetch report data');
        toast.error(`Failed to load CS report: ${toast.getErrorMessage(err)}`);
        setSelectedReport(null);
        setDetailAttendanceSummary([]);
      } finally {
        setLoadingReport(false);
      }
    };

    fetchReportData();
  }, [selectedCenterId, reportReloadNonce, canFetch, sessionId, selectedScholarshipId, auth?.token]);

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }

  const isDistrictView = level === 'district';
  const isBlockView = level === 'block';
  const isCenterView = level === 'center';

  const title = selectedCenterId
    ? 'CS Report Details'
    : isDistrictView
      ? 'CS Reports'
      : isBlockView
        ? `Blocks — ${selectedDistrict?.district_name || selectedDistrict?.district_code || ''}`
        : `Centers — ${selectedBlock?.block_name || selectedBlock?.block_code || ''}`;

  const subtitle = selectedCenterId
    ? 'Detailed view of Center Superintendent Report'
    : isDistrictView
      ? 'District-wise summary of blocks and centers.'
      : isBlockView
        ? 'Block-wise summary of centers under selected district.'
        : 'Click any center to open its CS report.';

  const activeRowsCount = isDistrictView ? districts.length : isBlockView ? blocks.length : centers.length;
  const totalPages = Math.max(1, Math.ceil(activeRowsCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(activeRowsCount, startIdx + PAGE_SIZE);
  const pagedDistricts = districts.slice(startIdx, endIdx);
  const pagedBlocks = blocks.slice(startIdx, endIdx);
  const pagedCenters = centers.slice(startIdx, endIdx);

  // Amount cell for the Excel file: a real number (blank when there is no report yet).
  const excelAmount = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const downloadCentersExcel = (rows = centers, { districtLabel = null, blockLabel = null, fileTag = 'block' } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      toast.info('No CS report data to download');
      return;
    }

    const headers = [
      'District Code',
      'Block Code',
      'Block Name',
      'Centre Code',
      'Centre Name',
      'Account No',
      'IFSC Code',
      'Bank Name',
      'Total Registered Students',
      'Room',
      'No. of Invigilator + Reliever',
      'Cent. Sup. @400.00',
      'Exam Incharge @300.00',
      `Invigilator + Reliever @${combinedRate.toFixed(2)}`,
      'Office Asst. @200.00',
      'Peon @150.00',
      'Observer @400.00',
      'Conting. @200.00',
      'Other Expenses',
      'Total',
    ];

    const excelRows = rows.map((c) => [
      c.district_code || c.district_name || '',
      c.block_code || '',
      c.block_name || '',
      c.center_code || '',
      c.center_name || '',
      c.bank_account_number || '',
      c.bank_ifsc_code || '',
      c.bank_name || '',
      c.total_registered_students ?? 0,
      c.number_of_exam_rooms ?? '',
      c.total_invigilators ?? 0,
      excelAmount(c.cent_sup_amount),
      excelAmount(c.exam_incharge_amount),
      excelAmount(invigilatorRelieverAmount(c)),
      excelAmount(c.office_asst_amount),
      excelAmount(c.peon_amount),
      excelAmount(c.observer_amount),
      excelAmount(c.contingency_amount),
      excelAmount(c.other_expenses_amount),
      excelAmount(grandTotalDisplay(c)),
    ]);

    const totals = rows.reduce(
      (acc, c) => ({
        total_registered_students: acc.total_registered_students + toNumberSafe(c.total_registered_students),
        number_of_exam_rooms: acc.number_of_exam_rooms + toNumberSafe(c.number_of_exam_rooms),
        total_invigilators: acc.total_invigilators + toNumberSafe(c.total_invigilators),
        cent_sup_amount: acc.cent_sup_amount + toNumberSafe(c.cent_sup_amount),
        exam_incharge_amount: acc.exam_incharge_amount + toNumberSafe(c.exam_incharge_amount),
        invigilator_hon_amount: acc.invigilator_hon_amount + toNumberSafe(c.invigilator_hon_amount),
        office_asst_amount: acc.office_asst_amount + toNumberSafe(c.office_asst_amount),
        peon_amount: acc.peon_amount + toNumberSafe(c.peon_amount),
        reliever_amount: acc.reliever_amount + toNumberSafe(c.reliever_amount),
        observer_amount: acc.observer_amount + toNumberSafe(c.observer_amount),
        contingency_amount: acc.contingency_amount + toNumberSafe(c.contingency_amount),
        other_expenses_amount: acc.other_expenses_amount + toNumberSafe(c.other_expenses_amount),
        grand_total_amount: acc.grand_total_amount + toNumberSafe(grandTotalDisplay(c)),
      }),
      {
        total_registered_students: 0,
        number_of_exam_rooms: 0,
        total_invigilators: 0,
        cent_sup_amount: 0,
        exam_incharge_amount: 0,
        invigilator_hon_amount: 0,
        office_asst_amount: 0,
        peon_amount: 0,
        reliever_amount: 0,
        observer_amount: 0,
        contingency_amount: 0,
        other_expenses_amount: 0,
        grand_total_amount: 0,
      }
    );

    excelRows.push([
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.total_registered_students,
      totals.number_of_exam_rooms,
      totals.total_invigilators,
      totals.cent_sup_amount,
      totals.exam_incharge_amount,
      combinedRate * totals.total_invigilators,
      totals.office_asst_amount,
      totals.peon_amount,
      totals.observer_amount,
      totals.contingency_amount,
      totals.other_expenses_amount,
      totals.grand_total_amount,
    ]);

    const fileDate = new Date().toISOString().split('T')[0];
    downloadXlsx({
      headers,
      rows: excelRows,
      // Everything from "Cent. Sup." on is an amount; the columns before it
      // (account number, IFSC, codes) stay text so leading zeros survive.
      moneyColumns: headers.map((_, i) => i).filter((i) => i >= 11),
      boldLastRow: true,
      widths: [12, 12, 20, 12, 30, 20, 14, 20, 14, 8, 12, ...Array(10).fill(16)],
      sheetName: 'CS Reports',
      filename: `scert_cs_reports_${fileTag}_${fileDate}.xlsx`,
    });
  };

  const downloadCentersPdf = (
    rows = centers,
    { districtLabel = null, blockLabel = null } = {}
  ) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      toast.info('No CS report data to download');
      return;
    }

    const win = window.open('', '_blank', 'width=1400,height=900');
    if (!win) {
      toast.error('Please allow pop-ups to download PDF');
      return;
    }

    const totals = rows.reduce(
      (acc, c) => ({
        total_registered_students: acc.total_registered_students + toNumberSafe(c.total_registered_students),
        number_of_exam_rooms: acc.number_of_exam_rooms + toNumberSafe(c.number_of_exam_rooms),
        total_invigilators: acc.total_invigilators + toNumberSafe(c.total_invigilators),
        cent_sup_amount: acc.cent_sup_amount + toNumberSafe(c.cent_sup_amount),
        exam_incharge_amount: acc.exam_incharge_amount + toNumberSafe(c.exam_incharge_amount),
        invigilator_hon_amount: acc.invigilator_hon_amount + toNumberSafe(c.invigilator_hon_amount),
        office_asst_amount: acc.office_asst_amount + toNumberSafe(c.office_asst_amount),
        peon_amount: acc.peon_amount + toNumberSafe(c.peon_amount),
        reliever_amount: acc.reliever_amount + toNumberSafe(c.reliever_amount),
        observer_amount: acc.observer_amount + toNumberSafe(c.observer_amount),
        contingency_amount: acc.contingency_amount + toNumberSafe(c.contingency_amount),
        other_expenses_amount: acc.other_expenses_amount + toNumberSafe(c.other_expenses_amount),
        grand_total_amount: acc.grand_total_amount + toNumberSafe(grandTotalDisplay(c)),
      }),
      {
        total_registered_students: 0,
        number_of_exam_rooms: 0,
        total_invigilators: 0,
        cent_sup_amount: 0,
        exam_incharge_amount: 0,
        invigilator_hon_amount: 0,
        office_asst_amount: 0,
        peon_amount: 0,
        reliever_amount: 0,
        observer_amount: 0,
        contingency_amount: 0,
        other_expenses_amount: 0,
        grand_total_amount: 0,
      }
    );

    const rowsHtml = rows
      .map(
        (c) => `
      <tr>
        <td>${c.district_code || c.district_name || '—'}</td>
        <td>${c.block_code || '—'}</td>
        <td>${c.block_name || '—'}</td>
        <td>${c.center_code || '—'}</td>
        <td>${c.center_name || '—'}</td>
        <td>${c.bank_account_number || '—'}</td>
        <td>${c.bank_ifsc_code || '—'}</td>
        <td>${c.bank_name || '—'}</td>
        <td>${c.total_registered_students ?? 0}</td>
        <td>${c.number_of_exam_rooms ?? '—'}</td>
        <td>${c.total_invigilators ?? 0}</td>
        <td>${formatAmount(c.cent_sup_amount)}</td>
        <td>${formatAmount(c.exam_incharge_amount)}</td>
        <td>${formatAmount(invigilatorRelieverAmount(c))}</td>
        <td>${formatAmount(c.office_asst_amount)}</td>
        <td>${formatAmount(c.peon_amount)}</td>
        <td>${formatAmount(c.observer_amount)}</td>
        <td>${formatAmount(c.contingency_amount)}</td>
        <td>${formatAmount(c.other_expenses_amount)}</td>
        <td>${formatAmount(grandTotalDisplay(c))}</td>
      </tr>`
      )
      .join('');

    const totalsRowHtml = `
      <tr style="font-weight:700;background:#f8fafc;">
        <td colspan="8">Total</td>
        <td>${totals.total_registered_students}</td>
        <td>${totals.number_of_exam_rooms}</td>
        <td>${totals.total_invigilators}</td>
        <td>${totals.cent_sup_amount.toFixed(2)}</td>
        <td>${totals.exam_incharge_amount.toFixed(2)}</td>
        <td>${(combinedRate * totals.total_invigilators).toFixed(2)}</td>
        <td>${totals.office_asst_amount.toFixed(2)}</td>
        <td>${totals.peon_amount.toFixed(2)}</td>
        <td>${totals.observer_amount.toFixed(2)}</td>
        <td>${totals.contingency_amount.toFixed(2)}</td>
        <td>${totals.other_expenses_amount.toFixed(2)}</td>
        <td>${totals.grand_total_amount.toFixed(2)}</td>
      </tr>
    `;

    const districtLabelText =
      districtLabel || selectedDistrict?.district_name || selectedDistrict?.district_code || '—';
    const blockLabelText = blockLabel || selectedBlock?.block_name || selectedBlock?.block_code || 'All Blocks';

    win.document.write(`
      <html>
      <head>
        <title>CS Reports</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 16px; }
          h2 { margin: 0 0 8px 0; text-align: center; }
          .meta-wrap { margin: 0 0 12px; font-size: 12px; color: #334155; text-align: center; }
          .meta-row {
            display: inline-flex;
            justify-content: center;
            align-items: center;
            gap: 14px;
            white-space: nowrap;
          }
          table { border-collapse: collapse; width: 100%; font-size: 10px; }
          th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
          th { background: #f1f5f9; }
          @page { size: A4 landscape; margin: 10mm; }
        </style>
      </head>
      <body>
        <h2>CS Reports</h2>
        <div class="meta-wrap">
          <div class="meta-row">
            <span><strong>Scholarship:</strong> ${selectedScholarshipName || '-'}</span>
            <span><strong>Session:</strong> ${selectedSessionName || '-'}</span>
            <span><strong>District:</strong> ${districtLabelText}</span>
            <span><strong>Block:</strong> ${blockLabelText}</span>
            <span><strong>Generated:</strong> ${new Date().toLocaleString()}</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>District Code</th><th>Block Code</th><th>Block Name</th><th>Centre Code</th><th>Centre Name</th>
              <th>Account No</th><th>IFSC Code</th><th>Bank Name</th><th>Total Registered</th><th>Room</th>
              <th>No. of Invigilator + Reliever</th><th>Cent. Sup.</th><th>Exam Incharge</th><th>Invigilator + Reliever</th>
              <th>Office Asst.</th><th>Peon</th><th>Observer</th><th>Conting.</th><th>Other Expenses</th><th>Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}${totalsRowHtml}</tbody>
        </table>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  const fetchDistrictCenterReports = async () => {
    if (!selectedDistrict?.district_code || !Array.isArray(blocks) || blocks.length === 0) {
      return [];
    }

    const all = await Promise.all(
      blocks.map(async (b) => {
        const params = new URLSearchParams();
        params.append('session_id', sessionId);
        params.append('scholarship_id', selectedScholarshipId);
        params.append('block_code', b.block_code);

        const data = await get(`/api/scert/center-superintendent-reports?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });

        const rows = Array.isArray(data?.reports) ? data.reports : [];
        return rows.map((r) => ({
          ...r,
          block_code: r.block_code || b.block_code,
          block_name: r.block_name || b.block_name,
          district_code: r.district_code || selectedDistrict.district_code,
          district_name: r.district_name || selectedDistrict.district_name,
        }));
      })
    );

    return all.flat();
  };

  const handleDownloadDistrictExcel = async () => {
    if (!isBlockView) return;
    try {
      setDownloadingDistrict(true);
      const districtRows = await fetchDistrictCenterReports();
      downloadCentersExcel(districtRows, {
        districtLabel: selectedDistrict?.district_name || selectedDistrict?.district_code,
        fileTag: `district_${selectedDistrict?.district_code || 'selected'}`,
      });
    } catch (err) {
      console.error('Failed to download district Excel:', err);
      toast.error(`Failed to download Excel: ${toast.getErrorMessage(err)}`);
    } finally {
      setDownloadingDistrict(false);
    }
  };

  const handleDownloadDistrictPdf = async () => {
    if (!isBlockView) return;
    try {
      setDownloadingDistrict(true);
      const districtRows = await fetchDistrictCenterReports();
      downloadCentersPdf(districtRows, {
        districtLabel: selectedDistrict?.district_name || selectedDistrict?.district_code,
        blockLabel: 'All Blocks',
      });
    } catch (err) {
      console.error('Failed to download district PDF:', err);
      toast.error(`Failed to download PDF: ${toast.getErrorMessage(err)}`);
    } finally {
      setDownloadingDistrict(false);
    }
  };

  // Details View
  if (selectedCenterId) {
    const report = selectedReport?.report;
    const reportAttendanceRows = mergeWithExpectedClasses(selectedReport?.attendance_summary || []);
    const fallbackAttendanceRows = mergeWithExpectedClasses(detailAttendanceSummary);
    const attendanceRowsForDetails =
      reportAttendanceRows.some(
        (r) =>
          toNumberSafe(r.total_enrolled) > 0 ||
          toNumberSafe(r.mat_present) > 0 ||
          toNumberSafe(r.mat_absent) > 0 ||
          toNumberSafe(r.sat_present) > 0 ||
          toNumberSafe(r.sat_absent) > 0
      )
        ? reportAttendanceRows
        : fallbackAttendanceRows.some(
            (r) =>
              toNumberSafe(r.total_enrolled) > 0 ||
              toNumberSafe(r.mat_present) > 0 ||
              toNumberSafe(r.mat_absent) > 0 ||
              toNumberSafe(r.sat_present) > 0 ||
              toNumberSafe(r.sat_absent) > 0
          )
        ? fallbackAttendanceRows
        : buildDefaultAttendanceRows();

    return (
      <div className="scert-cs-reports-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">{title}</h3>
            <p className="view-subtitle">{subtitle}</p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedCenterId('');
                setSelectedReport(null);
                setError('');
              }}
              disabled={loadingReport}
            >
              ← Back
            </button>

            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedReport(null);
                setReportReloadNonce((n) => n + 1);
              }}
              disabled={!canFetch || loadingReport}
            >
              {loadingReport ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="error-state">{error}</div>
        ) : loadingReport ? (
          <div className="loading-state">Loading report...</div>
        ) : !selectedReport ? (
          <div className="empty-state">No data found.</div>
        ) : (
          <div className="cs-report-details">
            {/* Center Information */}
            <div className="form-section">
              <h4 className="section-title">Center Information</h4>

              <div className="detail-section">
                <h5 className="detail-section-title">Center & Location</h5>

                <div className="form-row-display">
                  <div className="form-field-display">
                    <label className="form-label">Center Code</label>
                    <div className="form-value">{selectedReport?.center?.center_code || '—'}</div>
                  </div>
                  <div className="form-field-display">
                    <label className="form-label">Center Name</label>
                    <div className="form-value">{selectedReport?.center?.center_name || '—'}</div>
                  </div>
                </div>

                <div className="form-row-display">
                  <div className="form-field-display">
                    <label className="form-label">Block Code</label>
                    <div className="form-value">{selectedReport?.block?.block_code || '—'}</div>
                  </div>
                  <div className="form-field-display">
                    <label className="form-label">Block Name</label>
                    <div className="form-value">{selectedReport?.block?.block_name || '—'}</div>
                  </div>
                </div>

                <div className="form-row-display">
                  <div className="form-field-display">
                    <label className="form-label">District Code</label>
                    <div className="form-value">{selectedReport?.district?.district_code || '—'}</div>
                  </div>
                  <div className="form-field-display">
                    <label className="form-label">District Name</label>
                    <div className="form-value">{selectedReport?.district?.district_name || '—'}</div>
                  </div>
                </div>
              </div>

              <div className="detail-section" style={{ marginTop: '1.5rem' }}>
                <h5 className="detail-section-title">Superintendent & Infrastructure</h5>

                <div className="form-row-display">
                  <div className="form-field-display">
                    <label className="form-label">Superintendent Name</label>
                    <div className="form-value">{selectedReport?.superintendent?.name || '—'}</div>
                  </div>
                  <div className="form-field-display">
                    <label className="form-label">Superintendent Mobile</label>
                    <div className="form-value">{selectedReport?.superintendent?.mobile || '—'}</div>
                  </div>
                </div>

                <div className="form-row-display">
                  <div className="form-field-display">
                    <label className="form-label">Distance from Block (km)</label>
                    <div className="form-value">{report?.distance_from_block_km ?? '—'}</div>
                  </div>
                  <div className="form-field-display">
                    <label className="form-label">Number of Exam Rooms</label>
                    <div className="form-value">{report?.number_of_exam_rooms ?? '—'}</div>
                  </div>
                </div>
              </div>
            </div>

            {!report?.is_submitted ? (
              <div className="empty-state">No CS report has been submitted for this center yet.</div>
            ) : (
              <>
                {/* Attendance Summary */}
                <div className="form-section">
                  <h4 className="section-title">Student Enrollment & Attendance</h4>
                  <div className="smart-table-wrap">
                    <table className="smart-table">
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th>Total Enrolled</th>
                          <th>MAT Present</th>
                          <th>MAT Absent</th>
                          <th>MAT Total</th>
                          <th>SAT Present</th>
                          <th>SAT Absent</th>
                          <th>SAT Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceRowsForDetails.map((row, idx) => (
                          <tr key={idx}>
                            <td>{row.exam_class}</td>
                            <td>{row.total_enrolled}</td>
                            <td>{row.mat_present}</td>
                            <td>{row.mat_absent}</td>
                            <td>{row.mat_total}</td>
                            <td>{row.sat_present}</td>
                            <td>{row.sat_absent}</td>
                            <td>{row.sat_total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Staff Details with Honorarium */}
                <div className="form-section">
                  <h4 className="section-title">Staff Details & Honorarium</h4>
                  <div className="smart-table-wrap">
                    <table className="smart-table">
                      <thead>
                        <tr>
                          <th>Staff Role</th>
                          <th>Number of Staff</th>
                          <th>Honorarium per Unit</th>
                          <th>Total Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortStaffRows(
                          Array.isArray(selectedReport.staff_details) ? selectedReport.staff_details : []
                        ).map((staff, idx) => {
                          // Contingence is one flat amount set by SCERT: no head-count or per-unit rate.
                          const flat = isContingenceRole(staff.staff_role);
                          return (
                            <tr key={idx}>
                              <td>{displayStaffRole(staff.staff_role)}</td>
                              <td>{flat ? '—' : staff.staff_count}</td>
                              <td>{flat ? '—' : `₹${Number(staff.honorarium_per_unit || 0).toFixed(2)}`}</td>
                              <td>₹{Number(staff.total_amount || 0).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'right', fontWeight: 'bold' }}>
                            Grand Total:
                          </td>
                          <td style={{ fontWeight: 'bold' }}>
                            ₹{Number(report?.grand_total_amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Observers & Supervisors */}
                {Array.isArray(selectedReport.observers) && selectedReport.observers.length > 0 && (
                  <div className="form-section">
                    <h4 className="section-title">Observers & Supervisors</h4>
                    <div className="smart-table-wrap">
                      <table className="smart-table">
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>Official Name</th>
                            <th>Designation</th>
                            <th>Time of Visit</th>
                            <th>Time of Leaving</th>
                            <th>Other Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedReport.observers.map((obs, idx) => (
                            <tr key={idx}>
                              <td>
                                <span
                                  className={`status-pill status-${String(
                                    obs.observer_type || ''
                                  ).toLowerCase()}`}
                                >
                                  {obs.observer_type}
                                </span>
                              </td>
                              <td>{obs.official_name || '—'}</td>
                              <td>{obs.designation || '—'}</td>
                              <td>{obs.time_of_visit || '—'}</td>
                              <td>{obs.time_of_leaving || '—'}</td>
                              <td>{obs.other_details || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Special Incident */}
                {report?.any_special_incident && (
                  <div className="form-section">
                    <h4 className="section-title">Special Incident</h4>
                    <div
                      style={{
                        padding: '1rem',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                      }}
                    >
                      {report.any_special_incident}
                    </div>
                  </div>
                )}

                {/* Submission Info */}
                {report?.submitted_at && (
                  <div
                    style={{
                      padding: '1rem',
                      background: '#d1fae5',
                      borderRadius: '8px',
                      marginTop: '2rem',
                      color: '#065f46',
                    }}
                  >
                    <strong>Report Submitted</strong>
                    <p style={{ marginTop: '0.5rem' }}>
                     Submitted at: {new Date(report.submitted_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // List View
  const handleRefresh = () => {
    if (isDistrictView) {
      fetchDistricts();
      return;
    }

    if (isBlockView && selectedDistrict?.district_code) {
      fetchBlocks(selectedDistrict.district_code);
      return;
    }

    if (isCenterView && selectedDistrict?.district_code && selectedBlock?.block_code) {
      fetchCenters({
        districtCode: selectedDistrict.district_code,
        blockCode: selectedBlock.block_code,
      });
    }
  };

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">{title}</h3>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!isDistrictView && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                if (isCenterView) {
                  setLevel('block');
                  setSelectedBlock(null);
                  setCenters([]);
                } else {
                  setLevel('district');
                  setSelectedDistrict(null);
                  setSelectedBlock(null);
                  setBlocks([]);
                  setCenters([]);
                }
              }}
              disabled={loadingList}
            >
              ← Back
            </button>
          )}

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleRefresh}
            disabled={!canFetch || loadingList}
          >
            {loadingList ? 'Refreshing…' : 'Refresh'}
          </button>
          {isCenterView && (
            <>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => downloadCentersExcel()}
                disabled={loadingList || centers.length === 0}
              >
                Download Excel
              </button>
              <button
                type="button"
                className="scert-btn-primary"
                onClick={() => downloadCentersPdf()}
                disabled={loadingList || centers.length === 0}
              >
                Download PDF
              </button>
            </>
          )}
          {isBlockView && (
            <>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={handleDownloadDistrictExcel}
                disabled={loadingList || downloadingDistrict || blocks.length === 0}
              >
                {downloadingDistrict ? 'Preparing…' : 'Download District Excel'}
              </button>
              <button
                type="button"
                className="scert-btn-primary"
                onClick={handleDownloadDistrictPdf}
                disabled={loadingList || downloadingDistrict || blocks.length === 0}
              >
                {downloadingDistrict ? 'Preparing…' : 'Download District PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loadingList ? (
        <div className="loading-state">Loading…</div>
      ) : isDistrictView ? (
        districts.length === 0 ? (
          <div className="empty-state">No districts found.</div>
        ) : (
          <>
            <div className="smart-table-wrap scert-cs-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>S.No</th>
                    <th>District</th>
                    <th style={{ width: 160 }}>No. of Blocks</th>
                    <th style={{ width: 170 }}>No. of Centers</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDistricts.map((d, idx) => (
                    <tr
                      key={d.district_code}
                      style={{ cursor: 'pointer' }}
                      title="Click to view blocks"
                      onClick={() => {
                        setSelectedDistrict({
                          district_code: d.district_code,
                          district_name: d.district_name,
                        });
                        setSelectedBlock(null);
                        setCenters([]);
                        setLevel('block');
                        fetchBlocks(d.district_code);
                      }}
                    >
                      <td className="smart-table-strong">{startIdx + idx + 1}</td>
                      <td className="smart-table-strong">{d.district_name || '—'}</td>
                      <td className="smart-table-strong">{d.total_blocks ?? 0}</td>
                      <td className="smart-table-strong">{d.total_centers ?? 0}</td>
                    </tr>
                  ))}
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
                Showing <strong>{activeRowsCount === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
                <strong>{activeRowsCount}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
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
        )
      ) : isBlockView ? (
        blocks.length === 0 ? (
          <div className="empty-state">No blocks found under this district.</div>
        ) : (
          <>
            <div className="smart-table-wrap scert-cs-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>S.No</th>
                    <th>Block</th>
                    <th style={{ width: 170 }}>No. of Centers</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedBlocks.map((b, idx) => (
                    <tr
                      key={b.block_code}
                      style={{ cursor: 'pointer' }}
                      title="Click to view centers"
                      onClick={() => {
                        setSelectedBlock({ block_code: b.block_code, block_name: b.block_name });
                        setLevel('center');
                        fetchCenters({
                          districtCode: selectedDistrict?.district_code,
                          blockCode: b.block_code,
                        });
                      }}
                    >
                      <td className="smart-table-strong">{startIdx + idx + 1}</td>
                      <td className="smart-table-strong">{b.block_name || '—'}</td>
                      <td className="smart-table-strong">{b.total_centers ?? 0}</td>
                    </tr>
                  ))}
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
                Showing <strong>{activeRowsCount === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
                <strong>{activeRowsCount}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
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
        )
      ) : (
        <>
          {centers.length === 0 ? (
            <div className="empty-state">No CS reports found for this block.</div>
          ) : (
            <div className="smart-table-wrap scert-cs-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ minWidth: 120 }}>District</th>
                    <th rowSpan={2} style={{ minWidth: 110 }}>Block Code</th>
                    <th rowSpan={2} style={{ minWidth: 170 }}>Block Name</th>
                    <th rowSpan={2} style={{ minWidth: 120 }}>Centre Code</th>
                    <th rowSpan={2} style={{ minWidth: 200 }}>Centre Name</th>
                    <th rowSpan={2} style={{ minWidth: 160 }}>Account No</th>
                    <th rowSpan={2} style={{ minWidth: 130 }}>IFSC Code</th>
                    <th rowSpan={2} style={{ minWidth: 150 }}>Bank Name</th>
                    <th rowSpan={2} style={{ minWidth: 190 }}>Total number of registered Student</th>
                    <th rowSpan={2} style={{ minWidth: 90 }}>Room</th>
                    <th rowSpan={2} style={{ minWidth: 140 }}>No. of Invigilator + Reliever</th>
                    <th colSpan={9} style={{ minWidth: 1040 }}>Centre Expenditure</th>
                  </tr>
                  <tr>
                    <th style={{ minWidth: 130 }}>Cent. Sup. @400.00</th>
                    <th style={{ minWidth: 130 }}>Exam Incharge @300.00</th>
                    <th style={{ minWidth: 150 }}>Invigilator + Reliever @{combinedRate.toFixed(2)}</th>
                    <th style={{ minWidth: 130 }}>Office Asst. @200.00</th>
                    <th style={{ minWidth: 110 }}>Peon @150.00</th>
                    <th style={{ minWidth: 120 }}>Supervisor @400.00</th>
                    <th style={{ minWidth: 120 }}>Conting. @200.00</th>
                    <th style={{ minWidth: 140 }}>Contingence</th>
                    <th style={{ minWidth: 110 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCenters.map((c) => (
                    <tr
                      key={c.center_id}
                      style={{ cursor: 'pointer' }}
                      title="Click to view full CS report"
                      onClick={() => {
                        setError('');
                        setSelectedReport(null);
                        setSelectedCenterId(String(c.center_id));
                      }}
                    >
                      <td>{c.district_code || c.district_name || '—'}</td>
                      <td>{c.block_code || '—'}</td>
                      <td className="smart-table-strong">{c.block_name || '—'}</td>
                      <td>{c.center_code || '—'}</td>
                      <td className="smart-table-strong">{c.center_name || '—'}</td>
                      <td>{c.bank_account_number || '—'}</td>
                      <td>{c.bank_ifsc_code || '—'}</td>
                      <td>{c.bank_name || '—'}</td>
                      <td className="smart-table-strong">{c.total_registered_students ?? 0}</td>
                      <td>{c.number_of_exam_rooms ?? '—'}</td>
                      <td className="smart-table-strong">{c.total_invigilators ?? 0}</td>
                      <td>{formatAmount(c.cent_sup_amount)}</td>
                      <td>{formatAmount(c.exam_incharge_amount)}</td>
                      <td>{formatAmount(invigilatorRelieverAmount(c))}</td>
                      <td>{formatAmount(c.office_asst_amount)}</td>
                      <td>{formatAmount(c.peon_amount)}</td>
                      <td>{formatAmount(c.observer_amount)}</td>
                      <td>{formatAmount(c.contingency_amount)}</td>
                      <td>{formatAmount(c.other_expenses_amount)}</td>
                      <td className="smart-table-strong">{formatAmount(grandTotalDisplay(c))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {centers.length > 0 ? (
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
                Showing <strong>{activeRowsCount === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
                <strong>{activeRowsCount}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
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
          ) : null}

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{centers.length}</strong> CS report(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
