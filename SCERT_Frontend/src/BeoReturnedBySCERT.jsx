import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get, post } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { BeoReturnedApplicationEditor } from './BeoReturnedApplicationEditor.jsx';
import { BeoBulkReturnModal } from './BeoBulkReturnModal.jsx';
import { HiOutlinePencil } from 'react-icons/hi';

export function BeoReturnedBySCERT() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedScholarshipId, selectedSessionId, scholarships } = useDashboard();

  const selectedScholarshipName =
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || '';

  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [classFilter, setClassFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedReturnedIds, setSelectedReturnedIds] = useState(new Set());
  const [showBulkReturnModal, setShowBulkReturnModal] = useState(false);
  const [bulkReturning, setBulkReturning] = useState(false);
  const PAGE_SIZE = 20;

  const fetchApplications = async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);

      const data = await get(
        `/api/beo/applications/returned-by-scert${params.toString() ? '?' + params.toString() : ''}`,
        {
          token: auth?.token,
          sessionId: selectedSessionId,
        }
      );
      setApplications(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      setError(err.message || 'Failed to fetch applications');
      toast.error(`Failed to load returned applications: ${toast.getErrorMessage(err)}`);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      // NOTE: We only select from scopedApplications so it respects filters
      setSelectedReturnedIds(new Set(scopedApplications.map((app) => app.application_id)));
    } else {
      setSelectedReturnedIds(new Set());
    }
  };

  const toggleSelection = (appId) => {
    setSelectedReturnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const handleBulkReturnToSchool = async (remarkText) => {
    const ids = Array.from(selectedReturnedIds);
    if (ids.length === 0) return;

    setBulkReturning(true);

    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          post(
            `/api/beo/applications/${id}/return`,
            { remark_text: remarkText },
            { token: auth?.token }
          )
        )
      );

      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;

      if (fail > 0) {
        toast.warning(`Returned: ${ok}, Failed: ${fail}`);
        const firstErr = results.find((r) => r.status === 'rejected')?.reason;
        if (firstErr) {
          toast.error(`Some returns failed: ${toast.getErrorMessage(firstErr)}`);
        }
      } else {
        toast.success(`Returned ${ok} application(s) to school.`);
      }

      setShowBulkReturnModal(false);
    } finally {
      setBulkReturning(false);
      setSelectedReturnedIds(new Set());
      fetchApplications();
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

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedScholarshipId, selectedSessionId, classFilter, applications.length]);

  if (selectedAppId) {
    return (
      <BeoReturnedApplicationEditor
        applicationId={selectedAppId}
        onBack={() => {
          setSelectedAppId(null);
          fetchApplications();
        }}
      />
    );
  }

  let scopedApplications = !selectedScholarshipId
    ? applications
    : applications.filter((row) => {
        const rowSid = row?.scholarship_id ?? row?.scholarshipId ?? row?.scholarship;
        if (rowSid !== null && rowSid !== undefined && String(rowSid) === String(selectedScholarshipId)) return true;

        const rowSname = String(row?.scholarship_name || row?.scholarshipName || '');
        if (selectedScholarshipName && rowSname && rowSname === selectedScholarshipName) return true;

        return false;
      });

  if (classFilter) {
    scopedApplications = scopedApplications.filter(
      (row) => String(row?.class ?? '') === String(classFilter)
    );
  }

  const totalRows = scopedApplications.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pagedApplications = scopedApplications.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Returned by SCERT</h3>
              
            </div>
        </div>
        <button
          type="button"
          className="scert-btn-secondary"
          onClick={fetchApplications}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {(isCmScholarship || isNmmssScholarship) && (
        <div className="filters-bar">
          <div className="filter-group">
            <label className="filter-label">Class</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {isNmmssScholarship ? (
                <button
                  type="button"
                  className={`filter-btn ${classFilter === '8' ? 'filter-btn-active' : ''}`}
                  onClick={() => setClassFilter('8')}
                >
                  NMMSS Class 8
                </button>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading applications...</div>
      ) : scopedApplications.length === 0 ? (
        <div className="empty-state">No returned applications from SCERT for the selected filters.</div>
      ) : (
        <>
          <div className="bulk-actions-bar">
            <div className="bulk-actions-left">
              <span className="bulk-count">
                Selected: <strong>{selectedReturnedIds.size}</strong>
              </span>
            </div>
            <div className="bulk-actions-right" style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="save-draft-btn"
                disabled={selectedReturnedIds.size === 0 || loading}
                onClick={() => setShowBulkReturnModal(true)}
              >
                Return to School
              </button>
            </div>
          </div>

          <div className="smart-table-wrap beo-returned-scert-table-wrap beo-submitted-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input 
                      type="checkbox" 
                      onChange={handleSelectAll} 
                      checked={scopedApplications.length > 0 && selectedReturnedIds.size === scopedApplications.length} 
                    />
                  </th>
                  <th>Application ID</th>
                  <th>Student Name</th>
                  <th>Class</th>
                  <th>School</th>
                  <th>Status</th>
                  <th>Submitted At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedApplications.map((row) => (
                  <tr key={row.application_id} className={window.getSubmissionRoleRowClass(row)}>
                    <td>
                      <input 
                        type="checkbox" 
                        checked={selectedReturnedIds.has(row.application_id)} 
                        onChange={() => toggleSelection(row.application_id)} 
                      />
                    </td>
                    <td>
                      <code className="smart-table-id">{window.getDisplayApplicationId(row)}</code>
                    </td>
                    <td>{row.student_name || '—'}</td>
                    <td>{row.class || '—'}</td>
                    <td>{row.school_name || '—'}</td>
                    <td>
                      <span className="status-pill status-returned">{row.status}</span>
                    </td>
                    <td>
                      {row.submitted_at
                        ? new Date(row.submitted_at).toLocaleString()
                        : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-action-btn"
                        title="View & Edit"
                        onClick={() => setSelectedAppId(row.application_id)}
                      >
                        <HiOutlinePencil />
                      </button>
                    </td>
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

      <BeoBulkReturnModal
        isOpen={showBulkReturnModal}
        onClose={() => setShowBulkReturnModal(false)}
        onSubmit={handleBulkReturnToSchool}
        selectedCount={selectedReturnedIds.size}
        isSubmitting={bulkReturning}
      />
    </div>
  );
}
