import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { buildApiUrl, get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

export function BeoAdmitCardsPage({ onNavigate }) {
  const { auth } = useAuth();
  const { selectedScholarshipId, selectedSessionId, scholarships } = useDashboard();
  const toast = useToast();

  const selectedScholarshipName = String(
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );
  const showClassFilter = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [classFilter, setClassFilter] = useState('6');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalApplications, setTotalApplications] = useState(0);
  const limit = 20;

  useEffect(() => {
    fetchApprovedApplications();
  }, [selectedScholarshipId, classFilter, currentPage]);

  useEffect(() => {
    setClassFilter(showClassFilter ? '6' : '');
    setCurrentPage(1);
  }, [showClassFilter, selectedScholarshipId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setCurrentPage(1);
  }, [classFilter]);

  const fetchApprovedApplications = async () => {
    if (!selectedScholarshipId) return;
    
    setLoading(true);
    setError('');
    
    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);
      params.append('page', currentPage);
      params.append('limit', limit);
      
      const data = await get(`/api/beo/applications/approved?${params.toString()}`, {
        token: auth.token,
        sessionId: selectedSessionId,
      });
      
      const apps = Array.isArray(data.applications) ? data.applications : [];
      setApplications(apps);
      setTotalApplications(data.total || 0);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to fetch applications:', err);
      setError(err.message || 'Failed to load applications');
      toast.error(`Failed to load applications: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const currentApplications = applications;
  const totalPages = Math.max(1, Math.ceil(totalApplications / limit));

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(currentApplications.map((app) => app.application_id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (appId, checked) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(appId);
    } else {
      newSet.delete(appId);
    }
    setSelectedIds(newSet);
  };

  const handleDownloadSingle = async (applicationId) => {
    const url = buildApiUrl(`/api/admit-cards/${applicationId}/download`);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: 'application/pdf',
        },
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let message = `Failed to download admit card (HTTP ${response.status})`;
        try {
          if (contentType.includes('application/json')) {
            const json = await response.json();
            message = json?.message || message;
          } else {
            const text = await response.text();
            if (text) message = text;
          }
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const blobType = String(blob.type || response.headers.get('content-type') || '').toLowerCase();

      if (!blobType.includes('pdf') && !blobType.includes('octet-stream')) {
        throw new Error('Server did not return a PDF file');
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.target = '_blank';
      link.download = `admit_card_${applicationId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30000);
    } catch (err) {
      console.error('Download failed:', err);
      toast.error(toast.getErrorMessage(err, 'Failed to download admit card'));
    }
  };

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) {
      toast.warning('Please select at least one application');
      return;
    }

    const selectedApps = currentApplications.filter(app => selectedIds.has(app.application_id));
    
    for (const app of selectedApps) {
      await new Promise(resolve => setTimeout(resolve, 500));
      handleDownloadSingle(app.application_id);
    }
  };

  if (loading) {
    return (
      <div className="beo-content-area">
        <div className="loading-state">Loading admit cards...</div>
      </div>
    );
  }

  return (
    <div className="beo-content-area">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">Admit Cards</h3>
              
            </div>
        </div>
        <button
          type="button"
          className="scert-btn-primary"
          onClick={handleBulkDownload}
          disabled={selectedIds.size === 0}
        >
          Bulk Download ({selectedIds.size})
        </button>
      </div>

      {showClassFilter ? (
        <div className="filters-bar">
          <div className="filter-group">
            <label className="filter-label">Class</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                onClick={() => setClassFilter('6')}
              >
                Class 6
              </button>
              <button
                type="button"
                className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                onClick={() => setClassFilter('9')}
              >
                Class 9
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="error-state">{error}</div>
      ) : currentApplications.length === 0 ? (
        <div className="empty-state">
          No approved applications with admit cards available in your block.
        </div>
      ) : (
        <>
          <div className="smart-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === currentApplications.length && currentApplications.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th>Application ID</th>
                  <th>Roll Number</th>
                  <th>Class</th>
                  <th>Student Name</th>
                  <th>School</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentApplications.map((app) => (
                  <tr key={app.application_id} className={window.getSubmissionRoleRowClass(app)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(app.application_id)}
                        onChange={(e) => handleSelectOne(app.application_id, e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td className="smart-table-strong">{window.getDisplayApplicationId(app)}</td>
                    <td>{app.roll_number || '—'}</td>
                    <td>{app.class || '—'}</td>
                    <td>{app.student_name || '—'}</td>
                    <td>{app.school_name || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="scert-btn-secondary"
                        onClick={() => handleDownloadSingle(app.application_id)}
                        style={{ 
                          padding: '0.4rem 0.75rem', 
                          fontSize: '0.85rem',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="table-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="table-count">
              Total: <strong>{totalApplications}</strong> application(s)
            </span>
            <div className="pagination-controls" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                className="scert-btn-secondary"
                disabled={currentPage === 1 || loading}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem' }}>Page {currentPage} of {totalPages}</span>
              <button
                type="button"
                className="scert-btn-secondary"
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
