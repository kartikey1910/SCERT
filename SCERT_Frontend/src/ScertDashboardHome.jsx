import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { ScertDashboardProgressReport } from './ScertDashboardProgressReport.jsx';
import { ScertNmmssDashboard } from './ScertNmmssSummary.jsx';
import { useSession } from './scert.session-context.jsx';
import { HiOutlineInbox, HiOutlineCheckCircle, HiOutlineAcademicCap, HiOutlineDocumentText } from 'react-icons/hi';

export function ScertDashboardHome({ onNavigate }) {
  const { auth } = useAuth();
  const { sessionId, scholarships, selectedScholarshipId } = useSession();
  const selectedScholarshipName = String(
    (scholarships || []).find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || ''
  );
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    inbox: 0,
    approved: 0
  });
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError('');

    try {
      // Fetch profile
      const profile = await get('/api/scert/profile', { token: auth?.token });
      setProfileData(profile.profile);

      // Fetch applications for statistics
      const [inboxData, approvedData] = await Promise.all([
        get('/api/scert/applications/inbox', { token: auth?.token }).catch(() => ({ applications: [] })),
        get('/api/scert/applications/approved', { token: auth?.token }).catch(() => ({ applications: [] }))
      ]);

      const inbox = Array.isArray(inboxData.applications) ? inboxData.applications.length : 0;
      const approved = Array.isArray(approvedData.applications) ? approvedData.applications.length : 0;

      setStats({
        total: inbox + approved,
        inbox,
        approved
      });
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="scert-dashboard-home">
        <div className="loading-state">Loading dashboard...</div>
      </div>
    );
  }

  if (error && !profileData) {
    return (
      <div className="scert-dashboard-home">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  return (
    <div className="scert-dashboard-home">
      {/* Profile Header Card */}
      

      {isNmmssScholarship ? (
        <ScertNmmssDashboard
          sessionId={sessionId}
          scholarshipId={selectedScholarshipId}
          onNavigate={onNavigate}
        />
      ) : (
        <div className="scert-dashboard-progress-section">
          <ScertDashboardProgressReport />
        </div>
      )}
    </div>
  );
}
