import { createContext, useContext, useEffect, useState } from 'react';
import { setCurrentAuth } from './utils/currentAuth.js';

const AuthContext = createContext(null);

const STORAGE_KEY = 'scert_auth';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const initial = stored ? JSON.parse(stored) : null;
      setCurrentAuth(initial);
      return initial;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (auth) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [auth]);

  // Updated here rather than in an effect: pages fetch in their own mount
  // effects, which run before this provider's.
  const login = (payload) => {
    setCurrentAuth(payload);
    setAuth(payload);
  };

  const logout = () => {
    setCurrentAuth(null);
    setAuth(null);
  };

  const updateAuth = (updates) => {
    setAuth((prev) => {
      const next = prev ? { ...prev, ...updates } : null;
      setCurrentAuth(next);
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{ auth, login, logout, updateAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
