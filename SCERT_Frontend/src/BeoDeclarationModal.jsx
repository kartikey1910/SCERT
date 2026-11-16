import { useEffect, useMemo, useState } from 'react';
import { ModalOverlay } from './ModalOverlay.jsx';

const isNmmssScholarship = (scholarshipId, scholarshipName) => {
  const sid = String(scholarshipId || '').trim();
  const sName = String(scholarshipName || '');
  return (
    sid === '6' ||
    /\bNMMSS\b/i.test(sName) ||
    /\bNMMS\b/i.test(sName) ||
    /\bSNSS\b/i.test(sName) ||
    /\bSSSS\b/i.test(sName) ||
    /\bCLASS\s*8\b/i.test(sName)
  );
};

const getNormalizedClass = (classValue, scholarshipId, scholarshipName) => {
  if (isNmmssScholarship(scholarshipId, scholarshipName)) return '8';
  const value = String(classValue ?? '').trim();
  return value === '6' || value === '9' ? value : '6';
};

const getBeoDeclarationContent = ({ scholarshipId, scholarshipName, classValue }) => {
  const normalizedClass = getNormalizedClass(classValue, scholarshipId, scholarshipName);

  if (isNmmssScholarship(scholarshipId, scholarshipName)) {
    return {
      english:
        'I hereby declare that the school is a Government / Government-aided / Local Body institution and applicant(s)is/are regular student(s) of Class 8.',
      hindi:
        'मैं यह घोषणा करता/करती हूँ कि यह विद्यालय राजकीय/राजकीय सहायता/स्थानीय निकाय का विद्यालय है तथा आवेदक  कक्षा 8 के संस्थागत छात्र/छात्राएँ हैं।',
    };
  }

  if (normalizedClass === '9') {
    return {
      english:
        'I hereby declare that all the applicant(s) has/have passed Class 8 from a Government / Government aided school of Uttarakhand state and the school in which they are currently studying is also a Government / Government-aided school.',
      hindi:
        'मैं यह घोषणा करता/करती हूँ कि सभी आवेदक/आवेदकों ने कक्षा 8 की परीक्षा उत्तराखंड राज्य के  सरकारी/सरकारी सहायता प्राप्त विद्यालयों से उत्तीर्ण की है तथा अध्ययनरत् विद्यालय राजकीय/राजकीय सहायता प्राप्त विद्यालय है।',
    };
  }

  return {
    english:
      'I hereby declare that all the applicant(s) has/have passed Class 5 from a Government / Government aided school of Uttarakhand state and the school in which they are currently studying is also a Government / Government-aided school.',
    hindi:
      'मैं यह घोषणा करता/करती हूँ कि सभी आवेदक/आवेदकों ने कक्षा 5 की परीक्षा उत्तराखंड राज्य के  सरकारी/सरकारी सहायता प्राप्त विद्यालयों से उत्तीर्ण की है। तथा अध्ययनरत् विद्यालय राजकीय/राजकीय सहायता प्राप्त विद्यालय है।',
  };
};

export function BeoDeclarationModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  scholarshipId,
  scholarshipName,
  classValue,
  submitLabel = 'Submit to SCERT',
}) {
  const [accepted, setAccepted] = useState(false);
  const declaration = useMemo(
    () => getBeoDeclarationContent({ scholarshipId, scholarshipName, classValue }),
    [scholarshipId, scholarshipName, classValue]
  );

  useEffect(() => {
    if (isOpen) setAccepted(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (accepted) {
      onSubmit();
    }
  };

  return (
    <ModalOverlay onClose={onClose} ariaLabel="Declaration">
      <div className="school-declaration-modal">
        <div className="school-declaration-header">
          <h3 className="school-declaration-title">Declaration</h3>
        </div>

        <div className="school-declaration-content">
          <p className="school-declaration-text">
            {declaration.english}
          </p>
          <p className="school-declaration-text">
            {declaration.hindi}
          </p>

          <div className="school-declaration-checkbox-wrapper">
            <label className="school-declaration-checkbox-label">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={isSubmitting}
              />
              <span>I hereby accept the above declaration and confirm that all information provided is true and accurate.</span>
            </label>
          </div>
        </div>

        <div className="school-declaration-actions">
          <button
            type="button"
            className="school-declaration-cancel-btn"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="form-submit-btn"
            onClick={handleSubmit}
            disabled={!accepted || isSubmitting}
          >
            {isSubmitting ? 'Submitting…' : submitLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
