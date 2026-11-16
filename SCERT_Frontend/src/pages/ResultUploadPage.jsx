import { useCallback, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import { RESULT_UPLOAD_TYPES } from '../api/result.api.js';
import { ResultFileUpload } from '../components/result/ResultFileUpload.jsx';
import { UploadErrorsPanel } from '../components/result/UploadErrorsPanel.jsx';
import { UploadHistoryTable } from '../components/result/UploadHistoryTable.jsx';
import { VerificationTabs } from '../components/result/VerificationTabs.jsx';

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
};

const sectionStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '20px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
  padding: '20px',
};

const titleStyle = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 800,
  color: '#111827',
};

const labelStyle = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '13px',
  fontWeight: 700,
  color: '#374151',
};

const inputStyle = {
  width: '100%',
  border: '1px solid #d1d5db',
  borderRadius: '10px',
  padding: '11px 12px',
  fontSize: '14px',
  background: '#fff',
  boxSizing: 'border-box',
};

/**
 * The five sheets supplied by the exam agency. Order matters: the answer
 * key has to be loaded before student responses can be scored against it.
 */
const UPLOAD_CONFIGS = [
  {
    value: RESULT_UPLOAD_TYPES.ALL_STUDENTS,
    label: 'All Students',
    description:
      'Every candidate who appeared, with marks and attendance. This is the master list and replaces any previous upload for the class.',
    expects: 'One row per candidate — ROLLNO, CNAME, CAT, marks, SELECTED and the P/A attendance columns.',
  },
  {
    value: RESULT_UPLOAD_TYPES.SELECTED_STUDENTS,
    label: 'Selected Students',
    description:
      'The selected subset. Re-flags who is selected and fills in any columns the all-students sheet does not carry. It never deletes existing rows.',
    expects: 'The selected-candidates sheet — same layout as All Students, restricted to selected rows.',
  },
  {
    value: RESULT_UPLOAD_TYPES.ANSWER_KEY,
    label: 'Answer Key',
    description:
      'Correct answers per paper. Upload this before student responses — each booklet variant needs its own key.',
    expects: 'A PAPER column (MAT6, SAT6, MAT6B …) plus Q001…Qnnn answer columns.',
  },
  {
    value: RESULT_UPLOAD_TYPES.STUDENT_RESPONSES,
    label: 'Student Responses',
    description:
      'Scanned OMR responses. Every MAT / MATB / SAT worksheet in the file is read in one pass and scored against the matching answer key. Upload the complete workbook — it replaces all stored responses for the class.',
    expects: 'One worksheet per paper, named MAT, MATB or SAT, with ROLLNO, TOTRIGHT and Q001…Qnnn columns.',
  },
  {
    value: RESULT_UPLOAD_TYPES.BLOCK_SUMMARY,
    label: 'Block Summary',
    description:
      'The official district and block figures. These are the numbers block-level reports are published from.',
    expects: 'DISTRICT, BLOCK, REGISTERED, ABSENT, PRESENT, SELECTED and the GEN / OBC / SC / ST / EWS split.',
  },
];

function getScholarshipMode(scholarship) {
  const scholarshipId = Number(scholarship?.scholarship_id);
  const scholarshipName = String(scholarship?.scholarship_name || '').toLowerCase();

  if (scholarshipId === 3 || /\bcm\b/i.test(scholarshipName) || scholarshipName.includes('chief minister')) {
    return 'CM';
  }
  if (
    scholarshipId === 6 ||
    scholarshipName.includes('nmmss') ||
    scholarshipName.includes('nmms') ||
    scholarshipName.includes('snss') ||
    scholarshipName.includes('ssss')
  ) {
    return 'NMMSS';
  }
  return 'GENERIC';
}

function getClassOptionsForScholarship(scholarship) {
  const mode = getScholarshipMode(scholarship);
  if (mode === 'CM') return ['6', '9'];
  if (mode === 'NMMSS') return ['8'];
  return ['6', '8', '9', '10', '11', '12'];
}

export default function ResultUploadPage() {
  const {
    sessionId: selectedSessionId,
    scholarships = [],
    selectedScholarshipId,
  } = useSession() || {};

  const selectedScholarship =
    scholarships.find((item) => item.scholarship_id === selectedScholarshipId) || null;
  const classOptions = useMemo(
    () => getClassOptionsForScholarship(selectedScholarship),
    [selectedScholarship]
  );

  const [uploadType, setUploadType] = useState(UPLOAD_CONFIGS[0].value);
  const [classFilter, setClassFilter] = useState(classOptions[0] || '');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [errorsUploadId, setErrorsUploadId] = useState(null);

  const activeConfig =
    UPLOAD_CONFIGS.find((config) => config.value === uploadType) || UPLOAD_CONFIGS[0];

  const effectiveClass = classOptions.includes(String(classFilter))
    ? String(classFilter)
    : String(classOptions[0] || '');

  const handleUploadSuccess = useCallback((data) => {
    setRefreshTrigger((value) => value + 1);
    if (data?.error_count > 0) setErrorsUploadId(data.upload_id);
  }, []);

  const scopeReady = Boolean(selectedSessionId && selectedScholarshipId);

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <h2 style={titleStyle}>Result Upload</h2>
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#6b7280' }}>
          Files are filed under the selected session and scholarship, and the class chosen below.
        </p>

        {!scopeReady && (
          <div style={{
            marginTop: '16px', background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: '#92400e',
          }}>
            Select a session and scholarship from the dashboard header before uploading.
          </div>
        )}

        <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: 'minmax(250px, 320px)', gap: '16px' }}>
          <div>
            <label style={labelStyle} htmlFor="upload-type">Sheet type</label>
            <select
              id="upload-type"
              value={uploadType}
              onChange={(event) => setUploadType(event.target.value)}
              style={inputStyle}
            >
              {UPLOAD_CONFIGS.map((config) => (
                <option key={config.value} value={config.value}>{config.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <ResultFileUpload
          uploadType={uploadType}
          config={activeConfig}
          session_id={selectedSessionId}
          scholarship_id={selectedScholarshipId}
          classOptions={classOptions}
          classValue={effectiveClass}
          onClassChange={setClassFilter}
          onUploadSuccess={handleUploadSuccess}
          onViewErrors={setErrorsUploadId}
        />
      </section>

      {errorsUploadId && (
        <section>
          <UploadErrorsPanel
            uploadId={errorsUploadId}
            onClose={() => setErrorsUploadId(null)}
          />
        </section>
      )}

      <section style={sectionStyle}>
        <h3 style={{ ...titleStyle, fontSize: '18px', marginBottom: '16px' }}>Upload History</h3>
        <UploadHistoryTable
          refreshTrigger={refreshTrigger}
          onViewErrors={setErrorsUploadId}
          sessionId={selectedSessionId}
          scholarshipId={selectedScholarshipId}
        />
      </section>

      <section style={sectionStyle}>
        <h3 style={{ ...titleStyle, fontSize: '18px', marginBottom: '16px' }}>Verification Dashboard</h3>
        <p style={{ margin: '-8px 0 16px', fontSize: '13px', color: '#6b7280' }}>
          Shows the current data for the selected session, scholarship and class — updates automatically after every upload.
        </p>
        <VerificationTabs
          session_id={selectedSessionId}
          scholarship_id={selectedScholarshipId}
          classValue={effectiveClass}
          refreshTrigger={refreshTrigger}
        />
      </section>
    </div>
  );
}
