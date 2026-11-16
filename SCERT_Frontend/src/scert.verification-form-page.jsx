import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { API_BASE_URL, get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

const normalizeTwoDigitCode = (code) => {
  const s = String(code ?? '');
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n).padStart(2, '0');
  return s;
};

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

export function ScertVerificationFormPage() {
  const { auth } = useAuth();
  const { sessionId, sessions, selectedScholarshipId, scholarships } = useSession();
  const toast = useToast();
  
  const [level, setLevel] = useState('district'); // district | block | center | preview
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [selectedCenter, setSelectedCenter] = useState(null);

  const [districts, setDistricts] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [centers, setCenters] = useState([]);
  const [applications, setApplications] = useState([]);
  const [classFilter, setClassFilter] = useState('6');
  
  // Pagination State for Applications
  const [currentPage, setCurrentPage] = useState(1);
  const [totalApplications, setTotalApplications] = useState(0);
  const applicationsPerPage = 20;

  const [loading, setLoading] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [error, setError] = useState('');

  const selectedScholarship = scholarships.find(
    (s) => String(s.scholarship_id) === String(selectedScholarshipId)
  );
  const selectedSession = sessions.find((s) => String(s.session_id) === String(sessionId));
  const selectedSessionName = String(selectedSession?.session_name || '');
  const selectedScholarshipDisplayName = String(
    selectedScholarship?.scholarship_name || 'Scholarship Examination'
  );
  const selectedScholarshipName = String(selectedScholarship?.scholarship_name || '');
  const isCmScholarship =
    /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  
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

  // NMMSS is a class 8 exam only. It is recognised by name: its scholarship id
  // changes from one session to the next.
  const isNmmssByName = /\bNMMSS\b|\bNMMS\b/i.test(selectedScholarshipName);
  const verificationClassLabel = isCmScholarship
    ? String(classFilter || '6')
    : isNmmssByName
      ? '8'
      : '-';
  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId);

  const fetchDistricts = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      // Fetch both the district metadata and the separated fast student counts API
      const [distRes, countsRes] = await Promise.all([
        get(`/api/scert/list-centers/districts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`, { token: auth?.token, sessionId }).catch(() => ({ districts: [] })),
        get(`/api/scert/list-centers/districts/counts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`, { token: auth?.token, sessionId }).catch(() => ({}))
      ]);

      const dists = Array.isArray(distRes.districts) ? distRes.districts : [];
      
      // Merge counts into districts
      const mergedDistricts = dists.map(d => ({
        ...d,
        appsCount: countsRes[normalizeTwoDigitCode(d.district_code)] || 0
      }));

      setDistricts(mergedDistricts);
    } catch (err) {
      console.error('Failed to fetch districts:', err);
      setError(err.message || 'Failed to load districts');
      toast.error(`Failed to load districts: ${toast.getErrorMessage(err)}`);
      setDistricts([]);
    } finally {
      setLoading(false);
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId, toast]);

  const fetchBlocks = useCallback(
    async (districtCode) => {
      if (!canFetch) return;

      setLoading(true);
      setError('');

      try {
        const [blocksRes, countsRes] = await Promise.all([
          get(
            `/api/scert/list-centers/blocks?scholarship_id=${encodeURIComponent(selectedScholarshipId)}&district_code=${encodeURIComponent(districtCode)}`,
            { token: auth?.token, sessionId }
          ).catch(() => ({ blocks: [] })),
          get(
            `/api/scert/list-centers/blocks/counts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}&district_code=${encodeURIComponent(districtCode)}`,
            { token: auth?.token, sessionId }
          ).catch(() => ({}))
        ]);

        const blks = Array.isArray(blocksRes.blocks) ? blocksRes.blocks : [];
        
        // Merge counts
        const mergedBlocks = blks.map(b => ({
          ...b,
          appsCount: countsRes[normalizeTwoDigitCode(b.block_code)] || 0
        }));

        setBlocks(mergedBlocks);
      } catch (err) {
        console.error('Failed to fetch blocks:', err);
        setError(err.message || 'Failed to load blocks');
        toast.error(`Failed to load blocks: ${toast.getErrorMessage(err)}`);
        setBlocks([]);
      } finally {
        setLoading(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId, toast]
  );

  const fetchCenters = useCallback(
    async ({ districtCode, blockCode }) => {
      if (!canFetch) return;

      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams();
        params.append('scholarship_id', selectedScholarshipId);
        if (districtCode) params.append('district_code', districtCode);
        if (blockCode) params.append('block_code', blockCode);

        const data = await get(`/api/scert/centers?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });

        setCenters(Array.isArray(data.centers) ? data.centers : []);
      } catch (err) {
        console.error('Failed to fetch centers:', err);
        setError(err.message || 'Failed to load centers');
        toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
        setCenters([]);
      } finally {
        setLoading(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId, toast]
  );

  const [allCenterApplications, setAllCenterApplications] = useState([]);

  const fetchApplicationsForCenter = useCallback(
    async (centerId, targetPage = 1) => {
      if (!canFetch) return;

      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams();
        params.append('scholarship_id', selectedScholarshipId);
        params.append('center_id', centerId);
        
        const data = await get(`/api/scert/nominal-roll?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });

        let apps = Array.isArray(data.applications) ? data.applications : [];
        if (isCmScholarship && classFilter) {
          apps = apps.filter(app => extractApplicationClass(app) === String(classFilter));
        }

        setAllCenterApplications(apps);
        setTotalApplications(apps.length);
        
        // Frontend pagination
        const startIndex = (targetPage - 1) * applicationsPerPage;
        setApplications(apps.slice(startIndex, startIndex + applicationsPerPage));
        setCurrentPage(targetPage);
      } catch (err) {
        console.error('Failed to fetch applications:', err);
        setError(err.message || 'Failed to load applications');
        toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
        setAllCenterApplications([]);
        setApplications([]);
        setTotalApplications(0);
      } finally {
        setLoading(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId, classFilter, isCmScholarship, toast]
  );

  useEffect(() => {
    setLevel('district');
    setSelectedDistrict(null);
    setSelectedBlock(null);
    setSelectedCenter(null);

    setBlocks([]);
    setCenters([]);
    setApplications([]);

    if (canFetch) {
      fetchDistricts();
    } else {
      setDistricts([]);
    }
  }, [sessionId, selectedScholarshipId, canFetch, fetchDistricts]);

  useEffect(() => {
    setClassFilter(isCmScholarship ? '6' : '');
  }, [isCmScholarship, selectedScholarshipId]);

  // When class filter changes, refetch if we are in preview mode
  useEffect(() => {
    if (level === 'preview' && selectedCenter) {
      fetchApplicationsForCenter(selectedCenter.center_id, 1);
    }
  }, [classFilter]);

  const toAssetUrl = (path) => {
    const v = String(path || '').trim();
    if (!v) return '';
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    return `${API_BASE_URL}${v}`;
  };

  const handleDownloadPDF = async () => {
    if (!selectedCenter) return;
    
    setIsGeneratingPdf(true);
    toast.info("Generating PDF, please wait for images to load...");
    
    try {
      const allApps = allCenterApplications;
      
      if (allApps.length === 0) {
        toast.info("No approved applications found for this center to download.");
        setIsGeneratingPdf(false);
        return;
      }

      const centerName = selectedCenter?.school_name || 'Center';
      const centerDetails = getCenterHeaderDetails(selectedCenter);
      const printWindow = window.open('', '', 'width=800,height=600');
      
      const htmlContent = `
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
            .header {
              text-align: center;
              margin-bottom: 15px;
            }
            .header-brand {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              margin-bottom: 4px;
            }
            .header-brand img {
              height: 36px;
              width: 36px;
              object-fit: contain;
            }
            .header-brand span {
              font-size: 12px;
              font-weight: bold;
            }
            .header h1 {
              font-size: 16px;
              margin: 5px 0;
            }
            .header h3 {
              font-size: 12px;
              margin: 3px 0;
              font-weight: bold;
            }
            .header .meta {
              margin-top: 6px;
              font-size: 11px;
              font-weight: 600;
              line-height: 1.35;
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
            th:nth-child(3), td:nth-child(3) {
              width: 64px;
              white-space: nowrap;
              overflow-wrap: normal;
              word-break: keep-all;
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
              width: 46px;
              height: 34px;
            }
            th:nth-child(1), td:nth-child(1),
            th:nth-child(2), td:nth-child(2) { width: 52px; }
            th:nth-child(10), td:nth-child(10) { width: 44px; }
            th:nth-child(11), td:nth-child(11) { width: 90px; }
            th:nth-child(12), td:nth-child(12), th:nth-child(13), td:nth-child(13) { width: 150px; }
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
              <thead>
                <tr>
                  <th colspan="14" style="background: white; border: none; border-bottom: 1px solid #fff; padding-bottom: 12px; text-align: center;">
                    <div class="header" style="margin:0;">
                      <div class="header-brand">
                        <img src="${window.location.origin}/scert-logo.png" alt="SCERT" />
                        <span>State Council for Educational Research and Training, Uttarakhand</span>
                      </div>
                      <h1 style="font-size: 16px; margin: 5px 0;">${selectedScholarshipDisplayName}</h1>
                      <h3 style="font-size: 12px; margin: 3px 0; font-weight: bold;">VERIFICATION FORM</h3>
                      <div class="meta" style="margin-top: 6px; font-size: 11px; font-weight: 600;">
                        <strong>Session:</strong> ${selectedSessionName || '-'}
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        <strong>Examination Date:</strong> ${selectedScholarship?.exam_date ? formatDisplayDate(selectedScholarship.exam_date) : '___________'}
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        <strong>Centre:</strong> ${centerName}
                        ${isCmScholarship ? `&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Class:</strong> ${verificationClassLabel}` : ''}
                      </div>
                      <div class="meta" style="margin-top: 4px; font-size: 11px; font-weight: 600;">
                        <strong>Center Code:</strong> ${escapeHtml(centerDetails.centerCode)}
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        <strong>Block:</strong> ${escapeHtml(centerDetails.blockName)} (${escapeHtml(centerDetails.blockCode)})
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        <strong>District:</strong> ${escapeHtml(centerDetails.districtName)} (${escapeHtml(centerDetails.districtCode)})
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th class="photo-cell" rowspan="2">Photograph</th>
                  <th class="photo-cell" rowspan="2">Signature</th>
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
                  <th style="width: 150px;">MAT</th>
                  <th style="width: 150px;">SAT</th>
                </tr>
              </thead>
              <tbody>
                ${allApps.map((app, index) => `
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
                `).join('')}
              </tbody>
            </table>
            
            <div class="invigilator-signature">
              <p>Centre Superintendent Signature: <span class="signature-line"></span></p>
            </div>
          </div>
        </body>
        </html>
      `;
      
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
      toast.error("Failed to generate PDF: " + (err.message || ""));
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > Math.ceil(totalApplications / applicationsPerPage)) return;
    const startIndex = (newPage - 1) * applicationsPerPage;
    setApplications(allCenterApplications.slice(startIndex, startIndex + applicationsPerPage));
    setCurrentPage(newPage);
  };

  if (loading && level === 'district') {
    return (
      <div className="scert-page">
        <div className="loading-state">Loading verification forms...</div>
      </div>
    );
  }

  // District Level
  if (level === 'district') {
    return (
      <div className="scert-page">
        <div className="view-header-row">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Verification Form - Select District</h3>
            </div>
          </div>
        </div>

        {error && <div className="error-state">{error}</div>}

        {districts.length === 0 ? (
          <div className="empty-state">No districts found</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table" style={{ fontSize: "16px" }}>
              <thead>
                <tr>
                  <th>District Code</th>
                  <th>District Name</th>
                  <th>Centers</th>
                  <th>Students</th>
                </tr>
              </thead>
              <tbody>
                {districts.map((dist) => {
                  return (
                    <tr 
                      key={dist.district_code}
                      className="smart-table-clickable"
                      onClick={() => {
                        setSelectedDistrict(dist);
                        fetchBlocks(dist.district_code);
                        setLevel('block');
                      }}
                    >
                      <td className="smart-table-strong">{dist.district_code}</td>
                      <td>{dist.district_name}</td>
                      <td>{dist.total_centers || 0}</td>
                      <td>{dist.appsCount || 0}</td>
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

  // Block Level
  if (level === 'block') {
    return (
      <div className="scert-page">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">
              Verification Form - {selectedDistrict?.district_name}
            </h3>
            <p className="view-subtitle">Choose a block to view centers</p>
          </div>
          <button
            className="scert-btn-secondary"
            onClick={() => {
              setLevel('district');
              setSelectedDistrict(null);
              setBlocks([]);
            }}
          >
            Back to Districts
          </button>
        </div>

        {loading ? (
          <div className="loading-state">Loading blocks...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : blocks.length === 0 ? (
          <div className="empty-state">No blocks found</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table" style={{ fontSize: "16px" }}>
              <thead>
                <tr>
                  <th>Block Code</th>
                  <th>Block Name</th>
                  <th>Centers</th>
                  <th>Students</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((block) => {
                  return (
                    <tr 
                      key={block.block_code}
                      className="smart-table-clickable"
                      onClick={() => {
                        setSelectedBlock(block);
                        fetchCenters({
                          districtCode: selectedDistrict.district_code,
                          blockCode: block.block_code,
                        });
                        setLevel('center');
                      }}
                    >
                      <td className="smart-table-strong">{block.block_code}</td>
                      <td>{block.block_name}</td>
                      <td>{block.total_centers || 0}</td>
                      <td>{block.appsCount || 0}</td>
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

  // Center Level
  if (level === 'center') {
    return (
      <div className="scert-page">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">
              Verification Form - {selectedBlock?.block_name}
            </h3>
            <p className="view-subtitle">Choose a center to view verification form</p>
          </div>
          <button
            className="scert-btn-secondary"
            onClick={() => {
              setLevel('block');
              setSelectedBlock(null);
              setCenters([]);
            }}
          >
            Back to Blocks
          </button>
        </div>

        {loading ? (
          <div className="loading-state">Loading centers...</div>
        ) : error ? (
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
                  const count = center.total_registered || 0;

                  return (
                    <tr 
                      key={center.center_id}
                      className="smart-table-clickable"
                      onClick={() => {
                        setSelectedCenter(center);
                        fetchApplicationsForCenter(center.center_id, 1);
                        setLevel('preview');
                      }}
                    >
                      <td className="smart-table-strong">{center.center_order}</td>
                      <td>{center.school_name}</td>
                      <td>{count}</td>
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

  // Preview Level
  if (level === 'preview') {
    const totalPages = Math.ceil(totalApplications / applicationsPerPage);
    const centerDetails = getCenterHeaderDetails(selectedCenter);

    return (
      <div className="scert-page">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">
              Verification Form - {selectedCenter?.school_name}
            </h3>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {isCmScholarship ? (
              <>
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                  onClick={() => setClassFilter('6')}
                >
                  CM 6
                </button>
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                  onClick={() => setClassFilter('9')}
                >
                  CM 9
                </button>
              </>
            ) : null}
            <button
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('center');
                setSelectedCenter(null);
                setApplications([]);
              }}
            >
              Back to Centers
            </button>
            <button
              type="button"
              className="scert-btn-violet"
              onClick={handleDownloadPDF}
              disabled={applications.length === 0 || isGeneratingPdf}
            >
              {isGeneratingPdf ? 'Generating...' : 'Download PDF'}
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
          {isCmScholarship && (
            <div className="beo-verification-detail">
              <span className="beo-verification-detail-label">Class</span>
              <span className="beo-verification-detail-value">{verificationClassLabel || '-'}</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="loading-state">Loading applications...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : applications.length === 0 ? (
          <div className="empty-state">No approved applications found for this center</div>
        ) : (
          <>
            <div className="verification-preview">
              <p className="preview-note">
                Preview: Showing Page {currentPage} of {totalPages} from {selectedCenter?.school_name}
                {isCmScholarship ? ` (Class ${verificationClassLabel})` : ''}
              </p>
            </div>

            <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table" style={{ fontSize: "16px" }}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Photo</th>
                    <th rowSpan={2}>Signature</th>
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
                    <th rowSpan={2} style={{ width: '82px' }}>Invigilator's Signature</th>
                  </tr>
                  <tr>
                    <th style={{ width: '112px' }}>MAT</th>
                    <th style={{ width: '112px' }}>SAT</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => (
                    <tr key={app.application_id} className={window.getSubmissionRoleRowClass ? window.getSubmissionRoleRowClass(app) : ''}>
                      <td>
                        {app.photo_url ? (
                          <img 
                            src={toAssetUrl(app.photo_url)}
                            alt="Student"
                            style={{ width: '40px', height: '50px', objectFit: 'contain', objectPosition: 'center', background: '#fff' }}
                          />
                        ) : '-'}
                      </td>
                      <td>
                        {app.signature_url ? (
                          <img
                            src={toAssetUrl(app.signature_url)}
                            alt="Student Signature"
                            style={{ width: '46px', height: '34px', objectFit: 'contain', objectPosition: 'center', background: '#fff' }}
                          />
                        ) : '-'}
                      </td>
                      <td className="smart-table-strong">{app.roll_number || '-'}</td>
                      <td>{app.candidate_name || '-'}</td>
                      <td>{app.father_name || '-'}</td>
                      <td>{app.mother_name || '-'}</td>
                      <td>{formatDisplayDate(app.date_of_birth)}</td>
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
              </span>

              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button 
                    className="scert-btn-secondary"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1 || loading}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '14px' }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: '14px' }}>Page {currentPage} of {totalPages}</span>
                  <button 
                    className="scert-btn-secondary"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages || loading}
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
