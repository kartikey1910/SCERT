import { createContext, useContext, useState, useEffect } from 'react';
import { get } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';
import { pickDefaultScholarship } from './utils/defaultScholarship.js';

const DashboardContext = createContext();

const SESSION_CACHE_TTL_MS = 60 * 1000;
const SCHOLARSHIP_CACHE_TTL_MS = 60 * 1000;
const sessionsCacheByToken = new Map();
const sessionsInFlightByToken = new Map();
const scholarshipCacheByScope = new Map();
const scholarshipsInFlightByScope = new Map();

export function useDashboard() {
  return useContext(DashboardContext);
}

export function DashboardProvider({ children }) {
  const { auth } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [scholarships, setScholarships] = useState([]);
  const [selectedScholarshipId, setSelectedScholarshipId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingScholarships, setLoadingScholarships] = useState(false);

  useEffect(() => {
    const token = auth?.token;
    if (!token) {
      setSessions([]);
      setSelectedSessionId(null);
      setLoadingSessions(false);
      return;
    }

    const fetchSessions = async () => {
      setLoadingSessions(true);
      try {
        const now = Date.now();
        const cached = sessionsCacheByToken.get(token);

        let data;
        if (cached && cached.expiresAt > now) {
          data = cached.data;
        } else {
          const inFlight = sessionsInFlightByToken.get(token);
          const pending = inFlight || get('/api/sessions', { token });
          if (!inFlight) {
            sessionsInFlightByToken.set(token, pending);
          }

          data = await pending;
          sessionsCacheByToken.set(token, {
            data,
            expiresAt: now + SESSION_CACHE_TTL_MS,
          });
        }

        setSessions(data);
        const activeSession = data.find((s) => s.is_active);
        if (activeSession) {
          setSelectedSessionId(activeSession.session_id);
        } else if (data.length > 0) {
          setSelectedSessionId(data[0].session_id);
        }
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
      } finally {
        sessionsInFlightByToken.delete(token);
        setLoadingSessions(false);
      }
    };

    fetchSessions();
  }, [auth?.token]);

  useEffect(() => {
    const token = auth?.token;
    if (!token || !selectedSessionId) {
      setScholarships([]);
      setSelectedScholarshipId(null);
      setLoadingScholarships(false);
      return;
    }

    const fetchScholarships = async () => {
      setLoadingScholarships(true);
      const scopeKey = `${token}:${selectedSessionId}`;

      try {
        const now = Date.now();
        const cached = scholarshipCacheByScope.get(scopeKey);

        let data;
        if (cached && cached.expiresAt > now) {
          data = cached.data;
        } else {
          const inFlight = scholarshipsInFlightByScope.get(scopeKey);
          const pending =
            inFlight ||
            get('/api/scholarships', {
              token,
              sessionId: selectedSessionId,
            });

          if (!inFlight) {
            scholarshipsInFlightByScope.set(scopeKey, pending);
          }

          data = await pending;
          scholarshipCacheByScope.set(scopeKey, {
            data,
            expiresAt: now + SCHOLARSHIP_CACHE_TTL_MS,
          });
        }

        setScholarships(data);
        const defaultScholarship = pickDefaultScholarship(data);
        setSelectedScholarshipId(defaultScholarship ? defaultScholarship.scholarship_id : null);
      } catch (err) {
        console.error('Failed to fetch scholarships:', err);
        setScholarships([]);
        setSelectedScholarshipId(null);
      } finally {
        scholarshipsInFlightByScope.delete(scopeKey);
        setLoadingScholarships(false);
      }
    };

    fetchScholarships();
  }, [selectedSessionId, auth?.token]);

  const value = {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    scholarships,
    selectedScholarshipId,
    setSelectedScholarshipId,
    loadingSessions,
    loadingScholarships,
    selectedSession: sessions.find((s) => s.session_id === selectedSessionId),
    selectedScholarship: scholarships.find((s) => s.scholarship_id === selectedScholarshipId),
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
