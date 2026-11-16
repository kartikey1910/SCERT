import { useState } from 'react';
import { post } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';

export function ChangePasswordModal({ onSuccess, onError, onClose }) {
  const { auth } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!currentPassword) {
      setError('Current password is required');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await post('/api/auth/change-password', { current_password: currentPassword, new_password: newPassword }, { token: auth?.token });
      onSuccess();
    } catch (err) {
      const errorMsg = err.message || 'Failed to change password';
      setError(errorMsg);
      if (onError) onError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay auth-password-overlay" onClick={onClose}>
      <div className="modal-content auth-password-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header auth-password-header">
          <div className="auth-password-header-row">
            <div>
              <h2 className="modal-title auth-password-title">Set a New Password</h2>
              <p className="modal-subtitle auth-password-subtitle">
                For security, please create a new password before continuing.
              </p>
            </div>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="auth-password-close"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form auth-password-form" noValidate>
          <div className="form-field">
            <label className="form-label" htmlFor="currentPassword">
              Current Password
            </label>
            <div className="auth-password-input-wrap">
              <input
                id="currentPassword"
                type={showCurrentPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowCurrentPassword((v) => !v)}
                aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
              >
                {showCurrentPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="newPassword">
              New Password
            </label>
            <div className="auth-password-input-wrap">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowNewPassword((v) => !v)}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
              >
                {showNewPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="field-helper-text">Use at least 8 characters.</div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <div className="auth-password-input-wrap">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowConfirmPassword((v) => !v)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <button
            type="submit"
            className="modal-button auth-password-button"
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
