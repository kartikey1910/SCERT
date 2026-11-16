import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, put } from './apiClient.js';
import { getStudentAccessAdmin, setStudentAccessAdmin } from './api/studentAccess.api.js';
import { HiOutlineAcademicCap, HiOutlineLockClosed, HiOutlineLockOpen, HiOutlineDocumentText, HiOutlineClipboardCheck, HiOutlineOfficeBuilding, HiOutlineMap, HiOutlinePencil } from 'react-icons/hi';

export function ScertFeatureLocksPage({ selectedSessionId }) {
  const { auth } = useAuth();
  
  const [locks, setLocks] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(null);

  // Student Access: the switch for the whole student side (sign up, sign in,
  // every student request). It always belongs to the ACTIVE session.
  const [studentAccess, setStudentAccess] = useState(null); // { enabled, session_id, session_name }
  const [studentAccessError, setStudentAccessError] = useState('');
  const [studentAccessSaving, setStudentAccessSaving] = useState(false);

  const features = [
    { key: 'UPLOAD_ABSENTEE', label: 'Upload Absentee after exam', icon: HiOutlineDocumentText, desc: 'Allow BEOs to upload absentee lists post-examination.' },
    { key: 'UPLOAD_ABSENTEE_DURING_EXAM', label: 'Upload Absentee during exam', icon: HiOutlineDocumentText, desc: 'Allow BEOs to upload absentee lists during the examination.' },
    { key: 'UPLOAD_CS_REPORT', label: 'Upload Center Superintendent Report', icon: HiOutlineClipboardCheck, desc: 'Allow BEOs to submit the superintendent reports for their centers.' },
    { key: 'CREATE_CENTER', label: 'Create Center', icon: HiOutlineOfficeBuilding, desc: 'Allow BEOs to define new examination centers.' },
    { key: 'ALLOCATE_CENTERS', label: 'Allocate Centers', icon: HiOutlineMap, desc: 'Enable assignment of schools/students to specific centers.' },
    { key: 'EDIT_APPROVED_APPLICATIONS', label: 'Edit Approved Applications', icon: HiOutlinePencil, desc: 'Allow BEOs to edit and upload documents for applications that have already been approved.' }
  ];

  const fetchLocks = async () => {
    if (!selectedSessionId) return;
    
    setLoading(true);
    setError('');
    try {
      const data = await get(`/api/scert/feature-locks?session_id=${selectedSessionId}`, { token: auth?.token });
      setLocks(data.locks || {});
    } catch (err) {
      console.error('Failed to fetch locks:', err);
      setError(err.message || 'Failed to load feature locks');
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentAccess = async () => {
    setStudentAccessError('');
    try {
      setStudentAccess(await getStudentAccessAdmin(auth?.token));
    } catch (err) {
      console.error('Failed to fetch student access:', err);
      setStudentAccessError(err.message || 'Failed to load student access');
    }
  };

  useEffect(() => {
    if (auth?.token) fetchStudentAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  // Changes are accepted only while the session selected at the top is the active one.
  const viewingActiveSession =
    studentAccess?.session_id != null && String(studentAccess.session_id) === String(selectedSessionId);

  const handleStudentAccessToggle = async () => {
    if (!studentAccess || studentAccessSaving) return;
    setStudentAccessSaving(true);
    setStudentAccessError('');
    try {
      const next = await setStudentAccessAdmin(!studentAccess.enabled, {
        token: auth?.token,
        sessionId: selectedSessionId,
      });
      setStudentAccess({
        enabled: next.enabled,
        session_id: next.session_id,
        session_name: next.session_name,
      });
    } catch (err) {
      console.error('Failed to update student access:', err);
      setStudentAccessError(err.message || 'Failed to update student access');
    } finally {
      setStudentAccessSaving(false);
    }
  };

  useEffect(() => {
    if (auth?.token && selectedSessionId) {
      fetchLocks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token, selectedSessionId]);

  const handleToggle = async (featureKey, currentStatus) => {
    setToggling(featureKey);
    try {
      await put('/api/scert/feature-locks', {
        session_id: selectedSessionId,
        feature_name: featureKey,
        is_locked: !currentStatus // Toggle it
      }, { token: auth?.token });
      
      // Update local state directly to feel instant
      setLocks(prev => ({
        ...prev,
        [featureKey]: !currentStatus
      }));
    } catch (err) {
      console.error('Failed to toggle lock:', err);
      alert(err.message || 'Failed to update feature lock');
    } finally {
      setToggling(null);
    }
  };

  if (!selectedSessionId) {
    return <div className="loading-state">Please select a session from the top bar first.</div>;
  }

  return (
    <div className="applications-view scert-feature-locks-page">
      <div className="view-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="view-title">Feature Locks</h3>
          <p className="view-subtitle">Manage student access, and feature access for BEOs in the currently selected session.</p>
        </div>
      </div>

      <div className="scert-card" style={{ marginTop: '1.5rem', padding: '0' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--primary)', fontSize: '1.25rem' }}><HiOutlineAcademicCap /></span>
            Student Access
          </h4>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Turns the whole student side on or off for the active session
            {studentAccess?.session_name ? ` (${studentAccess.session_name})` : ''}.
          </p>
        </div>

        <div style={{ padding: '1.5rem', background: '#f8fafc', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
          {studentAccessError ? <div className="error-state" style={{ marginBottom: '1rem' }}>{studentAccessError}</div> : null}

          {!studentAccess ? (
            studentAccessError ? null : <div className="loading-state">Loading student access...</div>
          ) : (
            <div
              className="feature-lock-row"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap',
                padding: '1.25rem 1.5rem',
                background: 'white',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <div>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.25rem', fontSize: '1.05rem' }}>
                  Student login and registration
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', maxWidth: '46rem' }}>
                  {studentAccess.enabled
                    ? 'ON: the Student Login button shows on the home page, and students can register, sign in and apply.'
                    : 'OFF: the Student Login button is hidden, no one can register or sign in, and students already signed in are locked out.'}
                </div>
                {!viewingActiveSession ? (
                  <div style={{ fontSize: '0.8rem', color: '#b45309', marginTop: '0.5rem' }}>
                    To change this, select the active session ({studentAccess.session_name || studentAccess.session_id}) at the top.
                  </div>
                ) : null}
              </div>

              <div className="toggle-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {studentAccessSaving && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Saving...</span>}
                <button
                  type="button"
                  role="switch"
                  aria-checked={studentAccess.enabled}
                  aria-label="Student access"
                  disabled={studentAccessSaving || !viewingActiveSession}
                  onClick={handleStudentAccessToggle}
                  title={viewingActiveSession ? undefined : 'Select the active session at the top to change this'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: studentAccessSaving || !viewingActiveSession ? 'not-allowed' : 'pointer',
                    opacity: studentAccessSaving || !viewingActiveSession ? 0.6 : 1,
                  }}
                >
                  <span style={{ fontSize: '0.875rem', fontWeight: '600', color: studentAccess.enabled ? 'var(--success)' : 'var(--text-secondary)' }}>
                    {studentAccess.enabled ? 'On' : 'Off'}
                  </span>
                  <span
                    style={{
                      width: '52px',
                      height: '30px',
                      background: studentAccess.enabled ? 'var(--success)' : '#e2e8f0',
                      borderRadius: '30px',
                      position: 'relative',
                      transition: 'background 0.3s ease',
                      boxShadow: studentAccess.enabled ? '0 2px 8px rgba(16, 185, 129, 0.4)' : 'inset 0 2px 4px rgba(0,0,0,0.1)',
                      display: 'inline-block',
                    }}
                  >
                    <span
                      style={{
                        width: '26px',
                        height: '26px',
                        background: 'white',
                        borderRadius: '50%',
                        position: 'absolute',
                        top: '2px',
                        left: studentAccess.enabled ? '24px' : '2px',
                        transition: 'left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                      }}
                    />
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="scert-card" style={{ marginTop: '1.5rem', padding: '0' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--primary)', fontSize: '1.25rem' }}>🔒</span> 
            BEO Session Access Controls
          </h4>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            These toggles globally affect all BEOs. If the selected session is a past session, BEOs will see it as locked regardless of this setting.
          </p>
        </div>

        {error ? (
          <div className="error-state" style={{ margin: '1.5rem' }}>{error}</div>
        ) : loading ? (
          <div className="loading-state" style={{ margin: '2rem' }}>Loading access controls...</div>
        ) : (
          <div className="feature-locks-list" style={{ padding: '1.5rem', background: '#f8fafc', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
            {features.map((feature) => {
              const isLocked = locks[feature.key] === true;
              return (
                <div 
                  key={feature.key} 
                  className="feature-lock-row" 
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '1.25rem 1.5rem',
                    marginBottom: '1rem',
                    background: 'white',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                    e.currentTarget.style.borderColor = 'var(--primary-light)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      background: isLocked ? 'var(--bg-secondary)' : 'var(--primary-light)',
                      color: isLocked ? 'var(--text-secondary)' : 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem',
                      transition: 'all 0.3s ease'
                    }}>
                      <feature.icon />
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.25rem', fontSize: '1.05rem' }}>
                        {feature.label}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        {feature.desc}
                      </div>
                    </div>
                  </div>
                  
                  <div className="toggle-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {toggling === feature.key && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', animation: 'pulse 1.5s infinite' }}>Saving...</span>}
                    
                    <div 
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: toggling ? 'not-allowed' : 'pointer', opacity: toggling ? 0.7 : 1 }}
                      onClick={() => !toggling && handleToggle(feature.key, isLocked)}
                    >
                      <span style={{ 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: isLocked ? 'var(--text-secondary)' : 'var(--success)',
                        transition: 'color 0.3s ease'
                      }}>
                        {isLocked ? 'Locked' : 'Unlocked'}
                      </span>
                      
                      <div style={{
                        width: '52px',
                        height: '30px',
                        background: isLocked ? '#e2e8f0' : 'var(--success)',
                        borderRadius: '30px',
                        position: 'relative',
                        transition: 'background 0.3s ease, box-shadow 0.3s ease',
                        boxShadow: isLocked ? 'inset 0 2px 4px rgba(0,0,0,0.1)' : '0 2px 8px rgba(16, 185, 129, 0.4)'
                      }}>
                        <div style={{
                          width: '26px',
                          height: '26px',
                          background: 'white',
                          borderRadius: '50%',
                          position: 'absolute',
                          top: '2px',
                          left: isLocked ? '2px' : '24px',
                          transition: 'left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
