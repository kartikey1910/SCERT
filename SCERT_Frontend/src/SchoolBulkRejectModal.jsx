import { useState } from 'react';
import { ModalOverlay } from './ModalOverlay.jsx';

/**
 * Confirmation + reason for permanently rejecting the selected pending
 * applications.
 *
 * Rejecting locks an application and the student cannot resubmit, so this
 * asks for a written reason (it is what the school later sees under
 * Rejected Applications) and the confirm button is only live once one is
 * typed. It follows BeoBulkReturnModal's structure and shared modal classes
 * so it looks and behaves like the app's other dialogs.
 */
export function SchoolBulkRejectModal({ isOpen, onClose, onSubmit, selectedCount, isSubmitting }) {
  const [reasonText, setReasonText] = useState('');

  const reset = () => setReasonText('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const reason = reasonText.trim();
    if (!reason || isSubmitting) return;
    onSubmit(reason);
  };

  const handleClose = () => {
    // Closing mid-request would hide the progress of an action that is
    // already being applied.
    if (isSubmitting) return;
    reset();
    onClose();
  };

  if (!isOpen) return null;

  const plural = selectedCount !== 1 ? 's' : '';

  return (
    <ModalOverlay isOpen={isOpen} onClose={handleClose} ariaLabel="Reject applications">
      <div className="school-declaration-modal">
        <div className="school-declaration-header">
          <h3 className="school-declaration-title">Reject Application{plural}</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="school-declaration-content">
            <div className="school-bulk-reject-info" role="alert">
              <p className="school-bulk-reject-count">
                You are about to permanently reject <strong>{selectedCount}</strong> application{plural}.
              </p>
              <p className="school-bulk-reject-note">
                {selectedCount !== 1 ? 'They' : 'It'} will be locked and the student{plural} will not
                be able to resubmit. This cannot be undone from this screen.
              </p>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="bulk-reject-reason">
                Reason for rejection <span className="required">*</span>
              </label>
              <textarea
                id="bulk-reject-reason"
                className="form-input"
                rows={4}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Enter the reason for rejecting these applications..."
                disabled={isSubmitting}
                required
                autoFocus
              />
            </div>
          </div>

          <div className="school-declaration-actions">
            <button
              type="button"
              className="school-declaration-cancel-btn"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="scert-btn-danger"
              disabled={isSubmitting || !reasonText.trim()}
            >
              {isSubmitting ? 'Rejecting...' : `Reject ${selectedCount} Application${plural}`}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}
