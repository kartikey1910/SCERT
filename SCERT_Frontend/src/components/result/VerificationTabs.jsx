import { useState } from 'react';
import { StudentsTable } from './verification/StudentsTable';
import { BlockSummaryTable } from './verification/BlockSummaryTable';
import { AnswerKeysTable } from './verification/AnswerKeysTable';
import { StudentResponsesTable } from './verification/StudentResponsesTable';
import { GeneratedScoresTable } from './verification/GeneratedScoresTable';
import { UploadErrorsTable } from './verification/UploadErrorsTable';

const tabsContainerStyle = {
  display: 'flex',
  borderBottom: '1px solid #e5e7eb',
  marginBottom: '20px',
  gap: '8px',
  flexWrap: 'wrap',
};

const tabBtnStyle = {
  padding: '12px 20px',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 600,
  color: '#6b7280',
};

const tabBtnActiveStyle = {
  ...tabBtnStyle,
  color: '#3b82f6',
  borderBottom: '2px solid #3b82f6',
};

// One tab per sheet that can actually be uploaded, named the way the
// uploader names them, plus the two derived views (Generated Scores,
// Upload Errors) that aren't a sheet on their own but are useful alongside
// them. Each Component gets { session_id, scholarship_id, classValue,
// refreshTrigger } plus whatever's in extraProps.
const VERIFICATION_TABS = [
  { key: 'all_students', label: 'All Students', Component: StudentsTable, extraProps: { selectedOnly: false } },
  { key: 'selected_students', label: 'Selected Students', Component: StudentsTable, extraProps: { selectedOnly: true } },
  { key: 'answer_key', label: 'Answer Key', Component: AnswerKeysTable },
  { key: 'student_responses', label: 'Student Responses', Component: StudentResponsesTable },
  { key: 'block_summary', label: 'Block Summary', Component: BlockSummaryTable },
  { key: 'generated_scores', label: 'Generated Scores', Component: GeneratedScoresTable },
  { key: 'upload_errors', label: 'Upload Errors', Component: UploadErrorsTable },
];

/**
 * Each tab is scoped to session + scholarship + class and paginates on the
 * server — the tables underneath hold millions of rows for a single class,
 * so nothing here fetches more than one page at a time.
 */
export function VerificationTabs({ session_id, scholarship_id, classValue, refreshTrigger }) {
  const [activeTab, setActiveTab] = useState(VERIFICATION_TABS[0].key);

  if (!session_id || !scholarship_id || !classValue) {
    return (
      <div style={{
        padding: '40px 20px', textAlign: 'center', color: '#6b7280',
        background: '#f9fafb', borderRadius: '12px', border: '1px dashed #d1d5db',
      }}>
        Select a session, scholarship and class above to view uploaded data.
      </div>
    );
  }

  const active = VERIFICATION_TABS.find((tab) => tab.key === activeTab);
  const ActiveTable = active.Component;

  return (
    <div>
      <div style={tabsContainerStyle}>
        {VERIFICATION_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            style={activeTab === tab.key ? tabBtnActiveStyle : tabBtnStyle}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ minHeight: '300px' }}>
        <ActiveTable
          session_id={session_id}
          scholarship_id={scholarship_id}
          classValue={classValue}
          refreshTrigger={refreshTrigger}
          {...(active.extraProps || {})}
        />
      </div>
    </div>
  );
}
