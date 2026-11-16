import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { ScertApplicationViewer } from './scert.application-viewer.jsx';
import { HiOutlineEye } from 'react-icons/hi';
import { useSession } from './scert.session-context.jsx';

export function ScertReturnedToBeoPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, selectedScholarshipId } = useSession();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewingApplicationId, setViewingApplicationId] = useState(null);

  const fetchApplications = async () => {
    if (!sessionId) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      params.append('status', 'RETURNED');
      params.append('current_stage', 'BEO');

      const data = await get(`/api/scert/applications/inbox?${params.toString()}`, {
        token: auth.token,
        sessionId,
      });

      setApplications(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      console.error('Failed to fetch returned applications:', err);
      setError(err.message || 'Failed to load returned applications');
      toast.error(`Failed to load returned applications: ${toast.getErrorMessage(err)}`);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedScholarshipId]);

  if (viewingApplicationId) {
    return (
      <ScertApplicationViewer
        applicationId={viewingApplicationId}
        onBack={() => {
          setViewingApplicationId(null);
          fetchApplications();
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="scert-page">
        <div className="loading-state">Loading returned applications...</div>
      </div>
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Returned to BEO</h3>
              
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

      {error ? (
        <div className="error-state">{error}</div>
      ) : applications.length === 0 ? (
        <div className="empty-state">No applications returned to BEO for the selected criteria.</div>
      ) : (
        <div className="smart-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th>Application ID</th>
                <th>Student Name</th>
                <th>School Name</th>
                <th>UDISE Code</th>
                <th>Status</th>
                <th>Submitted At</th>
                <th style={{ width: 90 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                  <td>
                    <code className="smart-table-id">{window.getDisplayApplicationId(app)}</code>
                  </td>
                  <td>{app.student_name || '—'}</td>
                  <td>{app.school_name || '—'}</td>
                  <td>{app.udise_code || '—'}</td>
                  <td>
                    <span className={`status-pill status-${String(app.status || '').toLowerCase()}`}>
                      {app.status || '—'}
                    </span>
                  </td>
                  <td>{app.submitted_at ? new Date(app.submitted_at).toLocaleString() : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-action-btn"
                      title="View"
                      onClick={() => setViewingApplicationId(app.application_id)}
                    >
                      <HiOutlineEye />
                    </button>
                  </td>
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
    </div>
  );
}
