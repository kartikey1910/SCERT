import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

const normalizeTwoDigitCode = (code) => {
  const s = String(code ?? '');
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n).padStart(2, '0');
  return s;
};

export function ScertNominalRollPage() {
  const { auth } = useAuth();
  const { sessionId, selectedScholarshipId, scholarships, sessions } = useSession();
  const toast = useToast();

  const [level, setLevel] = useState('district'); // district | block | center | preview
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [selectedCenter, setSelectedCenter] = useState(null);

  const [districts, setDistricts] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [centers, setCenters] = useState([]);

  const [applications, setApplications] = useState([]);

  const [allCenters, setAllCenters] = useState([]);
  const [allApplications, setAllApplications] = useState([]);

  const [selectedCenterId, setSelectedCenterId] = useState(''); // for center-level download

  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('6');

  const selectedScholarship = scholarships.find(
    (s) => s.scholarship_id === selectedScholarshipId
  );
  const selectedSession = Array.isArray(sessions)
    ? sessions.find((s) => s.session_id === sessionId)
    : null;
  const scholarshipName = selectedScholarship?.scholarship_name?.toLowerCase() || '';

  const isCMScholarship = scholarshipName.includes('cm') || scholarshipName.includes('chief minister');
  const isNMMSSScholarship =
    scholarshipName.includes('nmmss') ||
    scholarshipName.includes('snss') ||
    scholarshipName.includes('ssss') ||
    scholarshipName.includes('class 8');

  const shouldApplyClassFilter = isCMScholarship && !isNMMSSScholarship;
  const shouldShowClassFilter = isCMScholarship;
  const hideSchoolCategory = isNMMSSScholarship || isCMScholarship;

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId);

  const formatMaybeDate = (value) => {
    if (!value) return '';
    const str = String(value).split('T')[0];
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString('en-GB');
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
    return v ? v : 'No';
  };

  const buildNominalRollParams = useCallback(
    ({ centerId, includeClassFilter = true } = {}) => {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);

      if (includeClassFilter && shouldApplyClassFilter && classFilter) {
        params.append('class_filter', classFilter);
      }

      if (centerId) {
        params.append('center_id', centerId);
      }

      return params;
    },
    [selectedScholarshipId, shouldApplyClassFilter]
  );

  const fetchDistricts = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await get(
        `/api/scert/list-centers/districts?scholarship_id=${encodeURIComponent(
          selectedScholarshipId
        )}`,
        { token: auth?.token, sessionId }
      );

      setDistricts(Array.isArray(data.districts) ? data.districts : []);
    } catch (err) {
      console.error('Failed to fetch districts:', err);
      setError(err.message || 'Failed to load districts');
      toast.error(`Failed to load districts: ${toast.getErrorMessage(err)}`);
      setDistricts([]);
    } finally {
      setLoading(false);
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId]);

  const fetchBlocks = useCallback(
    async (districtCode) => {
      if (!canFetch) return;

      setLoading(true);
      setError('');

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
        setError(err.message || 'Failed to load blocks');
        toast.error(`Failed to load blocks: ${toast.getErrorMessage(err)}`);
        setBlocks([]);
      } finally {
        setLoading(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId]
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
    [canFetch, selectedScholarshipId, auth?.token, sessionId]
  );

  const fetchAllCenters = useCallback(async () => {
    if (!canFetch) return;

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);

      const data = await get(`/api/scert/centers?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      setAllCenters(Array.isArray(data.centers) ? data.centers : []);
    } catch (err) {
      console.error('Failed to fetch all centers:', err);
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
      setAllCenters([]);
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId]);

  const fetchAllApplications = useCallback(async () => {
    if (!canFetch) return;

    try {
      const params = buildNominalRollParams({ includeClassFilter: false });
      const data = await get(`/api/scert/nominal-roll?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      setAllApplications(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      console.error('Failed to fetch all applications:', err);
      toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
      setAllApplications([]);
    }
  }, [canFetch, buildNominalRollParams, auth?.token, sessionId]);

  const fetchApplicationsForCenter = useCallback(
    async (centerId) => {
      if (!canFetch) return [];

      setLoading(true);
      setError('');

      try {
        const params = buildNominalRollParams({ centerId: String(centerId), includeClassFilter: true });
        const data = await get(`/api/scert/nominal-roll?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });

        const apps = Array.isArray(data.applications) ? data.applications : [];
        setApplications(apps);
        return apps;
      } catch (err) {
        console.error('Failed to fetch applications:', err);
        setError(err.message || 'Failed to load applications');
        toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
        setApplications([]);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [canFetch, buildNominalRollParams, auth?.token, sessionId]
  );

  useEffect(() => {
    setLevel('district');
    setSelectedDistrict(null);
    setSelectedBlock(null);
    setSelectedCenter(null);
    setSelectedCenterId('');

    setBlocks([]);
    setCenters([]);
    setApplications([]);

    if (canFetch) {
      fetchDistricts();
      fetchAllCenters();
      fetchAllApplications();
    } else {
      setDistricts([]);
      setAllCenters([]);
      setAllApplications([]);
    }
  }, [
    canFetch,
    sessionId,
    selectedScholarshipId,
    fetchDistricts,
    fetchAllCenters,
    fetchAllApplications,
  ]);

  useEffect(() => {
    if (level !== 'preview' || !selectedCenterId) return;
    
    const fetchWithCurrentFilter = async () => {
      setLoading(true);
      setError('');
      
      try {
        const params = new URLSearchParams();
        params.append('scholarship_id', selectedScholarshipId);
        params.append('center_id', String(selectedCenterId));
        if (shouldApplyClassFilter && classFilter) {
          params.append('class_filter', classFilter);
        }
        
        const data = await get(`/api/scert/nominal-roll?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });
        
        const apps = Array.isArray(data.applications) ? data.applications : [];
        setApplications(apps);
      } catch (err) {
        console.error('Failed to fetch applications:', err);
        setError(err.message || 'Failed to load applications');
        toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
        setApplications([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchWithCurrentFilter();
  }, [level, selectedCenterId, classFilter, selectedScholarshipId, auth?.token, sessionId, toast]);

  const appCountByCenterId = useMemo(() => {
    const map = new Map();
    (Array.isArray(allApplications) ? allApplications : []).forEach((app) => {
      const key = app.center_id != null ? String(app.center_id) : '';
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [allApplications]);

  const districtStats = useMemo(() => {
    const byDist = new Map();
    (Array.isArray(allCenters) ? allCenters : []).forEach((c) => {
      const dk = normalizeTwoDigitCode(c.district_code);
      if (!byDist.has(dk)) {
        byDist.set(dk, { centersCount: 0, appsCount: 0 });
      }
      const st = byDist.get(dk);
      st.centersCount++;
      st.appsCount += appCountByCenterId.get(String(c.center_id)) || 0;
    });
    return byDist;
  }, [allCenters, appCountByCenterId]);

  const blockStats = useMemo(() => {
    if (!selectedDistrict) return new Map();

    const byBlock = new Map();
    const dk = normalizeTwoDigitCode(selectedDistrict.district_code);

    (Array.isArray(allCenters) ? allCenters : []).forEach((c) => {
      const cdk = normalizeTwoDigitCode(c.district_code);
      if (cdk !== dk) return;

      const bk = normalizeTwoDigitCode(c.block_code);
      if (!byBlock.has(bk)) {
        byBlock.set(bk, { centersCount: 0, appsCount: 0 });
      }
      const st = byBlock.get(bk);
      st.centersCount++;
      st.appsCount += appCountByCenterId.get(String(c.center_id)) || 0;
    });

    return byBlock;
  }, [selectedDistrict, allCenters, appCountByCenterId]);

  const downloadPdfFromApps = (apps, { filePrefix, centerLabel = null, centerCode = null } = {}) => {
    if (!Array.isArray(apps) || apps.length === 0) {
      toast.info('No data to download');
      return;
    }

    let headers;
    let rows;

    if (isNMMSSScholarship) {
      headers = [
        'S.No',
        'Block Code',
        'Exam Code',
        'Application ID',
        'Roll No.',
        'SR No.',
        "Candidate's Name",
        "Father's Name",
        "Mother's Name",
        'DOB',
        'Sex',
        'Caste/Category',
        'Type of Divyangta',
        '% of Marks in Class 7',
        'Parental Income Code 1 or 2',
        'Aadhaar No',
        'School Name',
        'Block',
        'District',
        'School Type',
      ];

      rows = apps.map((app, index) => [
        index + 1,
        app.block_code || '',
        app.exam_code || '',
        window.getDisplayApplicationId(app),
        app.roll_number || '',
        app.student_registration_number || '',
        app.candidate_name || '',
        app.father_name || '',
        app.mother_name || '',
        formatMaybeDate(app.date_of_birth || app.dob),
        app.sex || '',
        app.caste_category || '',
        formatDisability(app.type_of_divyangta, app),
        app.marks_class_7 || '',
        app.parental_income_code || '',
        app.aadhaar_number || '',
        app.school_name || '',
        app.block_name || '',
        app.district_name || '',
        app.school_type || '',
      ]);
    } else {
      headers = [
        'S.N',
        'Block Code',
        'Application ID',
        'Roll No.',
        'Student Reg. No.',
        "Candidate's Name",
        "Father's Name",
        "Mother's Name",
        'Date Of Birth',
        'SEX',
        'Caste Category',
        'Type Of Divyangta',
        'Aadhaar Number',
        'School Name',
        'Block',
        'Distt',
        'School Type',
      ];
      if (!hideSchoolCategory) headers.push('School Category');

      rows = apps.map((app, index) => [
        index + 1,
        app.block_code || '',
        window.getDisplayApplicationId(app),
        app.roll_number || '',
        app.student_registration_number || '',
        app.candidate_name || '',
        app.father_name || '',
        app.mother_name || '',
        formatMaybeDate(app.date_of_birth || app.dob),
        app.sex || '',
        app.caste_category || '',
        formatDisability(app.type_of_divyangta, app),
        app.aadhaar_number || '',
        app.school_name || '',
        app.block_name || '',
        app.district_name || '',
        app.school_type || '',
      ]);
      if (!hideSchoolCategory) {
        rows.forEach((row, idx) => {
          row.push(apps[idx]?.school_category || '');
        });
      }
    }

    const escapeHtml = (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const generatedAt = new Date().toLocaleString();
    const safeTitle = (filePrefix || 'nominal_roll').replace(/_/g, ' ');
    const resolvedCenterLabel =
      centerLabel ||
      apps.find((a) => a?.center_name || a?.school_name)?.center_name ||
      apps.find((a) => a?.center_name || a?.school_name)?.school_name ||
      '-';
    const classMeta = shouldApplyClassFilter && classFilter
      ? ` | <strong>Class:</strong> ${escapeHtml(String(classFilter))}`
      : '';

    const html = `
      <html>
        <head>
          <title>${escapeHtml(safeTitle)}</title>
          <style>
            @page { size: landscape; margin: 10mm; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111827; }
            h2 { text-align: center; margin: 0 0 6px 0; font-size: 18px; }
            .header-brand { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px; }
            .header-brand img { height: 36px; width: 36px; object-fit: contain; }
            .header-brand span { font-size: 12px; font-weight: bold; }
            .meta { text-align: center; font-size: 12px; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; font-size: 9px; }
            th, td { border: 1px solid #111827; padding: 4px 5px; text-align: left; vertical-align: top; }
            th { background: #f3f4f6; font-weight: 700; }
          </style>
        </head>
        <body>
          <div class="header-brand">
            <img src="${window.location.origin}/scert-logo.png" alt="SCERT" />
            <span>State Council for Educational Research and Training, Uttarakhand</span>
          </div>
          <h2>Nominal Roll</h2>
          <div class="meta">${centerCode ? `<strong>Center Code:</strong> ${escapeHtml(centerCode)} | ` : ''}<strong>Scholarship:</strong> ${escapeHtml(selectedScholarship?.scholarship_name || '-')} | <strong>Session:</strong> ${escapeHtml(selectedSession?.session_name || '-')}${classMeta} | <strong>Center:</strong> ${escapeHtml(resolvedCenterLabel)} | <strong>Generated:</strong> ${escapeHtml(generatedAt)}</div>
          <table>
            <thead>
              <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row) =>
                    `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
                )
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Please allow pop-ups to download PDF');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 200);
  };

  const downloadSelectedCenter = async () => {
    if (!selectedCenterId) {
      toast.info('Select a center first');
      return;
    }

    const center = centers.find((c) => String(c.center_id) === String(selectedCenterId));
    const centerLabel = center?.school_name || center?.center_name || `center_${selectedCenterId}`;

    setDownloadLoading(true);
    try {
      const params = buildNominalRollParams({ centerId: String(selectedCenterId) });
      const data = await get(`/api/scert/nominal-roll?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      const apps = Array.isArray(data.applications) ? data.applications : [];
      downloadPdfFromApps(apps, {
        filePrefix: `nominal_roll_${centerLabel}`
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_-]/g, ''),
        centerLabel,
        centerCode: center?.center_order || null,
      });
    } catch (err) {
      console.error('Failed to download nominal roll:', err);
      toast.error(`Failed to download nominal roll: ${toast.getErrorMessage(err)}`);
    } finally {
      setDownloadLoading(false);
    }
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

  if (loading && level === 'district') {
    return (
      <div className="scert-page">
        <div className="loading-state">Loading nominal roll...</div>
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
              <h3 className="view-title">Nominal Roll - Select District</h3>
              
            </div>
          </div>
        </div>

        {error && <div className="error-state">{error}</div>}

        {districts.length === 0 ? (
          <div className="empty-state">No districts found</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table">
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
                  const dk = normalizeTwoDigitCode(dist.district_code);
                  const st = districtStats.get(dk) || { centersCount: 0, appsCount: 0 };

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
                      <td>{st.centersCount}</td>
                      <td>{st.appsCount}</td>
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
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Nominal Roll - {selectedDistrict?.district_name}</h3>
              
            </div>
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
            <table className="smart-table">
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
                  const bk = normalizeTwoDigitCode(block.block_code);
                  const st = blockStats.get(bk) || { centersCount: 0, appsCount: 0 };

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
                        setSelectedCenterId('');
                        setLevel('center');
                      }}
                    >
                      <td className="smart-table-strong">{block.block_code}</td>
                      <td>{block.block_name}</td>
                      <td>{st.centersCount}</td>
                      <td>{st.appsCount}</td>
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
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Nominal Roll - {selectedBlock?.block_name}</h3>
              
            </div>
            <p className="view-subtitle">
              Select a center (radio) to download, or click a row to view its nominal roll
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('block');
                setSelectedBlock(null);
                setCenters([]);
                setSelectedCenterId('');
              }}
            >
              Back to Blocks
            </button>
            <button
              type="button"
              className="scert-btn-violet"
              onClick={downloadSelectedCenter}
              disabled={!selectedCenterId || downloadLoading}
            >
              {downloadLoading ? 'Downloading...' : 'Download Nominal Roll'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">Loading centers...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : centers.length === 0 ? (
          <div className="empty-state">No centers found</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Select</th>
                  <th>Center Order</th>
                  <th>Center Name</th>
                  <th>Students</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((center) => {
                  const count = appCountByCenterId.get(String(center.center_id)) || 0;
                  const isSelected = String(selectedCenterId) === String(center.center_id);

                  return (
                    <tr
                      key={center.center_id}
                      className="smart-table-clickable"
                      onClick={async () => {
                        setSelectedCenter(center);
                        setSelectedCenterId(String(center.center_id));
                        await fetchApplicationsForCenter(center.center_id);
                        setLevel('preview');
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="radio"
                          name="center"
                          checked={isSelected}
                          onChange={() => setSelectedCenterId(String(center.center_id))}
                        />
                      </td>
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
    const centerName = selectedCenter?.school_name || 'Center';
    const centerCode = selectedCenter?.center_order || '-';

    return (
      <div className="scert-page">
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
                setApplications([]);
              }}
            >
              Back to Centers
            </button>
            <button
              type="button"
              className="scert-btn-violet"
              onClick={() =>
                downloadPdfFromApps(applications, {
                  filePrefix: `nominal_roll_${centerName}`
                    .replace(/\s+/g, '_')
                    .replace(/[^a-zA-Z0-9_-]/g, ''),
                  centerLabel: centerName,
                  centerCode: selectedCenter?.center_order || null,
                })
              }
              disabled={applications.length === 0}
            >
              Download PDF
            </button>
          </div>
        </div>

        {shouldShowClassFilter && (
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
        )}

        {loading ? (
          <div className="loading-state">Loading nominal roll...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : applications.length === 0 ? (
          <div className="empty-state">No approved applications found for this center</div>
        ) : (
          <>
            <div className="smart-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>Block Code</th>
                    {isNMMSSScholarship && <th>Exam Code</th>}
                    <th>Application ID</th>
                    <th>Roll No.</th>
                    <th>{isNMMSSScholarship ? 'SR No.' : 'Student Reg. No.'}</th>
                    {!isNMMSSScholarship && <th>Class</th>}
                    <th>Candidate's Name</th>
                    <th>Father's Name</th>
                    <th>Mother's Name</th>
                    <th>{isNMMSSScholarship ? 'DOB' : 'Date Of Birth'}</th>
                    <th>{isNMMSSScholarship ? 'Sex' : 'SEX'}</th>
                    <th>{isNMMSSScholarship ? 'Caste/Category' : 'Caste Category'}</th>
                    <th>Type {isNMMSSScholarship ? 'of' : 'Of'} Divyangta</th>
                    {isNMMSSScholarship && <th>% of Marks in Class 7</th>}
                    {isNMMSSScholarship && <th>Parental Income Code 1 or 2</th>}
                    <th>{isNMMSSScholarship ? 'Aadhaar No' : 'Aadhaar Number'}</th>
                    <th>School Name</th>
                    <th>Block</th>
                    <th>{isNMMSSScholarship ? 'District' : 'Distt'}</th>
                    <th>School Type</th>
                    {!hideSchoolCategory && <th>School Category</th>}
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app, index) => (
                    <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                      <td>{index + 1}</td>
                      <td>{app.block_code || '-'}</td>
                      {isNMMSSScholarship && <td>{app.exam_code || '-'}</td>}
                      <td>
                        <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                      </td>
                      <td className="smart-table-strong">{app.roll_number || '-'}</td>
                      <td>{app.student_registration_number || '-'}</td>
                      {!isNMMSSScholarship && <td>{app.class || '-'}</td>}
                      <td>{app.candidate_name || '-'}</td>
                      <td>{app.father_name || '-'}</td>
                      <td>{app.mother_name || '-'}</td>
                      <td>
                        {formatMaybeDate(app.date_of_birth) || '-'}
                      </td>
                      <td>{app.sex || '-'}</td>
                      <td>{app.caste_category || '-'}</td>
                      <td>{formatDisability(app.type_of_divyangta, app)}</td>
                      {isNMMSSScholarship && <td>{app.marks_class_7 || '-'}</td>}
                      {isNMMSSScholarship && <td>{app.parental_income_code || '-'}</td>}
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
                Total: <strong>{applications.length}</strong> application(s)
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
