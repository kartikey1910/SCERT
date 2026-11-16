import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { get, buildApiUrl } from './apiClient.js'
import {
  HiOutlineChartBar,
  HiOutlineCheckCircle,
  HiOutlineDocumentText,
  HiOutlineViewGrid,
} from 'react-icons/hi'
import { DistrictDashboardProgressReport } from './DistrictDashboardProgressReport.jsx'
import { ScertNmmssDashboard } from './ScertNmmssSummary.jsx'
import { NotificationMarquee } from './NotificationMarquee.jsx'
import { districtNmmssCards } from './utils/districtNmmssCards.js'

export function DistrictDashboardHome({ districtProfile, sessionId, selectedScholarshipId, selectedScholarshipName = '', onNavigate }) {
  const isNmmssScholarship = /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName)
  const { auth } = useAuth()
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const [showAllNotifications, setShowAllNotifications] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState({ totalBlocks: 0, approved: 0, pending: 0 })

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true)
      setError('')

      try {
        if (!auth?.token || !sessionId || !selectedScholarshipId) {
          setStats({ totalBlocks: 0, approved: 0 })
          return
        }

        const [blocksData, approvedData, pendingData, notifData] = await Promise.all([
          get(
            `/api/district/progress-reports/registration/blocks?scholarship_id=${encodeURIComponent(
              selectedScholarshipId
            )}`,
            { token: auth.token, sessionId }
          ).catch(() => ({ rows: [] })),
          get(
            `/api/district/applications/approved?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
            { token: auth.token, sessionId }
          ).catch(() => ({ total: 0, applications: [] })),
          get(
            `/api/district/applications/submitted-summary?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
            { token: auth.token, sessionId }
          ).catch(() => ({ blocks: [] })),
          get(`/api/district/notifications`, { token: auth.token }).catch(() => ({ notifications: [] }))
        ])

        const totalBlocks = Array.isArray(blocksData?.rows) ? blocksData.rows.length : 0
        const approved =
          typeof approvedData?.total === 'number'
            ? approvedData.total
            : Array.isArray(approvedData?.applications)
              ? approvedData.applications.length
              : 0
        // "Pending" = applications the BEO has forwarded that are still
        // awaiting SCERT's decision (current_stage = SCERT, status = SUBMITTED).
        const pending = Array.isArray(pendingData?.blocks)
          ? pendingData.blocks.reduce((sum, b) => sum + Number(b.submitted_count || 0), 0)
          : 0

        setStats({ totalBlocks, approved, pending })
        setNotifications(Array.isArray(notifData?.notifications) ? notifData.notifications : [])
      } catch (err) {
        console.error('Failed to fetch district dashboard stats:', err)
        setError(err.message || 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [auth?.token, sessionId, selectedScholarshipId])

  if (loading) {
    return (
      <div className="scert-dashboard-home">
        <div className="loading-state">Loading dashboard...</div>
      </div>
    )
  }

  if (error && !districtProfile) {
    return (
      <div className="scert-dashboard-home">
        <div className="error-state">{error}</div>
      </div>
    )
  }

  return (
    <div className="scert-dashboard-home district-dashboard-home">
      <NotificationMarquee notifications={notifications} onOpen={() => setShowAllNotifications(true)} />

      {isNmmssScholarship ? (
        <ScertNmmssDashboard
          sessionId={sessionId}
          scholarshipId={selectedScholarshipId}
          onNavigate={onNavigate}
          endpoint="/api/district/dashboard/nmmss-summary"
          rootLevel="block"
          buildCards={districtNmmssCards}
          boldCounts
          pdfEndpoint="/api/district/dashboard/nmmss-summary.pdf"
        />
      ) : (
        <DistrictDashboardProgressReport
          sessionId={sessionId}
          selectedScholarshipId={selectedScholarshipId}
          pendingCount={stats.pending}
        />
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
  )
}
