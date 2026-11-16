import { useEffect, useState } from 'react';
import { get } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';
import { ScertScholarshipDetails } from './ScertScholarshipDetails.jsx';

export function ScertScholarshipsListPage({ onCreateNew, onOpenDetails }) {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, selectedScholarshipId: topBarScholarshipId } = useSession();
  const [scholarships, setScholarships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedScholarshipId, setSelectedScholarshipId] = useState(null);

  useEffect(() => {
    const fetchScholarships = async () => {
      if (!sessionId) return; // Wait for session to be selected
      setLoading(true);
      setError('');
      try {
        const data = await get('/api/scert/scholarships', { 
          token: auth.token,
          sessionId: sessionId
        });
        setScholarships(data);
      } catch (err) {
        setError(err.message || 'Failed to load scholarships.');
        toast.error(`Failed to load scholarships: ${toast.getErrorMessage(err)}`);
      } finally {
        setLoading(false);
      }
    };
    fetchScholarships();
  }, [auth.token, sessionId]);

  // Show scholarship details if one is selected
  if (selectedScholarshipId) {
    return (
      <ScertScholarshipDetails
        scholarshipId={selectedScholarshipId}
        onBack={() => {
          setSelectedScholarshipId(null);
          // Trigger refetch by updating a dependency or calling fetchScholarships
        }}
      />
    );
  }

  return (
    <div className="scert-page">
      <div className="scert-page-header">
        <div>
          <h1 className="scert-page-title">All Scholarships</h1>
          <p className="scert-page-subtitle">
            View and manage all scholarships created in the system.
          </p>
        </div>
        <button
          className="scert-btn-violet"
          onClick={() => onCreateNew && onCreateNew()}
        >
          Create Scholarship
        </button>
      </div>

      {loading && <div className="scert-placeholder">Loading scholarships...</div>}
      {error && <div className="scert-form-error">{error}</div>}

      {!loading && !error && scholarships.length === 0 && (
        <div className="scert-placeholder">
          <p>No scholarships found. Create your first one!</p>
        </div>
      )}

      {!loading && !error && scholarships.length > 0 && (() => {
        // Filter by selected scholarship from top bar
        const filteredScholarships = topBarScholarshipId
          ? scholarships.filter(s => String(s.scholarship_id) === String(topBarScholarshipId))
          : scholarships;
        
        if (filteredScholarships.length === 0) {
          return (
            <div className="scert-placeholder">
              <p>No scholarships found for the selected scheme.</p>
            </div>
          );
        }
        
        return (
          <div className="scert-scholarships-grid">
            {filteredScholarships.map((s) => (
            <div key={s.scholarship_id} className="scert-scholarship-card">
              <div className="scert-scholarship-card-header">
                <h3 className="scert-scholarship-card-title">{s.scholarship_name}</h3>
                <span className={`scert-status-badge scert-status-${s.status.toLowerCase()}`}>
                  {s.status}
                </span>
              </div>
              <div className="scert-scholarship-card-meta">
                <span>Deadline: {new Date(s.last_date).toLocaleDateString()}</span>
                {s.exam_date && (
                  <span>Exam: {new Date(s.exam_date).toLocaleDateString()}</span>
                )}
              </div>
              <div className="scert-scholarship-card-actions">
                <button
                  className="scert-btn-link"
                  onClick={() => setSelectedScholarshipId(s.scholarship_id)}
                >
                  View Details →
                </button>
              </div>
            </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
