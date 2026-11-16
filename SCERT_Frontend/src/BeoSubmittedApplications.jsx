import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { HiOutlineEye } from 'react-icons/hi';
import { BeoPendingApplicationEditor } from './BeoPendingApplicationEditor.jsx';

export function BeoSubmittedApplications() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedScholarshipId, selectedSessionId, selectedSession, scholarships } = useDashboard();

  const selectedScholarshipName = String(
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );

  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [applicationIdQuery, setApplicationIdQuery] = useState('');
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

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
    if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
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
    return v || 'No divyangta';
  };

  const pickFirst = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== null && value !== undefined && String(value).trim() !== '') return value;
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

  const getStudentRegistrationNo = (row) =>
    row?.student_registration_no ||
    row?.student_registration_number ||
    row?.student_registrations ||
    row?.registration_no ||
    row?.student_reg_no ||
    row?.student_registration ||
    row?.student_registration_id ||
    row?.sr_no ||
    '-';

  const fetchApplications = async () => {
    if (!selectedScholarshipId) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);

      const data = await get(`/api/beo/applications/submitted-to-scert?${params.toString()}`, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });

      setApplications(Array.isArray(data?.applications) ? data.applications : []);
    } catch (err) {
      setError(err?.message || 'Failed to fetch applications');
      toast.error(`Failed to load submitted applications: ${toast.getErrorMessage(err)}`);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCmScholarship) {
      setClassFilter('6');
      return;
    }

    if (isNmmssScholarship) {
      setClassFilter('8');
      return;
    }

    setClassFilter('');
  }, [selectedScholarshipId, isCmScholarship, isNmmssScholarship]);

  useEffect(() => {
    fetchApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token, selectedScholarshipId, selectedSessionId, classFilter]);

  const schoolKey = (app) => String(app?.udise_code || '').trim();
  const schoolLabel = (app) => app?.school_name || app?.origin_school || schoolKey(app) || '-';

  // One entry per school that has a submitted application, for the dropdown.
  const schoolOptions = (() => {
    const bySchool = new Map();
    for (const app of applications) {
      const value = schoolKey(app);
      if (value && !bySchool.has(value)) bySchool.set(value, { value, label: schoolLabel(app) });
    }
    return Array.from(bySchool.values()).sort((a, b) => a.label.localeCompare(b.label));
  })();

  const idQuery = applicationIdQuery.trim().toLowerCase();
  const filtersActive = Boolean(schoolFilter || idQuery);

  // Matches what the table shows in the Application ID column.
  const matchesApplicationId = (app) =>
    String(window.getDisplayApplicationId(app)).toLowerCase().includes(idQuery);

  const filteredApplications = applications.filter(
    (app) =>
      (!classFilter || String(app?.class ?? '') === String(classFilter)) &&
      (!schoolFilter || schoolKey(app) === schoolFilter) &&
      (!idQuery || matchesApplicationId(app))
  );

  const sortedApplications = [...filteredApplications].sort((a, b) => {
    const centerA = Number(a?.center_order);
    const centerB = Number(b?.center_order);
    const hasCenterA = Number.isFinite(centerA);
    const hasCenterB = Number.isFinite(centerB);

    if (hasCenterA && hasCenterB && centerA !== centerB) return centerA - centerB;
    if (hasCenterA && !hasCenterB) return -1;
    if (!hasCenterA && hasCenterB) return 1;

    const appIdA = Number(a?.application_id);
    const appIdB = Number(b?.application_id);
    const hasAppIdA = Number.isFinite(appIdA);
    const hasAppIdB = Number.isFinite(appIdB);

    if (hasAppIdA && hasAppIdB) return appIdA - appIdB;
    if (hasAppIdA && !hasAppIdB) return -1;
    if (!hasAppIdA && hasAppIdB) return 1;
    return String(a?.application_id || '').localeCompare(String(b?.application_id || ''));
  });
  const totalApplications = sortedApplications.length;
  const totalPages = Math.max(1, Math.ceil(totalApplications / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const pagedApplications = sortedApplications.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedScholarshipId, selectedSessionId, classFilter, schoolFilter, idQuery, applications.length]);

  // A school picked for one scholarship/session need not exist in another.
  useEffect(() => {
    setSchoolFilter('');
    setApplicationIdQuery('');
  }, [selectedScholarshipId, selectedSessionId]);

  const handleDownloadPDF = () => {
    if (sortedApplications.length === 0) {
      toast.error('No applications to download');
      return;
    }

    const generatedAt = new Date().toLocaleString();
    const classMeta = classFilter ? ` | <strong>Class:</strong> ${classFilter}` : '';
    const schoolMeta = schoolFilter
      ? ` | <strong>School:</strong> ${schoolOptions.find((x) => x.value === schoolFilter)?.label || schoolFilter}`
      : '';
    const idMeta = idQuery ? ` | <strong>Application ID:</strong> ${applicationIdQuery.trim()}` : '';

    // table-layout: fixed spreads every column equally unless told otherwise,
    // which is what was squeezing long columns (School Type, Exam Centre's
    // Name...) into many wrapped lines while short ones (S. No., Sex) sat in
    // wasted space. A colgroup gives each column a width sized to what it
    // actually holds, so short fields stay narrow and long ones get the room.
    const headerThead = isNmmssScholarship
      ? `
        <colgroup>
          <col style="width:2%" /><col style="width:3%" /><col style="width:3%" />
          <col style="width:5%" /><col style="width:5%" /><col style="width:4%" />
          <col style="width:6%" /><col style="width:6%" /><col style="width:6%" />
          <col style="width:4%" /><col style="width:2%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:4%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:5%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:4%" /><col style="width:4%" />
          <col style="width:3%" /><col style="width:4%" /><col style="width:4%" />
          <col style="width:2%" /><col style="width:3%" />
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">S. No.</th>
            <th rowspan="2">BlockCode</th>
            <th rowspan="2">Exam Code</th>
            <th rowspan="2">Application ID</th>
            <th rowspan="2">ROLL. No. (10 Digit)</th>
            <th rowspan="2">SR No. of students</th>
            <th rowspan="2">Student's Name</th>
            <th rowspan="2">Father's Name</th>
            <th rowspan="2">Mother's Name</th>
            <th rowspan="2">Date of Birth</th>
            <th rowspan="2">Sex</th>
            <th rowspan="2">Caste Category</th>
            <th rowspan="2">Divyangta code</th>
            <th rowspan="2">Percentage of marks in Class 7th</th>
            <th rowspan="2">Parental Income Code 1 or 2</th>
            <th rowspan="2">Aadhaar Number</th>
            <th rowspan="2">School Name</th>
            <th rowspan="2">Block</th>
            <th rowspan="2">District</th>
            <th rowspan="2">School Type (Govt, Govt aided, Local body)</th>
            <th rowspan="2">School Catogary (Urban, Rural)</th>
            <th rowspan="2">Exam Center Code</th>
            <th rowspan="2">Exam Centre's Name</th>
            <th rowspan="2">Contact Number of Student</th>
            <th colspan="2">Attendance</th>
          </tr>
          <tr>
            <th>MAT</th>
            <th>SAT</th>
          </tr>
        </thead>
      `
      : isCmScholarship
        ? `
        <colgroup>
          <col style="width:2%" /><col style="width:3%" /><col style="width:5%" />
          <col style="width:5%" /><col style="width:4%" /><col style="width:6%" />
          <col style="width:6%" /><col style="width:6%" /><col style="width:4%" />
          <col style="width:2%" /><col style="width:3%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:5%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:5%" /><col style="width:4%" />
          <col style="width:4%" /><col style="width:4%" /><col style="width:3%" />
          <col style="width:4%" /><col style="width:4%" /><col style="width:3%" />
          <col style="width:3%" />
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">S. No.</th>
            <th rowspan="2">Block Code</th>
            <th rowspan="2">Application ID</th>
            <th rowspan="2">Roll No. (10 Digit)</th>
            <th rowspan="2">SR No. of students</th>
            <th rowspan="2">Student's Name</th>
            <th rowspan="2">Father's Name</th>
            <th rowspan="2">Mother's Name</th>
            <th rowspan="2">Date of Birth</th>
            <th rowspan="2">Sex</th>
            <th rowspan="2">Caste Category</th>
            <th rowspan="2">Type of Divyangta</th>
            <th rowspan="2">Aadhaar Number</th>
            <th rowspan="2">School Name</th>
            <th rowspan="2">Block</th>
            <th rowspan="2">District</th>
            <th rowspan="2">School Type (Govt, Govt aided, Local body)</th>
            <th rowspan="2">School Category (Urban, Rural)</th>
            <th rowspan="2">Previous School Name</th>
            <th rowspan="2">Previous School Type (Govt, Govt aided, Local body)</th>
            <th rowspan="2">Exam Center Code</th>
            <th rowspan="2">Exam Centre's Name</th>
            <th rowspan="2">Contact Number of Student</th>
            <th colspan="2">Attendance</th>
          </tr>
          <tr>
            <th>MAT</th>
            <th>SAT</th>
          </tr>
        </thead>
      `
        : `
        <colgroup>
          <col style="width:2%" /><col style="width:4%" /><col style="width:5%" />
          <col style="width:5%" /><col style="width:4%" /><col style="width:7%" />
          <col style="width:7%" /><col style="width:7%" /><col style="width:4%" />
          <col style="width:3%" /><col style="width:3%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:6%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:5%" /><col style="width:4%" />
          <col style="width:5%" /><col style="width:5%" /><col style="width:3%" />
          <col style="width:3%" /><col style="width:3%" />
        </colgroup>
        <thead>
          <tr>
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
            <th>Contact Number of Student</th>
          </tr>
        </thead>
      `;

    const rowsHtml = sortedApplications
      .map((app, index) => {
        if (isNmmssScholarship) {
          return `
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
        }

        return `
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
            <td>${app.previous_school_name || '-'}</td>
            <td>${app.previous_school_type || '-'}</td>
            <td>${app.center_order || '-'}</td>
            <td>${app.center_name || '-'}</td>
            <td>${app.contact_no || '-'}</td>
            ${isCmScholarship ? `<td>${formatAttendanceFlag(pickFirst(app, ['mat', 'mat_status']))}</td><td>${formatAttendanceFlag(pickFirst(app, ['sat', 'sat_status']))}</td>` : ''}
          </tr>
        `;
      })
      .join('');

    const html = `
      <html>
        <head>
          <title>Submitted Applications Report</title>
          <style>
            @page { size: A4 landscape; margin: 6mm; }
            * { box-sizing: border-box; }
            html, body { width: 100%; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; padding: 8px; }
            h2 { text-align: center; margin: 0 0 6px; font-size: 16px; }
            .info { text-align: center; margin-bottom: 10px; font-size: 11px; line-height: 1.35; }
            .info .meta { margin: 0; font-size: 11px; font-weight: 600; }
            .table-wrap { width: 100%; overflow: hidden; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7px; }
            th, td {
              border: 1px solid #000;
              padding: 3px 2px;
              text-align: center;
              vertical-align: middle;
              overflow-wrap: anywhere;
              word-break: break-word;
              line-height: 1.2;
            }
            th {
              background-color: #f0f0f0;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          <h2>Submitted Applications Report</h2>
          <div class="info">
            <p class="meta">
              <strong>Scholarship:</strong> ${selectedScholarshipName || 'N/A'} |
              <strong>Session:</strong> ${selectedSession?.session_name || 'N/A'}${classMeta}${schoolMeta}${idMeta} |
              <strong>Generated:</strong> ${generatedAt}
            </p>
          </div>
          <div class="table-wrap">
            <table>
              ${headerThead}
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
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
  };

  if (selectedAppId) {
    return (
      <BeoPendingApplicationEditor
        applicationId={selectedAppId}
        forceReadOnly
        showRemarks={false}
        onBack={() => {
          setSelectedAppId(null);
          fetchApplications();
        }}
      />
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row beo-submitted-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Submitted Applications</h3>
              
            </div>
        </div>

        <div className="beo-submitted-header-actions">
          {/* NMMSS has the single class 8, so there is nothing to choose: the
              list stays scoped to it (classFilter) without a button. */}
          {isCmScholarship && (
            <div className="filter-group beo-submitted-inline-filter">
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                  onClick={() => setClassFilter('6')}
                >
                  CM Class 6
                </button>
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                  onClick={() => setClassFilter('9')}
                >
                  CM Class 9
                </button>
              </div>
            </div>
          )}

          <div className="beo-submitted-btn-group">
            <button
              type="button"
              className="scert-btn-primary"
              onClick={handleDownloadPDF}
              disabled={loading || sortedApplications.length === 0}
            >
              Download PDF
            </button>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={fetchApplications}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="filters-bar" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
        <div className="filter-group">
          <label className="filter-label" htmlFor="beo-submitted-school-filter">School</label>
          <select
            id="beo-submitted-school-filter"
            className="form-input"
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            style={{ minWidth: '280px' }}
          >
            <option value="">All Schools</option>
            {schoolOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="beo-submitted-id-filter">Application ID</label>
          <input
            id="beo-submitted-id-filter"
            type="search"
            className="form-input"
            value={applicationIdQuery}
            onChange={(e) => setApplicationIdQuery(e.target.value)}
            placeholder="Search by Application ID"
            style={{ minWidth: '220px' }}
          />
        </div>
        {filtersActive && (
          <div className="filter-group">
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSchoolFilter('');
                setApplicationIdQuery('');
              }}
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading submitted applications...</div>
      ) : sortedApplications.length === 0 ? (
        <div className="empty-state">No submitted applications found for the selected filters.</div>
      ) : (
        <div className="beo-submitted-table-wrap smart-table-wrap">
          <table className="smart-table" style={{ minWidth: isNmmssScholarship ? '3000px' : '2600px' }}>
            <thead>
              {isNmmssScholarship ? (
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
                    <th rowSpan={2} style={{ minWidth: 130 }}>Contact Number of Student</th>
                    <th colSpan={2} style={{ minWidth: 180, textAlign: 'center' }}>Attendance</th>
                  </tr>
                  <tr>
                    <th style={{ minWidth: 90 }}>MAT</th>
                    <th style={{ minWidth: 90 }}>SAT</th>
                  </tr>
                </>
              ) : (
                isCmScholarship ? (
                  <>
                    <tr>
                      <th rowSpan={2} style={{ minWidth: 90 }}>Action</th>
                      <th rowSpan={2} style={{ minWidth: 70 }}>S. No.</th>
                      <th rowSpan={2} style={{ minWidth: 100 }}>Block Code</th>
                      <th rowSpan={2} style={{ minWidth: 120 }}>Application ID</th>
                      <th rowSpan={2} style={{ minWidth: 150 }}>Roll No. (10 Digit)</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>SR No. of students</th>
                      <th rowSpan={2} style={{ minWidth: 170 }}>Student&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Father&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 160 }}>Mother&apos;s Name</th>
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
                      <th rowSpan={2} style={{ minWidth: 180 }}>Exam Centre&apos;s Name</th>
                      <th rowSpan={2} style={{ minWidth: 130 }}>Contact Number of Student</th>
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
                    <th style={{ minWidth: 130 }}>Contact Number of Student</th>
                  </tr>
                )
              )}
            </thead>
            <tbody>
              {pagedApplications.map((row, index) =>
                isNmmssScholarship ? (
                  <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                    <td>
                      <button
                        type="button"
                        className="icon-action-btn"
                        title="View"
                        onClick={() => setSelectedAppId(row.application_id)}
                      >
                        <HiOutlineEye />
                      </button>
                    </td>
                    <td>{startIndex + index + 1}</td>
                    <td>{row.block_code || '-'}</td>
                    <td>{pickFirst(row, ['exam_code']) || '-'}</td>
                    <td><code className="smart-table-id">{window.getDisplayApplicationId(row)}</code></td>
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
                        className="icon-action-btn"
                        title="View"
                        onClick={() => setSelectedAppId(row.application_id)}
                      >
                        <HiOutlineEye />
                      </button>
                    </td>
                    <td>{startIndex + index + 1}</td>
                    <td>{row.block_code || '-'}</td>
                    <td><code className="smart-table-id">{window.getDisplayApplicationId(row)}</code></td>
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
          <div className="table-footer">
            <div className="pagination">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
              >
                Previous
              </button>
              <div className="pagination-info">
                Showing {totalApplications === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + PAGE_SIZE, totalApplications)} of {totalApplications}
                {' '} (Page {safeCurrentPage} / {totalPages})
              </div>
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
