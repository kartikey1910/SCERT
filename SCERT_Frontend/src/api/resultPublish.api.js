import { buildApiUrl, get, put } from '../apiClient.js';
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

/* ------------------------------------------------------------------ */
/* SCERT — authenticated                                               */
/* ------------------------------------------------------------------ */

export async function getPublishStatus(params = {}) {
  const token = getStoredToken();
  return get(`/api/results/publish/status${buildQueryString(params)}`, { token });
}

/**
 * audience: 'public'   — home-page View Result lookup
 *           'officers' — School, BEO and District result lists
 * The two are independent; flipping one never touches the other.
 */
export async function setPublishStatus({ session_id, scholarship_id, audience, is_published }) {
  const token = getStoredToken();
  return put('/api/results/publish', { session_id, scholarship_id, audience, is_published }, { token });
}

/* ------------------------------------------------------------------ */
/* Public — no auth                                                    */
/* ------------------------------------------------------------------ */

/** Whether any result is live. Drives the home-page button. */
export async function getResultAvailability() {
  try {
    const res = await fetch(buildApiUrl('/api/public/results/availability'), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { published: false, scopes: [] };
    return await res.json();
  } catch {
    // Never let a failed availability probe break the landing page.
    return { published: false, scopes: [] };
  }
}

/**
 * Student score-card lookup.
 *
 * POST, not GET: roll number and date of birth are personal data and must
 * not end up in a URL, browser history, or server access log.
 *
 * Returns { ok, status, data } rather than throwing, so the page can show
 * the server's own message for each case (not published / not found /
 * rate limited) instead of a generic failure.
 */
export async function lookupResult({ roll_number, dob }) {
  const res = await fetch(buildApiUrl('/api/public/results/lookup'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ roll_number, dob }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}
