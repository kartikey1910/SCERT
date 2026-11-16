import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { HiOutlineEye } from 'react-icons/hi';
import { ScertApplicationViewer } from './scert.application-viewer.jsx';

const formatMaybeDate = (value) => {
  if (!value) return '-';
  const str = String(value).split('T')[0].trim();
  
  let match = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (match) {
    return `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}`;
  }
  
  match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (match) {
    let yy = match[3];
    if (yy.length === 2) {
      yy = parseInt(yy, 10) > 50 ? `19${yy}` : `20${yy}`;
    }
    return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${yy}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear());
  return `${dd}/${mm}/${yy}`;
};

const formatDateDdMmYy = formatMaybeDate;

const formatDivyangta = (value, row = null) => {
  let v = String(value ?? '').trim();
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1).trim();
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
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
    ].find((item) => item !== null && item !== undefined && String(item).trim() !== '');
    v = String(fallback ?? '').trim();
  }
  return v ? v : 'No divyangta';
};

const pickFirst = (obj, keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
};

const formatAttendanceFlag = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '-';
  if (normalized === 'ABSENT' || normalized === 'A') return 'A';
  if (normalized === 'PRESENT' || normalized === 'P') return 'P';
  return normalized;
};

export function ScertApprovedApplicationsPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, selectedScholarshipId, scholarships } = useSession();

  const selectedScholarshipName = String(
    scholarships?.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );
  const isNmmssSelected = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const isCmSelected = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const showClassFilter = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('6');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const [viewingApplicationId, setViewingApplicationId] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const [districts, setDistricts] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [selectedDistrictCode, setSelectedDistrictCode] = useState('');
  const [selectedBlockCode, setSelectedBlockCode] = useState('');
  // Roll number: typed into rollInput, applied (rollQuery) shortly after typing stops.
  const [rollInput, setRollInput] = useState('');
  const [rollQuery, setRollQuery] = useState('');

  const getRollSerial = (row) => {
    const roll = String(row?.roll_number ?? '').replace(/\D/g, '');
    if (!roll) return Number.POSITIVE_INFINITY;
    const serial = Number(roll.slice(-4));
    return Number.isFinite(serial) ? serial : Number.POSITIVE_INFINITY;
  };

  const fetchDistricts = useCallback(async () => {
    if (!sessionId || !selectedScholarshipId) return;
    try {
      const data = await get(
        `/api/scert/list-centers/districts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
        { token: auth?.token, sessionId }
      );
      setDistricts(Array.isArray(data.districts) ? data.districts : []);
    } catch (err) {
      console.error('Failed to fetch districts:', err);
      setDistricts([]);
    }
  }, [auth?.token, selectedScholarshipId, sessionId]);

  const fetchBlocks = useCallback(async (districtCode) => {
    if (!sessionId || !selectedScholarshipId || !districtCode) {
      setBlocks([]);
      return;
    }
    try {
      const data = await get(
        `/api/scert/list-centers/blocks?scholarship_id=${encodeURIComponent(
          selectedScholarshipId
        )}&district_code=${encodeURIComponent(districtCode)}`,
        { token: auth?.token, sessionId }
      );
      setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
    } catch (err) {
      console.error('Failed to fetch blocks:', err);
      setBlocks([]);
    }
  }, [auth?.token, selectedScholarshipId, sessionId]);

  useEffect(() => {
    fetchDistricts();
  }, [fetchDistricts]);

  useEffect(() => {
    if (selectedDistrictCode) {
      fetchBlocks(selectedDistrictCode);
    } else {
      setBlocks([]);
    }
  }, [selectedDistrictCode, fetchBlocks]);
  const fetchApplications = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (showClassFilter && classFilter) params.append('class_filter', classFilter);
      if (selectedDistrictCode) params.append('district_code', selectedDistrictCode);
      if (selectedBlockCode) params.append('block_code', selectedBlockCode);
      if (rollQuery) params.append('roll_number', rollQuery);
      params.append('page', currentPage);
      params.append('limit', PAGE_SIZE);

      const data = await get(
        `/api/scert/applications/approved${params.toString() ? '?' + params.toString() : ''}`,
        { token: auth.token, sessionId }
      );

      setApplications(data.applications || []);
      setTotalItems(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch applications:', err);
      setError(err.message || 'Failed to load applications');
      toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, [auth.token, selectedScholarshipId, sessionId, currentPage, showClassFilter, classFilter, selectedDistrictCode, selectedBlockCode, rollQuery]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  useEffect(() => {
    setClassFilter(showClassFilter ? '6' : '');
  }, [showClassFilter, selectedScholarshipId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, classFilter, applications.length, viewingApplicationId, selectedDistrictCode, selectedBlockCode, rollQuery]);

  // Roll number: apply 350 ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setRollQuery(rollInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [rollInput]);

  // A roll number searched under one scholarship / session does not carry over to another.
  useEffect(() => {
    setRollInput('');
    setRollQuery('');
  }, [sessionId, selectedScholarshipId]);

  const filtersActive = Boolean(selectedDistrictCode || selectedBlockCode || rollQuery);
  const clearFilters = () => {
    setSelectedDistrictCode('');
    setSelectedBlockCode('');
    setRollInput('');
    setRollQuery('');
  };

  const handleRefresh = () => {
    fetchApplications();
  };

  const [totalItems, setTotalItems] = useState(0);

  const filteredApplications = applications;
  const totalRows = totalItems;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE);
  const pageApplications = applications;

  const escapeCsv = (value) => {
    if (value === null || value === undefined) return '';
    let s = String(value).trim();
    
    // Force text for 10+ digit numeric values (like Aadhaar) and Dates to prevent Excel auto-formatting
    if (/^\d{10,}$/.test(s.replace(/\s/g, '')) || /^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      return `="${s}"`;
    }

    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const buildExportData = (appsToExport) => {
    const headers = isNmmssSelected
      ? [
          'S. No.',
          'BlockCode',
          'Exam Code',
          'Application ID',
          'ROLL. No. (10 Digit)',
          'SR No. of students',
          "Student's Name",
          "Father's Name",
          "Mother's Name",
          'Date of Birth',
          'Sex',
          'Caste Category',
          'Divyangta code',
          'Percentage of marks in Class 7th',
          'Parental Income Code 1 or 2',
          'Aadhaar Number',
          'School Name',
          'Block',
          'District',
          'School Type (Govt, Govt aided, Local body)',
          'School Catogary (Urban, Rural)',
          'Exam Center Code',
          "Exam Centre's Name",
          'Contact No',
          'MAT',
          'SAT',
        ]
      : [
          'S. No.',
          'Block Code',
          'Application ID',
          'Roll No. (10 Digit)',
          'SR No. of students',
          "Student's Name",
          "Father's Name",
          "Mother's Name",
          'Date of Birth',
          'Sex',
          'Caste Category',
          'Type of Divyangta',
          'Aadhaar Number',
          'School Name',
          'Block',
          'District',
          'School Type (Govt, Govt aided, Local body)',
          'School Category (Urban, Rural)',
          'Previous School Name',
          'Previous School Type (Govt, Govt aided, Local body)',
          'Exam Center Code',
          "Exam Centre's Name",
          'Contact No',
          ...(isCmSelected ? ['MAT', 'SAT'] : []),
        ];

    const exportRows = appsToExport.map((app, index) => {
      if (isNmmssSelected) {
        return [
          index + 1,
          app.block_code || '-',
          pickFirst(app, ['exam_code']) || '-',
          window.getDisplayApplicationId(app),
          app.roll_number || '-',
          app.student_registration_no || app.sr_no || '-',
          app.candidate_name || app.student_name || '-',
          app.father_name || '-',
          app.mother_name || '-',
          formatDateDdMmYy(app.date_of_birth || app.dob),
          app.sex || app.gender || '-',
          app.caste_category || '-',
          formatDivyangta(app.type_of_divyangta, app),
          pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7', 'percentage_of_marks_in_class_7th', 'class_7_percentage', 'marks_percentage_class_7']) || '-',
          pickFirst(app, ['parental_income_code', 'parent_income_code', 'income_code']) || '-',
          app.aadhaar_number || '-',
          app.school_name || app.origin_school || '-',
          app.block_name || '-',
          app.district_name || app.district || app.district_code || '-',
          app.school_type || '-',
          app.school_category || '-',
          app.center_order || '-',
          app.center_name || '-',
          app.contact_no || '-',
          formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status'])),
          formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status'])),
        ];
      }
      return [
        index + 1,
        app.block_code || '-',
        window.getDisplayApplicationId(app),
        app.roll_number || '-',
        app.student_registration_no || app.sr_no || '-',
        app.candidate_name || app.student_name || '-',
        app.father_name || '-',
        app.mother_name || '-',
        formatDateDdMmYy(app.date_of_birth || app.dob),
        app.sex || app.gender || '-',
        app.caste_category || '-',
        formatDivyangta(app.type_of_divyangta, app),
        app.aadhaar_number || '-',
        app.school_name || app.origin_school || '-',
        app.block_name || '-',
        app.district_name || app.district || app.district_code || '-',
        app.school_type || '-',
        app.school_category || '-',
        app.previous_school_name || '-',
        app.previous_school_type || '-',
        app.center_order || '-',
        app.center_name || '-',
        app.contact_no || '-',
        ...(isCmSelected ? [
            formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status'])),
            formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))
          ] : []),
      ];
    });

    return { headers, rows: exportRows };
  };

  const downloadCsv = async () => {
    if (totalItems === 0) {
      toast.info('No approved applications to download');
      return;
    }

    setIsDownloading(true);
    toast.info('Preparing CSV data for download, this may take a moment...');
    let appsToExport = [];
    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (showClassFilter && classFilter) params.append('class_filter', classFilter);
      // The download covers what is on screen: the same district, block and roll filters.
      if (selectedDistrictCode) params.append('district_code', selectedDistrictCode);
      if (selectedBlockCode) params.append('block_code', selectedBlockCode);
      if (rollQuery) params.append('roll_number', rollQuery);
      params.append('export', 'true');

      const data = await get(
        `/api/scert/applications/approved?${params.toString()}`,
        { token: auth.token, sessionId }
      );
      appsToExport = data.applications || [];
    } catch (err) {
      toast.error('Failed to download full data for CSV.');
      setIsDownloading(false);
      return;
    }

    const { headers, rows: exportRows } = buildExportData(appsToExport);

    const csvContent = [
      headers.map(escapeCsv).join(','),
      ...exportRows.map((r) => r.map(escapeCsv).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scert_approved_applications_${selectedScholarshipId || 'all'}_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setIsDownloading(false);
  };

  const downloadPdf = async () => {
    if (totalItems === 0) {
      toast.info('No approved applications to download');
      return;
    }

    setIsDownloading(true);
    toast.info('Preparing PDF data, this may take a moment...');
    let appsToExport = [];
    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (showClassFilter && classFilter) params.append('class_filter', classFilter);
      // The download covers what is on screen: the same district, block and roll filters.
      if (selectedDistrictCode) params.append('district_code', selectedDistrictCode);
      if (selectedBlockCode) params.append('block_code', selectedBlockCode);
      if (rollQuery) params.append('roll_number', rollQuery);
      params.append('export', 'true');

      const data = await get(
        `/api/scert/applications/approved?${params.toString()}`,
        { token: auth.token, sessionId }
      );
      appsToExport = data.applications || [];
    } catch (err) {
      toast.error('Failed to download full data for PDF.');
      setIsDownloading(false);
      return;
    }

    const { headers, rows: exportRows } = buildExportData(appsToExport);
    const generatedAt = new Date().toLocaleString();
    const scholarshipText = selectedScholarshipName || 'All Scholarships';
    const classText = showClassFilter && classFilter ? ` | Class ${classFilter}` : '';

    const escapeHtml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Approved Applications</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; }
          .meta { margin-bottom: 8px; }
          .title { font-size: 14px; font-weight: 700; margin: 0 0 4px; }
          .sub { font-size: 11px; margin: 0 0 4px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 4px; font-size: 8px; word-break: break-word; }
          th { background: #f2f2f2; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="meta">
          <p class="title">Approved Applications Report</p>
          <p class="sub"><strong>Scholarship:</strong> ${escapeHtml(scholarshipText)}${escapeHtml(classText)}</p>
          <p class="sub"><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
        </div>
        <table>
          <thead>
            <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${exportRows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
              .join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const printWindow = window.open('', '', 'width=1200,height=900');
    if (!printWindow) {
      toast.error('Popup blocked. Please allow popups to download PDF.');
      setIsDownloading(false);
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      setIsDownloading(false);
    }, 250);
  };

  const rows = filteredApplications.map((app, index) => {
      if (isNmmssSelected) {
        return [
          index + 1,
          app.block_code || '-',
          pickFirst(app, ['exam_code']) || '-',
          window.getDisplayApplicationId(app),
          app.roll_number || '-',
          app.student_registration_no || app.sr_no || '-',
          app.candidate_name || app.student_name || '-',
          app.father_name || '-',
          app.mother_name || '-',
          formatDateDdMmYy(app.date_of_birth || app.dob),
          app.sex || app.gender || '-',
          app.caste_category || '-',
          formatDivyangta(app.type_of_divyangta, app),
          pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7', 'percentage_of_marks_in_class_7th', 'class_7_percentage', 'marks_percentage_class_7']) || '-',
          pickFirst(app, ['parental_income_code', 'parent_income_code', 'income_code']) || '-',
          app.aadhaar_number || '-',
          app.school_name || app.origin_school || '-',
          app.block_name || '-',
          app.district_name || app.district || app.district_code || '-',
          app.school_type || '-',
          app.school_category || '-',
          app.center_order || '-',
          app.center_name || '-',
          app.contact_no || '-',
          formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status'])),
          formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status'])),
        ];
      }

      return [
        index + 1,
        app.block_code || '-',
        window.getDisplayApplicationId(app),
        app.roll_number || '-',
        app.student_registration_no || app.sr_no || '-',
        app.candidate_name || app.student_name || '-',
        app.father_name || '-',
        app.mother_name || '-',
          formatDateDdMmYy(app.date_of_birth || app.dob),
        app.sex || app.gender || '-',
        app.caste_category || '-',
        formatDivyangta(app.type_of_divyangta, app),
        app.aadhaar_number || '-',
        app.school_name || app.origin_school || '-',
        app.block_name || '-',
        app.district_name || app.district || app.district_code || '-',
        app.school_type || '-',
        app.school_category || '-',
        app.previous_school_name || '-',
        app.previous_school_type || '-',
        app.center_order || '-',
        app.center_name || '-',
        app.contact_no || '-',
        ...(isCmSelected
          ? [
              formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status'])),
              formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status'])),
            ]
          : []),
      ];
    });

  return (
    <div className="applications-view">
      <div className="view-header-row scert-approved-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Approved Applications</h3>
              
            </div>
        </div>
        <div className="scert-approved-actions-row">
          {showClassFilter ? (
            <div className="scert-approved-inline-filter">
              <span className="scert-approved-inline-filter-label">Class</span>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
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
          <div className="scert-approved-inline-filter" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span className="scert-approved-inline-filter-label" style={{ whiteSpace: 'nowrap' }}>District</span>
              <select
                className="form-input"
                value={selectedDistrictCode}
                onChange={(e) => {
                  setSelectedDistrictCode(e.target.value);
                  setSelectedBlockCode('');
                }}
                style={{ padding: '4px 8px', minWidth: '150px' }}
              >
                <option value="">All Districts</option>
                {districts.map((d) => (
                  <option key={d.district_code} value={d.district_code}>
                    {d.district_name}
                  </option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span className="scert-approved-inline-filter-label" style={{ whiteSpace: 'nowrap' }}>Block</span>
              <select
                className="form-input"
                value={selectedBlockCode}
                onChange={(e) => setSelectedBlockCode(e.target.value)}
                disabled={!selectedDistrictCode}
                style={{ padding: '4px 8px', minWidth: '150px' }}
              >
                <option value="">All Blocks</option>
                {blocks.map((b) => (
                  <option key={b.block_code} value={b.block_code}>
                    {b.block_name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label
                className="scert-approved-inline-filter-label"
                htmlFor="scert-approved-roll-filter"
                style={{ whiteSpace: 'nowrap' }}
              >
                Roll Number
              </label>
              <input
                id="scert-approved-roll-filter"
                type="search"
                className="form-input"
                inputMode="numeric"
                maxLength={10}
                value={rollInput}
                onChange={(e) => setRollInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Search by roll number"
                style={{ padding: '4px 8px', minWidth: '170px' }}
              />
            </div>

            {filtersActive ? (
              <button type="button" className="scert-btn-secondary" onClick={clearFilters}>
                Clear Filters
              </button>
            ) : null}
          </div>
          {!viewingApplicationId ? (
            <>
              <button type="button" className="scert-btn-secondary" onClick={downloadCsv}>
                Download CSV
              </button>
              <button type="button" className="scert-btn-secondary" onClick={downloadPdf}>
                Download PDF
              </button>
            </>
          ) : null}
          {viewingApplicationId ? (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => setViewingApplicationId(null)}
            >
              Back to Approved List
            </button>
          ) : null}
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : viewingApplicationId ? (
        <div className="application-viewer">
          <ScertApplicationViewer
            applicationId={viewingApplicationId}
            onBack={() => {
              setViewingApplicationId(null);
              fetchApplications();
            }}
          />
        </div>
      ) : loading ? (
        <div className="loading-state">Loading approved applications...</div>
      ) : filteredApplications.length === 0 ? (
        <div className="empty-state">
          No approved applications found for the selected criteria.
        </div>
      ) : (
        <>
        <div className="smart-table-wrap scert-approved-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
          <table className="smart-table" style={{ minWidth: isNmmssSelected ? '3000px' : '2600px' }}>
            <thead>
              {isNmmssSelected ? (
                <>
                  <tr>
                    <th rowSpan={2} style={{ minWidth: 90 }}>Action</th>
                    <th rowSpan={2} style={{ minWidth: 70 }}>S. No.</th>
                    <th rowSpan={2} style={{ minWidth: 100 }}>BlockCode</th>
                    <th rowSpan={2} style={{ minWidth: 100 }}>Exam Code</th>
                    <th rowSpan={2} style={{ minWidth: 120 }}>Application ID</th>
                    <th rowSpan={2} style={{ minWidth: 170 }}>ROLL. No. (10 Digit)</th>
                    <th rowSpan={2} style={{ minWidth: 140 }}>SR No. of students</th>
                    <th rowSpan={2} style={{ minWidth: 170 }}>Student&apos;s Name</th>
                    <th rowSpan={2} style={{ minWidth: 160 }}>Father&apos;s Name</th>
                    <th rowSpan={2} style={{ minWidth: 160 }}>Mother&apos;s Name</th>
                    <th rowSpan={2} style={{ minWidth: 130 }}>Date of Birth</th>
                    <th rowSpan={2} style={{ minWidth: 90 }}>Sex</th>
                    <th rowSpan={2} style={{ minWidth: 140 }}>Caste Category</th>
                    <th rowSpan={2} style={{ minWidth: 140 }}>Divyangta code</th>
                    <th rowSpan={2} style={{ minWidth: 220 }}>Percentage of marks in Class 7th</th>
                    <th rowSpan={2} style={{ minWidth: 200 }}>Parental Income Code 1 or 2</th>
                    <th rowSpan={2} style={{ minWidth: 160 }}>Aadhaar Number</th>
                    <th rowSpan={2} style={{ minWidth: 180 }}>School Name</th>
                    <th rowSpan={2} style={{ minWidth: 130 }}>Block</th>
                    <th rowSpan={2} style={{ minWidth: 150 }}>District</th>
                    <th rowSpan={2} style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                    <th rowSpan={2} style={{ minWidth: 220 }}>School Catogary (Urban, Rural)</th>
                    <th rowSpan={2} style={{ minWidth: 150 }}>Exam Center Code</th>
                    <th rowSpan={2} style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                    <th rowSpan={2} style={{ minWidth: 130 }}>Contact No</th>
                    <th colSpan={2} style={{ minWidth: 180, textAlign: 'center' }}>Attendance</th>
                  </tr>
                  <tr>
                    <th style={{ minWidth: 90 }}>MAT</th>
                    <th style={{ minWidth: 90 }}>SAT</th>
                  </tr>
                </>
              ) : (
                isCmSelected ? (
                  <>
                    <tr>
                      <th rowSpan={2} style={{ minWidth: 90 }}>Action</th>
                      <th rowSpan={2} style={{ minWidth: 70 }}>S. No.</th>
                      <th rowSpan={2} style={{ minWidth: 100 }}>Block Code</th>
                      <th rowSpan={2} style={{ minWidth: 120 }}>Application ID</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>SR No. of students</th>
                      <th rowSpan={2} style={{ minWidth: 170 }}>Student's Name</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Father's Name</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Mother's Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Date of Birth</th>
                      <th rowSpan={2} style={{ minWidth: 90 }}>Sex</th>
                      <th rowSpan={2} style={{ minWidth: 140 }}>Caste Category</th>
                      <th rowSpan={2} style={{ minWidth: 170 }}>Type of Divyangta</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>Aadhaar Number</th>
                      <th rowSpan={2} style={{ minWidth: 180 }}>School Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Block</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>District</th>
                      <th rowSpan={2} style={{ minWidth: 250 }}>School Type (Govt, Govt aided, Local body)</th>
                      <th rowSpan={2} style={{ minWidth: 220 }}>School Category (Urban, Rural)</th>
                      <th rowSpan={2} style={{ minWidth: 180 }}>Previous School Name</th>
                      <th rowSpan={2} style={{ minWidth: 300 }}>Previous School Type (Govt, Govt aided, Local body)</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>Exam Center Code</th>
                      <th rowSpan={2} style={{ minWidth: 180 }}>Exam Centre's Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Contact No</th>
                      <th colSpan={2} style={{ minWidth: 180, textAlign: 'center' }}>Attendance</th>
                    </tr>
                    <tr>
                      <th style={{ minWidth: 90 }}>MAT</th>
                      <th style={{ minWidth: 90 }}>SAT</th>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <th style={{ minWidth: 90 }}>Action</th>
                    <th style={{ minWidth: 70 }}>S. No.</th>
                    <th style={{ minWidth: 100 }}>Block Code</th>
                    <th style={{ minWidth: 120 }}>Application ID</th>
                    <th style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                    <th style={{ minWidth: 130 }}>SR No. of students</th>
                    <th style={{ minWidth: 170 }}>Student's Name</th>
                    <th style={{ minWidth: 160 }}>Father's Name</th>
                    <th style={{ minWidth: 160 }}>Mother's Name</th>
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
                    <th style={{ minWidth: 180 }}>Exam Centre's Name</th>
                    <th style={{ minWidth: 130 }}>Contact No</th>
                  </tr>
                )
              )}
            </thead>
            <tbody>
              {pageApplications.map((app, index) => (
                <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                  {isNmmssSelected ? (
                    <>
                      <td>
                        <button
                          type="button"
                          className="icon-action-btn"
                          title="View"
                          onClick={() => setViewingApplicationId(app.application_id)}
                        >
                          <HiOutlineEye />
                        </button>
                      </td>
                      <td>{startIdx + index + 1}</td>
                      <td>{app.block_code || '-'}</td>
                      <td>{pickFirst(app, ['exam_code']) || '-'}</td>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                      </td>
                      <td className="smart-table-strong">{app.roll_number || '-'}</td>
                      <td>{app.student_registration_no || app.sr_no || '-'}</td>
                      <td>{app.candidate_name || app.student_name || '-'}</td>
                      <td>{app.father_name || '-'}</td>
                      <td>{app.mother_name || '-'}</td>
                      <td>{formatMaybeDate(app.date_of_birth || app.dob)}</td>
                      <td>{app.sex || app.gender || '-'}</td>
                      <td>{app.caste_category || '-'}</td>
                      <td>{formatDivyangta(app.type_of_divyangta, app)}</td>
                      <td>{pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7', 'percentage_of_marks_in_class_7th', 'class_7_percentage', 'marks_percentage_class_7']) || '-'}</td>
                      <td>{pickFirst(app, ['parental_income_code', 'parent_income_code', 'income_code']) || '-'}</td>
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
                    </>
                  ) : (
                    <>
                      <td>
                        <button
                          type="button"
                          className="icon-action-btn"
                          title="View"
                          onClick={() => setViewingApplicationId(app.application_id)}
                        >
                          <HiOutlineEye />
                        </button>
                      </td>
                      <td>{startIdx + index + 1}</td>
                      <td>{app.block_code || '-'}</td>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                      </td>
                      <td className="smart-table-strong">{app.roll_number || '-'}</td>
                      <td>{app.student_registration_no || app.sr_no || '-'}</td>
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
                      {isCmSelected ? <td>{formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td> : null}
                      {isCmSelected ? <td>{formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td> : null}
                    </>
                  )}
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

      {!viewingApplicationId ? (
        <div className="table-footer">
          <span className="table-count">
            Total: <strong>{filteredApplications.length}</strong> application(s)
          </span>
        </div>
      ) : null}

      {isDownloading && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#3b82f6',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          fontWeight: '500',
          fontSize: '14px'
        }}>
          <div style={{
            width: '18px',
            height: '18px',
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          Downloading file...
        </div>
      )}
    </div>
  );
}
