import { useMemo, useRef, useState } from 'react';
import { uploadResultFile } from '../../api/result.api.js';

const cardStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '14px',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)',
  padding: '16px',
  width: '100%',
};

const layoutStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(300px, 1.1fr) minmax(280px, 0.9fr)',
  gap: '16px',
  alignItems: 'start',
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

const buttonStyle = {
  width: '100%',
  border: 'none',
  borderRadius: '10px',
  padding: '11px 14px',
  fontSize: '14px',
  fontWeight: 700,
  color: '#fff',
  background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
  cursor: 'pointer',
};

const disabledButtonStyle = { ...buttonStyle, opacity: 0.6, cursor: 'not-allowed' };

const panelStyle = {
  borderRadius: '12px',
  padding: '16px',
  fontSize: '13px',
};

const statRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '5px 0',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
};

function Stat({ label, value, tone }) {
  const toneColor = tone === 'bad' ? '#b91c1c' : tone === 'warn' ? '#b45309' : '#14532d';
  return (
    <div style={statRowStyle}>
      <span style={{ color: '#374151', fontWeight: 600 }}>{label}</span>
      <span style={{ color: toneColor, fontWeight: 800 }}>{value}</span>
    </div>
  );
}

export function ResultFileUpload({
  uploadType,
  config,
  session_id,
  scholarship_id,
  classOptions,
  classValue,
  onClassChange,
  onUploadSuccess,
  onViewErrors,
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const resolvedClassOptions = useMemo(
    () => (Array.isArray(classOptions) && classOptions.length ? classOptions : [6, 8, 9, 10, 11, 12]),
    [classOptions]
  );

  const selectedClassValue =
    classValue !== undefined && classValue !== null && String(classValue).trim() !== ''
      ? String(classValue)
      : String(resolvedClassOptions[0] || '');

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setError('');
    setResult(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Choose a file to upload.');
      return;
    }
    if (!session_id || !scholarship_id || !selectedClassValue) {
      setError('Select a session, scholarship and class before uploading.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const data = await uploadResultFile({
        file: selectedFile,
        uploadType,
        session_id,
        scholarship_id,
        class: selectedClassValue,
      });
      setResult(data);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (onUploadSuccess) onUploadSuccess(data);
    } catch (err) {
      setError(err.message || 'The upload failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isFormValid = Boolean(session_id && scholarship_id && selectedClassValue && selectedFile);
  const hasIssues = result && (result.error_count > 0 || result.status === 'PARTIAL');

  return (
    <div style={cardStyle}>
      <div style={layoutStyle}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#111827' }}>
            {config.label}
          </h3>
          <p style={{ margin: '4px 0 10px', fontSize: '13px', color: '#6b7280' }}>
            {config.description}
          </p>

          {config.expects && (
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px',
              padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#475569',
            }}>
              <strong style={{ color: '#334155' }}>Expected sheet:</strong> {config.expects}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle} htmlFor="result-class-select">Class</label>
            <select
              id="result-class-select"
              value={selectedClassValue}
              onChange={(event) => onClassChange && onClassChange(event.target.value)}
              style={inputStyle}
            >
              {resolvedClassOptions.map((option) => (
                <option key={option} value={option}>Class {option}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle} htmlFor="result-file-upload">Excel file (.xlsx)</label>
            <input
              id="result-file-upload"
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              style={inputStyle}
            />
          </div>

          <button
            type="button"
            onClick={handleUpload}
            disabled={!isFormValid || loading}
            style={!isFormValid || loading ? disabledButtonStyle : buttonStyle}
          >
            {loading ? 'Processing…' : `Upload ${config.label}`}
          </button>

          {error && (
            <div style={{ ...panelStyle, marginTop: '12px', background: '#fef2f2', color: '#b91c1c' }}>
              {error}
            </div>
          )}
        </div>

        <div>
          {loading && (
            <div style={{
              background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px',
              padding: '24px', textAlign: 'center',
            }}>
              <div style={{
                width: '24px', height: '24px', margin: '0 auto',
                border: '3px solid #e2e8f0', borderTopColor: '#7c3aed',
                borderRadius: '50%', animation: 'result-upload-spin 1s linear infinite',
              }} />
              <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#64748b' }}>
                Reading and scoring the file.
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                Response files hold millions of answers — this can take a few minutes.
              </p>
              <style>{'@keyframes result-upload-spin { to { transform: rotate(360deg); } }'}</style>
            </div>
          )}

          {!loading && result && (
            <div style={{
              ...panelStyle,
              background: hasIssues ? '#fffbeb' : '#f0fdf4',
              border: `1px solid ${hasIssues ? '#fde68a' : '#bbf7d0'}`,
            }}>
              <h4 style={{
                margin: '0 0 10px', fontSize: '15px',
                color: hasIssues ? '#92400e' : '#166534',
              }}>
                {hasIssues ? 'Uploaded with warnings' : 'Upload complete'}
              </h4>

              {result.warning && (
                <p style={{ margin: '0 0 10px', color: '#92400e', fontSize: '12px' }}>
                  {result.warning}
                </p>
              )}

              {/* Student sheets */}
              {typeof result.total_rows === 'number' && (
                <>
                  <Stat label="Rows read" value={result.total_rows} />
                  <Stat label="Matched to applications" value={result.matched_students} />
                  <Stat
                    label="Unmatched"
                    value={result.unmatched_students}
                    tone={result.unmatched_students > 0 ? 'warn' : undefined}
                  />
                  <Stat label="Selected" value={result.selected_students} />
                  <Stat label="Present / absent" value={`${result.present_students} / ${result.absent_students}`} />
                </>
              )}

              {/* Answer key */}
              {Array.isArray(result.papers) && (
                <>
                  {result.papers.map((paper) => (
                    <Stat
                      key={paper.paper_code}
                      label={`${paper.paper_code}${paper.booklet_code ? ' (booklet ' + paper.booklet_code + ')' : ''}`}
                      value={`${paper.questions} questions`}
                    />
                  ))}
                  <Stat label="Total answers stored" value={result.total_answers} />
                </>
              )}

              {/* Student responses */}
              {Array.isArray(result.sheets) && (
                <>
                  {result.sheets.map((sheet) => (
                    <Stat
                      key={sheet.sheet_name}
                      label={`${sheet.sheet_name} → ${sheet.paper_code}`}
                      value={`${sheet.students} students`}
                    />
                  ))}
                  <Stat label="Answers scored" value={result.total_responses} />
                  <Stat
                    label="Score mismatches"
                    value={result.validation_failures}
                    tone={result.validation_failures > 0 ? 'bad' : undefined}
                  />
                  <Stat
                    label="Unmatched roll numbers"
                    value={result.unmatched_students}
                    tone={result.unmatched_students > 0 ? 'warn' : undefined}
                  />
                </>
              )}

              {/* Block summary */}
              {typeof result.blocks === 'number' && (
                <>
                  <Stat label="Blocks" value={result.blocks} />
                  <Stat label="Districts" value={result.districts} />
                  <Stat label="Registered" value={result.totals?.registered} />
                  <Stat label="Present / absent" value={`${result.totals?.present} / ${result.totals?.absent}`} />
                  <Stat label="Selected" value={result.totals?.selected} />
                </>
              )}

              {result.error_count > 0 && (
                <button
                  type="button"
                  onClick={() => onViewErrors && onViewErrors(result.upload_id)}
                  style={{
                    marginTop: '12px', width: '100%', border: '1px solid #f59e0b',
                    background: '#fff', color: '#b45309', borderRadius: '8px',
                    padding: '9px 12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  View {result.error_count} flagged row{result.error_count === 1 ? '' : 's'}
                </button>
              )}
            </div>
          )}

          {!loading && !result && !error && (
            <div style={{
              background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px',
              padding: '24px', textAlign: 'center',
            }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                The upload summary will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
