import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get, post } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { BeoDeclarationModal } from './BeoDeclarationModal.jsx';

export function BeoCenterAssignment() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedScholarshipId, scholarships } = useDashboard();

  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [selectedSchoolUserId, setSelectedSchoolUserId] = useState('');

  const [applications, setApplications] = useState([]);
  const [blockPendingTotal, setBlockPendingTotal] = useState(0);
  const [centers, setCenters] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [loadingBlockPendingTotal, setLoadingBlockPendingTotal] = useState(false);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const [selectedCenterId, setSelectedCenterId] = useState('');
  const [selectedAppIds, setSelectedAppIds] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [showDeclarationModal, setShowDeclarationModal] = useState(false);
  const [declarationClassValue, setDeclarationClassValue] = useState('');

  const selectedScholarshipName =
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || '';
  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);

  const filteredApplications = useMemo(() => {
    if (!classFilter) return applications;
    return applications.filter((row) => String(row?.class ?? row?.class_level ?? '').trim() === String(classFilter));
  }, [applications, classFilter]);

  useEffect(() => {
    if (!selectedScholarshipId) {
      setSchools([]);
      setSelectedSchoolUserId('');
      setApplications([]);
      setCenters([]);
      setSelectedCenterId('');
      setSelectedAppIds([]);
      return;
    }

    // Scholarship changed: refresh available schools + centers; applications require school filter.
    setSelectedSchoolUserId('');
    setApplications([]);
    setBlockPendingTotal(0);
    setClassFilter('');
    setSelectedAppIds([]);
    fetchSchools();
    fetchCenters();
    fetchBlockPendingTotal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScholarshipId]);

const fetchSchools = async () => {
  setLoadingSchools(true);
  setError('');

    try {
      // Fetch all schools in the BEO block (paginated on backend)
      const limit = 200;
      const first = await get(`/api/beo/schools?page=1&limit=${limit}&scholarship_id=${selectedScholarshipId}&pending_only=1`, { token: auth?.token });
      const rows = Array.isArray(first?.data) ? first.data : [];
      const totalPages = Number(first?.pagination?.totalPages || 1);

      if (totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2).map((page) =>
            get(`/api/beo/schools?page=${page}&limit=${limit}&scholarship_id=${selectedScholarshipId}&pending_only=1`, { token: auth?.token })
          )
        );
        for (const r of rest) {
          if (Array.isArray(r?.data)) rows.push(...r.data);
        }
      }

      setSchools(rows);
      return rows;
    } catch (err) {
      console.error('Failed to fetch schools:', err);
      toast.error(`Failed to load schools: ${toast.getErrorMessage(err)}`);
      setSchools([]);
      return [];
    } finally {
      setLoadingSchools(false);
    }
  };

  const fetchApplications = async (schoolUserId) => {
    if (!selectedScholarshipId) return;
    if (!schoolUserId) return;

    setLoadingApplications(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      params.append('school_user_id', schoolUserId);
      if (classFilter) params.append('class_filter', classFilter);
      const data = await get(
        `/api/beo/applications?${params.toString()}`,
        { token: auth?.token }
      );
      setApplications(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      setError(err.message || 'Failed to fetch applications');
      toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
      setApplications([]);
    } finally {
      setLoadingApplications(false);
    }
  };

  const fetchBlockPendingTotal = async () => {
    if (!selectedScholarshipId) return;

    setLoadingBlockPendingTotal(true);
    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);
      const data = await get(
        `/api/beo/applications?${params.toString()}`,
        { token: auth?.token }
      );
      const total = Number(data?.total);
      setBlockPendingTotal(Number.isFinite(total) ? total : (Array.isArray(data?.applications) ? data.applications.length : 0));
    } catch (err) {
      setBlockPendingTotal(0);
      toast.error(`Failed to load pending count: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoadingBlockPendingTotal(false);
    }
  };

  useEffect(() => {
    if (!selectedScholarshipId) return;
    fetchBlockPendingTotal();
    if (selectedSchoolUserId) {
      fetchApplications(selectedSchoolUserId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classFilter]);

  useEffect(() => {
    const visibleIds = new Set(filteredApplications.map((a) => String(a.application_id)));
    setSelectedAppIds((prev) => prev.filter((id) => visibleIds.has(String(id))));
  }, [filteredApplications]);

  const fetchCenters = async () => {
    if (!selectedScholarshipId) return;

    setLoadingCenters(true);

    try {
      const data = await get(`/api/beo/centers?scholarship_id=${selectedScholarshipId}`, {
        token: auth?.token,
      });
      setCenters(Array.isArray(data.centers) ? data.centers : []);
    } catch (err) {
      console.error('Failed to fetch centers:', err);
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
      setCenters([]);
    } finally {
      setLoadingCenters(false);
    }
  };

  const toggleAppSelection = (appId) => {
    setSelectedAppIds((prev) => {
      const exists = prev.includes(appId);
      if (exists) {
        return prev.filter((id) => id !== appId);
      }
      return [...prev, appId];
    });
  };

  const getDeclarationClassForSelection = () => {
    if (!isCmScholarship) return '8';
    if (classFilter === '6' || classFilter === '9') return classFilter;

    const selectedRows = filteredApplications.filter((row) =>
      selectedAppIds.includes(row.application_id)
    );
    const classes = Array.from(
      new Set(
        selectedRows
          .map((row) => String(row?.class ?? row?.class_level ?? '').trim())
          .filter(Boolean)
      )
    );
    if (classes.length === 1 && (classes[0] === '6' || classes[0] === '9')) {
      return classes[0];
    }
    return '';
  };

  const handleAssignCenter = async () => {
    if (!selectedScholarshipId) {
      setError('Please select a scholarship to continue.');
      toast.error('Please select a scholarship to continue.');
      return;
    }

    if (!selectedSchoolUserId) {
      setError('Please select a school first.');
      toast.error('Please select a school first.');
      return;
    }

    if (!selectedCenterId) {
      setError('Please select a center.');
      toast.error('Please select a center.');
      return;
    }

    if (selectedAppIds.length === 0) {
      setError('Please select at least one application.');
      toast.error('Please select at least one application.');
      return;
    }

    const resolvedClassForDeclaration = getDeclarationClassForSelection();
    if (isCmScholarship && !resolvedClassForDeclaration) {
      setError('Please select either Class 6 or Class 9 for declaration.');
      toast.error('Please select either Class 6 or Class 9 for declaration.');
      return;
    }

    setDeclarationClassValue(resolvedClassForDeclaration || '8');
    setShowDeclarationModal(true);
  };

  const executeAssignCenter = async () => {
    setShowDeclarationModal(false);

    setAssigning(true);
    setError('');
    setSuccess('');

    try {
      const currentSchoolUserId = String(selectedSchoolUserId);
      const payload = {
        scholarship_id: selectedScholarshipId,
        center_id: selectedCenterId,
        applications: selectedAppIds.map((id) => ({ application_id: id })),
      };

      await post('/api/beo/applications/assign-center', payload, {
        token: auth?.token,
      });

      setSuccess(`Successfully assigned ${selectedAppIds.length} applications to center.`);
      toast.success(`Successfully assigned ${selectedAppIds.length} applications to center.`);
      setSelectedAppIds([]);
      setSelectedCenterId('');

      const refreshedSchools = await fetchSchools();
      await Promise.all([fetchCenters(), fetchBlockPendingTotal()]);

      if (currentSchoolUserId) {
        await fetchApplications(currentSchoolUserId);

        const schoolStillPending = refreshedSchools.some(
          (s) => String(s.user_id) === currentSchoolUserId
        );
        if (!schoolStillPending) {
          setSelectedSchoolUserId('');
          setSelectedCenterId('');
          setSelectedAppIds([]);
          setApplications([]);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to assign center');
      toast.error(`Failed to assign center: ${toast.getErrorMessage(err)}`);
    } finally {
      setAssigning(false);
    }
  };

  if (!selectedScholarshipId) {
    return (
      <div className="applications-view">
        <div className="empty-state">
          <h3>Please select a scholarship to continue.</h3>
          <p>Use the scholarship dropdown above to select a scholarship for center assignment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Center Assignment</h3>
              
            </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {isCmScholarship && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                onClick={() => setClassFilter((prev) => (prev === '6' ? '' : '6'))}
              >
                Class 6
              </button>
              <button
                type="button"
                className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                onClick={() => setClassFilter((prev) => (prev === '9' ? '' : '9'))}
              >
                Class 9
              </button>
            </div>
          )}
          <div
            style={{
              height: '42px',
              minWidth: '170px',
              padding: '0 0.9rem',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              background: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            <span style={{ color: '#111827' }}>Pending Assignment</span>
            <span style={{ color: '#dc2626' }}>{loadingBlockPendingTotal ? '…' : blockPendingTotal}</span>
          </div>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              fetchSchools();
              fetchCenters();
              fetchBlockPendingTotal();
              if (selectedSchoolUserId) {
                fetchApplications(selectedSchoolUserId);
              }
            }}
            disabled={loadingApplications || loadingCenters || loadingSchools || loadingBlockPendingTotal || assigning}
          >
            {loadingApplications || loadingCenters || loadingSchools || loadingBlockPendingTotal ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="center-assignment-controls">
        <div className="center-assignment-filters-row">
          <div className="form-field">
            <label className="form-label">Select School</label>
            <select
              className="form-input"
              value={selectedSchoolUserId}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedSchoolUserId(next);
                setSelectedCenterId('');
                setSelectedAppIds([]);
                setApplications([]);
                setError('');
                setSuccess('');
                if (next) {
                  fetchApplications(next);
                }
              }}
              disabled={loadingSchools}
            >
              <option value="">-- Select School --</option>
              {schools.map((school) => (
                <option key={school.user_id} value={school.user_id}>
                  {school.school_name} - {school.udise_code}
                </option>
              ))}
            </select>
            {loadingSchools ? <div className="field-hint">Loading schools…</div> : null}
            {!loadingSchools && schools.length === 0 ? (
              <div className="field-hint">No schools found for your block.</div>
            ) : null}
          </div>

          <div className="form-field">
            <label className="form-label">Select Center</label>
            <select
              className="form-input"
              value={selectedCenterId}
              onChange={(e) => setSelectedCenterId(e.target.value)}
              disabled={!selectedSchoolUserId || loadingCenters || centers.length === 0}
            >
              <option value="">-- Select Center --</option>
              {centers.map((center) => (
                <option key={center.center_id} value={center.center_id}>
                  {(center.center_order ?? center.center_code ?? center.center_id ?? '-')}{' - '}
                  {center.school_name} - {center.udise_code}
                </option>
              ))}
            </select>
           
          </div>

          <div className="form-field">
            <label className="form-label" style={{ opacity: 0 }}>
              Assign
            </label>
            <button
              type="button"
              className="form-submit-btn"
              onClick={handleAssignCenter}
              disabled={assigning || !selectedSchoolUserId || !selectedCenterId || selectedAppIds.length === 0}
              style={{ width: '100%' }}
            >
              {assigning ? 'Assigning…' : 'Assign Center'}
            </button>
            
          </div>
        </div>

        <div className="bulk-actions-bar">
          <div className="bulk-actions-left">
            <span className="bulk-count">
              Selected: <strong>{selectedAppIds.length}</strong> application(s)
            </span>
          </div>
        </div>
      </div>

      {!selectedSchoolUserId ? (
        <div className="empty-state">Select a school to view its applications for center assignment.</div>
      ) : loadingApplications ? (
        <div className="loading-state">Loading applications...</div>
      ) : filteredApplications.length === 0 ? (
        <div className="empty-state">No pending applications found for this school.</div>
      ) : (
        <div className="smart-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>
                  <input
                    type="checkbox"
                    checked={selectedAppIds.length === filteredApplications.length && filteredApplications.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAppIds(filteredApplications.map((a) => a.application_id));
                      } else {
                        setSelectedAppIds([]);
                      }
                    }}
                  />
                </th>
                <th>Order</th>
                <th>Application ID</th>
                <th>Student Name</th>
                <th>School Name</th>
                <th>UDISE Code</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {filteredApplications.map((row) => {
                const selectionIndex = selectedAppIds.indexOf(row.application_id);
                const isSelected = selectionIndex !== -1;
                return (
                  <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleAppSelection(row.application_id)}
                      />
                    </td>
                    <td>
                      {isSelected && (
                        <span className="status-pill status-pending">{selectionIndex + 1}</span>
                      )}
                    </td>
                    <td>
                      <code className="smart-table-id">{window.getDisplayApplicationId(row)}</code>
                    </td>
                    <td className="smart-table-strong">
  {row.student_name || '—'}
</td>
                    <td className="smart-table-strong">{row.school_name || '—'}</td>
                    <td>{row.udise_code || '—'}</td>
                    <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BeoDeclarationModal
        isOpen={showDeclarationModal}
        onClose={() => setShowDeclarationModal(false)}
        onSubmit={executeAssignCenter}
        isSubmitting={assigning}
        scholarshipId={selectedScholarshipId}
        scholarshipName={selectedScholarshipName}
        classValue={declarationClassValue}
        submitLabel="Confirm & Assign Center"
      />

    </div>
  );
}
