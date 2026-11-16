import { useEffect, useMemo, useState } from 'react';
import { get } from './apiClient.js';
import { useAuth } from './AuthContext.jsx';

const formatSchoolType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  const mapping = {
    primary: 'Primary',
    'ps to ups': 'PS to UPS',
    'ps to secondary': 'PS to Secondary',
    'sec only': 'Sec Only',
    'sec to h sec': 'Sec to H Sec',
    'ups only': 'UPS Only',
    'ups to h sec': 'UPS to H Sec',
    'ups to sec': 'UPS to Sec',
  };
  return mapping[raw] || (raw ? raw.toUpperCase() : '-');
};

export function ScertSchoolListReportPage() {
  const { auth } = useAuth();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [districtFilter, setDistrictFilter] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [schoolCategoryFilter, setSchoolCategoryFilter] = useState('');
  const [schoolTypeFilter, setSchoolTypeFilter] = useState('');

  const [districtOptions, setDistrictOptions] = useState([]);
  const [blockOptions, setBlockOptions] = useState([]);
  const [schoolCategoryOptions, setSchoolCategoryOptions] = useState([]);
  const [schoolTypeOptions, setSchoolTypeOptions] = useState([]);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError('');

        const qs = new URLSearchParams();
        qs.set('page', String(page));
        qs.set('limit', String(limit));
        if (districtFilter) qs.set('district_name', districtFilter);
        if (blockFilter) qs.set('block_name', blockFilter);
        if (schoolCategoryFilter) qs.set('school_category', schoolCategoryFilter);
        if (schoolTypeFilter) qs.set('school_type_name', schoolTypeFilter);
        if (String(search || '').trim()) qs.set('q', String(search).trim());

        const res = await get(`/api/schools?${qs.toString()}`, { token: auth?.token });
        if (!mounted) return;

        setSchools(Array.isArray(res?.schools) ? res.schools : []);
        setPages(Number(res?.pages) || 1);
        setTotal(Number(res?.total) || 0);
        setDistrictOptions(Array.isArray(res?.filters?.districts) ? res.filters.districts : []);
        setBlockOptions(Array.isArray(res?.filters?.blocks) ? res.filters.blocks : []);
        setSchoolCategoryOptions(Array.isArray(res?.filters?.school_categories) ? res.filters.school_categories : []);
        setSchoolTypeOptions(Array.isArray(res?.filters?.school_types) ? res.filters.school_types : []);
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load school list');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [page, limit, search, districtFilter, blockFilter, schoolCategoryFilter, schoolTypeFilter, auth?.token]);

  const pageInfo = useMemo(() => {
    const currentCount = schools.length;
    if (!total || !currentCount) return 'Showing 0 records';
    const start = (page - 1) * limit + 1;
    const end = start + currentCount - 1;
    return `Showing ${start}-${end} of ${total}`;
  }, [schools.length, total, page, limit]);

  return (
    <div className="scert-page">
      <div className="scert-profile-section">
        <div className="school-list-head">
          <h3 className="scert-profile-section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
            School List
          </h3>
          <input
            type="text"
            className="school-list-search"
            placeholder="Search by school name or UDISE code..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="school-list-filters" style={{ marginTop: '0.8rem' }}>
          <label className="school-list-filter-label">
            District
            <select
              value={districtFilter}
              onChange={(e) => {
                setDistrictFilter(e.target.value);
                setBlockFilter('');
                setPage(1);
              }}
            >
              <option value="">All Districts</option>
              {districtOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="school-list-filter-label">
            Block
            <select
              value={blockFilter}
              onChange={(e) => {
                setBlockFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Blocks</option>
              {blockOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <label className="school-list-filter-label">
            School Category
            <select
              value={schoolCategoryFilter}
              onChange={(e) => {
                setSchoolCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Categories</option>
              {schoolCategoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="school-list-filter-label">
            School Type
            <select
              value={schoolTypeFilter}
              onChange={(e) => {
                setSchoolTypeFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Types</option>
              {schoolTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="school-list-table-wrap" style={{ marginTop: '0.7rem' }}>
          {loading ? (
            <div className="school-list-empty">Loading schools...</div>
          ) : error ? (
            <div className="school-list-empty">{error}</div>
          ) : schools.length === 0 ? (
            <div className="school-list-empty">No schools found.</div>
          ) : (
            <table className="school-list-table">
              <thead>
                <tr>
                  <th>UDISE Code</th>
                  <th>School Name</th>
                  <th>District</th>
                  <th>Block</th>
                  <th>School Category</th>
                  <th>School Type</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={`${s.udise_code}-${s.school_name}-${s.district_name || ''}-${s.block_name || ''}`}>
                    <td>{s.udise_code || '-'}</td>
                    <td>{s.school_name || '-'}</td>
                    <td>{s.district_name || '-'}</td>
                    <td>{s.block_name || '-'}</td>
                    <td>{s.school_category || '-'}</td>
                    <td>{s.school_type_name || formatSchoolType(s.school_type)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="school-list-pagination">
          <div className="school-list-page-info">{pageInfo}</div>
          <div className="school-list-page-controls">
            <label className="school-list-limit-label">
              Rows:
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button
              type="button"
              className="school-list-page-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
            >
              Previous
            </button>
            <span className="school-list-page-number">Page {page} of {pages}</span>
            <button
              type="button"
              className="school-list-page-btn"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={loading || page >= pages}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
