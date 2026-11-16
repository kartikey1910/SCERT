import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get, post } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

function formatIstDate(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function BeoUploadAbsenteeDuringExam() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedSessionId, selectedScholarshipId, scholarships } = useDashboard();

  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [centersError, setCentersError] = useState('');

  const [selectedCenterId, setSelectedCenterId] = useState('');

  const [centerMeta, setCenterMeta] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');

  const [summaryRows, setSummaryRows] = useState([]);

  const canFetchCenters = Boolean(auth?.token && selectedSessionId && selectedScholarshipId);
  const canFetchSummary = Boolean(canFetchCenters && selectedCenterId);

  const scholarshipName =
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name ||
    '—';

  const isCmScholarship = /\bCM\b/i.test(scholarshipName) || /CHIEF\s*MINISTER/i.test(scholarshipName);
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(scholarshipName) ||
    /\bNMMS\b/i.test(scholarshipName) ||
    /\bSNSS\b/i.test(scholarshipName) ||
    /\bSSSS\b/i.test(scholarshipName);

  const targetClasses = useMemo(() => {
    if (isCmScholarship) return ['6', '9'];
    if (isNmmssScholarship) return ['8'];
    return ['8'];
  }, [isCmScholarship, isNmmssScholarship]);

  const getDefaultRows = () =>
    targetClasses.map((examClass) => ({
      examClass,
      total: 0,
      matAbsent: 0,
      satAbsent: 0,
      submittedForClass: false,
      submittedAt: null,
    }));

  const fetchCenters = async () => {
    if (!canFetchCenters) return;

    setLoadingCenters(true);
    setCentersError('');

    try {
      const data = await get(`/api/beo/centers?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`, {
        token: auth.token,
        sessionId: selectedSessionId,
      });
      setCenters(Array.isArray(data.centers) ? data.centers : []);
    } catch (e) {
      console.error('Failed to fetch centers:', e);
      setCentersError(e.message || 'Failed to load centers');
      toast.error(`Failed to load centers: ${toast.getErrorMessage(e)}`);
      setCenters([]);
    } finally {
      setLoadingCenters(false);
    }
  };

  const fetchCenterSummary = async (centerId) => {
    if (!auth?.token || !selectedSessionId || !selectedScholarshipId || !centerId) return;

    setLoadingSummary(true);
    setSummaryError('');
    setSubmitError('');
    setSubmitSuccess('');

    try {
      const classResults = await Promise.all(
        targetClasses.map(async (classFilter) => {
          const params = new URLSearchParams();
          params.append('scholarship_id', selectedScholarshipId);
          params.append('class_filter', classFilter);

          const data = await get(
            `/api/beo/centers/${encodeURIComponent(centerId)}/attendance-summary?${params.toString()}`,
            { token: auth.token, sessionId: selectedSessionId }
          );

          return {
            center: data?.center || null,
            row: {
              examClass: String(classFilter),
              total: Number(data?.summary?.total_students || 0),
              matAbsent: Number(data?.summary?.mat_absent || 0),
              satAbsent: Number(data?.summary?.sat_absent || 0),
              submittedForClass: Boolean(data?.summary?.submitted_for_class),
              submittedAt: data?.summary?.submitted_at || null,
            },
          };
        })
      );

      setCenterMeta(classResults[0]?.center || null);
      setSummaryRows(classResults.map((r) => r.row));
    } catch (e) {
      console.error('Failed to fetch center summary:', e);
      setCenterMeta(null);
      setSummaryRows(getDefaultRows());
      setSummaryError(e.message || 'Failed to load summary');
      toast.error(`Failed to load summary: ${toast.getErrorMessage(e)}`);
    } finally {
      setLoadingSummary(false);
    }
  };

  const resetCenterState = ({ keepSubmitSuccess = false } = {}) => {
    setSelectedCenterId('');
    setCenterMeta(null);
    setSummaryError('');
    setSubmitError('');
    if (!keepSubmitSuccess) {
      setSubmitSuccess('');
    }
    setSummaryRows(getDefaultRows());
  };

  useEffect(() => {
    setSummaryRows(getDefaultRows());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetClasses]);

  useEffect(() => {
    resetCenterState();
    fetchCenters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedScholarshipId]);

  const updateAbsent = (examClass, field, value) => {
    const parsed = Math.max(0, Number(value || 0));
    setSummaryRows((prev) =>
      prev.map((row) => {
        if (row.examClass !== examClass) return row;
        const nextValue = Math.min(parsed, Number(row.total || 0));
        return { ...row, [field]: nextValue };
      })
    );
  };

  const handleSubmit = async () => {
    if (!canFetchSummary) return;

    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');

    try {
      for (const row of summaryRows) {
        const total = Number(row.total || 0);
        const matAbsent = Math.min(Number(row.matAbsent || 0), total);
        const satAbsent = Math.min(Number(row.satAbsent || 0), total);

        const payload = {
          scholarship_id: selectedScholarshipId,
          class_filter: row.examClass,
          total_students: total,
          mat_present: Math.max(total - matAbsent, 0),
          mat_absent: matAbsent,
          sat_present: Math.max(total - satAbsent, 0),
          sat_absent: satAbsent,
        };

        await post(`/api/beo/centers/${encodeURIComponent(selectedCenterId)}/attendance-summary`, payload, {
          token: auth.token,
          sessionId: selectedSessionId,
        });
      }

      setSubmitSuccess('Attendance summary uploaded successfully');
      toast.success('Attendance summary uploaded successfully');
      await fetchCenterSummary(selectedCenterId);
      fetchCenters();
    } catch (e) {
      console.error('Submit summary failed:', e);
      setSubmitError(e.message || 'Failed to submit summary');
      toast.error(`Failed to submit summary: ${toast.getErrorMessage(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }

  const selectedCenterLabel =
    centers.find((c) => String(c.center_id) === String(selectedCenterId))?.school_name ||
    centerMeta?.school_name ||
    'Center';

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">
            {selectedCenterId ? `Upload Absentee During Exam - ${selectedCenterLabel}` : 'Upload Absentee During Exam - Select Center'}
          </h3>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {selectedCenterId ? (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                resetCenterState();
              }}
            >
              ← Back to Centers
            </button>
          ) : null}

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchCenters}
            disabled={!canFetchCenters || loadingCenters}
          >
            {loadingCenters ? 'Refreshing…' : 'Refresh Centers'}
          </button>
        </div>
      </div>

      {centersError && <div className="error-state">{centersError}</div>}
      {submitError && <div className="error-state">{submitError}</div>}
      {!selectedCenterId && submitSuccess && (
        <div style={{ padding: '1rem', background: '#d1fae5', borderRadius: '8px', color: '#065f46', marginTop: '0.5rem' }}>
          <strong>Attendance Submitted</strong>
          <p style={{ marginTop: '0.5rem' }}>{submitSuccess}</p>
        </div>
      )}

      {!selectedCenterId ? (
        loadingCenters ? (
          <div className="loading-state">Loading centers...</div>
        ) : centers.length === 0 ? (
          <div className="empty-state">No centers found.</div>
        ) : (
          <div className="smart-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  <th>Center Order</th>
                  <th>Center Name</th>
                  <th>UDISE</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((c) => (
                  <tr
                    key={c.center_id}
                    className="smart-table-clickable"
                    onClick={() => {
                      const id = String(c.center_id);
                      setSelectedCenterId(id);
                      setCenterMeta(null);
                      setSummaryError('');
                      setSubmitError('');
                      setSubmitSuccess('');
                      setSummaryRows(getDefaultRows());
                      fetchCenterSummary(id);
                    }}
                  >
                    <td className="smart-table-strong">{c.center_order ?? c.center_id ?? '—'}</td>
                    <td className="smart-table-strong">{c.school_name || c.center_name || '—'}</td>
                    <td>{c.udise_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadingSummary ? (
        <div className="loading-state">Loading summary...</div>
      ) : summaryError ? (
        <div className="error-state">{summaryError}</div>
      ) : (
        <>
          <div className="view-header-row" style={{ marginTop: '0.5rem' }}>
            <div>
              <h3 className="view-title" style={{ fontSize: '1rem' }}>
                Summary
              </h3>
              <p className="view-subtitle">
                Center: <strong>{centerMeta?.school_name || selectedCenterLabel || '—'}</strong>
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {summaryRows.map((row) => {
              const submittedAtText = formatIstDate(row.submittedAt);
              return (
                <div
                  key={`summary-status-${row.examClass}`}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: 10,
                    border: row.submittedForClass ? '1px solid #86efac' : '1px solid #fed7aa',
                    background: row.submittedForClass ? '#ecfdf3' : '#fff7ed',
                    color: row.submittedForClass ? '#166534' : '#9a3412',
                    fontWeight: 600,
                  }}
                >
                  Class {row.examClass}: {row.submittedForClass ? 'Submitted' : 'Not submitted'}
                  {row.submittedForClass ? ` | Submitted on: ${submittedAtText}` : ''}
                </div>
              );
            })}
          </div>
          {submitSuccess ? (
            <div style={{ padding: '0.75rem 1rem', background: '#d1fae5', borderRadius: '8px', color: '#065f46', marginBottom: '0.75rem' }}>
              {submitSuccess}
            </div>
          ) : null}

          <div className="smart-table-wrap">
            <table className="smart-table">
              <thead>
                <tr>
                  
                  <th>Class</th>
                  <th>Total Enrolled</th>
                  <th>MAT Present</th>
                  <th>MAT Absent</th>
                  <th>SAT Present</th>
                  <th>SAT Absent</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => {
                  const total = Number(row.total || 0);
                  const matAbsent = Math.min(Number(row.matAbsent || 0), total);
                  const satAbsent = Math.min(Number(row.satAbsent || 0), total);
                  const matPresent = Math.max(total - matAbsent, 0);
                  const satPresent = Math.max(total - satAbsent, 0);

                  return (
                    <tr key={row.examClass} className={window.getSubmissionRoleRowClass(row)}>
                      
                      <td className="smart-table-strong">Class {row.examClass}</td>
                      <td>{total}</td>
                      <td>{matPresent}</td>
                      <td>
                        <input
                          type="number"
                          className="form-input summary-input"
                          value={matAbsent}
                          onChange={(e) => updateAbsent(row.examClass, 'matAbsent', e.target.value)}
                        />
                      </td>
                      <td>{satPresent}</td>
                      <td>
                        <input
                          type="number"
                          className="form-input summary-input"
                          value={satAbsent}
                          onChange={(e) => updateAbsent(row.examClass, 'satAbsent', e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="form-actions" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="form-submit-btn"
              onClick={handleSubmit}
              disabled={submitting || !canFetchSummary}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
