import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, post, del } from './apiClient.js';
import { HiOutlineTrash } from 'react-icons/hi';

export function ScertNotificationsPage() {
  const { auth } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form state
  const [showForm, setShowForm] = useState(false);
  const [targetRole, setTargetRole] = useState('BEO');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get('/api/scert/notifications', { token: auth?.token });
      setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auth?.token) {
      fetchNotifications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setFormError('Title and message are required.');
      return;
    }
    setFormLoading(true);
    setFormError('');
    try {
      const formData = new FormData();
      formData.append('target_role', targetRole);
      formData.append('title', title.trim());
      formData.append('message', message.trim());
      if (pdfFile) {
        formData.append('pdf', pdfFile);
      }

      await post('/api/scert/notifications', formData, { token: auth?.token });
      
      setShowForm(false);
      setTitle('');
      setMessage('');
      setPdfFile(null);
      setTargetRole('BEO');
      fetchNotifications();
    } catch (err) {
      console.error('Failed to create notification:', err);
      setFormError(err.message || 'Failed to create notification');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this notification?')) return;
    try {
      await del(`/api/scert/notifications/${id}`, { token: auth?.token });
      fetchNotifications();
    } catch (err) {
      console.error('Failed to delete notification:', err);
      alert(err.message || 'Failed to delete notification');
    }
  };

  return (
    <div className="applications-view">
      <div className="view-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="view-title">BEO & CEO Notifications</h3>
          
        </div>
        {!showForm && (
          <button 
            className="scert-btn-primary"
            onClick={() => setShowForm(true)}
          >
            Create Notification
          </button>
        )}
      </div>

      {showForm && (
        <div className="scert-card" style={{ marginBottom: '2rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>New Notification</h4>
          {formError && <div className="error-state" style={{ marginBottom: '1rem', padding: '0.75rem' }}>{formError}</div>}
          
          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: 'var(--text-primary)' }}>Target Audience</label>
              <select 
                className="form-input" 
                value={targetRole} 
                onChange={(e) => setTargetRole(e.target.value)}
                style={{ width: '100%', maxWidth: '400px' }}
              >
                <option value="BEO">BEOs Only</option>
                <option value="DISTRICT">Districts Only</option>
                <option value="BOTH">Both BEOs and Districts</option>
              </select>
            </div>
            
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: 'var(--text-primary)' }}>Title</label>
              <input 
                type="text" 
                className="form-input" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="E.g., Action Required: Verification Deadline"
                required
                style={{ width: '100%', maxWidth: '400px' }}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: 'var(--text-primary)' }}>Message</label>
              <textarea 
                className="form-input" 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your notification message here. Be concise and clear."
                rows={5}
                required
                style={{ width: '100%', maxWidth: '600px', resize: 'vertical' }}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: 'var(--text-primary)' }}>Attach PDF (Optional)</label>
              <input 
                type="file" 
                accept="application/pdf"
                className="form-input" 
                onChange={(e) => setPdfFile(e.target.files[0] || null)}
                style={{ width: '100%', maxWidth: '400px' }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                type="submit" 
                className="scert-btn-primary"
                disabled={formLoading}
              >
                {formLoading ? 'Publishing...' : 'Publish Notification'}
              </button>
              <button 
                type="button" 
                className="scert-btn-secondary"
                onClick={() => {
                  setShowForm(false);
                  setFormError('');
                }}
                disabled={formLoading}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading && notifications.length === 0 ? (
        <div className="loading-state">Loading notifications...</div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">No notifications published yet.</div>
      ) : (
        <div className="smart-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', width: '150px' }}>Date</th>
                <th style={{ textAlign: 'left', width: '120px' }}>Target</th>
                <th style={{ textAlign: 'left', width: '250px' }}>Title</th>
                <th style={{ textAlign: 'left' }}>Message</th>
                <th style={{ textAlign: 'left', width: '100px' }}>Status</th>
                <th style={{ textAlign: 'center', width: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((notif) => (
                <tr key={notif.notification_id}>
                  <td style={{ textAlign: 'left' }}>
                    {new Date(notif.created_at).toLocaleDateString()} {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <span className="scert-badge" style={{ 
                      backgroundColor: notif.target_role === 'BEO' ? 'var(--info-light)' : notif.target_role === 'DISTRICT' ? 'var(--warning-light)' : 'var(--primary-light)',
                      color: notif.target_role === 'BEO' ? 'var(--info)' : notif.target_role === 'DISTRICT' ? 'var(--warning)' : 'var(--primary)'
                    }}>
                      {notif.target_role}
                    </span>
                  </td>
                  <td style={{ textAlign: 'left', fontWeight: '500' }}>
                    {notif.title}
                    {notif.pdf_url && (
                      <span title="Contains Attachment" style={{ marginLeft: '0.5rem' }}>📎</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>{notif.message}</td>
                  <td style={{ textAlign: 'left' }}>
                    {notif.is_active ? (
                      <span className="scert-badge" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>Active</span>
                    ) : (
                      <span className="scert-badge" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>Deleted</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {notif.is_active && (
                      <button 
                        className="scert-btn-secondary" 
                        style={{ padding: '0.25rem 0.5rem', color: 'var(--error)' }}
                        onClick={() => handleDelete(notif.notification_id)}
                        title="Delete Notification"
                      >
                        <HiOutlineTrash size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
