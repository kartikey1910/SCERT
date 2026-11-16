import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const DEFAULT_DURATIONS_MS = {
  success: 2800,
  info: 3500,
  warning: 4500,
  error: 6000,
};

const TYPE_ICON = {
  success: '✓',
  info: 'i',
  warning: '!',
  error: '×',
};

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const clampMessage = (message) => {
  const text = normalizeText(message).trim();
  if (!text) return '';
  // keep toasts short-ish; avoid giant backend dumps
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
};

const getErrorMessage = (err, fallback = 'Something went wrong. Please try again.') => {
  if (!err) return fallback;

  const status = err?.status;
  if (status === 401) return 'Session expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';

  const message = clampMessage(err?.message || err);
  return message || fallback;
};

function ToastViewport({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-relevant="additions removals">
      {toasts.map((t) => {
        const type = t.type || 'info';
        const icon = TYPE_ICON[type] || TYPE_ICON.info;

        return (
          <div key={t.id} className={`toast toast--${type}`} role="status">
            <div className="toast-inner">
              <div className="toast-icon" aria-hidden="true">
                {icon}
              </div>
              <div className="toast-body">
                {t.title ? <div className="toast-title">{t.title}</div> : null}
                <div className="toast-message">{t.message}</div>
              </div>
            </div>

            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ToastProvider({ children, maxToasts = 4 }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    ({ type = 'info', title = '', message = '', durationMs, id } = {}) => {
      const resolvedId = id || makeId();
      const resolvedType = type || 'info';
      const resolvedMessage = clampMessage(message);

      if (!resolvedMessage) return null;

      const duration =
        Number.isFinite(durationMs) && durationMs !== null
          ? durationMs
          : DEFAULT_DURATIONS_MS[resolvedType] || DEFAULT_DURATIONS_MS.info;

      const toast = {
        id: resolvedId,
        type: resolvedType,
        title,
        message: resolvedMessage,
      };

      setToasts((prev) => {
        const next = [...prev, toast];
        if (next.length > maxToasts) {
          return next.slice(next.length - maxToasts);
        }
        return next;
      });

      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(resolvedId), duration);
        timersRef.current.set(resolvedId, timer);
      }

      return resolvedId;
    },
    [dismiss, maxToasts]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const api = useMemo(() => {
    return {
      toasts,
      push,
      dismiss,
      getErrorMessage,
      show: (message, options = {}) => push({ ...options, message }),
      success: (message, options = {}) => push({ type: 'success', ...options, message }),
      info: (message, options = {}) => push({ type: 'info', ...options, message }),
      warning: (message, options = {}) => push({ type: 'warning', ...options, message }),
      error: (message, options = {}) => push({ type: 'error', ...options, message }),
    };
  }, [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
