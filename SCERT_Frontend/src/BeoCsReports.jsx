import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useDashboard } from './DashboardContext.jsx';
import { get, post, buildApiUrl } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { sortStaffRows, displayStaffRole, isContingenceRole } from './utils/csStaffRoles.js';
import { requiredFieldsMessage } from './utils/formValidationMessages.js';

export function BeoCsReports({ viewOnly = false }) {
  const { auth } = useAuth();
  const toast = useToast();
  const { selectedSessionId, selectedScholarshipId, scholarships } = useDashboard();
  const selectedScholarshipName = String(
    scholarships?.find((s) => String(s?.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );

  const [centers, setCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [selectedCenterId, setSelectedCenterId] = useState('');

  // Reset component state when remounted (e.g., when user clicks sidebar link again)
  useEffect(() => {
    setSelectedCenterId('');
    setSelectedReport(null);
    setViewOnlyAttendanceSummary([]);
    setReportData(null);
    setError('');
    setSuccess('');
  }, []);

  // Reset selection when changing session/scholarship
  useEffect(() => {
    setSelectedCenterId('');
    setSelectedReport(null);
    setViewOnlyAttendanceSummary([]);
    setReportData(null);
    setError('');
    setSuccess('');
  }, [selectedSessionId, selectedScholarshipId]);

  const [reportData, setReportData] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [viewingDetails, setViewingDetails] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [viewOnlyAttendanceSummary, setViewOnlyAttendanceSummary] = useState([]);

  const [formData, setFormData] = useState({
    distance_from_block_km: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc_code: '',
    
    attendance_summary: [],
    
    number_of_exam_rooms: '',
    staff_details: [],
    
    was_supervisor_present: null,
    was_observer_present: null,
    supervisors: [],
    observers: [],
    
    any_special_incident: ''
  });


  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const sanitizeNonNegativeNumberInput = (value, { allowDecimal = false } = {}) => {
    const raw = String(value ?? '');
    if (!raw) return '';
    const cleaned = allowDecimal ? raw.replace(/[^0-9.]/g, '') : raw.replace(/\D/g, '');
    if (!cleaned) return '';
    if (allowDecimal) {
      const [whole = '', ...rest] = cleaned.split('.');
      const normalized = rest.length ? `${whole}.${rest.join('')}` : whole;
      return normalized;
    }
    return cleaned;
  };

  const preventNegativeNumberInput = (event) => {
    if (event.key === '-' || event.key === 'Minus') {
      event.preventDefault();
    }
  };

  const hasRole = (role, match) => String(role || '').toLowerCase().includes(match);
  const ensureRequiredStaffRows = (rows = []) => {
    const next = Array.isArray(rows) ? [...rows] : [];
    const hasSupervisorOrObserver = next.some((r) => 
      hasRole(r.staff_role, 'observer') || hasRole(r.staff_role, 'supervisor')
    );
    if (!hasSupervisorOrObserver) {
      next.push({
        staff_role: 'Supervisor',
        staff_count: 0,
      });
    }
    // Always in report order: Center Superintendent, Supervisor, Examination
    // Incharge, Invigilator, Reliever, Office Assistant, Peon, Contingence.
    return sortStaffRows(next);
  };
  const isRemovedStaffRole = (role) => {
    const r = String(role || '').toLowerCase();
    return r.includes('clerk') || r.includes('sweeper');
  };

  const filterStaffRows = (rows = []) =>
    (Array.isArray(rows) ? rows : []).filter((r) => !isRemovedStaffRole(r?.staff_role));

  const getHonorariumRate = (staffRole) => {
    const rates = Array.isArray(reportData?.honorarium_rates) ? reportData.honorarium_rates : [];
    const normalizedRole = String(staffRole || '').toLowerCase();
    const matched = rates.find((r) => String(r.staff_role || '').toLowerCase() === normalizedRole);
    if (matched) return parseFloat(matched.honorarium_per_unit || 0);
    if (normalizedRole.includes('observer') || normalizedRole.includes('supervisor')) return 400;
    return 0;
  };

  const getTargetAttendanceClasses = () => {
    const sid = Number(selectedScholarshipId);
    const isNmmssById = sid === 6;
    const isNmmssByName = /\bnmmss\b/i.test(selectedScholarshipName) || /\bnmms\b/i.test(selectedScholarshipName);
    return isNmmssById || isNmmssByName ? [8] : [6, 9];
  };

  const buildDefaultAttendanceSummary = () => (
    getTargetAttendanceClasses().map((cls) => ({
      exam_class: cls,
      total_enrolled: 0,
      mat_present: 0,
      mat_absent: 0,
      mat_total: 0,
      sat_present: 0,
      sat_absent: 0,
      sat_total: 0,
    }))
  );

  const normalizeAttendanceSummary = (rows = []) => {
    const classes = getTargetAttendanceClasses();
    const byClass = new Map(
      (Array.isArray(rows) ? rows : []).map((row) => [String(row?.exam_class ?? ''), row])
    );

    return classes.map((cls) => {
      const key = String(cls);
      const row = byClass.get(key) || {};
      const total = Math.max(0, Number(row.total_enrolled) || 0);
      const matAbsent = Math.min(Math.max(0, Number(row.mat_absent) || 0), total);
      const satAbsent = Math.min(Math.max(0, Number(row.sat_absent) || 0), total);

      return {
        exam_class: cls,
        total_enrolled: total,
        mat_present: Math.max(total - matAbsent, 0),
        mat_absent: matAbsent,
        mat_total: total,
        sat_present: Math.max(total - satAbsent, 0),
        sat_absent: satAbsent,
        sat_total: total,
      };
    });
  };

  const getSafeAttendanceSummary = (rows = []) => {
    const normalized = normalizeAttendanceSummary(rows);
    return normalized.length > 0 ? normalized : buildDefaultAttendanceSummary();
  };

  const hasAnyAttendanceValue = (rows = []) =>
    getSafeAttendanceSummary(rows).some(
      (row) =>
        Number(row?.total_enrolled || 0) > 0 ||
        Number(row?.mat_present || 0) > 0 ||
        Number(row?.mat_absent || 0) > 0 ||
        Number(row?.sat_present || 0) > 0 ||
        Number(row?.sat_absent || 0) > 0
    );

  const fetchAttendanceSummaryFromUpload = async (centerId) => {
    const classes = getTargetAttendanceClasses();

    const responses = await Promise.all(
      classes.map(async (cls) => {
        try {
          const data = await get(
            `/api/beo/centers/${encodeURIComponent(centerId)}/attendance?scholarship_id=${selectedScholarshipId}&class_filter=${cls}`,
            { token: auth?.token, sessionId: selectedSessionId }
          );
          const students = Array.isArray(data?.students) ? data.students : [];
          const total = students.length;
          const matAbsent = students.filter((s) => String(s?.mat_status || '').toUpperCase() === 'ABSENT').length;
          const satAbsent = students.filter((s) => String(s?.sat_status || '').toUpperCase() === 'ABSENT').length;
          return {
            exam_class: cls,
            total_enrolled: total,
            mat_absent: matAbsent,
            sat_absent: satAbsent,
          };
        } catch {
          return {
            exam_class: cls,
            total_enrolled: 0,
            mat_absent: 0,
            sat_absent: 0,
          };
        }
      })
    );

    return normalizeAttendanceSummary(responses);
  };

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      attendance_summary: buildDefaultAttendanceSummary(),
    }));
  }, [selectedScholarshipId]);

  // Fetch centers for BEO block
  useEffect(() => {
    if (!selectedSessionId || !selectedScholarshipId) return;

    const fetchCenters = async () => {
      setLoadingCenters(true);
      try {
        const data = await get(`/api/beo/centers?scholarship_id=${selectedScholarshipId}`, { 
          token: auth?.token,
          sessionId: selectedSessionId,
        });
        setCenters(data.centers || []);
      } catch (err) {
        console.error('Failed to fetch centers:', err);
        toast.error(`Failed to load centers: ${toast.getErrorMessage(err)}`);
        setCenters([]);
      } finally {
        setLoadingCenters(false);
      }
    };

    fetchCenters();
  }, [selectedSessionId, selectedScholarshipId, auth?.token]);

  // Fetch report data when center is selected
  useEffect(() => {
    if (!selectedCenterId || !selectedSessionId || !selectedScholarshipId) {
      setReportData(null);
      return;
    }

    if (viewOnly) {
      // In view-only mode, don't fetch/edit reports
      return;
    }

    const fetchReportData = async () => {
      setLoadingReport(true);
      setError('');
      try {
        const data = await get(`/api/beo/center-superintendent-reports?session_id=${selectedSessionId}&scholarship_id=${selectedScholarshipId}&center_id=${selectedCenterId}`, {
          token: auth?.token,
          sessionId: selectedSessionId,
        });

        setReportData(data);

        const attendanceFromUpload = await fetchAttendanceSummaryFromUpload(selectedCenterId);
        const safeAttendanceSummary = getSafeAttendanceSummary(attendanceFromUpload);

        // If report exists, populate form
        if (data.report) {
          setFormData({
            distance_from_block_km: data.report.distance_from_block_km || '',
            bank_name: data.report.bank_name || '',
            bank_account_number: data.report.bank_account_number || '',
            bank_ifsc_code: data.report.bank_ifsc_code || '',
            attendance_summary: safeAttendanceSummary,
            number_of_exam_rooms: data.report.number_of_exam_rooms || '',
            staff_details: data.staff_details.length > 0 
              ? ensureRequiredStaffRows(filterStaffRows(data.staff_details).map(s => ({ 
                  staff_role: displayStaffRole(s.staff_role), 
                  staff_count: s.staff_count,
                })))
              : ensureRequiredStaffRows(filterStaffRows(data.honorarium_rates).map(r => ({ 
                  staff_role: displayStaffRole(r.staff_role), 
                  staff_count: 0,
                }))),
            was_supervisor_present: data.report.was_supervisor_present,
            was_observer_present: data.report.was_observer_present,
            supervisors: data.observers.filter(o => o.observer_type === 'SUPERVISOR'),
            observers: data.observers.filter(o => o.observer_type === 'OBSERVER'),
            any_special_incident: data.report.any_special_incident || ''
          });
        } else {
          // Initialize with empty data
          setFormData({
            distance_from_block_km: '',
            bank_name: '',
            bank_account_number: '',
            bank_ifsc_code: '',
            attendance_summary: safeAttendanceSummary,
            number_of_exam_rooms: '',
            staff_details: ensureRequiredStaffRows(filterStaffRows(data.honorarium_rates).map(r => ({ 
              staff_role: displayStaffRole(r.staff_role), 
              staff_count: 0,
            }))),
            was_supervisor_present: null,
            was_observer_present: null,
            supervisors: [],
            observers: [],
            any_special_incident: ''
          });
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch report data');
        toast.error(`Failed to load CS report: ${toast.getErrorMessage(err)}`);
        setReportData(null);
      } finally {
        setLoadingReport(false);
      }
    };

    fetchReportData();
  }, [selectedCenterId, selectedSessionId, selectedScholarshipId, auth?.token]);

  const handleAttendanceChange = (classIndex, field, value) => {
    setFormData(prev => {
      const updated = [...prev.attendance_summary];
      const current = { ...updated[classIndex] };
      const parsed = Math.max(0, parseInt(value, 10) || 0);

      if (field === 'mat_absent') {
        const total = Number(current.total_enrolled || 0);
        const matAbsent = Math.min(parsed, total);
        current.mat_absent = matAbsent;
        current.mat_present = Math.max(total - matAbsent, 0);
      } else if (field === 'sat_absent') {
        const total = Number(current.total_enrolled || 0);
        const satAbsent = Math.min(parsed, total);
        current.sat_absent = satAbsent;
        current.sat_present = Math.max(total - satAbsent, 0);
      } else {
        current[field] = parsed;
      }

      updated[classIndex] = current;
      return { ...prev, attendance_summary: updated };
    });
  };

  const handleStaffChange = (index, value) => {
    setFormData(prev => {
      const updated = [...prev.staff_details];
      const sanitized = sanitizeNonNegativeNumberInput(value);
      updated[index] = { ...updated[index], staff_count: parseInt(sanitized, 10) || 0 };
      return { ...prev, staff_details: updated };
    });
  };

  const addObserver = (type) => {
    const newObserver = { official_name: '', designation: '', time_of_visit: '', time_of_leaving: '', other_details: '' };
    if (type === 'supervisor') {
      // Only one Supervisor is allowed per report.
      if (formData.supervisors.length >= 1) return;
      setFormData(prev => ({ ...prev, supervisors: [...prev.supervisors, newObserver] }));
    } else {
      // Only one Observer is allowed per report.
      if (formData.observers.length >= 1) return;
      setFormData(prev => ({ ...prev, observers: [...prev.observers, newObserver] }));
    }
  };

  const updateObserver = (type, index, field, value) => {
    const nextValue = field === 'official_name' ? String(value || '').toUpperCase() : value;
    if (type === 'supervisor') {
      setFormData(prev => {
        const updated = [...prev.supervisors];
        updated[index] = { ...updated[index], [field]: nextValue };
        return { ...prev, supervisors: updated };
      });
    } else {
      setFormData(prev => {
        const updated = [...prev.observers];
        updated[index] = { ...updated[index], [field]: nextValue };
        return { ...prev, observers: updated };
      });
    }
  };

  const removeObserver = (type, index) => {
    if (type === 'supervisor') {
      setFormData(prev => ({ ...prev, supervisors: prev.supervisors.filter((_, i) => i !== index) }));
    } else {
      setFormData(prev => ({ ...prev, observers: prev.observers.filter((_, i) => i !== index) }));
    }
  };

  /**
   * Every field on this report is mandatory before it can be submitted (a
   * draft may still be incomplete). Collects the missing/blank ones by
   * label so the toast can list exactly what is left, matching the pattern
   * the application forms already use (requiredFieldsMessage).
   */
  const getMissingRequiredFields = () => {
    const missing = [];

    if (formData.distance_from_block_km === '' || formData.distance_from_block_km === null || formData.distance_from_block_km === undefined) {
      missing.push('Distance of Examination Center from the block');
    }
    if (!String(formData.bank_name || '').trim()) missing.push('Name of the Bank');
    if (!String(formData.bank_account_number || '').trim()) missing.push('Account Number');
    if (!String(formData.bank_ifsc_code || '').trim()) missing.push('IFSC Code');
    if (formData.number_of_exam_rooms === '' || formData.number_of_exam_rooms === null || formData.number_of_exam_rooms === undefined) {
      missing.push('Number of Exam Rooms');
    }

    if (formData.was_supervisor_present === null || formData.was_supervisor_present === undefined) {
      missing.push('Was the supervisor present during the examination?');
    } else if (formData.was_supervisor_present) {
      if (formData.supervisors.length === 0) {
        missing.push('At least one Supervisor’s details');
      }
      formData.supervisors.forEach((s, idx) => {
        const label = `Supervisor ${idx + 1}`;
        if (!String(s.official_name || '').trim()) missing.push(`${label} - Officer Name`);
        if (!String(s.designation || '').trim()) missing.push(`${label} - Designation`);
        if (!String(s.time_of_visit || '').trim()) missing.push(`${label} - Time of Visit`);
        if (!String(s.time_of_leaving || '').trim()) missing.push(`${label} - Time of Leaving`);
        if (!String(s.other_details || '').trim()) missing.push(`${label} - Other Details`);
      });
    }

    if (formData.was_observer_present === null || formData.was_observer_present === undefined) {
      missing.push('Was the observer present during the examination?');
    } else if (formData.was_observer_present) {
      if (formData.observers.length === 0) {
        missing.push('At least one Observer’s details');
      }
      formData.observers.forEach((o, idx) => {
        const label = `Observer ${idx + 1}`;
        if (!String(o.official_name || '').trim()) missing.push(`${label} - Officer Name`);
        if (!String(o.designation || '').trim()) missing.push(`${label} - Designation`);
        if (!String(o.time_of_visit || '').trim()) missing.push(`${label} - Time of Visit`);
        if (!String(o.time_of_leaving || '').trim()) missing.push(`${label} - Time of Leaving`);
        if (!String(o.other_details || '').trim()) missing.push(`${label} - Other Details`);
      });
    }

    if (!String(formData.any_special_incident || '').trim()) {
      missing.push('Any Special Incident During Examination');
    }

    return missing;
  };

  const handleSubmit = async (submitFlag) => {
    if (!selectedCenterId || !selectedSessionId || !selectedScholarshipId) {
      setError('Please select a center');
      return;
    }

    if (submitFlag) {
      const missing = getMissingRequiredFields();
      if (missing.length > 0) {
        const message = requiredFieldsMessage(missing);
        setError(message);
        toast.error(message);
        return;
      }
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
        center_id: selectedCenterId,
        distance_from_block_km: parseFloat(formData.distance_from_block_km) || null,
        bank_name: formData.bank_name || null,
        bank_account_number: formData.bank_account_number || null,
        bank_ifsc_code: formData.bank_ifsc_code || null,
        number_of_exam_rooms: parseInt(formData.number_of_exam_rooms) || null,
        attendance_summary: formData.attendance_summary,
        staff_details: formData.staff_details,
        was_supervisor_present: formData.was_supervisor_present,
        was_observer_present: formData.was_observer_present,
        supervisors: formData.supervisors,
        observers: formData.observers,
        any_special_incident: formData.any_special_incident || null,
        submit: submitFlag
      };

      const result = await post('/api/beo/center-superintendent-reports', payload, { 
        token: auth?.token,
        sessionId: selectedSessionId,
      });
      setSuccess(result.message);
      toast.success(result?.message || (submitFlag ? 'Report submitted successfully.' : 'Report saved successfully.'));

      // Reload report data
      if (selectedCenterId) {
        const data = await get(`/api/beo/center-superintendent-reports?session_id=${selectedSessionId}&scholarship_id=${selectedScholarshipId}&center_id=${selectedCenterId}`, {
          token: auth?.token,
          sessionId: selectedSessionId,
        });
        setReportData(data);
      }
    } catch (err) {
      setError(err.message || 'Failed to submit report');
      toast.error(`Failed to submit report: ${toast.getErrorMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedCenterId || !selectedSessionId || !selectedScholarshipId) return;

    try {
      const qs = new URLSearchParams({
        session_id: String(selectedSessionId),
        scholarship_id: String(selectedScholarshipId),
        center_id: String(selectedCenterId),
      });

      const response = await fetch(buildApiUrl(`/api/beo/center-superintendent-reports/download.pdf?${qs.toString()}`), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${auth?.token || ''}`,
          'x-session-id': String(selectedSessionId),
        },
      });

      if (!response.ok) {
        let message = 'Failed to download PDF';
        try {
          const errData = await response.json();
          message = errData?.message || message;
        } catch {
          // no-op
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `beo_cs_report_${selectedSessionId}_${selectedScholarshipId}_${selectedCenterId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Failed to download PDF: ${toast.getErrorMessage(err)}`);
    }
  };

  const isReportSubmitted = reportData?.report?.is_submitted;
  const isFormLocked = false;


  // Fetch report when center selected in view-only mode
  useEffect(() => {
    if (!viewOnly || !selectedCenterId || !selectedSessionId || !selectedScholarshipId) {
      setSelectedReport(null);
      setViewOnlyAttendanceSummary([]);
      return;
    }

    const fetchReportData = async () => {
      setLoadingReport(true);
      setError('');
      try {
        const data = await get(`/api/beo/center-superintendent-reports?session_id=${selectedSessionId}&scholarship_id=${selectedScholarshipId}&center_id=${selectedCenterId}`, {
          token: auth?.token,
          sessionId: selectedSessionId,
        });
        setSelectedReport(data);
        const attendanceFromUpload = await fetchAttendanceSummaryFromUpload(selectedCenterId);
        setViewOnlyAttendanceSummary(getSafeAttendanceSummary(attendanceFromUpload));
      } catch (err) {
        setError(err.message || 'Failed to fetch report data');
        toast.error(`Failed to load CS report: ${toast.getErrorMessage(err)}`);
        setSelectedReport(null);
        setViewOnlyAttendanceSummary([]);
      } finally {
        setLoadingReport(false);
      }
    };

    fetchReportData();
  }, [viewOnly, selectedCenterId, selectedSessionId, selectedScholarshipId, auth?.token]);

  if (viewOnly && selectedCenterId) {
    const centerLabel =
      centers.find((c) => String(c.center_id) === String(selectedCenterId))?.school_name ||
      selectedReport?.center?.center_name ||
      'Center';
    const viewAttendanceRows = hasAnyAttendanceValue(selectedReport?.attendance_summary)
      ? getSafeAttendanceSummary(selectedReport?.attendance_summary)
      : getSafeAttendanceSummary(viewOnlyAttendanceSummary);

    if (loadingReport && !selectedReport) {
      return (
        <div className="beo-cs-reports-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">CS Report - {centerLabel}</h3>
              <p className="view-subtitle">Loading report...</p>
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedCenterId('');
                setSelectedReport(null);
              }}
            >
              ← Back to Centers
            </button>
          </div>
          {error ? <div className="error-state">{error}</div> : null}
          <div className="loading-state">Loading CS report...</div>
        </div>
      );
    }

    if (error && !selectedReport) {
      return (
        <div className="beo-cs-reports-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">CS Report - {centerLabel}</h3>
              <p className="view-subtitle">Unable to load report</p>
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedCenterId('');
                setSelectedReport(null);
              }}
            >
              ← Back to Centers
            </button>
          </div>
          <div className="error-state">{error}</div>
        </div>
      );
    }

    if (!selectedReport) {
      return (
        <div className="beo-cs-reports-view">
          <div className="view-header-row">
            <div>
              <h3 className="view-title">CS Report - {centerLabel}</h3>
              <p className="view-subtitle">No report found</p>
            </div>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedCenterId('');
                setSelectedReport(null);
              }}
            >
              ← Back to Centers
            </button>
          </div>
          <div className="empty-state">No CS report found for this center.</div>
        </div>
      );
    }

    return (
      <div className="beo-cs-reports-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">CS Report - {centerLabel}</h3>
            <p className="view-subtitle">View-only mode</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={handleDownloadPdf}
            >
              Download PDF
            </button>
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setSelectedCenterId('');
                setSelectedReport(null);
              }}
            >
              ← Back to Centers
            </button>
          </div>
        </div>
        <div className="cs-report-form">
          {/* Same readonly view as main form but all fields disabled */}
          <div className="form-section">
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Examination Center Code</label>
                <input type="text" className="form-input" value={selectedReport.center.center_code} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">District Code</label>
                <input type="text" className="form-input" value={selectedReport.district.district_code} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Examination Center Name</label>
                <input type="text" className="form-input" value={selectedReport.center.center_name} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">District Name</label>
                <input type="text" className="form-input" value={selectedReport.district.district_name} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Block Code</label>
                <input type="text" className="form-input" value={selectedReport.block.block_code} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Block Name</label>
                <input type="text" className="form-input" value={selectedReport.block.block_name} disabled />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Distance (km)</label>
                <input type="text" className="form-input" value={selectedReport.report?.distance_from_block_km || '—'} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Center Superintendent Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={selectedReport.superintendent?.name || '—'}
                  disabled
                />
              </div>
              <div className="form-group">
                <label className="form-label">Mobile Number</label>
                <input
                  type="text"
                  className="form-input"
                  value={selectedReport.superintendent?.mobile || '—'}
                  disabled
                />
              </div>
              <div className="form-group">
                <label className="form-label">Number of Exam Rooms</label>
                <input type="text" className="form-input" value={selectedReport.report?.number_of_exam_rooms || '—'} disabled />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h4 className="section-title">Bank Detail</h4>
            <div className="smart-table-wrap">
              <table className="smart-table" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '34%' }} />
                  <col style={{ width: '33%' }} />
                  <col style={{ width: '33%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name of the Bank</th>
                    <th>Account Number</th>
                    <th>IFSC Code</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'left' }}>{selectedReport.report?.bank_name || '—'}</td>
                    <td style={{ textAlign: 'left' }}>{selectedReport.report?.bank_account_number || '—'}</td>
                    <td style={{ textAlign: 'left' }}>{selectedReport.report?.bank_ifsc_code || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="form-section">
            <h4 className="section-title">Student Enrollment & Attendance</h4>
            <div className="smart-table-wrap">
              <table className="smart-table beo-cs-attendance-table">
                <colgroup>
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '16%' }} />
                </colgroup>
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
                  {viewAttendanceRows.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.exam_class}</td>
                      <td>{row.total_enrolled}</td>
                      <td>{row.mat_present}</td>
                      <td>{row.mat_absent}</td>
                      <td>{row.sat_present}</td>
                      <td>{row.sat_absent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="form-section">
            <h4 className="section-title">Staff Details & Honorarium</h4>
            <div className="smart-table-wrap">
              <table className="smart-table beo-cs-staff-table">
                <colgroup>
                  <col style={{ width: '38%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '23%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Staff Detail</th>
                    <th>Number</th>
                    <th>Honorarium Per Unit</th>
                    <th>Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sortStaffRows(filterStaffRows(selectedReport.staff_details)).map((staff, idx) => {
                    // Contingence is one flat amount set by SCERT: no head-count, no per-unit rate.
                    const flat = isContingenceRole(staff.staff_role);
                    return (
                      <tr key={idx}>
                        <td>{displayStaffRole(staff.staff_role)}</td>
                        <td>{flat ? '—' : staff.staff_count}</td>
                        <td>{flat ? '—' : `₹${parseFloat(staff.honorarium_per_unit).toFixed(2)}`}</td>
                        <td>₹{parseFloat(staff.total_amount).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'right', fontWeight: 'bold' }}>Grand Total:</td>
                    <td style={{ fontWeight: 'bold' }}>₹{parseFloat(selectedReport.report?.grand_total_amount || 0).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {selectedReport.observers?.length > 0 && (
            <div className="form-section">
              <h4 className="section-title">Observers & Supervisors</h4>
              <div className="smart-table-wrap">
                <table className="smart-table beo-cs-observers-table">
                  <colgroup>
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '20%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Official Name</th>
                      <th>Designation</th>
                      <th>Time of Visit</th>
                      <th>Time of Leaving</th>
                      <th>Other Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedReport.observers.map((obs, idx) => (
                      <tr key={idx}>
                        <td>{obs.observer_type}</td>
                        <td>{obs.official_name || '—'}</td>
                        <td>{obs.designation || '—'}</td>
                        <td>{obs.time_of_visit || '—'}</td>
                        <td>{obs.time_of_leaving || '—'}</td>
                        <td>{obs.other_details || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedReport.report?.any_special_incident && (
            <div className="form-section">
              <h4 className="section-title">Special Incident</h4>
              <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                {selectedReport.report.any_special_incident}
              </div>
            </div>
          )}

          {selectedReport.report?.is_submitted ? (
            <div style={{ padding: '1rem', background: '#d1fae5', borderRadius: '8px', marginTop: '2rem', color: '#065f46' }}>
              <strong>Report Submitted</strong>
              <p style={{ marginTop: '0.5rem' }}>
               Submitted at:{' '}
                {selectedReport.report?.submitted_at && !Number.isNaN(new Date(selectedReport.report.submitted_at).getTime())
                  ? new Date(selectedReport.report.submitted_at).toLocaleString()
                  : '—'}
              </p>
            </div>
          ) : (
            <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', marginTop: '2rem', color: '#92400e' }}>
              <strong>Report not submitted yet.</strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (viewOnly) {
    return (
      <div className="beo-cs-reports-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">CS Reports - Select Center</h3>
          </div>
        </div>

        {!selectedScholarshipId && (
          <div className="error-state" style={{ marginTop: '1rem' }}>
            Please select a scholarship from the dropdown at the top
          </div>
        )}

        {error && <div className="error-state" style={{ marginTop: '1rem' }}>{error}</div>}

        {loadingCenters ? (
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
                  <th>Superintendent</th>
                  <th>Mobile</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((center) => (
                  <tr
                    key={center.center_id}
                    className="smart-table-clickable"
                    onClick={() => {
                      setError('');
                      setSelectedReport(null);
                      setSelectedCenterId(String(center.center_id));
                    }}
                  >
                    <td className="smart-table-strong">{center.center_order ?? '—'}</td>
                    <td>{center.school_name || '—'}</td>
                    <td>{center.udise_code || '—'}</td>
                    <td>{center.superintendent_name || '—'}</td>
                    <td>{center.superintendent_mobile || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (!selectedCenterId) {
    return (
      <div className="beo-cs-reports-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">Upload CS Report - Select Center</h3>
            <p className="view-subtitle">Click a center to open the CS report form</p>
          </div>
        </div>

        {!selectedScholarshipId && (
          <div className="error-state" style={{ marginTop: '1rem' }}>
            Please select a scholarship from the dropdown at the top
          </div>
        )}

        {error && <div className="error-state" style={{ marginTop: '1rem' }}>{error}</div>}

        {loadingCenters ? (
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
                  <th>Superintendent</th>
                  <th>Mobile</th>
                </tr>
              </thead>
              <tbody>
                {centers.map((center) => (
                  <tr
                    key={center.center_id}
                    className="smart-table-clickable"
                    onClick={() => {
                      setError('');
                      setSuccess('');
                      setSelectedReport(null);
                      setSelectedCenterId(String(center.center_id));
                    }}
                  >
                    <td className="smart-table-strong">{center.center_order ?? '—'}</td>
                    <td>{center.school_name || '—'}</td>
                    <td>{center.udise_code || '—'}</td>
                    <td>{center.superintendent_name || '—'}</td>
                    <td>{center.superintendent_mobile || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const selectedCenterLabel =
    centers.find((c) => String(c.center_id) === String(selectedCenterId))?.school_name ||
    reportData?.center?.center_name ||
    'Center';

  return (
    <div className="beo-cs-reports-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Upload CS Report - {selectedCenterLabel}</h3>
          <p className="view-subtitle">Fill and submit CS report for the selected center</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleDownloadPdf}
          >
            Download PDF
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              setSelectedCenterId('');
              setReportData(null);
              setError('');
              setSuccess('');
            }}
          >
            ← Back to Centers
          </button>
        </div>
      </div>

      {!selectedScholarshipId && (
        <div className="error-state" style={{ marginTop: '1rem' }}>
          Please select a scholarship from the dropdown at the top
        </div>
      )}

      {error && <div className="error-state" style={{ marginTop: '1rem' }}>{error}</div>}
      {success && <div className="success-state" style={{ marginTop: '1rem', padding: '1rem', background: '#d1fae5', borderRadius: '8px', color: '#065f46' }}>{success}</div>}

      {loadingReport && <div className="loading-state">Loading report data...</div>}

      {reportData && (
        <div className="cs-report-form">
          {/* Part 1: Basic Information */}
          <div className="form-section">
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Examination Center Code</label>
                <input type="text" className="form-input" value={reportData.center.center_code} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">District Code</label>
                <input type="text" className="form-input" value={reportData.district.district_code} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Examination Center Name</label>
                <input type="text" className="form-input" value={reportData.center.center_name} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">District Name</label>
                <input type="text" className="form-input" value={reportData.district.district_name} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Block Code</label>
                <input type="text" className="form-input" value={reportData.block.block_code} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Block Name</label>
                <input type="text" className="form-input" value={reportData.block.block_name} disabled />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Distance of Examination Center from the block (in km) <span className="required">*</span></label>
                <input 
                  type="number" 
                  step="0.1"
                  min="0"
                  className="form-input" 
                  value={formData.distance_from_block_km}
                  onKeyDown={preventNegativeNumberInput}
                  onChange={(e) =>
                    setFormData(prev => ({
                      ...prev,
                      distance_from_block_km: sanitizeNonNegativeNumberInput(e.target.value, { allowDecimal: true }),
                    }))
                  }
                  disabled={isFormLocked}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Center Superintendent Name</label>
                <input type="text" className="form-input" value={reportData.superintendent.name} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Mobile Number</label>
                <input type="text" className="form-input" value={reportData.superintendent.mobile} disabled />
              </div>
            </div>
          </div>

          {/* Bank Details */}
          <div className="form-section">
            <h4 className="section-title">Bank Detail</h4>
            <div className="smart-table-wrap">
              <table className="smart-table" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '34%' }} />
                  <col style={{ width: '33%' }} />
                  <col style={{ width: '33%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name of the Bank <span className="required">*</span></th>
                    <th>Account Number <span className="required">*</span></th>
                    <th>IFSC Code <span className="required">*</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        type="text"
                        className="form-input table-input"
                        value={formData.bank_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, bank_name: e.target.value }))}
                        disabled={isFormLocked}
                      />
                    </td>
                    <td>
                      <input 
                        type="text" 
                        className="form-input table-input" 
                        value={formData.bank_account_number}
                        onChange={(e) => setFormData(prev => ({ ...prev, bank_account_number: e.target.value }))}
                        disabled={isFormLocked}
                      />
                    </td>
                    <td>
                      <input 
                        type="text" 
                        className="form-input table-input" 
                        value={formData.bank_ifsc_code}
                        onChange={(e) => setFormData(prev => ({ ...prev, bank_ifsc_code: e.target.value }))}
                        disabled={isFormLocked}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Attendance Summary */}
          <div className="form-section">
            <h4 className="section-title">Number of Registered and Present Students</h4>
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
                  {getSafeAttendanceSummary(formData.attendance_summary).map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.exam_class}</td>
                      <td>{row.total_enrolled}</td>
                      <td>{row.mat_present}</td>
                      <td>{row.mat_absent}</td>
                      <td>{row.sat_present}</td>
                      <td>{row.sat_absent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Staff Details with Honorarium */}
          <div className="form-section">
            <h4 className="section-title">Details of Staff Engaged for Examination</h4>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Number of Exam Rooms <span className="required">*</span></label>
              <input 
                type="number" 
                min="0"
                className="form-input" 
                value={formData.number_of_exam_rooms}
                onKeyDown={preventNegativeNumberInput}
                onChange={(e) =>
                  setFormData(prev => ({
                    ...prev,
                    number_of_exam_rooms: sanitizeNonNegativeNumberInput(e.target.value),
                  }))
                }
                disabled={isFormLocked}
                style={{ maxWidth: '200px' }}
              />
            </div>
            <div className="smart-table-wrap">
              <table className="smart-table">
                <thead>
                  <tr>
                    <th>Staff Detail</th>
                    <th>Number</th>
                    <th>Honorarium Per Unit</th>
                    <th>Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filterStaffRows(formData.staff_details).map((staff, idx) => {
                    // Contingence is set by SCERT in Rate Configuration and locked
                    // for the BEO: no head-count, no per-unit rate, no input.
                    const isContingence = isContingenceRole(staff.staff_role);
                    const rate = getHonorariumRate(staff.staff_role);
                    const total = isContingence ? rate : (rate * staff.staff_count);
                    return (
                      <tr key={idx}>
                        <td>{displayStaffRole(staff.staff_role)}</td>
                        <td>
                          {isContingence ? (
                            '—'
                          ) : (
                            <input 
                              type="number" 
                              min="0"
                              className="form-input" 
                              value={staff.staff_count}
                              onKeyDown={preventNegativeNumberInput}
                              onChange={(e) => handleStaffChange(idx, e.target.value)}
                              disabled={isFormLocked}
                              style={{ width: '80px' }}
                            />
                          )}
                        </td>
                        <td>
                          {isContingence ? '—' : `₹${rate.toFixed(2)}`}
                        </td>
                        <td>
                          ₹{total.toFixed(2)}
                          {isContingence ? (
                            <span
                              className="field-hint"
                              style={{ display: 'block' }}
                              title="Set by SCERT in Rate Configuration. The BEO cannot change it."
                            >
                              Set by SCERT
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'right', fontWeight: 'bold' }}>Grand Total:</td>
                    <td style={{ fontWeight: 'bold' }}>
                      ₹{filterStaffRows(formData.staff_details)
                        .reduce((sum, staff) => {
                          const rate = getHonorariumRate(staff.staff_role);
                          // Contingence is SCERT's flat amount; the rest is rate x number.
                          if (isContingenceRole(staff.staff_role)) return sum + rate;
                          return sum + (rate * (Number(staff.staff_count) || 0));
                        }, 0)
                        .toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Supervisors */}
          <div className="form-section">
            <h4 className="section-title">Details of Observers and Other Officials Present During Examination</h4>
            <div className="form-group">
              <label className="form-label">Was the supervisor present during the examination? <span className="required">*</span></label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label>
                  <input 
                    type="radio" 
                    name="supervisor_present"
                    checked={formData.was_supervisor_present === true}
                    onChange={() => setFormData(prev => ({ ...prev, was_supervisor_present: true }))}
                    disabled={isFormLocked}
                  /> Yes
                </label>
                <label>
                  <input 
                    type="radio" 
                    name="supervisor_present"
                    checked={formData.was_supervisor_present === false}
                    onChange={() => setFormData(prev => ({ ...prev, was_supervisor_present: false }))}
                    disabled={isFormLocked}
                  /> No
                </label>
              </div>
            </div>

            {formData.was_supervisor_present && (
              <>
                {formData.supervisors.map((supervisor, idx) => (
                  <div key={idx} className="observer-row" style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '1rem' }}>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Officer Name <span className="required">*</span></label>
                        <input
                          type="text"
                          className="form-input"
                          value={supervisor.official_name}
                          onChange={(e) => updateObserver('supervisor', idx, 'official_name', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Designation and institute/school/office name <span className="required">*</span></label>
                        <input
                          type="text"
                          className="form-input"
                          value={supervisor.designation}
                          onChange={(e) => updateObserver('supervisor', idx, 'designation', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Time of Visit <span className="required">*</span></label>
                        <input
                          type="time"
                          className="form-input"
                          value={supervisor.time_of_visit}
                          onChange={(e) => updateObserver('supervisor', idx, 'time_of_visit', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Time of Leaving <span className="required">*</span></label>
                        <input
                          type="time"
                          className="form-input"
                          value={supervisor.time_of_leaving || ''}
                          onChange={(e) => updateObserver('supervisor', idx, 'time_of_leaving', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Other Details <span className="required">*</span></label>
                        <input
                          type="text"
                          className="form-input"
                          value={supervisor.other_details}
                          onChange={(e) => updateObserver('supervisor', idx, 'other_details', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                    </div>
                    {!isFormLocked && (
                      <button 
                        type="button" 
                        className="scert-btn-danger" 
                        onClick={() => removeObserver('supervisor', idx)}
                        style={{ marginTop: '0.5rem' }}
                      >
                        Remove Supervisor
                      </button>
                    )}
                  </div>
                ))}
                {!isFormLocked && formData.supervisors.length < 1 && (
                  <button
                    type="button"
                    className="scert-btn-secondary"
                    onClick={() => addObserver('supervisor')}
                  >
                    Add Supervisor
                  </button>
                )}
              </>
            )}
          </div>

          {/* Observers */}
          <div className="form-section">
            <div className="form-group">
              <label className="form-label">Was the observer present during the examination? <span className="required">*</span></label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label>
                  <input 
                    type="radio" 
                    name="observer_present"
                    checked={formData.was_observer_present === true}
                    onChange={() => setFormData(prev => ({ ...prev, was_observer_present: true }))}
                    disabled={isFormLocked}
                  /> Yes
                </label>
                <label>
                  <input 
                    type="radio" 
                    name="observer_present"
                    checked={formData.was_observer_present === false}
                    onChange={() => setFormData(prev => ({ ...prev, was_observer_present: false }))}
                    disabled={isFormLocked}
                  /> No
                </label>
              </div>
            </div>

            {formData.was_observer_present && (
              <>
                {formData.observers.map((observer, idx) => (
                  <div key={idx} className="observer-row" style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '1rem' }}>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Officer Name <span className="required">*</span></label>
                        <input
                          type="text"
                          className="form-input"
                          value={observer.official_name}
                          onChange={(e) => updateObserver('observer', idx, 'official_name', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Designation and institute/school/office name <span className="required">*</span></label>
                        <input
                          type="text"
                          className="form-input"
                          value={observer.designation}
                          onChange={(e) => updateObserver('observer', idx, 'designation', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Time of Visit <span className="required">*</span></label>
                        <input
                          type="time"
                          className="form-input"
                          value={observer.time_of_visit}
                          onChange={(e) => updateObserver('observer', idx, 'time_of_visit', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Time of Leaving <span className="required">*</span></label>
                        <input
                          type="time"
                          className="form-input"
                          value={observer.time_of_leaving || ''}
                          onChange={(e) => updateObserver('observer', idx, 'time_of_leaving', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Other Details <span className="required">*</span></label>
                        <input
                          type="text"
                          className="form-input"
                          value={observer.other_details}
                          onChange={(e) => updateObserver('observer', idx, 'other_details', e.target.value)}
                          disabled={isFormLocked}
                        />
                      </div>
                    </div>
                    {!isFormLocked && (
                      <button 
                        type="button" 
                        className="scert-btn-danger" 
                        onClick={() => removeObserver('observer', idx)}
                        style={{ marginTop: '0.5rem' }}
                      >
                        Remove Observer
                      </button>
                    )}
                  </div>
                ))}
                {!isFormLocked && formData.observers.length < 1 && (
                  <button
                    type="button"
                    className="scert-btn-secondary"
                    onClick={() => addObserver('observer')}
                  >
                    Add Observer
                  </button>
                )}
              </>
            )}
          </div>

          {/* Special Incident */}
          <div className="form-section">
            <h4 className="section-title">Any Special Incident During Examination (Must be Reported if Occurred) <span className="required">*</span></h4>
            <div className="form-group">
              <textarea 
                className="form-input" 
                rows="4"
                value={formData.any_special_incident}
                onChange={(e) => setFormData(prev => ({ ...prev, any_special_incident: e.target.value }))}
                disabled={isFormLocked}
                placeholder="Describe any special incidents during the examination..."
              />
            </div>
          </div>

          {/* Action Buttons */}
          {!isFormLocked && (
            <div className="form-actions" style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button 
                type="button" 
                className="scert-btn-secondary"
                onClick={() => handleSubmit(false)}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : 'Save as Draft'}
              </button>
              <button 
                type="button" 
                className="scert-btn-primary"
                onClick={() => handleSubmit(true)}
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          )}

          {isReportSubmitted && (
            <div style={{ padding: '1rem', background: '#d1fae5', borderRadius: '8px', marginTop: '2rem', color: '#065f46' }}>
              <strong>Report Submitted Successfully!</strong>
              <p style={{ marginTop: '0.5rem' }}>
               Submitted at: {new Date(reportData.report.submitted_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
