import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { API_BASE_URL, get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

// NOTE: This is intentionally separate from BeoProgressReport so dashboard-specific CSS tweaks
// won't affect the main Progress Report page.
export function BeoDashboardProgressReport({
  pendingCount = 0,
  returnedByScertCount = 0,
}) {
  const { auth } = useAuth();
  const { selectedSessionId, selectedScholarshipId } = useDashboard();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [targetClasses, setTargetClasses] = useState([6, 9]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const canFetch = Boolean(auth?.token && selectedSessionId && selectedScholarshipId);

  const normalizeTargetClasses = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n));
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => Number(String(s).trim()))
        .filter((n) => Number.isFinite(n));
    }
    return [];
  };

  const fetchReport = async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await get(
        `/api/beo/progress-reports/registration?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
        {
          token: auth.token,
          sessionId: selectedSessionId,
        }
      );

      const nextRows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      setRows(nextRows);

      const nextTarget = normalizeTargetClasses(data?.targetClasses ?? data?.target_classes);
      setTargetClasses(nextTarget.length ? nextTarget : [6, 9]);
    } catch (err) {
      console.error('Failed to fetch progress report:', err);
      setError(err.message || 'Failed to load progress report');
      toast.error(`Failed to load progress report: ${toast.getErrorMessage(err)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!canFetch) return;

    const params = new URLSearchParams();
    params.append('scholarship_id', selectedScholarshipId);

    const url = `${API_BASE_URL}/api/beo/progress-reports/registration.pdf?${params.toString()}`;
    const filename = `beo_progress_report_${selectedSessionId}_${selectedScholarshipId}.pdf`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'x-session-id': selectedSessionId,
        },
      });

      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.message) msg = data.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();

      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Progress report PDF download failed:', e);
      toast.error(toast.getErrorMessage(e, 'Failed to download PDF'));
    }
  };

  useEffect(() => {
    setPage(1);
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedScholarshipId]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.class6_strength += Number(r.class6_strength || 0);
        acc.class6_registered += Number(r.class6_registered || 0);
        acc.class8_strength += Number(r.class8_strength || 0);
        acc.class8_registered += Number(r.class8_registered || 0);
        acc.class9_strength += Number(r.class9_strength || 0);
        acc.class9_registered += Number(r.class9_registered || 0);
        acc.total_registration += Number(r.total_registration || 0);
        acc.appeared += Number(r.appeared || 0);
        return acc;
      },
      {
        class6_strength: 0,
        class6_registered: 0,
        class8_strength: 0,
        class8_registered: 0,
        class9_strength: 0,
        class9_registered: 0,
        total_registration: 0,
        appeared: 0,
      }
    );
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(rows.length, startIdx + PAGE_SIZE);

  const pageRows = useMemo(() => {
    return rows.slice(startIdx, endIdx);
  }, [rows, startIdx, endIdx]);

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }

  return (
    <div className="applications-view beo-dashboard-progress-report">
      <div className="view-header-row beo-progress-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Progress Report</h3>
              
            </div>
        </div>

        <div className="beo-progress-header-stats">
          <div className="beo-progress-stat-card">
            <div className="beo-progress-stat-label">Returned by SCERT</div>
            <div className="beo-progress-stat-value">{returnedByScertCount}</div>
          </div>
          <div className="beo-progress-stat-card">
            <div className="beo-progress-stat-label">Pending Applications</div>
            <div className="beo-progress-stat-value">{pendingCount}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleDownloadPdf}
            disabled={!canFetch || loading}
            title="Download as PDF"
          >
            Download PDF
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchReport}
            disabled={!canFetch || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading progress report...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No schools found for your block (or no data available).</div>
      ) : (
        <div className="smart-table-wrap beo-dashboard-progress-table-wrap">
          <table className="smart-table beo-dashboard-progress-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>S.No</th>
                <th className="beo-progress-school-name-col" style={{ textAlign: 'left' }}>Name of the School</th>
                {targetClasses.includes(6) && (
                  <>
                    <th>Students in Class 6</th>
                    <th>Registered for Scholarship (Class 6)</th>
                  </>
                )}
                {targetClasses.includes(8) && (
                  <>
                    <th>Students in Class 8</th>
                    <th>Registered for Scholarship (Class 8)</th>
                  </>
                )}
                {targetClasses.includes(9) && (
                  <>
                    <th>Students in Class 9</th>
                    <th>Registered for Scholarship (Class 9)</th>
                  </>
                )}
                <th>Total Registration</th>
                <th title="Present in either paper. Fills in once the BEO uploads Absentee After Exam.">Appeared in Exam</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, idx) => (
                <tr key={String(r.school_user_id || startIdx + idx)} className={window.getSubmissionRoleRowClass(r)}>
                  <td className="smart-table-strong">{startIdx + idx + 1}</td>
                  <td className="beo-progress-school-name-col" style={{ textAlign: 'left' }}>{r.school_name || '—'}</td>
                  {targetClasses.includes(6) && (
                    <>
                      <td className="smart-table-strong">{r.class6_strength ?? 0}</td>
                      <td className="smart-table-strong">{r.class6_registered ?? 0}</td>
                    </>
                  )}
                  {targetClasses.includes(8) && (
                    <>
                      <td className="smart-table-strong">{r.class8_strength ?? 0}</td>
                      <td className="smart-table-strong">{r.class8_registered ?? 0}</td>
                    </>
                  )}
                  {targetClasses.includes(9) && (
                    <>
                      <td className="smart-table-strong">{r.class9_strength ?? 0}</td>
                      <td className="smart-table-strong">{r.class9_registered ?? 0}</td>
                    </>
                  )}
                  <td className="smart-table-strong">{r.total_registration ?? 0}</td>
                  <td className="smart-table-strong">{r.appeared ?? 0}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className="smart-table-strong beo-progress-total-label" style={{ textAlign: 'left' }}>Total</td>
                {targetClasses.includes(6) && (
                  <>
                    <td className="smart-table-strong">{totals.class6_strength}</td>
                    <td className="smart-table-strong">{totals.class6_registered}</td>
                  </>
                )}
                {targetClasses.includes(8) && (
                  <>
                    <td className="smart-table-strong">{totals.class8_strength}</td>
                    <td className="smart-table-strong">{totals.class8_registered}</td>
                  </>
                )}
                {targetClasses.includes(9) && (
                  <>
                    <td className="smart-table-strong">{totals.class9_strength}</td>
                    <td className="smart-table-strong">{totals.class9_registered}</td>
                  </>
                )}
                <td className="smart-table-strong">{totals.total_registration}</td>
                <td className="smart-table-strong">{totals.appeared}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="table-footer" style={{ marginTop: '0.75rem' }}>
          <span className="table-count">
            Showing <strong>{rows.length === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
            <strong>{rows.length}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              style={{ padding: '0.45rem 0.9rem' }}
            >
              Previous
            </button>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              style={{ padding: '0.45rem 0.9rem' }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
