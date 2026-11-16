import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get } from './apiClient.js';
import { SchoolDashboardPendingList } from './SchoolDashboardPendingList.jsx';
import { SchoolNmmssSummary } from './SchoolNmmssSummary.jsx';

// Dedupes concurrent requests for the same scope (e.g. a double-invoke in
// React StrictMode) without caching the result afterward - the dashboard
// must reflect an application submitted moments ago, not a stale count from
// a TTL window.
const countsInFlightByScope = new Map();

export function SchoolDashboardHome({ onApplyNow, onNavigate, onOpenTab }) {
  const { auth } = useAuth();
  const { selectedSessionId, selectedScholarshipId, scholarships } = useDashboard();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    pending: 0,
    drafts: 0,
    returnedByBeo: 0,
    rejected: 0,
    submitted: 0,
  });
  const [error, setError] = useState('');
  // NMMSS only: the category x gender table and the school's contact details.
  // Kept apart from `error` so a failure here never blanks the status cards.
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');

  const selectedScholarshipName = String(
    scholarships.find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || ''
  );
  const isCmScholarship = /\bCM\b/i.test(selectedScholarshipName) || /CHIEF\s*MINISTER/i.test(selectedScholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedScholarshipId]);

  const fetchDashboardData = async () => {
    if (!auth?.token || !selectedSessionId || !selectedScholarshipId) {
      setLoading(false);
      setStats({ pending: 0, drafts: 0, returnedByBeo: 0, rejected: 0, submitted: 0 });
      setSummary(null);
      setSummaryError('');
      return;
    }

    let classFilter = '';
    if (isCmScholarship) classFilter = '6';
    if (isNmmssScholarship) classFilter = '8';

    setLoading(true);
    setError('');

    // Fetched alongside the counts rather than after them, and never allowed
    // to throw into the counts' error handling.
    const summaryRequest = isNmmssScholarship
      ? get(`/api/school/dashboard/nmmss-summary?scholarship_id=${selectedScholarshipId}`, {
          token: auth?.token,
          sessionId: selectedSessionId,
        }).then((data) => ({ data }), (err) => ({ err }))
      : null;

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', selectedScholarshipId);
      if (classFilter) params.append('class_filter', classFilter);
      const scopeKey = `${selectedSessionId}:${selectedScholarshipId}:${classFilter || '-'}`;

      const inFlight = countsInFlightByScope.get(scopeKey);
      const pending =
        inFlight ||
        get(`/api/school/applications/counts?${params.toString()}`, {
          token: auth?.token,
          sessionId: selectedSessionId,
        });
      if (!inFlight) {
        countsInFlightByScope.set(scopeKey, pending);
      }
      const counts = await pending;

      setStats({
        pending: Number(counts?.pending || 0),
        drafts: Number(counts?.drafts || 0),
        returnedByBeo: Number(counts?.returned_by_beo || 0),
        rejected: Number(counts?.rejected || 0),
        submitted: Number(counts?.submitted || 0),
      });

      if (summaryRequest) {
        const result = await summaryRequest;
        if (result.err) {
          setSummary(null);
          setSummaryError(result.err.message || 'Unable to load the student summary');
        } else {
          setSummary(result.data);
          setSummaryError('');
        }
      } else {
        setSummary(null);
        setSummaryError('');
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      const classFilterKey = isCmScholarship ? '6' : isNmmssScholarship ? '8' : '-';
      const scopeKey = `${selectedSessionId}:${selectedScholarshipId}:${classFilterKey}`;
      countsInFlightByScope.delete(scopeKey);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="school-dashboard-home">
        <div className="loading-state">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="school-dashboard-home">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  // NMMSS status cards, in the order and colours of the dashboard sheet.
  const nmmssCards = [
    { key: 'drafts', label: 'Draft Applications', value: stats.drafts, tone: 'orange', view: 'verification-drafts' },
    { key: 'pending', label: 'Pending Applications', value: stats.pending, tone: 'yellow', view: 'verification-pending' },
    { key: 'rejected', label: 'Rejected Applications', value: stats.rejected, tone: 'red', view: 'verification-rejected' },
    { key: 'submitted', label: 'Submitted Applications', value: stats.submitted, tone: 'green', view: 'verification-submitted' },
    // Returned applications are waiting on the school, so this card pulses -
    // but only while there is something returned to act on.
    {
      key: 'returned',
      label: 'Returned by BEO',
      value: stats.returnedByBeo,
      tone: 'violet',
      view: 'verification-returned-by-beo',
      blink: stats.returnedByBeo > 0,
    },
  ];

  if (isNmmssScholarship) {
    const profileIncomplete = Boolean(summary?.profile_incomplete);
    return (
      <div className="school-dashboard-home">
        <div className="school-dashboard-home-top-row">
          <div className="school-dashboard-home-stats school-dashboard-home-stats--five">
            {nmmssCards.map((card) => (
              // A real button, so the cards can be reached and opened from the
              // keyboard as well as clicked.
              <button
                key={card.key}
                type="button"
                className={`school-dashboard-home-stat-card school-dashboard-home-stat-card--${card.tone} school-dashboard-home-stat-card--link${card.blink ? ' is-blinking' : ''}`}
                title={
                  card.blink
                    ? `Applications returned by the BEO need your attention - open ${card.label}`
                    : `Open ${card.label}`
                }
                onClick={() => onOpenTab?.(card.view)}
              >
                <span className="school-dashboard-home-stat-label">{card.label}</span>
                <span className="school-dashboard-home-stat-value">{card.value}</span>
              </button>
            ))}
          </div>

          <div className="school-dashboard-home-actions">
            <button
              type="button"
              className={`school-dashboard-home-profile-btn${profileIncomplete ? ' is-blinking' : ''}`}
              onClick={() => onNavigate?.('profile')}
              title={
                profileIncomplete
                  ? 'Your school profile is incomplete - update it'
                  : 'View or edit your school profile'
              }
            >
              Update Profile
            </button>
            <button
              type="button"
              className="scert-btn-primary school-dashboard-home-apply-btn"
              onClick={onApplyNow}
            >
              Apply Now
            </button>
          </div>
        </div>

        {summaryError ? (
          <div className="error-state school-nmmss-summary-error">{summaryError}</div>
        ) : summary ? (
          <SchoolNmmssSummary summary={summary} />
        ) : null}

        <div className="school-dashboard-pending-section">
          <SchoolDashboardPendingList />
        </div>
      </div>
    );
  }

  return (
    <div className="school-dashboard-home">
      <div className="school-dashboard-home-top-row">
        <div className="school-dashboard-home-stats">
          <div className="school-dashboard-home-stat-card">
            <div className="school-dashboard-home-stat-label">Draft Applications</div>
            <div className="school-dashboard-home-stat-value">{stats.drafts}</div>
          </div>
          <div className="school-dashboard-home-stat-card">
            <div className="school-dashboard-home-stat-label">Pending Applications</div>
            <div className="school-dashboard-home-stat-value">{stats.pending}</div>
          </div>
          <div className="school-dashboard-home-stat-card">
            <div className="school-dashboard-home-stat-label">Returned by BEO</div>
            <div className="school-dashboard-home-stat-value">{stats.returnedByBeo}</div>
          </div>
          <div className="school-dashboard-home-stat-card" style={{ borderColor: '#fca5a5' }}>
            <div className="school-dashboard-home-stat-label" style={{ color: '#dc2626' }}>Rejected</div>
            <div className="school-dashboard-home-stat-value" style={{ color: '#dc2626' }}>{stats.rejected}</div>
          </div>
        </div>

        <button
          type="button"
          className="scert-btn-primary school-dashboard-home-apply-btn"
          onClick={onApplyNow}
        >
          Apply Now
        </button>
      </div>

      <div className="school-dashboard-pending-section">
        <SchoolDashboardPendingList />
      </div>
    </div>
  );
}
