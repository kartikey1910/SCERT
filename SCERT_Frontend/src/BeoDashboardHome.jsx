import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, buildApiUrl } from './apiClient.js';
import { useDashboard } from './DashboardContext.jsx';
import { BeoDashboardProgressReport } from './BeoDashboardProgressReport.jsx';
import { BeoNmmssSummary, BeoNmmssContact } from './BeoNmmssSummary.jsx';
import { NotificationMarquee } from './NotificationMarquee.jsx';
import { useToast } from './ToastContext.jsx';
import { downloadBeoProgressReportPdf } from './utils/beoProgressReportPdf.js';

export function BeoDashboardHome({ onNavigate }) {
  const { auth } = useAuth();
  const toast = useToast();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const { selectedScholarshipId, selectedSessionId, scholarships } = useDashboard();
  // NMMSS only: the block's school-wise table, status counts and the BEO's
  // contact details. Kept apart from `error` so a failure here never blanks
  // the rest of the dashboard.
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');

  const selectedScholarshipName = String(
    (scholarships || []).find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || ''
  );
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const [stats, setStats] = useState({
    pending: 0,
    returnedByScert: 0,
  });
  const [notifications, setNotifications] = useState([]);
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [error, setError] = useState('');

useEffect(() => {
  if (selectedScholarshipId) {
    fetchDashboardData();
  }
}, [selectedScholarshipId, selectedSessionId, isNmmssScholarship]);

  

const fetchDashboardData = async () => {
  if (!selectedScholarshipId) {
    console.warn("No scholarship selected yet, skipping dashboard fetch");
    return;
  }

  setLoading(true);
  setError('');

  try {
      const profile = await get('/api/beo/profile', { token: auth?.token });
      setProfileData(profile.profile);

      const params = new URLSearchParams();
      if (selectedScholarshipId) params.append('scholarship_id', selectedScholarshipId);
      const suffix = params.toString() ? `?${params.toString()}` : '';

      if (isNmmssScholarship) {
        // One request carries the four status counts, the school-wise table
        // and the contact details, so the two application lists the other
        // scholarships fetch just to count them are not needed.
        const [summaryResult, notifData] = await Promise.all([
          get(`/api/beo/dashboard/nmmss-summary${suffix}`, { token: auth?.token, sessionId: selectedSessionId })
            .then((data) => ({ data }), (err) => ({ err })),
          get(`/api/beo/notifications`, { token: auth?.token }).catch(() => ({ notifications: [] })),
        ]);

        setNotifications(Array.isArray(notifData?.notifications) ? notifData.notifications : []);
        if (summaryResult.err) {
          setSummary(null);
          setSummaryError(summaryResult.err.message || 'Unable to load the school-wise summary');
        } else {
          setSummary(summaryResult.data);
          setSummaryError('');
        }
        return;
      }

      setSummary(null);
      setSummaryError('');

      const [pendingData, returnedData, notifData] = await Promise.all([
        get(`/api/beo/applications/inbox${suffix}`, { token: auth?.token, sessionId: selectedSessionId }).catch(() => ({ applications: [] })),
        get(`/api/beo/applications/returned-by-scert${suffix}`, { token: auth?.token, sessionId: selectedSessionId }).catch(() => ({ applications: [] })),
        get(`/api/beo/notifications`, { token: auth?.token }).catch(() => ({ notifications: [] })),
      ]);

      setNotifications(Array.isArray(notifData?.notifications) ? notifData.notifications : []);

      setStats({
        pending: Array.isArray(pendingData?.applications) ? pendingData.applications.length : 0,
        returnedByScert: Array.isArray(returnedData?.applications) ? returnedData.applications.length : 0,
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
      <div className="beo-dashboard-home">
        <div className="loading-state">Loading dashboard...</div>
      </div>
    );
  }

  if (error && !profileData) {
    return (
      <div className="beo-dashboard-home">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  // NMMSS status cards, in the order of the dashboard sheet. Each opens the
  // tab that lists exactly those applications.
  const counts = summary?.counts || {};
  const nmmssCards = [
    { key: 'pending', label: 'Pending Applications', value: Number(counts.pending || 0), tone: 'yellow', view: 'verification-pending' },
    { key: 'returned_to_school', label: 'Applications Returned to School', value: Number(counts.returned_to_school || 0), tone: 'orange', view: 'return-to-school' },
    { key: 'submitted', label: 'Submitted Applications', value: Number(counts.submitted || 0), tone: 'green', view: 'submitted-applications' },
    // Returned by SCERT is waiting on the BEO, so this card pulses - but only
    // while there is something returned to act on.
    {
      key: 'returned_by_scert',
      label: 'Applications Returned by SCERT',
      value: Number(counts.returned_by_scert || 0),
      tone: 'violet',
      view: 'returned-by-scert',
      blink: Number(counts.returned_by_scert || 0) > 0,
    },
  ];

  return (
    <div className="beo-dashboard-home" id='beo-dashboard-home'>
      {/* Profile Header Card */}
      {/* <div className="dashboard-profile-card">
        <div className="profile-header-content">
          <h2 className="profile-title">
            BEO Dashboard — Block Education Office - {profileData?.block_name || 'N/A'}
          </h2>
          <div className="detail-parent">
          <div className="detail-item">
              <span className="detail-label">BEO</span>
              <span className="detail-value">{profileData?.beo_name || 'N/A'}</span>
            </div>
            <div className="school-info-divider school-info-divider-beo" />
            <div className="detail-item">
              <span className="detail-label">Contact</span>
              <span className="detail-value">{profileData?.contact_number || 'N/A'}</span>
            </div>
            </div>
        </div>
      </div> */}

      <NotificationMarquee notifications={notifications} onOpen={() => setShowAllNotifications(true)} />

      {isNmmssScholarship ? (
        <div className="beo-nmmss-dashboard">
          {summary && <BeoNmmssContact profile={summary.profile} />}

          {summary && (
            <div className="school-dashboard-home-stats school-dashboard-home-stats--four beo-nmmss-cards">
              {nmmssCards.map((card) => (
                // A real button, so the cards can be reached and opened from
                // the keyboard as well as clicked.
                <button
                  key={card.key}
                  type="button"
                  className={`school-dashboard-home-stat-card school-dashboard-home-stat-card--${card.tone} school-dashboard-home-stat-card--link${card.blink ? ' is-blinking' : ''}`}
                  title={
                    card.blink
                      ? `Applications returned by SCERT need your attention - open ${card.label}`
                      : `Open ${card.label}`
                  }
                  onClick={() => onNavigate?.(card.view)}
                >
                  <span className="school-dashboard-home-stat-label">{card.label}</span>
                  <span className="school-dashboard-home-stat-value">{card.value}</span>
                </button>
              ))}
            </div>
          )}

          {summaryError ? (
            <div className="error-state school-nmmss-summary-error">{summaryError}</div>
          ) : summary ? (
            <>
              <div className="beo-nmmss-toolbar">
                <h3 className="view-title">Progress Report</h3>
                <button
                  type="button"
                  className="scert-btn-secondary"
                  disabled={downloadingPdf}
                  title="Download the school-wise progress report as PDF"
                  onClick={async () => {
                    setDownloadingPdf(true);
                    try {
                      await downloadBeoProgressReportPdf({
                        token: auth?.token,
                        sessionId: selectedSessionId,
                        scholarshipId: selectedScholarshipId,
                        nmmss: true,
                      });
                    } catch (e) {
                      toast.error(toast.getErrorMessage(e, 'Failed to download PDF'));
                    } finally {
                      setDownloadingPdf(false);
                    }
                  }}
                >
                  {downloadingPdf ? 'Preparing PDF…' : 'Download PDF'}
                </button>
              </div>
              <BeoNmmssSummary summary={summary} />
            </>
          ) : null}
        </div>
      ) : (
        <div className="beo-dashboard-progress-section">
          <BeoDashboardProgressReport
            pendingCount={stats.pending}
            returnedByScertCount={stats.returnedByScert}
          />
        </div>
      )}

      {showAllNotifications && (
        <div className="modal-overlay" onClick={() => setShowAllNotifications(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h3>All Notifications</h3>
              <button className="modal-close" onClick={() => setShowAllNotifications(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="notification-modal-list">
                {notifications.map((notif) => (
                  <div key={notif.notification_id} className="notification-list-item">
                    <div className="notification-list-header">
                      <h4 className="notification-list-title">{notif.title}</h4>
                      <span className="notification-list-date">
                        {new Date(notif.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="notification-list-message" style={{ whiteSpace: 'pre-wrap' }}>{notif.message}</p>
                    {notif.pdf_url && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <a 
                          href={buildApiUrl(notif.pdf_url)} 
                          target="_blank" 
                          rel="noreferrer"
                          className="scert-btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}
                        >
                          📎 Download
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
