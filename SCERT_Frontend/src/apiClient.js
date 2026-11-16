const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URL = String(RAW_API_BASE_URL).replace(/\/+$/, '');

function buildApiUrl(path = '') {
  const value = String(path || '');
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? `${API_BASE_URL}${value}` : `${API_BASE_URL}/${value}`;
}

async function request(path, { method = 'GET', body, token, sessionId } = {}) {
  const headers = {};

  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (sessionId) {
    headers['x-session-id'] = sessionId;
  }

  const res = await fetch(buildApiUrl(path), {
    method,
    headers,
    body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
  });

    // Read body once, then try to parse JSON.
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
      
      // Emit custom event for 401 errors so dashboards can auto-logout
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }

      // SCERT switched Student Access off while a student is signed in: tell the
      // student dashboard so it can sign the student out with a clear message.
      if (
        res.status === 403 &&
        data && typeof data === 'object' && data.code === 'STUDENT_ACCESS_DISABLED' &&
        token && typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent('auth:student-access-closed'));
      }
      
      throw error;
    }

  return data;
}

export function get(path, options = {}) {
  return request(path, { method: 'GET', ...options });
}

export function post(path, body, options = {}) {
  return request(path, { method: 'POST', body, ...options });
}

export function put(path, body, options = {}) {
  return request(path, { method: 'PUT', body, ...options });
}

export function del(path, options = {}) {
  return request(path, { method: 'DELETE', ...options });
}

export { API_BASE_URL, buildApiUrl };
