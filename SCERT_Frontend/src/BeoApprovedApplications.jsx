import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { HiOutlineEye, HiOutlinePencil } from 'react-icons/hi';
import { BeoPendingApplicationEditor } from './BeoPendingApplicationEditor.jsx';

export function BeoApprovedApplications({ featureLocks = {} }) {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedSessionId, selectedScholarshipId, scholarships, selectedSession } = useDashboard();

  const selectedScholarshipName = String(
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );

  const isNmmssSelected = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const isCmSelected = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const showClassFilter = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);

  const [applications, setApplications] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('6');
  // School / roll-number filters. The roll number is typed into rollInput and
  // applied (rollQuery) shortly after typing stops, so each keystroke is not a request.
  const [schoolFilter, setSchoolFilter] = useState('');
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [rollInput, setRollInput] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedAppId, setSelectedAppId] = useState(null);
  const PAGE_SIZE = 20;
  const [previousSchoolDetailsByUdise, setPreviousSchoolDetailsByUdise] = useState({});

  const allowEdit = featureLocks['EDIT_APPROVED_APPLICATIONS'] === false;

  const getRollSerial = (row) => {
    const roll = String(row?.roll_number ?? '').replace(/\D/g, '');
    if (!roll) return Number.POSITIVE_INFINITY;
    const serial = Number(roll.slice(-4));
    return Number.isFinite(serial) ? serial : Number.POSITIVE_INFINITY;
  };

  const sortApplications = (items) =>
    [...items].sort((a, b) => {
      const aSerial = getRollSerial(a);
      const bSerial = getRollSerial(b);
      if (aSerial !== bSerial) return aSerial - bSerial;

      const aRoll = String(a?.roll_number ?? '').trim();
      const bRoll = String(b?.roll_number ?? '').trim();
      if (aRoll !== bRoll) return aRoll.localeCompare(bRoll, undefined, { numeric: true });

      const aDisplayId = String(a?.application_display_id ?? '').trim();
      const bDisplayId = String(b?.application_display_id ?? '').trim();
      if (aDisplayId !== bDisplayId) return aDisplayId.localeCompare(bDisplayId, undefined, { numeric: true });

      return Number(a?.application_id || 0) - Number(b?.application_id || 0);
    });

  const formatMaybeDate = (value) => {
    if (!value) return '-';
    const str = String(value).split('T')[0];
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-GB');
  };

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

  const normalizePreviousSchoolType = (details = {}) =>
    pickFirst(details, [
      'school_management_code',
      'school_type',
      'school_management_type',
      'management_type',
      'type',
      'school_category_code',
    ]);

  const unresolvedPreviousSchoolUdises = useMemo(() => {
    const codes = new Set();
    applications.forEach((app) => {
      const udise = String(app?.previous_school_udise || '').trim();
      if (!udise) return;
      const hasName = String(app?.previous_school_name || '').trim() !== '';
      const hasType = String(app?.previous_school_type || '').trim() !== '';
      if (hasName && hasType) return;
      const cached = previousSchoolDetailsByUdise[udise];
      const cachedName = String(cached?.school_name || '').trim();
      const cachedType = String(normalizePreviousSchoolType(cached) || '').trim();
      if (!cachedName || !cachedType) {
        codes.add(udise);
      }
    });
    return Array.from(codes);
  }, [applications, previousSchoolDetailsByUdise]);

  const resolvePreviousSchoolDetails = useCallback(async () => {
    if (!auth?.token || unresolvedPreviousSchoolUdises.length === 0) return;

    try {
      const settled = await Promise.all(
        unresolvedPreviousSchoolUdises.map(async (udise) => {
          try {
            const data = await get(
              `/api/preschools?search=${encodeURIComponent(udise)}&page=1&limit=20`,
              { token: auth.token }
            );
            const rows = Array.isArray(data?.data) ? data.data : [];
            const exact =
              rows.find((r) => String(r?.udise_code || '').trim() === udise) || rows[0] || null;
            return [udise, exact];
          } catch {
            return [udise, null];
          }
        })
      );

      setPreviousSchoolDetailsByUdise((prev) => {
        const next = { ...prev };
        settled.forEach(([udise, details]) => {
          if (!details) return;
          next[udise] = details;
        });
        return next;
      });
    } catch {
      // Non-blocking enrichment only
    }
  }, [auth?.token, unresolvedPreviousSchoolUdises]);

  const getPreviousSchoolName = (app) =>
    pickFirst(app, [
      'previous_school_name',
      'previous_primary_school_name',
      'previous_school',
      'previous_school_detail_name',
      'previous_school_details_name',
      'previous_school_school_name',
      'prev_school_name',
    ]) ||
    pickFirst(previousSchoolDetailsByUdise[String(app?.previous_school_udise || '').trim()] || {}, [
      'school_name',
      'name',
    ]) ||
    (String(app?.previous_school_udise || '').trim()
      ? `UDISE: ${String(app.previous_school_udise).trim()}`
      : '-');

  const getPreviousSchoolType = (app) =>
    pickFirst(app, [
      'previous_school_type',
      'previous_primary_school_type',
      'previous_school_management_code',
      'previous_school_management_type',
      'previous_school_category',
      'previous_school_school_type',
      'prev_school_type',
    ]) ||
    normalizePreviousSchoolType(
      previousSchoolDetailsByUdise[String(app?.previous_school_udise || '').trim()] || {}
    );
  const getStudentRegistrationNo = (row) =>
    row?.student_registration_no ||
    row?.student_registration_number ||
    row?.student_registrations ||
    row?.student_registration ||
    row?.student_registration_id ||
    row?.student_reg_no ||
    row?.registration_no ||
    
    row?.registration_number ||
    row?.sr_no ||
    row?.sr_number ||
    '-';

  const fetchApplications = useCallback(async () => {
    if (!selectedSessionId || !selectedScholarshipId) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      params.append('page', currentPage);
      params.append('limit', PAGE_SIZE);
      if (showClassFilter && classFilter) {
        params.append('class_filter', classFilter);
      }
      if (schoolFilter) params.append('school_user_id', schoolFilter);
      if (rollQuery) params.append('roll_number', rollQuery);

      const data = await get(
        `/api/beo/applications/approved${params.toString() ? '?' + params.toString() : ''}`,
        { token: auth?.token, sessionId: selectedSessionId }
      );

      setApplications(sortApplications(Array.isArray(data.applications) ? data.applications : []));
      setTotalRows(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch approved applications:', err);
      setError(err.message || 'Failed to load approved applications');
      toast.error(`Failed to load approved applications: ${toast.getErrorMessage(err)}`);
      setApplications([]);
      setTotalRows(0);
    } finally {
      setLoading(false);
    }
  }, [auth?.token, selectedScholarshipId, selectedSessionId, currentPage, classFilter, showClassFilter, schoolFilter, rollQuery]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  useEffect(() => {
    resolvePreviousSchoolDetails();
  }, [resolvePreviousSchoolDetails]);

  useEffect(() => {
    setClassFilter(showClassFilter ? '6' : '');
  }, [showClassFilter, selectedScholarshipId]);

  // Roll number: apply 350 ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setRollQuery(rollInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [rollInput]);

  // School options: the schools in this block that have approved applications
  // (for the chosen class, when there is one), independent of the other filters.
  useEffect(() => {
    if (!auth?.token || !selectedSessionId || !selectedScholarshipId) return undefined;
    let cancelled = false;
    const params = new URLSearchParams();
    params.append('scholarship_id', selectedScholarshipId);
    if (showClassFilter && classFilter) params.append('class_filter', classFilter);

    get(`/api/beo/applications/approved/schools?${params.toString()}`, {
      token: auth.token,
      sessionId: selectedSessionId,
    })
      .then((data) => {
        if (!cancelled) setSchoolOptions(Array.isArray(data?.schools) ? data.schools : []);
      })
      .catch(() => {
        if (!cancelled) setSchoolOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [auth?.token, selectedScholarshipId, selectedSessionId, classFilter, showClassFilter]);

  const filtersActive = Boolean(schoolFilter || rollQuery);
  const clearFilters = () => {
    setSchoolFilter('');
    setRollInput('');
    setRollQuery('');
  };

  const handleRefresh = () => {
    fetchApplications();
  };

  const handleDownloadPDF = () => {
    if (applications.length === 0) {
      toast.error('No applications to download');
      return;
    }

    const selectedScholarship = scholarships.find(
      (s) => String(s.scholarship_id) === String(selectedScholarshipId)
    );

    const sessionLabel = selectedSession?.session_name || selectedSessionId || 'N/A';
    const generatedAt = new Date().toLocaleString();
    const headerColumns = isNmmssSelected
      ? `
                <th>S. No.</th>
                <th>BlockCode</th>
                <th>Exam Code</th>
                <th>Application ID</th>
                <th>ROLL. No. (10 Digit)</th>
                <th>SR No. of students</th>
                <th>Student's Name</th>
                <th>Father's Name</th>
                <th>Mother's Name</th>
                <th>Date of Birth</th>
                <th>Sex</th>
                <th>Caste Category</th>
                <th>Divyangta code</th>
                <th>Percentage of marks in Class 7th</th>
                <th>Parental Income Code 1 or 2</th>
                <th>Aadhaar Number</th>
                <th>School Name</th>
                <th>Block</th>
                <th>District</th>
                <th>School Type (Govt, Govt aided, Local body)</th>
                <th>School Category (Urban, Rural)</th>
                <th>Exam Center Code</th>
                <th>Exam Centre's Name</th>
                <th>Contact No</th>
                <th>MAT</th>
                <th>SAT</th>
      `
      : `
                <th>S. No.</th>
                <th>Block Code</th>
                <th>Application ID</th>
                <th>Roll No. (10 Digit)</th>
                <th>SR No. of students</th>
                <th>Student's Name</th>
                <th>Father's Name</th>
                <th>Mother's Name</th>
                <th>Date of Birth</th>
                <th>Sex</th>
                <th>Caste Category</th>
                <th>Type of Divyangta</th>
                <th>Aadhaar Number</th>
                <th>School Name</th>
                <th>Block</th>
                <th>District</th>
                <th>School Type (Govt, Govt aided, Local body)</th>
                <th>School Category (Urban, Rural)</th>
                <th>Previous School Name</th>
                <th>Previous School Type (Govt, Govt aided, Local body)</th>
                <th>Exam Center Code</th>
                <th>Exam Centre's Name</th>
                <th>Contact No</th>
                ${isCmSelected ? '<th>MAT</th><th>SAT</th>' : ''}
      `;

    // Create table HTML
    let tableHTML = `
      <html>
        <head>
          <title>Approved Applications Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h2 { text-align: center; margin-bottom: 10px; }
            .info { text-align: center; margin-bottom: 20px; font-size: 14px; }
            .meta-line { text-align: center; margin-bottom: 16px; font-size: 14px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #000; padding: 6px 4px; text-align: left; }
            th { background-color: #f0f0f0; font-weight: bold; }
            .footer { margin-top: 20px; text-align: right; font-size: 12px; }
          </style>
        </head>
        <body>
          <h2>Approved Applications Report</h2>
          <div class="meta-line">
            <span><strong>Scholarship:</strong> ${selectedScholarship?.scholarship_name || 'N/A'}</span>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            <span><strong>Session:</strong> ${sessionLabel}</span>
            ${showClassFilter ? `&nbsp;&nbsp;|&nbsp;&nbsp;<span><strong>Class:</strong> ${classFilter}</span>` : ''}
            ${schoolFilter ? `&nbsp;&nbsp;|&nbsp;&nbsp;<span><strong>School:</strong> ${
              (schoolOptions.find((x) => String(x.school_user_id) === String(schoolFilter))?.school_name || schoolFilter)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            }</span>` : ''}
            ${rollQuery ? `&nbsp;&nbsp;|&nbsp;&nbsp;<span><strong>Roll No.:</strong> ${rollQuery}</span>` : ''}
            &nbsp;&nbsp;|&nbsp;&nbsp;
            <span><strong>Generated:</strong> ${generatedAt}</span>
          </div>
          <div class="info">
          </div>
          <table>
            <thead>
              <tr>
                ${headerColumns}
              </tr>
            </thead>
            <tbody>
    `;

    applications.forEach((app, index) => {
      if (isNmmssSelected) {
        tableHTML += `
          <tr>
            <td>${index + 1}</td>
            <td>${app.block_code || '-'}</td>
            <td>${pickFirst(app, ['exam_code']) || '-'}</td>
            <td>${window.getDisplayApplicationId(app)}</td>
            <td>${app.roll_number || '-'}</td>
            <td>${getStudentRegistrationNo(app)}</td>
            <td>${app.candidate_name || app.student_name || '-'}</td>
            <td>${app.father_name || '-'}</td>
            <td>${app.mother_name || '-'}</td>
            <td>${formatMaybeDate(app.date_of_birth || app.dob)}</td>
            <td>${app.sex || app.gender || '-'}</td>
            <td>${app.caste_category || '-'}</td>
            <td>${formatDivyangta(app.type_of_divyangta, app)}</td>
            <td>${pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7']) || '-'}</td>
            <td>${pickFirst(app, ['parental_income_code', 'income_code']) || '-'}</td>
            <td>${app.aadhaar_number || '-'}</td>
            <td>${app.school_name || app.origin_school || '-'}</td>
            <td>${app.block_name || '-'}</td>
            <td>${app.district_name || app.district || app.district_code || '-'}</td>
            <td>${app.school_type || '-'}</td>
            <td>${app.school_category || '-'}</td>
            <td>${app.center_order || '-'}</td>
            <td>${app.center_name || '-'}</td>
            <td>${app.contact_no || '-'}</td>
            <td>${formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td>
            <td>${formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td>
          </tr>
        `;
        return;
      }

      tableHTML += `
        <tr>
          <td>${index + 1}</td>
          <td>${app.block_code || '-'}</td>
          <td>${window.getDisplayApplicationId(app)}</td>
          <td>${app.roll_number || '-'}</td>
          <td>${getStudentRegistrationNo(app)}</td>
          <td>${app.candidate_name || app.student_name || '-'}</td>
          <td>${app.father_name || '-'}</td>
          <td>${app.mother_name || '-'}</td>
          <td>${formatMaybeDate(app.date_of_birth || app.dob)}</td>
          <td>${app.sex || app.gender || '-'}</td>
          <td>${app.caste_category || '-'}</td>
          <td>${formatDivyangta(app.type_of_divyangta, app)}</td>
          <td>${app.aadhaar_number || '-'}</td>
          <td>${app.school_name || app.origin_school || '-'}</td>
          <td>${app.block_name || '-'}</td>
          <td>${app.district_name || app.district || app.district_code || '-'}</td>
          <td>${app.school_type || '-'}</td>
          <td>${app.school_category || '-'}</td>
          <td>${getPreviousSchoolName(app)}</td>
          <td>${getPreviousSchoolType(app)}</td>
          <td>${app.center_order || '-'}</td>
          <td>${app.center_name || '-'}</td>
          <td>${app.contact_no || '-'}</td>
          ${isCmSelected ? `<td>${formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td><td>${formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td>` : ''}
        </tr>
      `;
    });

    tableHTML += `
            </tbody>
          </table>
          <div class="footer">
            <strong>Total Applications:</strong> ${totalRows}
          </div>
        </body>
      </html>
    `;

    // Open print dialog
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(tableHTML);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    } else {
      toast.error('Please allow pop-ups to download PDF');
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSessionId, selectedScholarshipId, classFilter, schoolFilter, rollQuery]);

  // A school (or roll number) picked for one scholarship / session / class need
  // not exist under another.
  useEffect(() => {
    setSchoolFilter('');
    setRollInput('');
    setRollQuery('');
  }, [selectedSessionId, selectedScholarshipId, classFilter]);

  if (selectedAppId) {
    return (
      <BeoPendingApplicationEditor
        applicationId={selectedAppId}
        forceReadOnly={!allowEdit}
        showRemarks={false}
        onBack={() => {
          setSelectedAppId(null);
          fetchApplications();
        }}
        featureLocks={featureLocks}
      />
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Approved Applications</h3>
              
            </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="scert-btn-primary"
            onClick={handleDownloadPDF}
            disabled={loading || applications.length === 0}
          >
            Download PDF
          </button>
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

      <div className="filters-bar" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
        {showClassFilter ? (
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
          <label className="filter-label" htmlFor="beo-approved-school-filter">School</label>
          <select
            id="beo-approved-school-filter"
            className="form-input"
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            style={{ minWidth: '280px' }}
          >
            <option value="">All Schools</option>
            {schoolOptions.map((school) => (
              <option key={school.school_user_id} value={String(school.school_user_id)}>
                {school.school_name}
                {school.udise_code ? ` - ${school.udise_code}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="beo-approved-roll-filter">Roll Number</label>
          <input
            id="beo-approved-roll-filter"
            type="search"
            className="form-input"
            inputMode="numeric"
            maxLength={10}
            value={rollInput}
            onChange={(e) => setRollInput(e.target.value.replace(/\D/g, ''))}
            placeholder="Search by roll number"
            style={{ minWidth: '200px' }}
          />
        </div>
        {filtersActive ? (
          <div className="filter-group">
            <button type="button" className="scert-btn-secondary" onClick={clearFilters}>
              Clear Filters
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading approved applications...</div>
      ) : applications.length === 0 ? (
        <div className="empty-state">
          No approved applications found for the selected criteria.
        </div>
      ) : (
        <>
        <div className="smart-table-wrap beo-approved-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
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
              {applications.map((app, index) => (
                <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                  {isNmmssSelected ? (
                    <>
                      <td>
                        <button
                          type="button"
                          className="icon-action-btn"
                          title={allowEdit ? "Edit application" : "View application"}
                          onClick={() => setSelectedAppId(app.application_id)}
                        >
                          {allowEdit ? <HiOutlinePencil /> : <HiOutlineEye />}
                        </button>
                      </td>
                      <td>{startIndex + index + 1}</td>
                      <td>{app.block_code || '-'}</td>
                      <td>{pickFirst(app, ['exam_code']) || '-'}</td>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                      </td>
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
                    </>
                  ) : (
                    <>
                      <td>
                        <button
                          type="button"
                          className="icon-action-btn"
                          title={allowEdit ? "Edit application" : "View application"}
                          onClick={() => setSelectedAppId(app.application_id)}
                        >
                          {allowEdit ? <HiOutlinePencil /> : <HiOutlineEye />}
                        </button>
                      </td>
                      <td>{startIndex + index + 1}</td>
                      <td>{app.block_code || '-'}</td>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                      </td>
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
                      <td>{getPreviousSchoolName(app)}</td>
                      <td>{getPreviousSchoolType(app)}</td>
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
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={safePage <= 1}
          >
            Previous
          </button>
          <span className="pagination-info">
            Showing {totalRows === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + PAGE_SIZE, totalRows)} of {totalRows} (Page {safePage} / {totalPages})
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

      <div className="table-footer">
        <span className="table-count">
          Total: <strong>{totalRows}</strong> application(s)
        </span>
      </div>
    </div>
  );
}
