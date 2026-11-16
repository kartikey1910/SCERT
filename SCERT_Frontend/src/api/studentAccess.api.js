import { buildApiUrl, get, put } from '../apiClient.js';

/**
 * The Student Access switch (SCERT turns the student side on or off).
 *
 * Public side: the home page shows the Student Login button, and the student
 * login page shows its form, only while the switch is on.
 * SCERT side: the Feature Locks tab reads and flips it.
 */

// Several pages ask at once (top nav on every public page, the login page), so
// the answer is shared for a few seconds instead of asked for again each time.
const PUBLIC_CACHE_MS = 15000;
let publicCache = null;

/**
 * { enabled: boolean }. It reads as closed if the check fails: a backend
 * hiccup hides the button rather than sending students to a page that cannot
 * serve them.
 */
export async function getStudentAccessPublic({ fresh = false } = {}) {
  if (!fresh && publicCache && Date.now() - publicCache.at < PUBLIC_CACHE_MS) {
    return publicCache.value;
  }

  let value = { enabled: false };
  try {
    const res = await fetch(buildApiUrl('/api/public/student-access'), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      value = { enabled: data?.enabled === true };
    }
  } catch {
    // Never let a failed probe break a public page.
  }

  publicCache = { value, at: Date.now() };
  return value;
}

/** SCERT: { enabled, session_id, session_name } for the active session. */
export function getStudentAccessAdmin(token) {
  return get('/api/scert/student-access', { token });
}

/** SCERT: switch the student side on or off (active session). */
export function setStudentAccessAdmin(enabled, { token, sessionId } = {}) {
  publicCache = null;
  return put('/api/scert/student-access', { enabled }, { token, sessionId });
}
