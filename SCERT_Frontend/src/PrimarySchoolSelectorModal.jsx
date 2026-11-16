import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';

const PRESCHOOL_CACHE_TTL_MS = 60 * 1000;
const preschoolCache = new Map();
const preschoolInFlight = new Map();

export function PrimarySchoolSelectorModal({ isOpen, onClose, onSelect, currentValue }) {
  const { auth } = useAuth();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedSchool, setSelectedSchool] = useState(null);

  const limit = 20;

  useEffect(() => {
    if (!isOpen) return;
    fetchSchools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, page, searchQuery]);

  const fetchSchools = async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      if (searchQuery) {
        params.append('search', searchQuery);
      }

      const requestPath = `/api/preschools?${params.toString()}`;
      const cacheKey = requestPath;
      const now = Date.now();
      const cached = preschoolCache.get(cacheKey);

      let response;
      if (cached && cached.expiresAt > now) {
        response = cached.data;
      } else {
        const inFlight = preschoolInFlight.get(cacheKey);
        const pending = inFlight || get(requestPath, { token: auth?.token });
        if (!inFlight) {
          preschoolInFlight.set(cacheKey, pending);
        }

        response = await pending;
        preschoolCache.set(cacheKey, {
          data: response,
          expiresAt: now + PRESCHOOL_CACHE_TTL_MS,
        });
      }

      setSchools(response.data || []);
      setTotal(response.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load schools');
    } finally {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (searchQuery) {
        params.append('search', searchQuery);
      }
      preschoolInFlight.delete(`/api/preschools?${params.toString()}`);
      setLoading(false);
    }
  };

  const handleSearchChange = (e) => {
    setSearchInput(e.target.value);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    setSearchQuery(searchInput.trim());
  };

  const handleSelectSchool = (school) => {
    setSelectedSchool(school);
  };

  const handleConfirmSelection = () => {
    if (selectedSchool) {
      onSelect(selectedSchool);
      handleClose();
    }
  };

  const handleClose = () => {
    setSearchInput('');
    setSearchQuery('');
    setPage(1);
    setSelectedSchool(null);
    setSchools([]);
    onClose();
  };

  const totalPages = Math.ceil(total / limit);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content scert-violet-modal primary-school-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
          <div className="auth-password-header-row">
            <div>
              <h2 className="modal-title scert-violet-modal-title">Select Previous School</h2>
              <p className="modal-subtitle">Search by school name, UDISE, district, block, then confirm.</p>
            </div>
            <button
              type="button"
              className="modal-close-btn"
              onClick={handleClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="modal-body">
          <form
            className="search-box"
            onSubmit={handleSearchSubmit}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
          >
            <input
              type="text"
              className="search-input form-input"
              placeholder="Search by school name, UDISE, district, block..."
              value={searchInput}
              onChange={handleSearchChange}
            />
            <button type="submit" className="scert-btn-secondary">
              Search
            </button>
          </form>

          {error && <div className="form-error">{error}</div>}

          {currentValue && (
            <div className="current-selection-info">
              <strong>Current Selection:</strong> {currentValue}
            </div>
          )}

          {loading ? (
            <div className="loading-state">Loading schools...</div>
          ) : (
            <>
              <div className="schools-list">
                {schools.length === 0 ? (
                  <div className="no-results">No schools found</div>
                ) : (
                  schools.map((school) => (
                    <div
                      key={school.udise_code}
                      className={`school-item ${selectedSchool?.udise_code === school.udise_code ? 'selected' : ''}`}
                      onClick={() => handleSelectSchool(school)}
                    >
                      <div className="school-name">{school.school_name}</div>
                      <div className="school-details">
                        UDISE: {school.udise_code} | District: {school.district_name} | Block: {school.block_name}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    type="button"
                    className="scert-btn-secondary"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </button>
                  <span className="pagination-info">
                    Page {page} of {totalPages} ({total} schools)
                  </span>
                  <button
                    type="button"
                    className="scert-btn-secondary"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="scert-btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="scert-btn-violet"
            onClick={handleConfirmSelection}
            disabled={!selectedSchool}
          >
            Confirm Selection
          </button>
        </div>
      </div>
    </div>
  );
}
