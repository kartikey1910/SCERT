import { useEffect, useMemo, useState } from 'react';
import { ModalOverlay } from './ModalOverlay.jsx';

const isNmmssScholarship = ({ scholarshipId, scholarshipName }) => {
  const sid = String(scholarshipId || '').trim();
  const name = String(scholarshipName || '');
  return sid === '6' || /\bNMMSS\b/i.test(name) || /\bNMMS\b/i.test(name);
};

const getNormalizedClass = (classValue, scholarshipId, scholarshipName) => {
  const sid = String(scholarshipId || '').trim();
  if (isNmmssScholarship({ scholarshipId: sid, scholarshipName })) return '8';
  const value = String(classValue ?? '').trim();
  return value === '6' || value === '9' ? value : '6';
};

const getSchoolDeclarationContent = ({ scholarshipId, scholarshipName, classValue }) => {
  const sid = String(scholarshipId || '').trim();
  const normalizedClass = getNormalizedClass(classValue, sid, scholarshipName);

  if (isNmmssScholarship({ scholarshipId: sid, scholarshipName })) {
    return {
      english:
        'I hereby declare that all the information furnished in the application(s) is true and correct as per the school records. The applicant’s/applicants’ name(s) and date of birth are as per the Aadhaar record and is/are regular student(s) of Class 8.',
      hindi:
        'मैं यह घोषणा करता/करती हूँ कि आवेदन(नों) में दी गई समस्त जानकारी विद्यालय अभिलेखों के अनुसार सत्य एवं सही है तथा आवेदक/आवेदकों का नाम एवं जन्म-तिथि आधार अभिलेख के अनुसार है/हैं तथा वे कक्षा 8 के संस्थागत छात्र/छात्राएँ हैं।',
    };
  }

  if (normalizedClass === '9') {
    return {
      english:
        'I hereby declare that all the information furnished in the application(s) is true and correct as per the school records and applicant’s/applicants’ name and date of birth are as per the Aadhaar record. The applicant(s) has/have passed Class 8 from a Government / Government-aided school of Uttarakhand state and applicant(s) is/are regular student(s) of Class 9.',
      hindi:
        'मैं यह घोषणा करता/करती हूँ कि आवेदन(नों) में दी गई समस्त जानकारी विद्यालय अभिलेखानुसार सत्य एवं सही है तथा आवेदक/आवेदकों का नाम एवं जन्म-तिथि, आधार अभिलेखानुसार है/हैं। आवेदक/आवेदकों ने कक्षा 8 की परीक्षा उत्तराखंड राज्य के राजकीय/राजकीय सहायता प्राप्त विद्यालय से उत्तीर्ण की है तथा वे कक्षा 9 के संस्थागत छात्र/छात्राएँ हैं।',
    };
  }

  return {
    english:
      'I hereby declare that all the information furnished in the application(s) is true and correct as per the school records and applicant’s/applicants’ name and date of birth are as per the Aadhaar record. The applicant(s) has/have passed Class 5 from a Government / Government-aided school of Uttarakhand state and is/are regular student(s) of Class 6.',
    hindi:
      'मैं यह घोषणा करता/करती हूँ कि आवेदन(नों) में दी गई समस्त जानकारी विद्यालय अभिलेखों के अनुसार सत्य एवं सही है तथा आवेदक/आवेदकों का नाम एवं जन्म-तिथि, आधार अभिलेख के अनुसार है/हैं। आवेदक/आवेदकों ने कक्षा 5 की परीक्षा उत्तराखंड राज्य के  राजकीय/राजकीय सहायता प्राप्त विद्यालय से उत्तीर्ण की है तथा वे कक्षा 6 के संस्थागत छात्र/छात्राएँ हैं।',
  };
};

export function SchoolDeclarationModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  scholarshipId,
  scholarshipName,
  classValue,
}) {
  const [accepted, setAccepted] = useState(false);
  const declaration = useMemo(
    () => getSchoolDeclarationContent({ scholarshipId, scholarshipName, classValue }),
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
            {isSubmitting ? 'Submitting…' : 'Submit to BEO'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
