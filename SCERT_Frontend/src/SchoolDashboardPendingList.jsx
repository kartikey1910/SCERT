import { useEffect, useState, useMemo } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

export function SchoolDashboardPendingList() {
  const { auth } = useAuth();
  const { selectedSessionId, selectedScholarshipId, scholarships } = useDashboard();
  const toast = useToast();

  const [pendingApps, setPendingApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const selectedScholarshipName = String(
    scholarships.find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || ''
  );
  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

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

  const canFetch = Boolean(auth?.token && selectedSessionId && selectedScholarshipId);
  const waitingForResolvedClassFilter =
    (isCmScholarship || isNmmssScholarship) && !classFilter;

  const fetchPendingApplications = async () => {
    if (!canFetch || waitingForResolvedClassFilter) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);

      const data = await get(
        `/api/school/applications/pending${params.toString() ? `?${params.toString()}` : ''}`,
        { token: auth.token, sessionId: selectedSessionId }
      );
      setPendingApps(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch pending applications:', err);
      setError(err.message || 'Failed to load pending applications');
      toast.error(`Failed to load pending applications: ${toast.getErrorMessage(err)}`);
      setPendingApps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    if (waitingForResolvedClassFilter) return;
    fetchPendingApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedScholarshipId, classFilter, waitingForResolvedClassFilter]);

  const filteredApps = useMemo(() => {
    if (!selectedScholarshipId) return pendingApps;
    return pendingApps.filter((row) => String(row.scholarship_id || '') === String(selectedScholarshipId));
  }, [pendingApps, selectedScholarshipId]);

  const sortedApps = useMemo(() => {
    const list = Array.isArray(filteredApps) ? [...filteredApps] : [];
    const getDisplayId = (row) =>
      String(row?.application_display_id || window.getDisplayApplicationId(row) || '').trim().toUpperCase();
    const getTrailingSerial = (displayId) => {
      const match = String(displayId || '').match(/(\d{5})$/);
      return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    };

    if (isNmmssScholarship) {
      return list.sort((a, b) => {
        const aDisplay = getDisplayId(a);
        const bDisplay = getDisplayId(b);
        const aSerial = getTrailingSerial(aDisplay);
        const bSerial = getTrailingSerial(bDisplay);

        if (aSerial !== bSerial) return aSerial - bSerial;
        if (aDisplay !== bDisplay) return aDisplay.localeCompare(bDisplay, undefined, { numeric: true });
        return Number(a?.application_id || 0) - Number(b?.application_id || 0);
      });
    }

    const extractParts = (value) => {
      const text = String(value || '').trim().toUpperCase();
      const serialMatch = text.match(/(\d{5})$/);
      const serial = serialMatch ? Number(serialMatch[1]) : Number.MAX_SAFE_INTEGER;
      const m = text.match(/^([A-Z]*)(\d+)$/);
      if (!m) return { prefix: text, number: Number.MAX_SAFE_INTEGER, serial };
      return { prefix: m[1] || '', number: Number(m[2] || 0), serial };
    };

    return list.sort((a, b) => {
      const aDisplay = getDisplayId(a);
      const bDisplay = getDisplayId(b);

      if (!aDisplay && !bDisplay) {
        return Number(a?.application_id || 0) - Number(b?.application_id || 0);
      }
      if (!aDisplay) return 1;
      if (!bDisplay) return -1;

      const aParts = extractParts(aDisplay);
      const bParts = extractParts(bDisplay);

      if (aParts.serial !== bParts.serial) return aParts.serial - bParts.serial;

      const prefixCmp = aParts.prefix.localeCompare(bParts.prefix);
      if (prefixCmp !== 0) return prefixCmp;
      if (aParts.number !== bParts.number) return aParts.number - bParts.number;
      return aDisplay.localeCompare(bDisplay, undefined, { numeric: true });
    });
  }, [filteredApps]);

  const totalPages = Math.max(1, Math.ceil(sortedApps.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(sortedApps.length, startIdx + PAGE_SIZE);

  const pageRows = useMemo(() => {
    return sortedApps.slice(startIdx, endIdx);
  }, [sortedApps, startIdx, endIdx]);

  useEffect(() => {
    setPage((prev) => Math.min(Math.max(prev, 1), totalPages));
  }, [totalPages]);

  const renderClassFilters = () => {
    if (!isCmScholarship && !isNmmssScholarship) return null;

    return (
      <div className="filters-bar compact-filters-bar">
        <div className="filter-group">
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isNmmssScholarship ? (
              <button
                type="button"
                className={`filter-btn compact-filter-btn ${classFilter === '8' ? 'filter-btn-active' : ''}`}
                onClick={() => setClassFilter('8')}
              >
                Class 8
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`filter-btn compact-filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                  onClick={() => setClassFilter('6')}
                >
                  Class 6
                </button>
                <button
                  type="button"
                  className={`filter-btn compact-filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                  onClick={() => setClassFilter('9')}
                >
                  Class 9
                </button>
              </>
            )}
          </div>
          
        </div>
      </div>
    );
  };

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }

  return (
    <div className="applications-view school-dashboard-pending-list">
      <div className="view-header-row compact-view-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Pending Applications</h3>
              
            </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {renderClassFilters()}
          <button
            type="button"
            className="scert-btn-secondary compact-refresh-btn"
            onClick={fetchPendingApplications}
            disabled={!canFetch || waitingForResolvedClassFilter || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading pending applications...</div>
      ) : sortedApps.length === 0 ? (
        <div className="empty-state">No pending applications found.</div>
      ) : (
        <div className="smart-table-wrap compact-table-wrap">
          <table className="smart-table compact-table">
            <thead>
              <tr>
                <th>Application ID</th>
                <th>Student Name</th>
                <th>Scholarship Name</th>
                <th>Status</th>
                <th>Submitted By</th>
                <th>Submitted At</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const rowStage = String(row.current_stage || '').toUpperCase();
                const rowStatus = String(row.status || '').toUpperCase();
                const displayStatus = rowStage === 'SCHOOL' && rowStatus === 'SUBMITTED' ? 'PENDING' : (row.status || '—');

                return (
                  <tr key={String(row.application_id)} className={window.getSubmissionRoleRowClass(row)}>
                    <td>
                      <code className="smart-table-id smart-table-id--strong">{window.getDisplayApplicationId(row)}</code>
                    </td>
                    <td className="smart-table-strong">{row.student_name || '—'}</td>
                    <td>{row.scholarship_name || '—'}</td>
                    <td>
                      <span className={`status-pill status-${String(displayStatus || '').toLowerCase()}`}>
                        {displayStatus}
                      </span>
                    </td>
                    <td>
                      <span className="status-pill">{row.submitted_by_role || '—'}</span>
                    </td>
                    <td>
                      {row.submitted_at
                        ? new Date(row.submitted_at).toLocaleString()
                        : row.updated_at
                          ? new Date(row.updated_at).toLocaleString()
                          : row.created_at
                            ? new Date(row.created_at).toLocaleString()
                            : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && sortedApps.length > 0 && (
        <div className="table-footer compact-table-footer" style={{ marginTop: '0.5rem' }}>
          <span className="table-count">
            Showing <strong>{sortedApps.length === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
            <strong>{sortedApps.length}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="scert-btn-secondary compact-pagination-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className="scert-btn-secondary compact-pagination-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
