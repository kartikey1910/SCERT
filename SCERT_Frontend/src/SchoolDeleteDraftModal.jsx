import { ModalOverlay } from './ModalOverlay.jsx';

/**
 * Confirmation before permanently deleting one of the school's draft
 * applications.
 *
 * A delete cannot be undone - the form data and every uploaded document go
 * with it - so the dialog names the exact application being removed, and
 * Cancel (not the destructive button) holds the initial focus, so a stray
 * Enter cannot delete anything.
 */
export function SchoolDeleteDraftModal({ isOpen, onClose, onConfirm, isDeleting, applicationLabel, studentName }) {
  const handleClose = () => {
    // Closing mid-request would hide the outcome of a delete already in flight.
    if (isDeleting) return;
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay isOpen={isOpen} onClose={handleClose} ariaLabel="Delete draft application">
      <div className="school-declaration-modal">
        <div className="school-declaration-header">
          <h3 className="school-declaration-title">Delete Draft Application</h3>
        </div>

        <div className="school-declaration-content">
          <div className="school-bulk-reject-info" role="alert">
            <p className="school-bulk-reject-count">
              You are about to permanently delete draft application{' '}
              <strong>{applicationLabel}</strong>
              {studentName ? (
                <>
                  {' '}for <strong>{studentName}</strong>
                </>
              ) : null}
              .
            </p>
            <p className="school-bulk-reject-note">
              Its form data and all uploaded documents will be removed. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="school-declaration-actions">
          <button
            type="button"
            className="school-declaration-cancel-btn"
            onClick={handleClose}
            disabled={isDeleting}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="scert-btn-danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Draft'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
