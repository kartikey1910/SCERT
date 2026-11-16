import { API_BASE_URL } from '../apiClient.js';

/**
 * Downloads the BEO's block progress report as a PDF - the NMMSS school-wise
 * summary or, for other scholarships, the registration report. The same
 * endpoints the Reports > Progress Report page uses. Throws with the server's
 * message on failure so the caller can show it.
 */
export async function downloadBeoProgressReportPdf({ token, sessionId, scholarshipId, nmmss }) {
  const params = new URLSearchParams({ scholarship_id: String(scholarshipId) });
  const url = nmmss
    ? `${API_BASE_URL}/api/beo/progress-reports/nmmss-summary.pdf?${params}`
    : `${API_BASE_URL}/api/beo/progress-reports/registration.pdf?${params}`;
  const filename = nmmss
    ? `beo_progress_report_nmmss_${sessionId}_${scholarshipId}.pdf`
    : `beo_progress_report_${sessionId}_${scholarshipId}.pdf`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'x-session-id': sessionId },
  });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) msg = data.message;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }

  const blobUrl = window.URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(blobUrl);
}
