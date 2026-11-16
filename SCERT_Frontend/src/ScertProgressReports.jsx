import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { API_BASE_URL, get } from './apiClient.js';
import { useSession } from './scert.session-context.jsx';
import { useToast } from './ToastContext.jsx';
import { ScertNmmssDashboard } from './ScertNmmssSummary.jsx';

function sumTotals(rows, kind) {
  if (!Array.isArray(rows)) return null;
  return rows.reduce(
    (acc, r) => {
      acc.class6_strength += Number(r.class6_strength || 0);
      acc.class6_registered += Number(r.class6_registered || 0);
      acc.class8_strength += Number(r.class8_strength || 0);
      acc.class8_registered += Number(r.class8_registered || 0);
      acc.class9_strength += Number(r.class9_strength || 0);
      acc.class9_registered += Number(r.class9_registered || 0);
      acc.total_registration += Number(r.total_registration || 0);
      return acc;
    },
    {
      kind,
      class6_strength: 0,
      class6_registered: 0,
      class8_strength: 0,
      class8_registered: 0,
      class9_strength: 0,
      class9_registered: 0,
      total_registration: 0,
    }
  );
}

const normalizeTargetClasses = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n));
  }
  return [];
};

export function ScertProgressReports({ onNavigate }) {
  const { auth } = useAuth();
  const { sessionId, selectedScholarshipId, scholarships } = useSession();
  const toast = useToast();

  // NMMSS has no class-strength breakdown (it is Class 8 only) - it shows
  // the same dashboard table (district -> block -> school drill-down)
  // instead, so SCERT does not have to leave Reports to see those figures.
  const selectedScholarshipName = String(
    (scholarships || []).find((s) => s.scholarship_id === selectedScholarshipId)?.scholarship_name || ''
  );
  const isNmmssScholarship =
    /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);

  const [level, setLevel] = useState('district'); // 'district' | 'block' | 'school'
  const [selectedDistrict, setSelectedDistrict] = useState(null); // { district_code, district_name }
  const [selectedBlock, setSelectedBlock] = useState(null); // { block_code, block_name }

  const [rows, setRows] = useState([]);
  const [targetClasses, setTargetClasses] = useState([6, 9]); // Default to CM Scholarship classes
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canFetch = Boolean(auth?.token && sessionId && selectedScholarshipId);

  const fetchDistricts = async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await get(
        `/api/scert/progress-reports/registration/districts?scholarship_id=${encodeURIComponent(selectedScholarshipId)}`,
        { token: auth.token, sessionId }
      );
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      const nextTarget = normalizeTargetClasses(data?.targetClasses ?? data?.target_classes);
      setTargetClasses(nextTarget.length ? nextTarget : [6, 9]);
    } catch (err) {
      console.error('Failed to fetch district progress report:', err);
      setError(err.message || 'Failed to load district progress report');
      toast.error(`Failed to load district report: ${toast.getErrorMessage(err)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchBlocks = async (districtCode) => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await get(
        `/api/scert/progress-reports/registration/blocks?scholarship_id=${encodeURIComponent(
          selectedScholarshipId
        )}&district_code=${encodeURIComponent(districtCode)}`,
        { token: auth.token, sessionId }
      );
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      const nextTarget = normalizeTargetClasses(data?.targetClasses ?? data?.target_classes);
      setTargetClasses(nextTarget.length ? nextTarget : [6, 9]);
    } catch (err) {
      console.error('Failed to fetch block progress report:', err);
      setError(err.message || 'Failed to load block progress report');
      toast.error(`Failed to load block report: ${toast.getErrorMessage(err)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSchools = async (blockCode, districtCode = null) => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const data = await get(
        `/api/scert/progress-reports/registration/schools?scholarship_id=${encodeURIComponent(
          selectedScholarshipId
        )}&block_code=${encodeURIComponent(blockCode)}${
          districtCode ? `&district_code=${encodeURIComponent(districtCode)}` : ''
        }`,
        { token: auth.token, sessionId }
      );
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      const nextTarget = normalizeTargetClasses(data?.targetClasses ?? data?.target_classes);
      setTargetClasses(nextTarget.length ? nextTarget : [6, 9]);
    } catch (err) {
      console.error('Failed to fetch school progress report:', err);
      setError(err.message || 'Failed to load school progress report');
      toast.error(`Failed to load school report: ${toast.getErrorMessage(err)}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!canFetch) return;

    const params = new URLSearchParams();
    params.append('scholarship_id', selectedScholarshipId);

    let endpoint = '/api/scert/progress-reports/registration/districts.pdf';
    let filename = `scert_progress_report_districts_${sessionId}_${selectedScholarshipId}.pdf`;

    if (level === 'block') {
      const dc = selectedDistrict?.district_code;
      if (!dc) return;
      params.append('district_code', dc);
      endpoint = '/api/scert/progress-reports/registration/blocks.pdf';
      filename = `scert_progress_report_blocks_${dc}_${sessionId}_${selectedScholarshipId}.pdf`;
    } else if (level === 'school') {
      const bc = selectedBlock?.block_code;
      if (!bc) return;
      params.append('block_code', bc);
      if (selectedDistrict?.district_code) {
        params.append('district_code', selectedDistrict.district_code);
      }
      endpoint = '/api/scert/progress-reports/registration/schools.pdf';
      filename = `scert_progress_report_schools_${bc}_${sessionId}_${selectedScholarshipId}.pdf`;
    }

    const url = `${API_BASE_URL}${endpoint}?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'x-session-id': sessionId,
        },
      });

      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.message) msg = data.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();

      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Progress report PDF download failed:', e);
      toast.error(toast.getErrorMessage(e, 'Failed to download PDF'));
    }
  };

  useEffect(() => {
    // Reset to district view when scholarship or session changes
    setLevel('district');
    setSelectedDistrict(null);
    setSelectedBlock(null);
    if (selectedScholarshipId && !isNmmssScholarship) fetchDistricts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedScholarshipId, isNmmssScholarship]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, level, selectedDistrict?.district_code, selectedBlock?.block_code, rows.length]);

  const totals = useMemo(() => sumTotals(rows, level), [rows, level]);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE);
  const pageRows = rows.slice(startIdx, endIdx);

  if (!selectedScholarshipId) {
    return <div className="error-state">Please select a scholarship from the dropdown at the top.</div>;
  }

  if (isNmmssScholarship) {
    return (
      <div className="applications-view">
        <div className="view-header-row">
          <div>
            <h3 className="view-title">Progress Reports</h3>
          </div>
        </div>
        <ScertNmmssDashboard
          sessionId={sessionId}
          scholarshipId={selectedScholarshipId}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Progress Reports</h3>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {level === 'block' && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('district');
                setSelectedDistrict(null);
                setSelectedBlock(null);
                fetchDistricts();
              }}
              disabled={loading}
            >
              ← Back to Districts
            </button>
          )}
          {level === 'school' && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('block');
                setSelectedBlock(null);
                if (selectedDistrict?.district_code) {
                  fetchBlocks(selectedDistrict.district_code);
                }
              }}
              disabled={loading}
            >
              ← Back to Blocks
            </button>
          )}

          <button
            type="button"
            className="scert-btn-violet"
            onClick={handleDownloadPdf}
            disabled={!canFetch || loading}
            title="Download as PDF"
          >
            Download PDF
          </button>

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={() => {
              if (level === 'district') fetchDistricts();
              else if (level === 'block' && selectedDistrict?.district_code)
                fetchBlocks(selectedDistrict.district_code);
              else if (level === 'school' && selectedBlock?.block_code)
                fetchSchools(selectedBlock.block_code, selectedDistrict?.district_code || null);
            }}
            disabled={!canFetch || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading progress report...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No data found.</div>
      ) : (
        <>
        <div className="smart-table-wrap scert-progress-table-wrap beo-submitted-table-wrap">
          <table className="smart-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>S.No</th>
                <th>
                  {level === 'district'
                    ? 'Name of the District'
                    : level === 'block'
                    ? 'Name of the Block'
                    : 'Name of the School'}
                </th>
                {targetClasses.includes(6) && (
                  <>
                    <th>Students in Class 6</th>
                    <th>Registered for Scholarship (Class 6)</th>
                  </>
                )}
                {targetClasses.includes(8) && (
                  <>
                    <th>Students in Class 8</th>
                    <th>Registered for Scholarship (Class 8)</th>
                  </>
                )}
                {targetClasses.includes(9) && (
                  <>
                    <th>Students in Class 9</th>
                    <th>Registered for Scholarship (Class 9)</th>
                  </>
                )}
                <th>Total Registration</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, idx) => {
                const isClickable = level === 'district' || level === 'block';
                const handleClick = () => {
                  if (level === 'district') {
                    setSelectedDistrict({
                      district_code: r.district_code,
                      district_name: r.district_name,
                    });
                    setLevel('block');
                    fetchBlocks(r.district_code);
                  } else if (level === 'block') {
                    setSelectedBlock({
                      block_code: r.block_code,
                      block_name: r.block_name,
                    });
                    setLevel('school');
                    fetchSchools(r.block_code, selectedDistrict?.district_code || null);
                  }
                };

                return (
                  <tr
                    key={String(
                      (level === 'district'
                        ? r.district_code
                        : level === 'block'
                        ? r.block_code
                        : r.school_udise_code) || idx
                    )}
                    onClick={isClickable ? handleClick : undefined}
                    style={isClickable ? { cursor: 'pointer' } : undefined}
                    title={
                      level === 'district'
                        ? 'Click to view block-wise report'
                        : level === 'block'
                        ? 'Click to view school-wise report'
                        : undefined
                    }
                  >
                    <td className="smart-table-strong">{startIdx + idx + 1}</td>
                    <td className="smart-table-strong">
                      {level === 'district'
                        ? r.district_name || '—'
                        : level === 'block'
                        ? r.block_name || '—'
                        : r.school_name || '—'}
                    </td>
                    {targetClasses.includes(6) && (
                      <>
                        <td>{r.class6_strength ?? 0}</td>
                        <td>{r.class6_registered ?? 0}</td>
                      </>
                    )}
                    {targetClasses.includes(8) && (
                      <>
                        <td>{r.class8_strength ?? 0}</td>
                        <td>{r.class8_registered ?? 0}</td>
                      </>
                    )}
                    {targetClasses.includes(9) && (
                      <>
                        <td>{r.class9_strength ?? 0}</td>
                        <td>{r.class9_registered ?? 0}</td>
                      </>
                    )}
                    <td className="smart-table-strong">{r.total_registration ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot>
                <tr>
                  <td />
                  <td className="smart-table-strong">Total</td>
                  {targetClasses.includes(6) && (
                    <>
                      <td className="smart-table-strong">{totals.class6_strength}</td>
                      <td className="smart-table-strong">{totals.class6_registered}</td>
                    </>
                  )}
                  {targetClasses.includes(8) && (
                    <>
                      <td className="smart-table-strong">{totals.class8_strength}</td>
                      <td className="smart-table-strong">{totals.class8_registered}</td>
                    </>
                  )}
                  {targetClasses.includes(9) && (
                    <>
                      <td className="smart-table-strong">{totals.class9_strength}</td>
                      <td className="smart-table-strong">{totals.class9_registered}</td>
                    </>
                  )}
                  <td className="smart-table-strong">{totals.total_registration}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="pagination">
          <button
            type="button"
            className="pagination-btn"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="pagination-info">
            Showing <strong>{totalRows === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
            <strong>{totalRows}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
          </span>
          <button
            type="button"
            className="pagination-btn"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
        </>
      )}
    </div>
  );
}
