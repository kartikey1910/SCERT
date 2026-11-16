import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
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

const formatDisability = (value, row = null) => {
  let v = String(value ?? '').trim();
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

export function BeoNominalRollPage({ onNavigate }) {
  const { auth } = useAuth();
  const {
    selectedScholarshipId,
    selectedSessionId,
    selectedScholarship,
    selectedSession,
    scholarships,
    sessions,
  } = useDashboard();
  const toast = useToast();
  const selectedScholarshipName = String(
    selectedScholarship?.scholarship_name ||
      scholarships?.find((s) => String(s?.scholarship_id) === String(selectedScholarshipId))?.scholarship_name ||
      selectedScholarshipId ||
      ''
  );
  const selectedSessionName = String(
    selectedSession?.session_name ||
      sessions?.find((s) => String(s?.session_id) === String(selectedSessionId))?.session_name ||
      selectedSessionId ||
      ''
  );
  const isCMScholarship =
    /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNMMSSScholarship =
    /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const hideSchoolCategory = isNMMSSScholarship || isCMScholarship;

  const [level, setLevel] = useState('center'); // center | preview
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [selectedCenterId, setSelectedCenterId] = useState('');

  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);

  const [centerApplications, setCenterApplications] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(false);

  const [countsByCenterId, setCountsByCenterId] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [error, setError] = useState('');

  const getStudentRegistrationNo = (app) =>
    app?.student_registration_no ||
    app?.student_registration_number ||
    app?.student_registration ||
    app?.student_registrations ||
    app?.student_registration_id ||
    app?.sr_no ||
    app?.sr_number ||
    '-';

  const shouldApplyClassFilter = !isNMMSSScholarship;
  const [classFilter, setClassFilter] = useState(shouldApplyClassFilter ? '6' : '');

  const fetchCenters = async () => {
    if (!selectedScholarshipId) return;

    setLoadingCenters(true);
    try {
      const data = await get(`/api/beo/centers?scholarship_id=${selectedScholarshipId}`, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });
      const list = Array.isArray(data?.centers) ? data.centers : [];
      setCenters(list);
    } catch (err) {
      console.error('Failed to fetch centers:', err);
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
      setCenters([]);
    } finally {
      setLoadingCenters(false);
    }
  };

  const fetchCounts = async () => {
    if (!selectedScholarshipId) return;

    setLoadingCounts(true);
    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);

      const data = await get(`/api/beo/nominal-roll?${params.toString()}`, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });

      const apps = Array.isArray(data?.applications) ? data.applications : [];
      const next = {};
      for (const app of apps) {
        const key = app.center_id != null ? String(app.center_id) : '';
        if (!key) continue;
        next[key] = (next[key] || 0) + 1;
      }
      setCountsByCenterId(next);
    } catch (err) {
      console.error('Failed to fetch nominal roll counts:', err);
      // Counts are non-blocking; keep UI usable
      setCountsByCenterId({});
    } finally {
      setLoadingCounts(false);
    }
  };

  const fetchCenterNominalRoll = async () => {
    if (!selectedScholarshipId || !selectedCenterId) return;

    setLoadingApplications(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      params.append('center_id', selectedCenterId);
      if (shouldApplyClassFilter && classFilter) params.append('class_filter', classFilter);

      const data = await get(`/api/beo/nominal-roll?${params.toString()}`, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });

      const apps = Array.isArray(data?.applications) ? data.applications : [];
      setCenterApplications(apps);
    } catch (err) {
      console.error('Failed to fetch nominal roll:', err);
      setError(err.message || 'Failed to load nominal roll');
      toast.error(`Failed to load nominal roll: ${toast.getErrorMessage(err)}`);
      setCenterApplications([]);
    } finally {
      setLoadingApplications(false);
    }
  };

  useEffect(() => {
    setLevel('center');
    setSelectedCenter(null);
    setSelectedCenterId('');
    setCenterApplications([]);
    setError('');

    fetchCenters();
    fetchCounts();
  }, [selectedScholarshipId, selectedSessionId, auth?.token]);

  useEffect(() => {
    setClassFilter(shouldApplyClassFilter ? '6' : '');
  }, [shouldApplyClassFilter, selectedScholarshipId]);

  useEffect(() => {
    if (level !== 'preview') return;
    if (!selectedCenterId) return;

    fetchCenterNominalRoll();
  }, [level, selectedCenterId, classFilter, selectedScholarshipId, selectedSessionId, auth?.token]);

  const downloadPdfFromApps = (apps, { centerName, centerCode }) => {
    if (!Array.isArray(apps) || apps.length === 0) {
      toast.info('No data to download');
      return;
    }

    const generatedAt = new Date().toLocaleString();
    const classLine = shouldApplyClassFilter && classFilter
      ? `<span><strong>Class:</strong> ${classFilter}</span>`
      : '';

    const headerColumns = `
      <th>S.N</th>
      <th>Block Code</th>
      <th>Application ID</th>
      <th>Roll No.</th>
      <th>SR No.</th>
      <th>Candidate's Name</th>
      <th>Father's Name</th>
      <th>Mother's Name</th>
      <th>Date Of Birth</th>
      <th>SEX</th>
      <th>Caste Category</th>
      <th>Type Of Divyangta</th>
      <th>Adhaar Number</th>
      <th>School Name</th>
      <th>Block</th>
      <th>Distt</th>
      <th>School Type</th>
      ${!hideSchoolCategory ? '<th>School Category</th>' : ''}
    `;

    const rowsHtml = apps
      .map((app, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${app.block_code || '-'}</td>
          <td>${window.getDisplayApplicationId(app) || '-'}</td>
          <td>${app.roll_number || '-'}</td>
          <td>${getStudentRegistrationNo(app)}</td>
          <td>${app.candidate_name || '-'}</td>
          <td>${app.father_name || '-'}</td>
          <td>${app.mother_name || '-'}</td>
          <td>${formatMaybeDate(app.date_of_birth)}</td>
          <td>${app.sex || '-'}</td>
          <td>${app.caste_category || '-'}</td>
          <td>${formatDisability(app.type_of_divyangta, app)}</td>
          <td>${app.aadhaar_number || '-'}</td>
          <td>${app.school_name || '-'}</td>
          <td>${app.block_name || '-'}</td>
          <td>${app.district_name || '-'}</td>
          <td>${app.school_type || '-'}</td>
          ${!hideSchoolCategory ? `<td>${app.school_category || '-'}</td>` : ''}
        </tr>
      `)
      .join('');

    const html = `
      <html>
        <head>
          <title>Nominal Roll</title>
          <style>
            @page { size: landscape; margin: 12mm; }
            body { font-family: Arial, sans-serif; margin: 0; }
            h2 { text-align: center; margin: 0 0 8px; }
            .header-brand { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px; }
            .header-brand img { height: 36px; width: 36px; object-fit: contain; }
            .header-brand span { font-size: 12px; font-weight: bold; }
            .info { margin: 0 0 12px; font-size: 12px; }
            .info-row {
              display: flex;
              justify-content: center;
              align-items: center;
              gap: 16px;
              white-space: nowrap;
            }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th, td { border: 1px solid #000; padding: 4px 5px; text-align: left; vertical-align: top; }
            th { background: #f2f2f2; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header-brand">
            <img src="${window.location.origin}/scert-logo.png" alt="SCERT" />
            <span>State Council for Educational Research and Training, Uttarakhand</span>
          </div>
          <h2>Nominal Roll</h2>
          <div class="info">
            <div class="info-row">
              <span><strong>Center Code:</strong> ${centerCode || '-'}</span>
              <span><strong>Scholarship:</strong> ${selectedScholarshipName || '-'}</span>
              <span><strong>Session:</strong> ${selectedSessionName || '-'}</span>
              <span><strong>Center:</strong> ${centerName}</span>
              ${classLine}
              <span><strong>Generated:</strong> ${generatedAt}</span>
            </div>
          </div>
          <table>
            <thead><tr>${headerColumns}</tr></thead>
            <tbody>${rowsHtml}</tbody>
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
  };

  const renderClassFilters = () => {
    if (!shouldApplyClassFilter) return null;

    return (
      <div className="filters-bar">
        <div className="filter-group">
          <label className="filter-label">Class Filter</label>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
              onClick={() => setClassFilter('6')}
            >
              CM Class 6 Nominal Roll
            </button>
            <button
              type="button"
              className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
              onClick={() => setClassFilter('9')}
            >
              CM Class 9 Nominal Roll
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loadingCenters && centers.length === 0 && level === 'center') {
    return (
      <div className="beo-content-area">
        <div className="loading-state">Loading centers...</div>
      </div>
    );
  }

  if (level === 'center') {
    return (
      <div className="beo-content-area">
        <div className="view-header-row">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Nominal Roll - Select Center</h3>
              
            </div>
            <p className="view-subtitle">Click a center to view/download its nominal roll</p>
          </div>
        </div>

        {error ? (
          <div className="error-state">{error}</div>
        ) : centers.length === 0 ? (
          <div className="empty-state">No centers found</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th>Center Order</th>
                  <th>Center Name</th>
                  <th>Students</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((center) => {
                  const count = countsByCenterId[String(center.center_id)] ?? 0;

                  return (
                    <tr
                      key={center.center_id}
                      className="smart-table-clickable"
                      onClick={() => {
                        setSelectedCenter(center);
                        setSelectedCenterId(String(center.center_id));
                        setLevel('preview');
                      }}
                    >
                      <td className="smart-table-strong">{center.center_order ?? '-'}</td>
                      <td className="smart-table-strong">{center.center_name || center.school_name || '-'}</td>
                      <td>{loadingCounts ? '-' : count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (level === 'preview') {
    const centerName = selectedCenter?.center_name || selectedCenter?.school_name || 'Center';
    const centerCode = selectedCenter?.center_order || '-';

    return (
      <div className="beo-content-area">
        <div className="view-header-row">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Nominal Roll - {centerName} (Center Code: {centerCode})</h3>

            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('center');
                setSelectedCenter(null);
                setCenterApplications([]);
                setError('');
              }}
            >
              Back to Centers
            </button>
            <button
              type="button"
              className="scert-btn-primary"
              onClick={() => {
                setDownloadLoading(true);
                try {
                  downloadPdfFromApps(centerApplications, {
                    centerName,
                    centerCode,
                  });
                } finally {
                  setDownloadLoading(false);
                }
              }}
              disabled={downloadLoading || centerApplications.length === 0}
            >
              {downloadLoading ? 'Downloading...' : 'Download PDF'}
            </button>
          </div>
        </div>

        {shouldApplyClassFilter ? (
          <div className="filters-bar">
            <div className="filter-group">
              <label className="filter-label">Class Filter</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                  onClick={() => setClassFilter('6')}
                >
                  Class 6 Nominal Roll
                </button>
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                  onClick={() => setClassFilter('9')}
                >
                  Class 9 Nominal Roll
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {loadingApplications ? (
          <div className="loading-state">Loading nominal roll...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : centerApplications.length === 0 ? (
          <div className="empty-state">No approved applications found for this center.</div>
        ) : (
          <>
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>S.N</th>
                    <th>Block Code</th>
                    <th>Application ID</th>
                    <th>Roll No.</th>
                    <th>SR No.</th>
                    <th>Candidate's Name</th>
                    <th>Father's Name</th>
                    <th>Mother's Name</th>
                    <th>Date Of Birth</th>
                    <th>SEX</th>
                    <th>Caste Category</th>
                    <th>Type Of Divyangta</th>
                    <th>Adhaar Number</th>
                    <th>School Name</th>
                    <th>Block</th>
                    <th>Distt</th>
                    <th>School Type</th>
                    {!hideSchoolCategory && <th>School Category</th>}
                  </tr>
                </thead>
                <tbody>
                  {centerApplications.map((app, index) => (
                    <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                      <td>{index + 1}</td>
                      <td>{app.block_code || '-'}</td>
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                      </td>
                      <td className="smart-table-strong">{app.roll_number || '-'}</td>
                      <td>{getStudentRegistrationNo(app)}</td>
                      <td>{app.candidate_name || '-'}</td>
                      <td>{app.father_name || '-'}</td>
                      <td>{app.mother_name || '-'}</td>
                      <td>
                        {formatMaybeDate(app.date_of_birth)}
                      </td>
                      <td>{app.sex || '-'}</td>
                      <td>{app.caste_category || '-'}</td>
                      <td>{formatDisability(app.type_of_divyangta, app)}</td>
                      <td>{app.aadhaar_number || '-'}</td>
                      <td>{app.school_name || '-'}</td>
                      <td>{app.block_name || '-'}</td>
                      <td>{app.district_name || '-'}</td>
                      <td>{app.school_type || '-'}</td>
                      {!hideSchoolCategory && <td>{app.school_category || '-'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span className="table-count">
                Total: <strong>{centerApplications.length}</strong> application(s)
                {shouldApplyClassFilter && classFilter ? ` (Class ${classFilter})` : ''}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}
