import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

export function BeoListOfCenters() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedScholarshipId, scholarships } = useDashboard();
  
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCenters = async () => {
    if (!selectedScholarshipId) return;
    
    setLoading(true);
    setError('');
    
    try {
      const data = await get(
        `/api/beo/centers?scholarship_id=${selectedScholarshipId}`,
        { token: auth?.token }
      );
      
      setCenters(Array.isArray(data.centers) ? data.centers : []);
    } catch (err) {
      console.error('Failed to fetch centers:', err);
      setError(err.message || 'Failed to load centers');
      toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
      setCenters([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCenters();
  }, [selectedScholarshipId]);

  const handleRefresh = () => {
    fetchCenters();
  };

  const handleDownloadPDF = () => {
    if (centers.length === 0) {
      toast.error('No centers to download');
      return;
    }

    const currentScholarship = scholarships.find(
      (s) => s.scholarship_id === selectedScholarshipId
    );

    // Create table HTML
    let tableHTML = `
      <html>
        <head>
          <title>List of Centers Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h2 { text-align: center; margin-bottom: 10px; }
            .info { text-align: center; margin-bottom: 20px; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #000; padding: 8px 6px; text-align: left; }
            th { background-color: #f0f0f0; font-weight: bold; }
            .footer { margin-top: 20px; text-align: right; font-size: 12px; }
          </style>
        </head>
        <body>
          <h2>List of Examination Centers</h2>
          <div class="info">
            <strong>Scholarship:</strong> ${currentScholarship?.scholarship_name || 'N/A'}<br/>
            <strong>Generated:</strong> ${new Date().toLocaleString()}
          </div>
          <table>
            <thead>
              <tr>
                <th>Center ID</th>
                <th>Center Order</th>
                <th>School Name</th>
                <th>UDISE Code</th>
                <th>Superintendent Name</th>
                <th>Superintendent Mobile</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
    `;

    centers.forEach((center) => {
      tableHTML += `
        <tr>
          <td>${center.center_id}</td>
          <td><strong>${center.center_order || '—'}</strong></td>
          <td>${center.school_name || '—'}</td>
          <td>${center.udise_code || '—'}</td>
          <td>${center.superintendent_name || '—'}</td>
          <td>${center.superintendent_mobile || '—'}</td>
          <td>Active</td>
        </tr>
      `;
    });

    tableHTML += `
            </tbody>
          </table>
          <div class="footer">
            <strong>Total Centers:</strong> ${centers.length}
          </div>
        </body>
      </html>
    `;

    // Open print dialog
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(tableHTML);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    } else {
      toast.error('Please allow pop-ups to download PDF');
    }
  };

  const currentScholarship = scholarships.find(s => s.scholarship_id === selectedScholarshipId);

  if (!selectedScholarshipId) {
    return (
      <div className="applications-view">
        <div className="empty-state">
          <h3>Please select a scholarship</h3>
          <p>Use the scholarship dropdown above to view centers for a specific scholarship.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="applications-view">
        <div className="loading-state">Loading centers...</div>
      </div>
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">List of Centers</h3>
              
            </div>
          <p className="view-subtitle">
            Exam centers available in your block for {currentScholarship?.scholarship_name || 'selected scholarship'}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="scert-btn-primary"
            onClick={handleDownloadPDF}
            disabled={loading || centers.length === 0}
          >
            Download PDF
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : centers.length === 0 ? (
        <div className="empty-state">
          No centers have been created for this scholarship in your block yet.
        </div>
      ) : (
        <>
          <div className="smart-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th>Center ID</th>
                  <th>Center Order</th>
                  <th>School Name</th>
                  <th>UDISE Code</th>
                  <th>Superintendent Name</th>
                  <th>Superintendent Mobile</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((center) => (
                  <tr key={center.center_id} className={window.getSubmissionRoleRowClass(center)}>
                    <td>
                      <code className="smart-table-id">#{center.center_id}</code>
                    </td>
                    <td className="smart-table-strong">
                      {center.center_order || '—'}
                    </td>
                    <td>{center.school_name || '—'}</td>
                    <td>{center.udise_code || '—'}</td>
                    <td>{center.superintendent_name || '—'}</td>
                    <td>{center.superintendent_mobile || '—'}</td>
                    <td>
                      <span className="status-pill status-approved">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{centers.length}</strong> center(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
