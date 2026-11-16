import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { ModalOverlay } from './ModalOverlay.jsx';

function getFileNameFromPath(value) {
  if (!value) return '';

  if (value instanceof File) return value.name || 'file';

  const s = String(value);
  const clean = s.split('?')[0].split('#')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

function resolveFileUrl(value) {
  if (!value || value instanceof File) return '';

  const s = String(value).trim();
  if (!s) return '';

  if (s.startsWith('http://') || s.startsWith('https://')) return s;

  const clean = s.replace(/^\/+/, '');

  // Backend serves static uploads at /api/uploads.
  // We see a few shapes coming back from backend:
  // - uploads/<path>
  // - /uploads/<path>
  // - /api/uploads/<path>
  // - <path> (relative to uploads dir), e.g. 1/3/5/candidate_photograph/...

  if (clean.startsWith('uploads/')) return `${API_BASE_URL}/api/${clean}`;
  if (clean.startsWith('api/uploads/')) return `${API_BASE_URL}/${clean}`;
  if (clean.startsWith('api/')) return `${API_BASE_URL}/${clean}`;

  // Any other relative path: assume it's under uploads.
  return `${API_BASE_URL}/api/uploads/${clean}`;
}

function isPdfUrl(url, mimeType) {
  const u = String(url || '').toLowerCase();
  return u.includes('.pdf') || u.includes('application/pdf') || mimeType === 'application/pdf';
}

function isImageUrl(url, mimeType) {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('.png') ||
    u.includes('.jpg') ||
    u.includes('.jpeg') ||
    u.includes('.webp') ||
    u.includes('.gif') ||
    String(mimeType || '').startsWith('image/')
  );
}

export function FileAttachment({ value, compact = false }) {
  const { auth } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [objectUrl, setObjectUrl] = useState('');

  const isLocalFile = value instanceof File;
  const fileName = useMemo(() => getFileNameFromPath(value), [value]);
  const url = useMemo(() => resolveFileUrl(value), [value]);
  const mimeType = isLocalFile ? value.type : '';

  const canPreview = isLocalFile
    ? isPdfUrl('', mimeType) || isImageUrl('', mimeType)
    : Boolean(url) && (isPdfUrl(url) || isImageUrl(url));

  // A freshly-chosen file (not uploaded yet) previews straight from the
  // browser's own copy - no server round trip needed or possible yet.
  useEffect(() => {
    if (!isLocalFile) return undefined;
    if (!open) return undefined;
    const localObjectUrl = window.URL.createObjectURL(value);
    setObjectUrl(localObjectUrl);
    return () => {
      window.URL.revokeObjectURL(localObjectUrl);
      setObjectUrl('');
    };
  }, [isLocalFile, open, value]);

  useEffect(() => {
    if (isLocalFile) return;
    if (!open) return;
    if (!url) return;

    let cancelled = false;
    let localObjectUrl = '';

    const run = async () => {
      setLoading(true);
      setError('');

      try {
        const headers = {};
        if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;

        const res = await fetch(url, { headers });
        if (!res.ok) {
          let msg = `Failed to load file (HTTP ${res.status})`;
          try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const j = await res.json();
              msg = j?.message || msg;
            } else {
              const t = await res.text();
              if (t) msg = t;
            }
          } catch {
            // ignore
          }
          throw new Error(msg);
        }

        const blob = await res.blob();
        localObjectUrl = window.URL.createObjectURL(blob);

        if (!cancelled) {
          setObjectUrl(localObjectUrl);
        } else {
          window.URL.revokeObjectURL(localObjectUrl);
        }
      } catch (e) {
        if (!cancelled) {
          setObjectUrl('');
          setError(e?.message || 'Failed to load file');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
      if (localObjectUrl) window.URL.revokeObjectURL(localObjectUrl);
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
      setObjectUrl('');
      setLoading(false);
      setError('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url, auth?.token]);

  const downloadFile = async () => {
    if (isLocalFile) {
      const dlUrl = window.URL.createObjectURL(value);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(dlUrl), 30000);
      return;
    }

    if (!url) return;

    try {
      const headers = {};
      if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const dlUrl = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => window.URL.revokeObjectURL(dlUrl), 30000);
    } catch (e) {
      setError(e?.message || 'Download failed');
    }
  };

  if (!value) return <span>—</span>;

  const viewButton = (
    <button
      type="button"
      className={compact ? 'scert-btn-secondary' : 'scert-btn-secondary'}
      onClick={() => setOpen(true)}
      disabled={!canPreview}
      style={compact ? { padding: '0.35rem 0.6rem', fontSize: '0.85rem' } : undefined}
    >
      View
    </button>
  );

  const downloadButton = (
    <button
      type="button"
      className={compact ? 'scert-btn-secondary' : 'scert-btn-secondary'}
      onClick={downloadFile}
      disabled={isLocalFile ? false : !url}
      style={compact ? { padding: '0.35rem 0.6rem', fontSize: '0.85rem' } : undefined}
    >
      Download
    </button>
  );

  return (
    <>
      <div style={compact ? { display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' } : { display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span style={compact ? { fontSize: '0.85rem', color: '#475569' } : undefined}>{fileName}</span>
        <div style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {viewButton}
          {downloadButton}
        </div>
      </div>

      {open && (
        <ModalOverlay
          onClose={() => {
            setOpen(false);
          }}
          ariaLabel="Attachment viewer"
        >
          <div
            className="auth-modal-window"
            style={{
              gridTemplateColumns: '1fr',
              maxWidth: 'min(1100px, 94vw)',
              maxHeight: '90vh',
              overflow: 'hidden',
            }}
          >
            <button type="button" className="auth-modal-close" onClick={() => setOpen(false)}>
              ×
            </button>
            <div className="auth-modal-left" style={{ padding: '1rem', overflow: 'auto' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>{fileName}</div>

              {loading ? (
                <div className="loading-state">Loading file…</div>
              ) : error ? (
                <div className="error-state">{error}</div>
              ) : isPdfUrl(url, mimeType) ? (
                <iframe
                  src={objectUrl || url}
                  title={fileName}
                  style={{ width: '100%', height: '75vh', border: 'none', borderRadius: 8 }}
                />
              ) : isImageUrl(url, mimeType) ? (
                <img
                  src={objectUrl || url}
                  alt={fileName}
                  style={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' }}
                />
              ) : (
                <div>
                  <p>Preview not available for this file type.</p>
                </div>
              )}

              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                {downloadButton}
                <button type="button" className="scert-btn-secondary" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}
