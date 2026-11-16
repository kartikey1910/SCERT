import { useState } from 'react';
import { ModalOverlay } from './ModalOverlay.jsx';

export function BeoBulkReturnModal({ isOpen, onClose, onSubmit, selectedCount, isSubmitting }) {
  const [remarkText, setRemarkText] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (remarkText.trim()) {
      onSubmit(remarkText.trim());
      setRemarkText('');
    }
  };

  const handleClose = () => {
    setRemarkText('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay isOpen={isOpen} onClose={handleClose}>
      <div className="school-declaration-modal">
        <div className="school-declaration-header">
          <h3 className="school-declaration-title">Return Applications to School</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="school-declaration-content">
            <div className="beo-bulk-return-info">
              <p className="beo-bulk-return-count">
                You are about to return <strong>{selectedCount}</strong> application{selectedCount !== 1 ? 's' : ''} to their respective schools.
              </p>
              <p className="beo-bulk-return-note">
                Please provide a remark explaining why these applications are being returned.
              </p>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="bulk-remark">
                Remarks <span className="required">*</span>
              </label>
              <textarea
                id="bulk-remark"
                className="form-input"
                rows={4}
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                placeholder="Enter remarks for returning these applications..."
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
              disabled={isSubmitting || !remarkText.trim()}
            >
              {isSubmitting ? 'Returning...' : `Return ${selectedCount} Application${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}
