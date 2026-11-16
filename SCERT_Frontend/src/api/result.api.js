import { buildApiUrl, get } from '../apiClient.js';
import { getCurrentToken } from '../utils/currentAuth.js';

// This tab's own login. Not localStorage: a sign-in as another role in a
// second tab would replace it there (see utils/currentAuth.js).
const getStoredToken = getCurrentToken;

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function parseResponse(res) {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    raw = '';
  }

  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!res.ok) {
    const message =
      (typeof data === 'object' && data ? data.message : null) ||
      (typeof data === 'string' && data.trim() ? data.trim() : null) ||
      'Something went wrong. Please try again.';

    const error = new Error(message);
    error.status = res.status;
    error.data = data;

    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }

    throw error;
  }

  return data;
}

/**
 * The five sheets the exam agency supplies. upload_type tells the backend
 * which parser to run, so every sheet goes through one request shape.
 */
export const RESULT_UPLOAD_TYPES = {
  ALL_STUDENTS: 'ALL_STUDENTS',
  SELECTED_STUDENTS: 'SELECTED_STUDENTS',
  ANSWER_KEY: 'ANSWER_KEY',
  STUDENT_RESPONSES: 'STUDENT_RESPONSES',
  BLOCK_SUMMARY: 'BLOCK_SUMMARY',
};

/**
 * Uploads one result workbook.
 *
 * Response files run to 30+ MB and several million scored rows, so this
 * request can legitimately take minutes — callers should keep their
 * progress state up until it resolves.
 */
export async function uploadResultFile({
  file,
  uploadType,
  session_id,
  scholarship_id,
  class: classValue,
}) {
  const token = getStoredToken();
  const formData = new FormData();

  formData.append('file', file);
  formData.append('upload_type', String(uploadType));
  formData.append('session_id', String(session_id));
  formData.append('scholarship_id', String(scholarship_id));
  formData.append('class', String(classValue));

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(buildApiUrl('/api/results/upload'), {
    method: 'POST',
    headers,
    body: formData,
  });

  return parseResponse(res);
}

// Thin wrappers kept so existing callers keep working.
export function uploadResult(file, session_id, scholarship_id, classValue) {
  return uploadResultFile({
    file,
    uploadType: RESULT_UPLOAD_TYPES.ALL_STUDENTS,
    session_id,
    scholarship_id,
    class: classValue,
  });
}

export function uploadAnswerKey(file, session_id, scholarship_id, classValue) {
  return uploadResultFile({
    file,
    uploadType: RESULT_UPLOAD_TYPES.ANSWER_KEY,
    session_id,
    scholarship_id,
    class: classValue,
  });
}

export function uploadStudentResponses(file, session_id, scholarship_id, classValue) {
  return uploadResultFile({
    file,
    uploadType: RESULT_UPLOAD_TYPES.STUDENT_RESPONSES,
    session_id,
    scholarship_id,
    class: classValue,
  });
}

export function uploadBlockSummary(file, session_id, scholarship_id, classValue) {
  return uploadResultFile({
    file,
    uploadType: RESULT_UPLOAD_TYPES.BLOCK_SUMMARY,
    session_id,
    scholarship_id,
    class: classValue,
  });
}

export async function listResultUploads(params = {}) {
  const token = getStoredToken();
  return get(`/api/results/uploads${buildQueryString(params)}`, { token });
}

export async function getResultUploadErrors(uploadId, params = {}) {
  const token = getStoredToken();
  return get(`/api/results/uploads/${uploadId}/errors${buildQueryString(params)}`, { token });
}

export async function getResultSummary(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/summary${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getResultFilterOptions(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/filter-options${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getResultLatestUpload(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/latest-upload${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getResultAnalytics(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/analytics${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getTopRankers(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/top-rankers${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getTopDistricts(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/top-districts${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getTopBlocks(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/top-blocks${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getTopSchools(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/top-schools${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getHierarchySummary(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/hierarchy-summary${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getResultCharts(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/charts${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getSummaryReport(params = {}) {
  const token = getStoredToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const query = buildQueryString(params);

  try {
    const res = await fetch(buildApiUrl(`/api/results/summary-report${query}`), { headers });
    return await parseResponse(res);
  } catch (error) {
    throw error;
  }
}

export async function getSubjectWiseFilterOptions(params = {}) {
  const token = getStoredToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const query = buildQueryString(params);

  try {
    const res = await fetch(buildApiUrl(`/api/results/subject-wise/filter-options${query}`), { headers });
    return await parseResponse(res);
  } catch (error) {
    throw error;
  }
}

export async function getSubjectWiseReport(params = {}) {
  const token = getStoredToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const query = buildQueryString(params);

  try {
    const res = await fetch(buildApiUrl(`/api/results/subject-wise-report${query}`), { headers });
    return await parseResponse(res);
  } catch (error) {
    throw error;
  }
}

export async function getSchoolParticipationSummary(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/school-participation-summary${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getSchoolParticipationTable(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/school-participation${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getSchoolParticipationHierarchy(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/school-participation-hierarchy${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getRemainingSchools(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/remaining-schools${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

// ==========================================
// EXAM ANALYTICAL REPORT APIs
// ==========================================

export async function getExamAnalyticsSummary(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/exam-analytics/summary${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getExamAnalyticsCharts(params = {}, groupBy) {
  try {
    const token = getStoredToken();
    const path = `/api/results/exam-analytics/charts${buildQueryString({ ...params, group_by: groupBy })}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getExamAnalyticsTable(params = {}, level) {
  try {
    const token = getStoredToken();
    const path = `/api/results/exam-analytics/table${buildQueryString({ ...params, level })}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getExamAnalyticsFilters(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/exam-analytics/filters${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

export async function getOverallPerformanceReport(params = {}) {
  try {
    const token = getStoredToken();
    const path = `/api/results/overall-performance-report${buildQueryString(params)}`;
    return await get(path, { token });
  } catch (error) {
    throw error;
  }
}

// Static district/block nav tree for the report's left-side drill-down —
// same for every session/scholarship/class, so the page fetches it once.
export async function getOverallPerformanceGeoMaster() {
  try {
    const token = getStoredToken();
    return await get(`/api/results/overall-performance-report/geo`, { token });
  } catch (error) {
    throw error;
  }
}

// ---- Full Result (agency ALL DATA sheet, SCERT only) ----

export async function getFullResult(params = {}) {
  const token = getStoredToken();
  return await get(`/api/results/full-result${buildQueryString(params)}`, { token });
}

export async function getFullResultFilterOptions(params = {}) {
  const token = getStoredToken();
  return await get(`/api/results/full-result/filter-options${buildQueryString(params)}`, { token });
}

/**
 * Exports need the Authorization header, so they are fetched as blobs
 * rather than opened as plain links. `format` is "pdf" or "xlsx".
 */
// ---- Selected Students (official list, SCERT only) ----

export async function getSelectedStudentsList(params = {}) {
  const token = getStoredToken();
  return await get(`/api/results/selected-students${buildQueryString(params)}`, { token });
}

export async function getSelectedStudentsFilterOptions(params = {}) {
  const token = getStoredToken();
  return await get(`/api/results/selected-students/filter-options${buildQueryString(params)}`, { token });
}

export async function downloadSelectedStudentsFile(format, params = {}) {
  const token = getStoredToken();
  const res = await fetch(buildApiUrl(`/api/results/selected-students.${format}${buildQueryString(params)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = "Download failed.";
    try { message = (await res.json())?.message || message; } catch { /* non-JSON body */ }
    throw new Error(message);
  }
  return await res.blob();
}

export async function downloadFullResultFile(format, params = {}) {
  const token = getStoredToken();
  const res = await fetch(buildApiUrl(`/api/results/full-result.${format}${buildQueryString(params)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = "Download failed.";
    try { message = (await res.json())?.message || message; } catch { /* non-JSON body */ }
    throw new Error(message);
  }
  return await res.blob();
}

// ==========================================
// VERIFICATION APIs
// ==========================================

export async function getResultStudents(params = {}) {
  const token = getStoredToken();
  return get(`/api/results/students${buildQueryString(params)}`, { token });
}

export async function getResultBlockSummaryList(params = {}) {
  const token = getStoredToken();
  return get(`/api/results/block-summary${buildQueryString(params)}`, { token });
}

export async function getAnswerKeys(params = {}) {
  try {
    const token = getStoredToken();
    return await get(`/api/results/answer-keys${buildQueryString(params)}`, { token });
  } catch (error) {
    throw error;
  }
}

export async function getStudentResponses(params = {}) {
  try {
    const token = getStoredToken();
    return await get(`/api/results/student-responses${buildQueryString(params)}`, { token });
  } catch (error) {
    throw error;
  }
}

export async function getGeneratedScores(params = {}) {
  try {
    const token = getStoredToken();
    return await get(`/api/results/generated-scores${buildQueryString(params)}`, { token });
  } catch (error) {
    throw error;
  }
}

export async function getUploadErrors(params = {}) {
  try {
    const token = getStoredToken();
    return await get(`/api/results/upload-errors${buildQueryString(params)}`, { token });
  } catch (error) {
    throw error;
  }
}
