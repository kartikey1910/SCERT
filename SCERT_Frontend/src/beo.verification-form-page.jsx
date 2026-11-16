import { useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { API_BASE_URL, get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

const extractApplicationClass = (app) => {
  if (app?.class !== null && app?.class !== undefined && String(app.class).trim() !== '') {
    return String(app.class).trim();
  }
  const displayId = String(app?.application_display_id || '');
  const match = displayId.match(/^CM(\d)/i);
  return match?.[1] || '';
};

const getDisabilityCode = (row) => {
  const value = [
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
  return value ?? 'No';
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// The identifying details printed at the top of the verification form: which
// center this is, and the block and district it belongs to.
const getCenterHeaderDetails = (center) => {
  const pick = (...values) => {
    const found = values.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
    return found === undefined ? '-' : String(found).trim();
  };
  return {
    centerCode: pick(center?.center_code, center?.center_order),
    blockName: pick(center?.block_name),
    blockCode: pick(center?.block_code),
    districtName: pick(center?.district_name),
    districtCode: pick(center?.district_code),
  };
};

export function BeoVerificationFormPage({ onNavigate }) {
  const { auth } = useAuth();
  const { selectedScholarshipId, scholarships, selectedSessionId, selectedSession, sessions } = useDashboard();
  const toast = useToast();

  const [level, setLevel] = useState('center'); // center | preview
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [selectedCenterId, setSelectedCenterId] = useState('');

  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);

  const [countsByCenterId, setCountsByCenterId] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [allCenterApplications, setAllCenterApplications] = useState([]);
  const [centerApplications, setCenterApplications] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  
  // Pagination State for Applications
  const [currentPage, setCurrentPage] = useState(1);
  const [totalApplications, setTotalApplications] = useState(0);
  const applicationsPerPage = 20;

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [error, setError] = useState('');

  // Class filter applies only for CM scheme
  const [classFilter, setClassFilter] = useState('6');

  const selectedScholarship = scholarships.find(
    (s) => String(s.scholarship_id) === String(selectedScholarshipId)
  );
  const selectedScholarshipName = String(selectedScholarship?.scholarship_name || '');
  const isCmScholarship =
    /\bcm\b/i.test(selectedScholarshipName) || /chief\s*minister/i.test(selectedScholarshipName);
  const isNmmssScholarship =
    /\bnmmss\b/i.test(selectedScholarshipName) ||
    /\bnmms\b/i.test(selectedScholarshipName) ||
    /snss/i.test(selectedScholarshipName) ||
    /ssss/i.test(selectedScholarshipName);
  const shouldApplyClassFilter = isCmScholarship;
  const selectedSessionName = String(
    selectedSession?.session_name ||
      sessions?.find((s) => String(s?.session_id) === String(selectedSessionId))?.session_name ||
      selectedSessionId ||
      ''
  );
  const selectedScholarshipDisplayName = String(
    selectedScholarship?.scholarship_name || 'Scholarship Examination'
  );
  const formatDisplayDate = (value) => {
    if (!value) return '-';
    const raw = String(value).trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = String(parsed.getFullYear());
    return `${day}/${month}/${year}`;
  };

  const verificationClassLabel =
    shouldApplyClassFilter
      ? String(classFilter || '6')
      : isNmmssScholarship
        ? '8'
        : '';

  useEffect(() => {
    setClassFilter(shouldApplyClassFilter ? '6' : '');
  }, [shouldApplyClassFilter, selectedScholarshipId]);

  const fetchCenters = async () => {
    if (!selectedScholarshipId) return;

    setLoadingCenters(true);
    try {
      const data = await get(`/api/beo/centers?scholarship_id=${selectedScholarshipId}`, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });
      setCenters(Array.isArray(data?.centers) ? data.centers : []);
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
      console.error('Failed to fetch counts:', err);
      setCountsByCenterId({});
    } finally {
      setLoadingCounts(false);
    }
  };

  const fetchCenterApplications = async (targetPage = 1) => {
    if (!selectedScholarshipId || !selectedCenterId) return;

    setLoadingApplications(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      params.append('center_id', selectedCenterId);

      const data = await get(`/api/beo/nominal-roll?${params.toString()}`, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });

      let apps = Array.isArray(data?.applications) ? data.applications : [];
      
      // Filter by class locally
      if (shouldApplyClassFilter && classFilter) {
        apps = apps.filter(app => extractApplicationClass(app) === String(classFilter));
      }

      setAllCenterApplications(apps);
      setTotalApplications(apps.length);
      
      // Frontend pagination
      const startIndex = (targetPage - 1) * applicationsPerPage;
      setCenterApplications(apps.slice(startIndex, startIndex + applicationsPerPage));
      setCurrentPage(targetPage);
    } catch (err) {
      console.error('Failed to fetch center applications:', err);
      setError(err.message || 'Failed to load verification form data');
      toast.error(`Failed to load verification form: ${toast.getErrorMessage(err)}`);
      setAllCenterApplications([]);
      setCenterApplications([]);
      setTotalApplications(0);
    } finally {
      setLoadingApplications(false);
    }
  };

  useEffect(() => {
    setLevel('center');
    setSelectedCenter(null);
    setSelectedCenterId('');
    setAllCenterApplications([]);
    setCenterApplications([]);
    setError('');

    fetchCenters();
    fetchCounts();
  }, [selectedScholarshipId, selectedSessionId, auth?.token]);

  useEffect(() => {
    if (level !== 'preview') return;
    if (!selectedCenterId) return;

    fetchCenterApplications(1);
  }, [level, selectedCenterId, classFilter, selectedScholarshipId, selectedSessionId, auth?.token]);

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
      </div>
    );
  };

  const toAssetUrl = (path) => {
    const v = String(path || '').trim();
    if (!v) return '';
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    return `${API_BASE_URL}${v}`;
  };

  const buildVerificationHtml = ({ apps, centerName, center }) => {
    const details = getCenterHeaderDetails(center);
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Verification Form - ${centerName}</title>
        <style>
          @media print {
            body { margin: 0; }
            .page-break { page-break-after: always; }
            @page { size: A4 landscape; margin: 8mm; }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 10px;
          }
          .header { text-align: center; margin-bottom: 12px; }
          .header-brand { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px; }
          .header-brand img { height: 36px; width: 36px; object-fit: contain; }
          .header-brand span { font-size: 12px; font-weight: bold; }
          .header h2 { margin: 0 0 8px; font-size: 16px; }
          .header .info { margin: 0; font-size: 11px; }
          .header .info-row {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 16px;
            white-space: nowrap;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-bottom: 16px;
          }
          th, td {
            border: 1px solid #000;
            padding: 5px 3px;
            text-align: center;
            vertical-align: middle;
          }
          th {
            background-color: #f0f0f0;
            font-weight: bold;
            font-size: 11px;
          }
          td {
            min-height: 44px;
            font-size: 11px;
            overflow-wrap: anywhere;
          }
          .photo-cell {
            width: 36px;
          }
          .photo-cell img {
            width: 30px;
            height: 42px;
            object-fit: contain;
            object-position: center;
            background: #fff;
          }
          .photo-cell img.signature-img {
            height: 32px;
            width: 46px;
          }
          th:nth-child(1), td:nth-child(1),
          th:nth-child(2), td:nth-child(2) { width: 52px; }
          th:nth-child(10), td:nth-child(10) { width: 44px; }
          th:nth-child(11), td:nth-child(11) { width: 90px; }
          th:nth-child(12), td:nth-child(12), th:nth-child(13), td:nth-child(13) { width: 132px; }
          th:nth-child(14), td:nth-child(14) { width: 138px; }
          .invigilator-signature {
            margin-top: 40px;
            text-align: right;
            font-size: 11px;
          }
          .signature-line {
            margin-top: 50px;
            border-top: 1px solid #000;
            width: 200px;
            display: inline-block;
          }
          #loader {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 24px;
            font-weight: bold;
            color: #555;
          }
        </style>
      </head>
      <body>
        <div id="loader">Loading student images, please wait...</div>
        <div id="content" style="display: none;">
          <table>
            <thead class="print-header">
              <tr>
                <th colspan="14" style="background: white; border: none; padding-bottom: 15px;">
                  <div class="header" style="margin:0; border:none;">
                    <div class="header-brand">
                      <img src="${window.location.origin}/scert-logo.png" alt="SCERT" />
                      <span>State Council for Educational Research and Training, Uttarakhand</span>
                    </div>
                    <h2>Verification Form</h2>
                    <div class="info">
                      <div class="info-row">
                        <span><strong>Scholarship:</strong> ${selectedScholarshipDisplayName || '-'}</span>
                        <span><strong>Session:</strong> ${selectedSessionName || '-'}</span>
                        <span><strong>Centre:</strong> ${centerName}</span>
                        ${shouldApplyClassFilter ? `<span><strong>Class:</strong> ${verificationClassLabel || '-'}</span>` : ''}
                      </div>
                      <div class="info-row" style="margin-top: 6px;">
                        <span><strong>Center Code:</strong> ${escapeHtml(details.centerCode)}</span>
                        <span><strong>Block:</strong> ${escapeHtml(details.blockName)} (${escapeHtml(details.blockCode)})</span>
                        <span><strong>District:</strong> ${escapeHtml(details.districtName)} (${escapeHtml(details.districtCode)})</span>
                      </div>
                    </div>
                  </div>
                </th>
              </tr>
              <tr>
                <th class="photo-cell" rowspan="2">Photograph</th>
                <th class="photo-cell" rowspan="2">Candidate Signature</th>
                <th rowspan="2">Roll No.</th>
                <th rowspan="2">Applicant Name</th>
                <th rowspan="2">Father Name</th>
                <th rowspan="2">Mother Name</th>
                <th rowspan="2">Date of Birth</th>
                <th rowspan="2">Sex</th>
                <th rowspan="2">Caste</th>
                <th rowspan="2">Divyangta Code</th>
                <th rowspan="2">School Name</th>
                <th colspan="2">Signature of Applicant</th>
                <th class="photo-cell" style="width: 138px;" rowspan="2">Invigilator's Signature</th>
              </tr>
              <tr>
                <th style="width: 132px;">MAT</th>
                <th style="width: 132px;">SAT</th>
              </tr>
            </thead>
            <tbody>
              ${apps
                .map(
                  (app, index) => `
                <tr>
                  <td class="photo-cell" style="height: 72px;">
                    ${app.photo_url ? `<img src="${toAssetUrl(app.photo_url)}" alt="Photo" />` : ''}
                  </td>
                  <td class="photo-cell" style="height: 72px;">
                    ${app.signature_url ? `<img class="signature-img" src="${toAssetUrl(app.signature_url)}" alt="Signature" />` : ''}
                  </td>
                  <td>${app.roll_number || '-'}</td>
                  <td>${app.candidate_name || '-'}</td>
                  <td>${app.father_name || '-'}</td>
                  <td>${app.mother_name || '-'}</td>
                  <td>${formatDisplayDate(app.date_of_birth)}</td>
                  <td>${app.sex || '-'}</td>
                  <td>${app.caste_category || '-'}</td>
                  <td>${getDisabilityCode(app)}</td>
                  <td>${app.school_name || '-'}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>

          <div class="invigilator-signature">
            <p>Centre Superintendent Signature: <span class="signature-line"></span></p>
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const downloadSelectedCenterPdf = () => {
    if (!selectedCenterId) {
      toast.info('Select a center first');
      return;
    }

    if (!Array.isArray(allCenterApplications) || allCenterApplications.length === 0) {
      toast.info('No data to download');
      return;
    }

    const center = centers.find((c) => String(c.center_id) === String(selectedCenterId));
    const centerName = center?.center_name || center?.school_name || `Center ${selectedCenterId}`;

    setDownloadLoading(true);
    toast.info("Generating PDF, please wait for images to load...");

    try {
      const printWindow = window.open('', '', 'width=800,height=600');
      const htmlContent = buildVerificationHtml({ apps: allCenterApplications, centerName, center });

      printWindow.document.write(htmlContent);
      printWindow.document.close();

      const script = printWindow.document.createElement('script');
      script.textContent = `
        window.onload = function() {
          const images = Array.from(document.images);
          let loaded = 0;
          let total = images.length;
          
          if (total === 0) {
            triggerPrint();
            return;
          }
          
          function checkDone() {
            loaded++;
            if (loaded >= total) {
              triggerPrint();
            }
          }
          
          function triggerPrint() {
            document.getElementById('loader').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            setTimeout(() => { window.print(); }, 250);
          }
          
          images.forEach(img => {
            if (img.complete) {
              checkDone();
            } else {
              img.onload = checkDone;
              img.onerror = checkDone;
            }
          });
        };
      `;
      printWindow.document.body.appendChild(script);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      toast.error("Failed to generate PDF");
    } finally {
      setDownloadLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > Math.ceil(totalApplications / applicationsPerPage)) return;
    const startIndex = (newPage - 1) * applicationsPerPage;
    setCenterApplications(allCenterApplications.slice(startIndex, startIndex + applicationsPerPage));
    setCurrentPage(newPage);
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
              <h3 className="view-title">Verification Form - Select Center</h3>
            </div>
            <p className="view-subtitle">Click a center to preview/download the verification form</p>
          </div>
        </div>

        {error ? (
          <div className="error-state">{error}</div>
        ) : centers.length === 0 ? (
          <div className="empty-state">No centers found</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table" style={{ fontSize: "16px" }}>
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
                      <td>{loadingCounts ? '...' : count}</td>
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
    const centerDetails = getCenterHeaderDetails(selectedCenter);
    const totalPages = Math.ceil(totalApplications / applicationsPerPage);

    return (
      <div className="beo-content-area">
        <div className="view-header-row">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Verification Form - {centerName}</h3>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('center');
                setSelectedCenter(null);
                setAllCenterApplications([]);
                setCenterApplications([]);
                setError('');
              }}
            >
              Back to Centers
            </button>
            <button
              type="button"
              className="scert-btn-primary"
              onClick={downloadSelectedCenterPdf}
              disabled={downloadLoading || allCenterApplications.length === 0}
            >
              {downloadLoading ? 'Preparing...' : 'Download PDF'}
            </button>
          </div>
        </div>

        <div className="beo-verification-center-details" aria-label="Center details">
          <div className="beo-verification-detail">
            <span className="beo-verification-detail-label">Center Code</span>
            <span className="beo-verification-detail-value">{centerDetails.centerCode}</span>
          </div>
          <div className="beo-verification-detail">
            <span className="beo-verification-detail-label">Block</span>
            <span className="beo-verification-detail-value">
              {centerDetails.blockName} ({centerDetails.blockCode})
            </span>
          </div>
          <div className="beo-verification-detail">
            <span className="beo-verification-detail-label">District</span>
            <span className="beo-verification-detail-value">
              {centerDetails.districtName} ({centerDetails.districtCode})
            </span>
          </div>
          {shouldApplyClassFilter && (
            <div className="beo-verification-detail">
              <span className="beo-verification-detail-label">Class</span>
              <span className="beo-verification-detail-value">{verificationClassLabel || '-'}</span>
            </div>
          )}
        </div>

        {renderClassFilters()}

        {loadingApplications ? (
          <div className="loading-state">Loading verification form data...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : centerApplications.length === 0 ? (
          <div className="empty-state">No approved applications found for this center.</div>
        ) : (
          <>
            <div className="verification-preview">
              <p className="preview-note">
                Preview: Showing Page {currentPage} of {totalPages}
                {shouldApplyClassFilter && verificationClassLabel ? ` (Class ${verificationClassLabel})` : ''}
              </p>
            </div>

            <div className="smart-table-wrap">
              <table className="smart-table" style={{ fontSize: "16px", overflowX: 'auto' }}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Photo</th>
                    <th rowSpan={2}>Candidate Signature</th>
                    <th rowSpan={2}>Roll No.</th>
                    <th rowSpan={2}>Applicant Name</th>
                    <th rowSpan={2}>Father Name</th>
                    <th rowSpan={2}>Mother Name</th>
                    <th rowSpan={2}>Date of Birth</th>
                    <th rowSpan={2}>Sex</th>
                    <th rowSpan={2}>Caste</th>
                    <th rowSpan={2}>Divyangta Status</th>
                    <th rowSpan={2}>School Name</th>
                    <th colSpan={2}>Signature of Applicant</th>
                    <th rowSpan={2}>Invigilator's Signature</th>
                  </tr>
                  <tr>
                    <th style={{ width: '72px' }}>MAT</th>
                    <th style={{ width: '72px' }}>SAT</th>
                  </tr>
                </thead>
                <tbody>
                  {centerApplications.map((app) => (
                    <tr key={app.application_id} className={window.getSubmissionRoleRowClass ? window.getSubmissionRoleRowClass(app) : ''}>
                      <td>
                        {app.photo_url ? (
                          <img
                            src={toAssetUrl(app.photo_url)}
                            alt="Student"
                            style={{
                              width: '40px',
                              height: '50px',
                              objectFit: 'contain',
                              objectPosition: 'center',
                              background: '#fff',
                            }}
                          />
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        {app.signature_url ? (
                          <img
                            src={toAssetUrl(app.signature_url)}
                            alt="Student Signature"
                            style={{
                              width: '46px',
                              height: '34px',
                              objectFit: 'contain',
                              objectPosition: 'center',
                              background: '#fff',
                            }}
                          />
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="smart-table-strong">{app.roll_number || '-'}</td>
                      <td>{app.candidate_name || '-'}</td>
                      <td>{app.father_name || '-'}</td>
                      <td>{app.mother_name || '-'}</td>
                      <td>
                        {formatDisplayDate(app.date_of_birth)}
                      </td>
                      <td>{app.sex || '-'}</td>
                      <td>{app.caste_category || '-'}</td>
                      <td>{getDisabilityCode(app)}</td>
                      <td>{app.school_name || '-'}</td>
                      <td></td>
                      <td></td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="table-count">
                Total: <strong>{totalApplications}</strong> student(s)
                {shouldApplyClassFilter && classFilter ? ` (Class ${classFilter})` : ''}
              </span>

              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button 
                    className="scert-btn-secondary"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || loadingApplications}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '14px' }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: '14px' }}>Page {currentPage} of {totalPages}</span>
                  <button 
                    className="scert-btn-secondary"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || loadingApplications}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '14px' }}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return null;
}
