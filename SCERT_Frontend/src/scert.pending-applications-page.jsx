import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, post } from './apiClient.js';
import { ScertApplicationViewer } from './scert.application-viewer.jsx';
import { useToast } from './ToastContext.jsx';
import { HiOutlineEye } from 'react-icons/hi';
import { useSession } from './scert.session-context.jsx';

const normalizeTwoDigitCode = (code) => {
  const s = String(code ?? '');
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n).padStart(2, '0');
  return s;
};

const resolveAppClass = (app) => {
  const value =
    app?.class ??
    app?.student_class ??
    app?.class_level ??
    app?.current_class ??
    app?.application_class ??
    app?.scholarship_class ??
    '';
  return String(value).trim();
};

export function ScertPendingApplicationsPage() {
  const { auth } = useAuth();
  const { sessionId, selectedScholarshipId, scholarships } = useSession();
  const toast = useToast();

  const [level, setLevel] = useState('district'); // district | block | center | applications
  const [selectedDistrict, setSelectedDistrict] = useState(null); // { district_code, district_name }
  const [selectedBlock, setSelectedBlock] = useState(null); // { block_code, block_name }
  const [selectedCenter, setSelectedCenter] = useState(null); // { center_id, center_order, school_name }

  const [districts, setDistricts] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [centers, setCenters] = useState([]);
  const [applications, setApplications] = useState([]);

  const [allCenters, setAllCenters] = useState([]);
  const [allPendingApps, setAllPendingApps] = useState([]);

  const [selectedDistrictCodes, setSelectedDistrictCodes] = useState(() => new Set());
  const [selectedBlockKeys, setSelectedBlockKeys] = useState(() => new Set()); // key = "{district_code}|{block_code}"
  const [selectedCenterIds, setSelectedCenterIds] = useState(() => new Set());
  const [selectedApplicationIds, setSelectedApplicationIds] = useState(() => new Set());

  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState([]);
  const [bulkScopeLabel, setBulkScopeLabel] = useState('');
  const [returnRemark, setReturnRemark] = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewingApplicationId, setViewingApplicationId] = useState(null);
  const [cmClassFilter, setCmClassFilter] = useState('6');

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId);
  const isCmScholarship = String(selectedScholarshipId) === '3';

  const fetchDistricts = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await get(
        `/api/scert/list-centers/districts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
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
      // don't hard-fail the page; center drilldown already fetches centers per block
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
      setAllCenters([]);
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId]);

  const fetchAllPendingApplications = useCallback(async () => {
    if (!canFetch) return;

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      params.append('status', 'SUBMITTED');
      params.append('counts_only', 'true');

      const data = await get(`/api/scert/applications/inbox?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      setAllPendingApps(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      console.error('Failed to fetch all pending applications:', err);
      toast.error(`Failed to load pending applications: ${toast.getErrorMessage(err)}`);
      setAllPendingApps([]);
    }
  }, [canFetch, selectedScholarshipId, auth?.token, sessionId]);

  const fetchApplications = useCallback(
    async ({ centerId }) => {
      if (!canFetch) return;

      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams();
        params.append('scholarship_id', selectedScholarshipId);
        params.append('status', 'SUBMITTED');
        params.append('export', 'true');
        if (centerId) params.append('center_id', centerId);
        if (isCmScholarship && cmClassFilter) params.append('class_filter', cmClassFilter);

        const data = await get(`/api/scert/applications/inbox?${params.toString()}`, {
          token: auth?.token,
          sessionId,
        });

        setApplications(Array.isArray(data.applications) ? data.applications : []);
      } catch (err) {
        console.error('Failed to fetch applications:', err);
        setError(err.message || 'Failed to load applications');
        toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
        setApplications([]);
      } finally {
        setLoading(false);
      }
    },
    [canFetch, selectedScholarshipId, auth?.token, sessionId, isCmScholarship, cmClassFilter]
  );

  useEffect(() => {
    setLevel('district');
    setSelectedDistrict(null);
    setSelectedBlock(null);
    setSelectedCenter(null);

    setBlocks([]);
    setCenters([]);
    setApplications([]);

    setSelectedDistrictCodes(new Set());
    setSelectedBlockKeys(new Set());
    setSelectedCenterIds(new Set());
    setSelectedApplicationIds(new Set());

    setShowApproveModal(false);
    setShowReturnModal(false);
    setBulkTargetIds([]);
    setBulkScopeLabel('');
    setReturnRemark('');
    setCmClassFilter('6');

    if (canFetch) {
      fetchDistricts();
      fetchAllCenters();
      fetchAllPendingApplications();
    } else {
      setDistricts([]);
      setAllCenters([]);
      setAllPendingApps([]);
    }
  }, [sessionId, selectedScholarshipId, canFetch, fetchDistricts, fetchAllCenters, fetchAllPendingApplications]);

  useEffect(() => {
    if (!isCmScholarship) return;
    if (level !== 'applications') return;
    if (!selectedCenter?.center_id) return;
    fetchApplications({ centerId: selectedCenter.center_id });
  }, [isCmScholarship, cmClassFilter, level, selectedCenter?.center_id, fetchApplications]);

  const centerMetaById = useMemo(() => {
    const map = new Map();
    (Array.isArray(allCenters) ? allCenters : []).forEach((c) => {
      map.set(String(c.center_id), {
        ...c,
        district_code: normalizeTwoDigitCode(c.district_code),
        block_code: normalizeTwoDigitCode(c.block_code),
      });
    });
    return map;
  }, [allCenters]);

  const pendingCountByCenterId = useMemo(() => {
    const map = new Map();
    (Array.isArray(allPendingApps) ? allPendingApps : []).forEach((app) => {
      const key = app.center_id != null ? String(app.center_id) : '';
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [allPendingApps]);

  const pendingCountByDistrictCode = useMemo(() => {
    const map = new Map();
    (Array.isArray(allPendingApps) ? allPendingApps : []).forEach((app) => {
      const centerId = app.center_id != null ? String(app.center_id) : '';
      if (!centerId) return;
      const meta = centerMetaById.get(centerId);
      const districtCode = meta?.district_code;
      if (!districtCode) return;
      map.set(districtCode, (map.get(districtCode) || 0) + 1);
    });
    return map;
  }, [allPendingApps, centerMetaById]);

  const pendingCountByBlockKey = useMemo(() => {
    const map = new Map();
    (Array.isArray(allPendingApps) ? allPendingApps : []).forEach((app) => {
      const centerId = app.center_id != null ? String(app.center_id) : '';
      if (!centerId) return;
      const meta = centerMetaById.get(centerId);
      const districtCode = meta?.district_code;
      const blockCode = meta?.block_code;
      if (!districtCode || !blockCode) return;
      const key = `${districtCode}|${blockCode}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [allPendingApps, centerMetaById]);

  const handleViewApplication = (applicationId) => {
    setViewingApplicationId(applicationId);
  };

  const selectedScholarshipName = useMemo(() => {
    return (
      scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))
        ?.scholarship_name || selectedScholarshipId
    );
  }, [scholarships, selectedScholarshipId]);

  const filteredApplications = isCmScholarship
    ? applications.filter((app) => resolveAppClass(app) === String(cmClassFilter))
    : applications;

  const bulkGetSelectedAppIds = () => {
    if (level === 'district') {
      const selected = new Set(Array.from(selectedDistrictCodes).map(normalizeTwoDigitCode));
      const ids = (Array.isArray(allPendingApps) ? allPendingApps : [])
        .filter((app) => {
          const centerId = app.center_id != null ? String(app.center_id) : '';
          const meta = centerMetaById.get(centerId);
          const dc = meta?.district_code;
          return dc && selected.has(String(dc));
        })
        .map((app) => app.application_id);
      return Array.from(new Set(ids));
    }

    if (level === 'block') {
      const selected = new Set(Array.from(selectedBlockKeys));
      const ids = (Array.isArray(allPendingApps) ? allPendingApps : [])
        .filter((app) => {
          const centerId = app.center_id != null ? String(app.center_id) : '';
          const meta = centerMetaById.get(centerId);
          const dc = meta?.district_code;
          const bc = meta?.block_code;
          if (!dc || !bc) return false;
          const key = `${dc}|${bc}`;
          return selected.has(key);
        })
        .map((app) => app.application_id);
      return Array.from(new Set(ids));
    }

    if (level === 'center') {
      const selected = new Set(Array.from(selectedCenterIds).map(String));
      const ids = (Array.isArray(allPendingApps) ? allPendingApps : [])
        .filter((app) => app.center_id != null && selected.has(String(app.center_id)))
        .map((app) => app.application_id);
      return Array.from(new Set(ids));
    }

    if (level === 'applications') {
      return Array.from(new Set(Array.from(selectedApplicationIds)));
    }

    return [];
  };

  const getSelectionCount = () => {
    if (level === 'district') return selectedDistrictCodes.size;
    if (level === 'block') return selectedBlockKeys.size;
    if (level === 'center') return selectedCenterIds.size;
    if (level === 'applications') return selectedApplicationIds.size;
    return 0;
  };

  const getScopeLabel = () => {
    if (level === 'district') return 'selected district(s)';
    if (level === 'block') return 'selected block(s)';
    if (level === 'center') return 'selected center(s)';
    return 'selected application(s)';
  };

  const bulkOpenApproveModal = () => {
    const selectedCount = getSelectionCount();
    if (selectedCount === 0) {
      toast.warning('Select at least one item to approve.');
      return;
    }

    const ids = bulkGetSelectedAppIds();
    if (ids.length === 0) {
      toast.warning(`No pending applications found under ${getScopeLabel()}.`);
      return;
    }

    setBulkTargetIds(ids);
    setBulkScopeLabel(getScopeLabel());
    setShowApproveModal(true);
  };

  const bulkOpenReturnModal = () => {
    const selectedCount = getSelectionCount();
    if (selectedCount === 0) {
      toast.warning('Select at least one item to return.');
      return;
    }

    const ids = bulkGetSelectedAppIds();
    if (ids.length === 0) {
      toast.warning(`No pending applications found under ${getScopeLabel()}.`);
      return;
    }

    setBulkTargetIds(ids);
    setBulkScopeLabel(getScopeLabel());
    setReturnRemark('');
    setShowReturnModal(true);
  };

  const bulkApprove = async () => {
    if (bulkTargetIds.length === 0) return;

    setBulkWorking(true);
    try {
      const results = await Promise.allSettled(
        bulkTargetIds.map((id) =>
          post(`/api/scert/applications/${id}/approve`, {}, { token: auth?.token, sessionId })
        )
      );

      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      if (fail > 0) {
        toast.warning(`Approved: ${ok}, Failed: ${fail}`);
        const firstErr = results.find((r) => r.status === 'rejected')?.reason;
        if (firstErr) toast.error(`Some approvals failed: ${toast.getErrorMessage(firstErr)}`);
      } else {
        toast.success(`Approved: ${ok}`);
      }

      await fetchAllPendingApplications();
      if (selectedCenter?.center_id) {
        await fetchApplications({ centerId: selectedCenter.center_id });
      }

      setSelectedDistrictCodes(new Set());
      setSelectedBlockKeys(new Set());
      setSelectedCenterIds(new Set());
      setSelectedApplicationIds(new Set());
      setShowApproveModal(false);
      setBulkTargetIds([]);
      setBulkScopeLabel('');
    } finally {
      setBulkWorking(false);
    }
  };

  const bulkReturnToBeo = async () => {
    if (bulkTargetIds.length === 0) return;

    if (!returnRemark || !returnRemark.trim()) {
      toast.warning('Please enter a remark to return applications to BEO.');
      return;
    }

    setBulkWorking(true);
    try {
      const results = await Promise.allSettled(
        bulkTargetIds.map((id) =>
          post(
            `/api/scert/applications/${id}/return`,
            { remark_text: returnRemark.trim() },
            { token: auth?.token, sessionId }
          )
        )
      );

      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      if (fail > 0) {
        toast.warning(`Returned: ${ok}, Failed: ${fail}`);
        const firstErr = results.find((r) => r.status === 'rejected')?.reason;
        if (firstErr) toast.error(`Some returns failed: ${toast.getErrorMessage(firstErr)}`);
      } else {
        toast.success(`Returned: ${ok}`);
      }

      await fetchAllPendingApplications();
      if (selectedCenter?.center_id) {
        await fetchApplications({ centerId: selectedCenter.center_id });
      }

      setSelectedDistrictCodes(new Set());
      setSelectedBlockKeys(new Set());
      setSelectedCenterIds(new Set());
      setSelectedApplicationIds(new Set());
      setShowReturnModal(false);
      setReturnRemark('');
      setBulkTargetIds([]);
      setBulkScopeLabel('');
    } finally {
      setBulkWorking(false);
    }
  };


  const isDistrictView = level === 'district';
  const isBlockView = level === 'block';
  const isCenterView = level === 'center';
  const isApplicationsView = level === 'applications';

  const title = isDistrictView
    ? 'Pending Applications'
    : isBlockView
      ? `Pending Applications — Blocks (${selectedDistrict?.district_name || selectedDistrict?.district_code || ''})`
      : isCenterView
        ? `Pending Applications — Centers (${selectedBlock?.block_name || selectedBlock?.block_code || ''})`
        : `Pending Applications — Center ${selectedCenter?.center_order ?? ''}`;

  const subtitle = isDistrictView
    ? 'Select District → Block → Center to view pending applications under that center.'
    : isBlockView
      ? 'Select a block.'
      : isCenterView
        ? 'Select a center.'
        : 'Applications at SCERT stage awaiting final verification and approval.';

  const scopedPendingCount = useMemo(() => {
    if (isApplicationsView) {
      return filteredApplications.length;
    }

    if (isCenterView) {
      if (!selectedDistrict?.district_code || !selectedBlock?.block_code) return 0;
      const districtCode = normalizeTwoDigitCode(selectedDistrict.district_code);
      const blockCode = normalizeTwoDigitCode(selectedBlock.block_code);
      return (Array.isArray(allPendingApps) ? allPendingApps : []).reduce((acc, app) => {
        const centerId = app.center_id != null ? String(app.center_id) : '';
        const meta = centerMetaById.get(centerId);
        if (!meta) return acc;
        return meta.district_code === districtCode && meta.block_code === blockCode ? acc + 1 : acc;
      }, 0);
    }

    if (isBlockView) {
      if (!selectedDistrict?.district_code) return 0;
      const districtCode = normalizeTwoDigitCode(selectedDistrict.district_code);
      return (Array.isArray(allPendingApps) ? allPendingApps : []).reduce((acc, app) => {
        const centerId = app.center_id != null ? String(app.center_id) : '';
        const meta = centerMetaById.get(centerId);
        if (!meta) return acc;
        return meta.district_code === districtCode ? acc + 1 : acc;
      }, 0);
    }

    return Array.isArray(allPendingApps) ? allPendingApps.length : 0;
  }, [
    isApplicationsView,
    isCenterView,
    isBlockView,
    filteredApplications.length,
    allPendingApps,
    centerMetaById,
    selectedDistrict?.district_code,
    selectedBlock?.block_code,
  ]);

  if (viewingApplicationId) {
    return (
      <ScertApplicationViewer
        applicationId={viewingApplicationId}
        onBack={() => {
          setViewingApplicationId(null);
          if (selectedCenter?.center_id) {
            fetchApplications({ centerId: selectedCenter.center_id });
          }
        }}
      />
    );
  }

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }

  const handleBack = () => {
    if (isApplicationsView) {
      setLevel('center');
      setSelectedCenter(null);
      setApplications([]);
      return;
    }

    if (isCenterView) {
      setLevel('block');
      setSelectedBlock(null);
      setCenters([]);
      return;
    }

    if (isBlockView) {
      setLevel('district');
      setSelectedDistrict(null);
      setBlocks([]);
    }
  };

  const handleRefresh = () => {
    if (isDistrictView) {
      fetchDistricts();
      fetchAllCenters();
      fetchAllPendingApplications();
      return;
    }

    if (isBlockView && selectedDistrict?.district_code) {
      fetchBlocks(selectedDistrict.district_code);
      fetchAllPendingApplications();
      return;
    }

    if (isCenterView && selectedDistrict?.district_code && selectedBlock?.block_code) {
      fetchCenters({
        districtCode: selectedDistrict.district_code,
        blockCode: selectedBlock.block_code,
      });
      fetchAllPendingApplications();
      return;
    }

    if (isApplicationsView && selectedCenter?.center_id) {
      fetchApplications({ centerId: selectedCenter.center_id });
      fetchAllPendingApplications();
    }
  };

  const renderCmClassFilters = () => {
    if (!isApplicationsView || !isCmScholarship) return null;
    return (
      <div className="filters-bar" style={{ marginBottom: '0.75rem' }}>
        <div className="filter-group">
          <label className="filter-label">Class</label>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className={`filter-btn ${cmClassFilter === '6' ? 'filter-btn-class6-active' : ''}`}
              onClick={() => {
                setCmClassFilter('6');
                setSelectedApplicationIds(new Set());
              }}
            >
              CM Class 6
            </button>
            <button
              type="button"
              className={`filter-btn ${cmClassFilter === '9' ? 'filter-btn-class9-active' : ''}`}
              onClick={() => {
                setCmClassFilter('9');
                setSelectedApplicationIds(new Set());
              }}
            >
              CM Class 9
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleDownloadApplicationsPdf = () => {
    if (!isApplicationsView || filteredApplications.length === 0) {
      toast.warning('No pending applications to download.');
      return;
    }

    const html = `
      <html>
        <head>
          <title>SCERT Pending Applications</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h2 { text-align: center; margin-bottom: 10px; }
            .info { text-align: center; margin-bottom: 18px; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #000; padding: 6px 4px; text-align: left; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h2>SCERT Pending Applications</h2>
          <div class="info">
            <strong>Scholarship:</strong> ${selectedScholarshipName}<br/>
            <strong>Generated:</strong> ${new Date().toLocaleString()}
          </div>
          <table>
            <thead>
              <tr>
                <th>Application ID</th>
                <th>Serial No</th>
                <th>Student Name</th>
                <th>Scholarship</th>
                <th>School Name</th>
                <th>UDISE Code</th>
                <th>Center Order</th>
                <th>Status</th>
                <th>Submitted At</th>
              </tr>
            </thead>
            <tbody>
              ${filteredApplications
                .map(
                  (app) => `
                <tr>
                  <td>${window.getDisplayApplicationId(app)}</td>
                  <td>${app.student_registration_no || app.sr_no || '—'}</td>
                  <td>${app.student_name || '—'}</td>
                  <td>${app.scholarship_name || '—'}</td>
                  <td>${app.school_name || '—'}</td>
                  <td>${app.udise_code || '—'}</td>
                  <td>${app.center_order || 'Not assigned'}</td>
                  <td>${app.status === 'SUBMITTED' && app.current_stage === 'SCERT' ? 'Pending' : app.status || '—'}</td>
                  <td>${app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</td>
                </tr>`
                )
                .join('')}
            </tbody>
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

  return (
    <div className="applications-view scert-pending-applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">{title}</h3>
              
            </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div className="scert-pending-stat-box">
            <span className="scert-pending-stat-label">Pending Applications</span>
            <span className="scert-pending-stat-value">{loading ? '…' : scopedPendingCount}</span>
          </div>
          {!isDistrictView && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={handleBack}
              disabled={loading || bulkWorking}
            >
              ← Back
            </button>
          )}
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={bulkOpenReturnModal}
            disabled={!canFetch || loading || bulkWorking}
          >
           Return to BEO
          </button>
          <button
            type="button"
            className="scert-btn-violet"
            onClick={bulkOpenApproveModal}
            disabled={!canFetch || loading || bulkWorking}
          >
            Approve
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleRefresh}
            disabled={!canFetch || loading || bulkWorking}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {isApplicationsView && (
            <button
              type="button"
              className="scert-btn-violet"
              onClick={handleDownloadApplicationsPdf}
              disabled={!canFetch || loading || bulkWorking || filteredApplications.length === 0}
            >
              Download PDF
            </button>
          )}
        </div>
      </div>

      {showApproveModal && (
        <div className="modal-overlay" onClick={() => !bulkWorking && setShowApproveModal(false)}>
          <div
            className="modal-content scert-violet-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header" style={{ textAlign: 'left' }}>
              <h2 className="modal-title scert-violet-modal-title">Confirm Approval</h2>
              <p className="modal-subtitle">
                You are about to approve <strong>{bulkTargetIds.length}</strong> pending application(s) under{' '}
                <strong>{bulkScopeLabel}</strong>.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => setShowApproveModal(false)}
                disabled={bulkWorking}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scert-btn-violet"
                onClick={bulkApprove}
                disabled={bulkWorking}
              >
                {bulkWorking ? 'Approving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="modal-overlay" onClick={() => !bulkWorking && setShowReturnModal(false)}>
          <div
            className="modal-content scert-violet-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header" style={{ textAlign: 'left' }}>
              <h2 className="modal-title scert-violet-modal-title">Return to BEO</h2>
              <p className="modal-subtitle">
                You are about to return <strong>{bulkTargetIds.length}</strong> pending application(s) under{' '}
                <strong>{bulkScopeLabel}</strong>.
              </p>
            </div>

            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Remark</label>
              <textarea
                className="form-input"
                rows={4}
                placeholder="Enter remark to return applications to BEO"
                value={returnRemark}
                onChange={(e) => setReturnRemark(e.target.value)}
                disabled={bulkWorking}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="scert-btn-secondary"
                onClick={() => setShowReturnModal(false)}
                disabled={bulkWorking}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scert-btn-violet"
                onClick={bulkReturnToBeo}
                disabled={bulkWorking}
              >
                {bulkWorking ? 'Returning…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renderCmClassFilters()}

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading…</div>
      ) : isDistrictView ? (
        districts.length === 0 ? (
          <div className="empty-state">No districts found.</div>
        ) : (
          <div className="smart-table-wrap scert-pending-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>
                    <input
                      type="checkbox"
                      checked={districts.length > 0 && selectedDistrictCodes.size === districts.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDistrictCodes(
                            new Set(districts.map((d) => normalizeTwoDigitCode(d.district_code)))
                          );
                        } else {
                          setSelectedDistrictCodes(new Set());
                        }
                      }}
                    />
                  </th>
                  <th style={{ width: 70 }}>S.No</th>
                  <th>District</th>
                  <th style={{ width: 160 }}>No. of Blocks</th>
                  <th style={{ width: 170 }}>No. of Centers</th>
                  <th style={{ width: 190 }}>Pending Applications</th>
                </tr>
              </thead>
              <tbody>
                {districts.map((d, idx) => {
                  const dc = normalizeTwoDigitCode(d.district_code);
                  const checked = selectedDistrictCodes.has(dc);
                  const pendingCount = pendingCountByDistrictCode.get(dc) || 0;

                  return (
                    <tr
                      key={d.district_code}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedDistrict({
                          district_code: d.district_code,
                          district_name: d.district_name,
                        });
                        setSelectedBlock(null);
                        setSelectedCenter(null);
                        setBlocks([]);
                        setCenters([]);
                        setApplications([]);
                        setSelectedBlockKeys(new Set());
                        setSelectedCenterIds(new Set());
                        setSelectedApplicationIds(new Set());
                        setLevel('block');
                        fetchBlocks(d.district_code);
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedDistrictCodes((prev) => {
                              const next = new Set(prev);
                              if (next.has(dc)) next.delete(dc);
                              else next.add(dc);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="smart-table-strong">{idx + 1}</td>
                      <td className="smart-table-strong">
                        {d.district_name || '—'}
                        <div style={{ fontSize: '0.85em', opacity: 0.8 }}>Code: {d.district_code}</div>
                      </td>
                      <td className="smart-table-strong">{d.total_blocks ?? 0}</td>
                      <td className="smart-table-strong">{d.total_centers ?? 0}</td>
                      <td className="smart-table-strong">{pendingCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : isBlockView ? (
        blocks.length === 0 ? (
          <div className="empty-state">No blocks found under this district.</div>
        ) : (
          <div className="smart-table-wrap scert-pending-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>
                    <input
                      type="checkbox"
                      checked={blocks.length > 0 && selectedBlockKeys.size === blocks.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const dc = normalizeTwoDigitCode(selectedDistrict?.district_code);
                          setSelectedBlockKeys(
                            new Set(blocks.map((b) => `${dc}|${normalizeTwoDigitCode(b.block_code)}`))
                          );
                        } else {
                          setSelectedBlockKeys(new Set());
                        }
                      }}
                    />
                  </th>
                  <th style={{ width: 70 }}>S.No</th>
                  <th>Block</th>
                  <th style={{ width: 140 }}>Block Code</th>
                  <th style={{ width: 170 }}>No. of Centers</th>
                  <th style={{ width: 190 }}>Pending Applications</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b, idx) => {
                  const dc = normalizeTwoDigitCode(selectedDistrict?.district_code);
                  const bc = normalizeTwoDigitCode(b.block_code);
                  const key = `${dc}|${bc}`;
                  const checked = selectedBlockKeys.has(key);
                  const pendingCount = pendingCountByBlockKey.get(key) || 0;

                  return (
                    <tr
                      key={b.block_code}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedBlock({ block_code: b.block_code, block_name: b.block_name });
                        setSelectedCenter(null);
                        setCenters([]);
                        setApplications([]);
                        setSelectedCenterIds(new Set());
                        setSelectedApplicationIds(new Set());
                        setLevel('center');
                        fetchCenters({
                          districtCode: selectedDistrict?.district_code,
                          blockCode: b.block_code,
                        });
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedBlockKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="smart-table-strong">{idx + 1}</td>
                      <td className="smart-table-strong">{b.block_name || '—'}</td>
                      <td>{b.block_code || '—'}</td>
                      <td className="smart-table-strong">{b.total_centers ?? 0}</td>
                      <td className="smart-table-strong">{pendingCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : isCenterView ? (
        centers.length === 0 ? (
          <div className="empty-state">No centers found in this block.</div>
        ) : (
          <div className="smart-table-wrap scert-pending-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>
                    <input
                      type="checkbox"
                      checked={centers.length > 0 && selectedCenterIds.size === centers.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCenterIds(new Set(centers.map((c) => String(c.center_id))));
                        } else {
                          setSelectedCenterIds(new Set());
                        }
                      }}
                    />
                  </th>
                  {/* <th>Center ID</th> */}
                  <th>Center Order</th>
                  <th>Center Name</th>
                  <th>UDISE</th>
                  <th>Superintendent</th>
                  <th>Mobile</th>
                  <th style={{ width: 190 }}>Pending Applications</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((c) => {
                  const id = String(c.center_id);
                  const checked = selectedCenterIds.has(id);
                  const pendingCount = pendingCountByCenterId.get(id) || 0;

                  return (
                    <tr
                      key={c.center_id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedCenter({
                          center_id: c.center_id,
                          center_order: c.center_order,
                          school_name: c.school_name,
                        });
                        setApplications([]);
                        setSelectedApplicationIds(new Set());
                        setLevel('applications');
                        fetchApplications({ centerId: c.center_id });
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedCenterIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            });
                          }}
                        />
                      </td>
                      {/* <td>
                        <code className="smart-table-id">#{c.center_id}</code>
                      </td> */}
                      <td className="smart-table-strong">{c.center_order ?? '—'}</td>
                      <td className="smart-table-strong">{c.school_name || '—'}</td>
                      <td>{c.udise_code || '—'}</td>
                      <td>{c.superintendent_name || '—'}</td>
                      <td>{c.superintendent_mobile || '—'}</td>
                      <td className="smart-table-strong">{pendingCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {filteredApplications.length === 0 ? (
            <div className="empty-state">No pending applications found for this center.</div>
          ) : (
            <div className="smart-table-wrap scert-pending-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th style={{ width: 52 }}>
                      <input
                        type="checkbox"
                        checked={filteredApplications.length > 0 && selectedApplicationIds.size === filteredApplications.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedApplicationIds(new Set(filteredApplications.map((a) => a.application_id)));
                          } else {
                            setSelectedApplicationIds(new Set());
                          }
                        }}
                      />
                    </th>
                    <th>Application ID</th>
                    <th>Serial No</th>
                    <th>Student Name</th>
                    {/* <th>Scholarship</th> */}
                    <th>School Name</th>
                    <th>UDISE Code</th>
                    <th>Center Order</th>
                    <th>Status</th>
                    <th>Submitted At</th>
                    <th style={{ width: 90 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.map((app) => {
                    const checked = selectedApplicationIds.has(app.application_id);
                    return (
                      <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedApplicationIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(app.application_id)) next.delete(app.application_id);
                                else next.add(app.application_id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td>
                          <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                        </td>
                        <td className="smart-table-strong">{app.student_registration_no || app.sr_no || '—'}</td>
                        <td>{app.student_name || '—'}</td>
                        {/* <td>{app.scholarship_name || '—'}</td> */}
                        <td>{app.school_name || '—'}</td>
                        <td>{app.udise_code || '—'}</td>
                        <td>{app.center_order || 'Not assigned'}</td>
                        <td>
                          <span className={`status-pill status-${String(app.status || '').toLowerCase()}`}>
                            {app.status === 'SUBMITTED' && app.current_stage === 'SCERT' ? 'Pending' : app.status}
                          </span>
                        </td>
                        <td>{app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="icon-action-btn"
                            title="View / Verify"
                            onClick={() => handleViewApplication(app.application_id)}
                          >
                            <HiOutlineEye />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{filteredApplications.length}</strong> application(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
