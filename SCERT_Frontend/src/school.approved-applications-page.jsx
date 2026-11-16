import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { SchoolApplicationViewer } from './school.application-viewer.jsx';
import { HiOutlineEye } from 'react-icons/hi';
import { useDashboard } from './DashboardContext.jsx';
import { useToast } from './ToastContext.jsx';

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
  const splitMultiValues = (rawValue) => {
    if (rawValue === null || rawValue === undefined) return [];
    if (Array.isArray(rawValue)) {
      return rawValue.flatMap((item) => splitMultiValues(item)).filter(Boolean);
    }

    const raw = String(rawValue).trim();
    if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') {
      return [];
    }

    if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
      if (raw.startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
          }
        } catch {
          // fallback below
        }
      }

      return raw
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
        .filter(Boolean);
    }

    return [raw];
  };

  const normalizeDisplay = (rawValue) => {
    const parts = splitMultiValues(rawValue);
    if (!parts.length) return '';
    return Array.from(new Set(parts)).join(', ');
  };

  let v = normalizeDisplay(value);
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
    v = normalizeDisplay(fallback);
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

const getStudentRegistrationNo = (app) =>
  pickFirst(app, [
    'sr_no',
    'sr_number',
    'student_registration_number',
    'student_registration_no',
    'student_reg_no',
    'registration_number',
    'registration_no',
    'student_registration',
  ]) || '-';

export function SchoolApprovedApplicationsPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedSessionId, selectedSession, selectedScholarshipId, selectedScholarship } = useDashboard();

  const selectedScholarshipName = String(selectedScholarship?.scholarship_name || '');
  const isNmmssSelected = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const showClassFilter = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewingApplicationId, setViewingApplicationId] = useState(null);
  const [viewingApplicationData, setViewingApplicationData] = useState(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [viewingError, setViewingError] = useState('');

  // Start as undefined so we don't auto-fetch with a wrong default when switching to a non-CM / inactive scholarship.
  const [classFilter, setClassFilter] = useState(undefined);
  const lastScholarshipIdRef = useRef(null);
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

  const fetchApplications = useCallback(async () => {
    if (!selectedScholarshipId) return;
    
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);

      const data = await get(
        `/api/school/applications/approved?${params.toString()}`,
        {
          token: auth?.token,
          sessionId: selectedSessionId,
        }
      );

      setApplications(sortApplications(Array.isArray(data.applications) ? data.applications : []));
    } catch (err) {
      console.error('Failed to fetch approved applications:', err);
      setError(err.message || 'Failed to load applications');
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, [auth?.token, selectedScholarshipId, selectedSessionId, classFilter]);


  const handleDownloadPDF = () => {
    if (applications.length === 0) {
      toast.error('No applications to download');
      return;
    }

    const showPreviousSchoolColumns = !isNmmssSelected;

    // Create table HTML
    let tableHTML = `
      <html>
        <head>
          <title>Approved Applications Report</title>
          <style>
            @page { size: A4 landscape; margin: 8mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            h2 { text-align: center; margin: 0 0 6px; font-size: 16px; }
            .info { text-align: center; margin-bottom: 8px; font-size: 11px; line-height: 1.25; }
            .report-wrap { width: 100%; overflow: visible; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8px; }
            th, td { border: 1px solid #000; padding: 2px 3px; text-align: left; vertical-align: middle; white-space: normal; word-break: break-word; line-height: 1.15; }
            th { background-color: #f0f0f0; font-weight: 700; }
            /* Force fit-to-page width: ignore fixed px widths that were causing overflow */
            [class^="w-"], [class*=" w-"] { width: auto !important; max-width: none !important; }
            .w-sno, .w-block-code, .w-sr, .w-dob, .w-sex, .w-center-code, .w-contact { text-align: center; }
            .w-school-type, .w-school-cat, .w-prev-name, .w-prev-type, .w-center-name { white-space: normal; }
            .footer { margin-top: 8px; text-align: right; font-size: 11px; }
          </style>
        </head>
        <body>
          <div class="report-wrap">
            <h2>Approved Applications Report</h2>
            <div class="info">
              <strong>Scholarship:</strong> ${selectedScholarship?.scholarship_name || 'N/A'} |
              <strong>Session:</strong> ${selectedSession?.session_name || 'N/A'}${showClassFilter && classFilter ? ` | <strong>Class:</strong> ${classFilter}` : ''} |
              <strong>Generated:</strong> ${new Date().toLocaleString()}
            </div>
            <table>
              <thead>
                <tr>
                  <th class="w-sno">S. No.</th>
                  <th class="w-block-code">Block Code</th>
                  <th class="w-app-id">App ID</th>
                  <th class="w-roll">Roll No. (10 Digit)</th>
                  <th class="w-sr">SR No. of students</th>
                  <th class="w-name">Student's Name</th>
                  <th class="w-name">Father's Name</th>
                  <th class="w-name">Mother's Name</th>
                  <th class="w-dob">Date of Birth</th>
                  <th class="w-sex">Sex</th>
                  <th class="w-caste">Caste Category</th>
                  <th class="w-div">Type of Divyangta</th>
                  ${isNmmssSelected ? '<th class="w-income">Parental Income Code</th>' : ''}
                  ${isNmmssSelected ? '<th class="w-marks">Previous Class Percentage</th>' : ''}
                  <th class="w-aadhaar">Aadhaar Number</th>
                  <th class="w-school">School Name</th>
                  <th class="w-block">Block</th>
                  <th class="w-dist">District</th>
                  <th class="w-school-type">School Type (Govt, Govt aided, Local body)</th>
                  <th class="w-school-cat">School Category (Urban, Rural)</th>
                  ${showPreviousSchoolColumns ? '<th class="w-prev-name">Previous School Name</th>' : ''}
                  ${showPreviousSchoolColumns ? '<th class="w-prev-type">Previous School Type (Govt, Govt aided, Local body)</th>' : ''}
                  <th class="w-center-code">Exam Center Code</th>
                  <th class="w-center-name">Exam Centre\'s Name</th>
                  <th class="w-contact">Contact No</th>
                </tr>
              </thead>
              <tbody>
    `;

    applications.forEach((app, index) => {
      tableHTML += `
        <tr>
          <td class="w-sno">${index + 1}</td>
          <td class="w-block-code">${app.block_code || '-'}</td>
          <td class="w-app-id">${window.getDisplayApplicationId(app)}</td>
          <td class="w-roll">${app.roll_number || '-'}</td>
          <td class="w-sr">${getStudentRegistrationNo(app)}</td>
          <td class="w-name">${app.candidate_name || app.student_name || '-'}</td>
          <td class="w-name">${app.father_name || '-'}</td>
          <td class="w-name">${app.mother_name || '-'}</td>
          <td class="w-dob">${formatMaybeDate(app.date_of_birth || app.dob)}</td>
          <td class="w-sex">${app.sex || app.gender || '-'}</td>
          <td class="w-caste">${app.caste_category || '-'}</td>
          <td class="w-div">${formatDivyangta(app.type_of_divyangta, app)}</td>
          ${isNmmssSelected ? `<td class="w-income">${pickFirst(app, ['parental_income_code', 'parental_annual_income']) || '-'}</td>` : ''}
          ${isNmmssSelected ? `<td class="w-marks">${pickFirst(app, ['marks_class_7', 'percentage_of_class_vii', 'percentage_marks_class_7']) || '-'}</td>` : ''}
          <td class="w-aadhaar">${app.aadhaar_number || '-'}</td>
          <td class="w-school">${app.school_name || app.origin_school || '-'}</td>
          <td class="w-block">${app.block_name || '-'}</td>
          <td class="w-dist">${app.district_name || app.district || app.district_code || '-'}</td>
          <td class="w-school-type">${app.school_type || '-'}</td>
          <td class="w-school-cat">${app.school_category || '-'}</td>
          ${showPreviousSchoolColumns ? `<td class="w-prev-name">${app.previous_school_name || '-'}</td>` : ''}
          ${showPreviousSchoolColumns ? `<td class="w-prev-type">${app.previous_school_type || '-'}</td>` : ''}
          <td class="w-center-code">${app.center_order || '-'}</td>
          <td class="w-center-name">${app.center_name || '-'}</td>
          <td class="w-contact">${app.contact_no || '-'}</td>
        </tr>
      `;
    });

    tableHTML += `
              </tbody>
            </table>
            <div class="footer">
              <strong>Total Applications:</strong> ${applications.length}
            </div>
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

  // Keep class filter in-sync with scholarship type.
  // - CM scholarships: default to class 6 (user can toggle to class 9)
  // - Others (incl. inactive scholarships): no class filter
  // Also avoids the initial "fetch then clear" flicker by waiting until classFilter is initialized.
  useEffect(() => {
    if (!selectedScholarshipId) return;

    const desiredClassFilter = showClassFilter ? '6' : '';
    const scholarshipChanged = selectedScholarshipId !== lastScholarshipIdRef.current;

    if (scholarshipChanged) {
      lastScholarshipIdRef.current = selectedScholarshipId;
      setClassFilter(desiredClassFilter);
      return;
    }

    if (classFilter === undefined) {
      setClassFilter(desiredClassFilter);
      return;
    }

    if (showClassFilter && classFilter === '') {
      setClassFilter('6');
      return;
    }

    if (!showClassFilter && classFilter !== '') {
      setClassFilter('');
    }
  }, [selectedScholarshipId, showClassFilter, classFilter]);

  // Fetch applications when ready
  useEffect(() => {
    if (auth?.token && selectedScholarshipId && classFilter !== undefined) {
      fetchApplications();
    }
  }, [auth?.token, selectedScholarshipId, selectedSessionId, classFilter, fetchApplications]);

  const initializing = Boolean(selectedScholarshipId) && classFilter === undefined;

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Approved Applications</h3>
              
            </div>
        </div>

        {viewingApplicationId ? (
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              setViewingApplicationId(null);
              setViewingApplicationData(null);
              setViewingError('');
              fetchApplications();
            }}
          >
            Back to Approved List
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {showClassFilter ? (
              <>
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
              </>
            ) : null}
            <button
              type="button"
              className="scert-btn-primary"
              onClick={handleDownloadPDF}
              disabled={loading || initializing || applications.length === 0}
            >
              Download PDF
            </button>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={fetchApplications}
              disabled={loading || initializing}
            >
              {loading || initializing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        )}
      </div>

      {viewingApplicationId ? (
        <div className="application-viewer">
          {viewingLoading ? (
            <div className="loading-state">Loading application...</div>
          ) : viewingError ? (
            <div className="error-state">{viewingError}</div>
          ) : (
            <SchoolApplicationViewer
              key={String(viewingApplicationId)}
              applicationId={viewingApplicationId}
              prefetchedData={viewingApplicationData}
              onBack={() => {
                setViewingApplicationId(null);
                setViewingApplicationData(null);
                setViewingError('');
                fetchApplications();
              }}
            />
          )}
        </div>
      ) : (
        <>
          {error ? (
            <div className="error-state">{error}</div>
          ) : loading || initializing ? (
            <div className="smart-table-wrap school-approved-table-wrap" style={{ overflowX: 'auto' }}>
              <div className="loading-state">Loading approved applications...</div>
            </div>
          ) : applications.length === 0 ? (
            <div className="empty-state">No approved applications found for the selected criteria.</div>
          ) : (
            <div className="smart-table-wrap school-approved-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table" style={{ minWidth: isNmmssSelected ? '3000px' : '2600px' }}>
                <thead>
                  {isNmmssSelected ? (
                    <tr>
                      <th style={{ minWidth: 110 }}>Action</th>
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
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ minWidth: 110 }}>Action</th>
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
                              title="View application"
                              aria-label={`View application ${window.getDisplayApplicationId(app)}`}
                              onClick={() => {
                                setViewingApplicationId(app.application_id);
                                setViewingApplicationData(null);
                                setViewingError('');
                                setViewingLoading(false);
                              }}
                            >
                              <HiOutlineEye size={18} />
                            </button>
                          </td>
                          <td>{index + 1}</td>
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
                        </>
                      ) : (
                        <>
                          <td>
                            <button
                              type="button"
                              className="icon-action-btn"
                              title="View application"
                              aria-label={`View application ${window.getDisplayApplicationId(app)}`}
                              onClick={() => {
                                setViewingApplicationId(app.application_id);
                                setViewingApplicationData(null);
                                setViewingError('');
                                setViewingLoading(false);
                              }}
                            >
                              <HiOutlineEye size={18} />
                            </button>
                          </td>
                          <td>{index + 1}</td>
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
                          <td>{app.previous_school_name || '-'}</td>
                          <td>{app.previous_school_type || '-'}</td>
                          <td>{app.center_order || '-'}</td>
                          <td>{app.center_name || '-'}</td>
                          <td>{app.contact_no || '-'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{applications.length}</strong> application(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
