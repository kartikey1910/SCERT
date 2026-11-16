import { useState } from 'react';
import { ModalOverlay } from './ModalOverlay.jsx';

const normalizePhone = (value) => String(value || '').replace(/\D+/g, '');

/**
 * Popup for correcting a created exam center's superintendent name and mobile.
 *
 * Only those two details can be changed - the school, its order and its
 * applications are shown for reference and stay as they are. The form starts
 * from the center's current details (mount it fresh per center, keyed by
 * center id) and Save is live only when both are valid and something changed.
 */
export function BeoEditCenterModal({ center, onClose, onSave, isSaving }) {
  const [name, setName] = useState(center?.superintendent_name || '');
  const [mobile, setMobile] = useState(normalizePhone(center?.superintendent_mobile));

  const trimmedName = name.trim().replace(/\s+/g, ' ');
  const nameOk = trimmedName.length > 0;
  const mobileOk = mobile.length === 10;
  const changed =
    trimmedName !== String(center?.superintendent_name || '').trim() ||
    mobile !== normalizePhone(center?.superintendent_mobile);

  const handleClose = () => {
    // Closing mid-request would hide whether the change was saved.
    if (isSaving) return;
    onClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nameOk || !mobileOk || !changed || isSaving) return;
    onSave({ superintendent_name: trimmedName, superintendent_mobile: mobile });
  };

  return (
    <ModalOverlay isOpen onClose={handleClose} ariaLabel="Edit center superintendent">
      <div className="school-declaration-modal">
        <div className="school-declaration-header">
          <h3 className="school-declaration-title">Edit Superintendent Details</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="school-declaration-content">
            <div className="beo-edit-center-info">
              <p className="beo-edit-center-school">
                Center {center?.center_order ?? '-'} - <strong>{center?.school_name || '-'}</strong>
                {center?.udise_code ? ` (${center.udise_code})` : ''}
              </p>
              <p className="beo-edit-center-note">
                Only the superintendent&apos;s name and mobile number can be changed here.
              </p>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="edit-center-sup-name">
                Superintendent Name <span className="required">*</span>
              </label>
              <input
                id="edit-center-sup-name"
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase())}
                placeholder="Enter superintendent name"
                maxLength={150}
                disabled={isSaving}
                autoFocus
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="edit-center-sup-mobile">
                Superintendent Mobile <span className="required">*</span>
              </label>
              <input
                id="edit-center-sup-mobile"
                type="tel"
                className="form-input"
                value={mobile}
                onChange={(e) => setMobile(normalizePhone(e.target.value).slice(0, 10))}
                placeholder="10-digit mobile number"
                inputMode="numeric"
                maxLength={10}
                disabled={isSaving}
              />
              {mobile.length > 0 && !mobileOk ? (
                <div className="field-hint">Enter a valid 10-digit mobile number.</div>
              ) : null}
            </div>
          </div>

          <div className="school-declaration-actions">
            <button
              type="button"
              className="school-declaration-cancel-btn"
              onClick={handleClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="scert-btn-primary"
              disabled={isSaving || !nameOk || !mobileOk || !changed}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
}
