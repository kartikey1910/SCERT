import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get, post } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

function normalizeStatus(v) {
  const s = String(v || 'PRESENT').toUpperCase();
  return s === 'ABSENT' ? 'ABSENT' : 'PRESENT';
}

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

function getRollSerialSortValue(student) {
  const roll = String(student?.roll_number || '').trim();
  const lastFour = roll.match(/(\d{4})$/)?.[1];
  if (lastFour) return Number(lastFour);

  const fullRoll = Number(roll);
  if (Number.isFinite(fullRoll)) return fullRoll;

  const appId = Number(student?.application_id);
  if (Number.isFinite(appId)) return appId;

  return Number.MAX_SAFE_INTEGER;
}

export function BeoUploadAbsentee() {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedSessionId, selectedScholarshipId, scholarships } = useDashboard();

  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [centersError, setCentersError] = useState('');

  const [selectedCenterId, setSelectedCenterId] = useState('');

  const [centerMeta, setCenterMeta] = useState(null);
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [studentsError, setStudentsError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [classSubmissionStatus, setClassSubmissionStatus] = useState({});

  const canFetchCenters = Boolean(auth?.token && selectedSessionId && selectedScholarshipId);
  const canFetchStudents = Boolean(canFetchCenters && selectedCenterId);

  const scholarshipName =
    scholarships.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name ||
    '—';

  const isCmScholarship = /\bCM\b/i.test(scholarshipName) || /CHIEF\s*MINISTER/i.test(scholarshipName);
  const isNmmssScholarship = /\bNMMSS\b/i.test(scholarshipName) || /\bNMMS\b/i.test(scholarshipName);
  const targetClasses = useMemo(() => {
    if (isCmScholarship) return ['6', '9'];
    if (isNmmssScholarship) return ['8'];
    return classFilter ? [classFilter] : ['8'];
  }, [classFilter, isCmScholarship, isNmmssScholarship]);

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
      console.error('Failed to fetch centers for attendance:', e);
      setCentersError(e.message || 'Failed to load centers');
      toast.error(`Failed to load centers: ${toast.getErrorMessage(e)}`);
      setCenters([]);
    } finally {
      setLoadingCenters(false);
    }
  };

  const fetchCenterAttendance = async (centerId) => {
    if (!auth?.token || !selectedSessionId || !selectedScholarshipId || !centerId) return;

    setLoadingStudents(true);
    setStudentsError('');
    setSubmitError('');
    setSubmitSuccess('');

    try {
      const params = new URLSearchParams();
      params.append('scholarship_id', String(selectedScholarshipId));
      if (classFilter) params.append('class_filter', classFilter);

      const data = await get(
        `/api/beo/centers/${encodeURIComponent(centerId)}/attendance?${params.toString()}`,
        { token: auth.token, sessionId: selectedSessionId }
      );

      setCenterMeta(data?.center || null);
      setClassSubmissionStatus(data?.class_submission_status || {});

      const list = Array.isArray(data?.students) ? data.students : [];
      setStudents(
        list
          .map((s) => ({
            application_id: s.application_id,
            roll_number: s.roll_number,
            student_name: s.student_name,
            mat_status: normalizeStatus(s.mat_status),
            sat_status: normalizeStatus(s.sat_status),
          }))
          .sort((a, b) => {
            const serialDiff = getRollSerialSortValue(a) - getRollSerialSortValue(b);
            if (serialDiff !== 0) return serialDiff;
            return String(a.roll_number || '').localeCompare(String(b.roll_number || ''));
          })
      );
    } catch (e) {
      console.error('Failed to fetch center attendance list:', e);
      setCenterMeta(null);
      setClassSubmissionStatus({});
      setStudents([]);
      setStudentsError(e.message || 'Failed to load students');
      toast.error(`Failed to load students: ${toast.getErrorMessage(e)}`);
    } finally {
      setLoadingStudents(false);
    }
  };

  const resetCenterState = ({ keepSubmitSuccess = false } = {}) => {
    setSelectedCenterId('');
    setCenterMeta(null);
    setClassSubmissionStatus({});
    setStudents([]);
    setStudentsError('');
    setSubmitError('');
    if (!keepSubmitSuccess) {
      setSubmitSuccess('');
    }
  };

  useEffect(() => {
    if (isCmScholarship) {
      setClassFilter('6');
      return;
    }
    if (isNmmssScholarship) {
      setClassFilter('8');
      return;
    }
    setClassFilter('');
  }, [selectedScholarshipId, isCmScholarship, isNmmssScholarship]);

  useEffect(() => {
    // reset when scholarship/session changes
    resetCenterState();

    fetchCenters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedScholarshipId]);

  useEffect(() => {
    if (selectedCenterId && classFilter) {
      fetchCenterAttendance(selectedCenterId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classFilter]);

  const updateStudent = (applicationId, patch) => {
    setStudents((prev) =>
      prev.map((s) => (String(s.application_id) === String(applicationId) ? { ...s, ...patch } : s))
    );
  };

  const handleSubmit = async () => {
    if (!canFetchStudents) return;

    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');

    try {
      const payload = {
        scholarship_id: selectedScholarshipId,
        class_filter: classFilter || null,
        students: students.map((s) => ({
          application_id: s.application_id,
          mat_status: normalizeStatus(s.mat_status),
          sat_status: normalizeStatus(s.sat_status),
        })),
      };

      const res = await post(`/api/beo/centers/${encodeURIComponent(selectedCenterId)}/attendance`, payload, {
        token: auth.token,
        sessionId: selectedSessionId,
      });

      setSubmitSuccess(res?.message || 'Attendance uploaded successfully');
      toast.success(res?.message || 'Attendance uploaded successfully');
      await fetchCenterAttendance(selectedCenterId);
      fetchCenters();
    } catch (e) {
      console.error('Upload absentee failed:', e);
      setSubmitError(e.message || 'Failed to submit attendance');
      toast.error(`Failed to submit attendance: ${toast.getErrorMessage(e)}`);
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

  const renderClassFilters = () => {
    if (!isCmScholarship && !isNmmssScholarship) return null;

    return (
      <div className="beo-absentee-class-filters">
        <div className="beo-absentee-class-filter-actions">
          {isNmmssScholarship ? (
            <button
              type="button"
              className={`filter-btn ${classFilter === '8' ? 'filter-btn-active' : ''}`}
              onClick={() => setClassFilter('8')}
            >
              NMMSS Class 8
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`filter-btn ${classFilter === '6' ? 'filter-btn-class6-active' : ''}`}
                onClick={() => setClassFilter('6')}
              >
                CM Class 6
              </button>
              <button
                type="button"
                className={`filter-btn ${classFilter === '9' ? 'filter-btn-class9-active' : ''}`}
                onClick={() => setClassFilter('9')}
              >
                CM Class 9
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="applications-view">
      <div className="beo-absentee-header">
        <div className="beo-absentee-header-title">
          <h3 className="view-title">
            {selectedCenterId ? `Upload Absentee - ${selectedCenterLabel}` : 'Upload Absentee - Select Center'}
          </h3>
        </div>

        <div className="beo-absentee-header-actions">
          {selectedCenterId ? renderClassFilters() : null}
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
                      setStudents([]);
                      setStudentsError('');
                      setSubmitError('');
                      setSubmitSuccess('');
                      fetchCenterAttendance(id);
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
      ) : loadingStudents ? (
        <div className="loading-state">Loading students...</div>
      ) : studentsError ? (
        <div className="error-state">{studentsError}</div>
      ) : students.length === 0 ? (
        <div className="empty-state">No approved students found for this center.</div>
      ) : (
        <>
          <div className="view-header-row" style={{ marginTop: '0.5rem' }}>
            <div>
              <h3 className="view-title" style={{ fontSize: '1rem' }}>
                Student-wise Attendance
              </h3>
              <p className="view-subtitle">
                Center: <strong>{centerMeta?.school_name || selectedCenterLabel || '—'}</strong> | Mark Absent/Present for each student (default: Present).
              </p>
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.75rem' }}>
            {targetClasses.map((cls) => {
              const clsInfo = classSubmissionStatus?.[String(cls)] || {};
              const submittedForClass = Boolean(clsInfo.submitted_for_class);
              const submittedAtText = formatIstDate(clsInfo.submitted_at);
              return (
                <div
                  key={`status-${cls}`}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: 10,
                    border: submittedForClass ? '1px solid #86efac' : '1px solid #fed7aa',
                    background: submittedForClass ? '#ecfdf3' : '#fff7ed',
                    color: submittedForClass ? '#166534' : '#9a3412',
                    fontWeight: 600,
                  }}
                >
                  Class {cls}: {submittedForClass ? 'Submitted' : 'Not submitted'}
                  {submittedForClass ? ` | Submitted on: ${submittedAtText}` : ''}
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
                  <th>Roll No.</th>
                  <th>Student Name</th>
                  <th style={{ width: 160 }}>MAT</th>
                  <th style={{ width: 160 }}>SAT</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={String(s.application_id)} className={window.getSubmissionRoleRowClass(s)}>
                    <td>
                      <code className="smart-table-id">{s.roll_number || s.application_id}</code>
                    </td>
                    <td className="smart-table-strong">{s.student_name || '—'}</td>
                    <td>
                      <select
                        className="form-input"
                        value={normalizeStatus(s.mat_status)}
                        onChange={(e) => updateStudent(s.application_id, { mat_status: e.target.value })}
                      >
                        <option value="PRESENT">Present</option>
                        <option value="ABSENT">Absent</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-input"
                        value={normalizeStatus(s.sat_status)}
                        onChange={(e) => updateStudent(s.application_id, { sat_status: e.target.value })}
                      >
                        <option value="PRESENT">Present</option>
                        <option value="ABSENT">Absent</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>


          <div className="form-actions" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="form-submit-btn"
              onClick={handleSubmit}
              disabled={submitting || !canFetchStudents}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
