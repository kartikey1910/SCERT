/**
 * NMMSS dashboard for SCERT and District: the BEO dashboard's status cards and
 * table, one level up. For SCERT the table opens District -> Block -> School;
 * for a District user it starts at the district's Blocks. Clicking a row opens
 * the level below it. Every level has the same columns, so the figures can be
 * read across and added down.
 *
 * Qualified and Selected need NMMSS results, which the system does not hold
 * yet, so they show a dash rather than 0 (see BeoNmmssSummary).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get, API_BASE_URL } from './apiClient.js';
import { useToast } from './ToastContext.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

const LEVEL_HEAD = {
  district: 'District Name',
  block: 'Block Name',
  school: 'Schools Name',
};

function PendingCells({ count }) {
  return Array.from({ length: count }, (_, i) => (
    <td
      key={i}
      className="school-nmmss-num beo-nmmss-pending"
      title="Available once results are declared"
    >
      &mdash;
    </td>
  ));
}

const DEFAULT_CARDS = (counts) => [
  { key: 'pending', label: 'Pending Applications', value: Number(counts.pending || 0), tone: 'yellow', view: 'pending-applications' },
  { key: 'approved', label: 'Approved Applications', value: Number(counts.approved || 0), tone: 'green', view: 'approved-applications' },
  { key: 'returned_to_beo', label: 'Applications Returned to BEO', value: Number(counts.returned_to_beo || 0), tone: 'orange', view: 'returned-to-beo' },
];

/**
 * @param {string} [endpoint]   summary endpoint (SCERT by default)
 * @param {'district'|'block'} [rootLevel]  the level the table opens at
 * @param {(counts:object)=>object[]} [buildCards]  status cards; a card
 *   without a `view` is shown but does not link anywhere
 * @param {boolean} [boldCounts]  show the figures in bold
 * @param {string} [pdfEndpoint]  when set, a Download PDF button fetches the
 *   table at the level on screen from this endpoint
 */
export function ScertNmmssDashboard({
  sessionId,
  scholarshipId,
  onNavigate,
  endpoint = '/api/scert/dashboard/nmmss-summary',
  rootLevel = 'district',
  buildCards = DEFAULT_CARDS,
  boldCounts = false,
  pdfEndpoint,
}) {
  const { auth } = useAuth();
  const toast = useToast();
  const token = auth?.token;
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const [level, setLevel] = useState(rootLevel);
  const [district, setDistrict] = useState(null); // { district_code, district_name }
  const [block, setBlock] = useState(null); // { block_code, block_name }
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (nextLevel, nextDistrict, nextBlock) => {
      if (!token || !scholarshipId) return;
      setLoading(true);
      setError('');
      try {
        const qs = new URLSearchParams({ scholarship_id: String(scholarshipId), level: nextLevel });
        if (nextDistrict?.district_code) qs.set('district_code', nextDistrict.district_code);
        if (nextLevel === 'school' && nextBlock?.block_code) qs.set('block_code', nextBlock.block_code);
        const result = await get(`${endpoint}?${qs.toString()}`, { token, sessionId });
        setData(result);
      } catch (err) {
        setData(null);
        setError(err?.message || 'Unable to load the NMMSS summary');
      } finally {
        setLoading(false);
      }
    },
    [token, sessionId, scholarshipId, endpoint]
  );

  // A different scholarship or session starts again from the districts.
  useEffect(() => {
    setLevel(rootLevel);
    setDistrict(null);
    setBlock(null);
    load(rootLevel, null, null);
  }, [load, rootLevel]);

  const go = (nextLevel, nextDistrict, nextBlock) => {
    setLevel(nextLevel);
    setDistrict(nextDistrict);
    setBlock(nextBlock);
    load(nextLevel, nextDistrict, nextBlock);
  };

  const openRow = (row) => {
    if (level === 'district') {
      go('block', { district_code: row.district_code, district_name: row.district_name }, null);
    } else if (level === 'block') {
      go('school', district, { block_code: row.block_code, block_name: row.block_name });
    }
  };

  const cards = buildCards(data?.counts || {});

  const downloadPdf = async () => {
    if (!pdfEndpoint || !token || !scholarshipId) return;
    setDownloadingPdf(true);
    try {
      const qs = new URLSearchParams({ scholarship_id: String(scholarshipId), level });
      if (district?.district_code) qs.set('district_code', district.district_code);
      if (level === 'school' && block?.block_code) qs.set('block_code', block.block_code);
      const res = await fetch(`${API_BASE_URL}${pdfEndpoint}?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-session-id': sessionId },
      });
      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.message) msg = body.message;
        } catch {
          // not JSON
        }
        throw new Error(msg);
      }
      const disposition = res.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ||
        `progress_report_nmmss_${level === 'school' ? `schools_${block?.block_code}` : `${level}s`}_${sessionId}_${scholarshipId}.pdf`;
      const blobUrl = window.URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(toast.getErrorMessage(err, 'Failed to download PDF'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const otherRegistered = Number(totals.registered_other || 0);
  const clickable = level !== 'school';
  const numClass = boldCounts ? 'school-nmmss-num beo-nmmss-count' : 'school-nmmss-num';

  const rowKey = (row) =>
    level === 'district' ? row.district_code : level === 'block' ? row.block_code : row.school_user_id;
  const rowName = (row) =>
    level === 'district' ? row.district_name : level === 'block' ? row.block_name : row.school_name;

  return (
    <div className="beo-nmmss-dashboard scert-nmmss-dashboard">
      {data && (
        <div className="school-dashboard-home-stats school-dashboard-home-stats--three beo-nmmss-cards">
          {cards.map((card) =>
            card.view ? (
              <button
                key={card.key}
                type="button"
                className={`school-dashboard-home-stat-card school-dashboard-home-stat-card--${card.tone} school-dashboard-home-stat-card--link`}
                title={`Open ${card.label}`}
                onClick={() => onNavigate?.(card.view)}
              >
                <span className="school-dashboard-home-stat-label">{card.label}</span>
                <span className="school-dashboard-home-stat-value">{card.value}</span>
              </button>
            ) : (
              <div
                key={card.key}
                className={`school-dashboard-home-stat-card school-dashboard-home-stat-card--${card.tone}`}
              >
                <span className="school-dashboard-home-stat-label">{card.label}</span>
                <span className="school-dashboard-home-stat-value">{card.value}</span>
              </div>
            )
          )}
        </div>
      )}

      <div className="scert-nmmss-crumbs" aria-label="Location">
        <button
          type="button"
          className="scert-nmmss-crumb"
          onClick={() => go(rootLevel, null, null)}
          disabled={level === rootLevel || loading}
        >
          {rootLevel === 'district' ? 'All Districts' : 'All Blocks'}
        </button>
        {district && (
          <>
            <span className="scert-nmmss-crumb-sep" aria-hidden="true">›</span>
            <button
              type="button"
              className="scert-nmmss-crumb"
              onClick={() => go('block', district, null)}
              disabled={level === 'block' || loading}
            >
              {district.district_name}
            </button>
          </>
        )}
        {block && (
          <>
            <span className="scert-nmmss-crumb-sep" aria-hidden="true">›</span>
            <span className="scert-nmmss-crumb scert-nmmss-crumb--current">{block.block_name}</span>
          </>
        )}
        {level !== rootLevel && (
          <button
            type="button"
            className="scert-btn-secondary scert-nmmss-back"
            onClick={() => (level === 'school' ? go('block', district, null) : go(rootLevel, null, null))}
            disabled={loading}
          >
            {level === 'school' ? '← Back to Blocks' : '← Back to Districts'}
          </button>
        )}
        {pdfEndpoint && (
          <button
            type="button"
            className="scert-btn-secondary scert-nmmss-pdf"
            onClick={downloadPdf}
            disabled={downloadingPdf || loading || !rows.length}
            title="Download this table as PDF"
          >
            {downloadingPdf ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        )}
      </div>

      {error ? (
        <div className="error-state school-nmmss-summary-error">{error}</div>
      ) : (
        <section className="school-nmmss-summary beo-nmmss-summary" aria-label={`${LEVEL_HEAD[level]} wise students`}>
          <div className="school-nmmss-scroll">
            <table className="school-nmmss-table beo-nmmss-table">
              <thead>
                <tr>
                  <th rowSpan={2} scope="col" className="beo-nmmss-sno">S.No</th>
                  <th rowSpan={2} scope="col" className="beo-nmmss-school-head">{LEVEL_HEAD[level]}</th>
                  <th rowSpan={2} scope="col">Enrolled Students in Class 8</th>
                  <th colSpan={3} scope="colgroup">Registered</th>
                  <th rowSpan={2} scope="col">Appeared in Exam</th>
                  <th rowSpan={2} scope="col">Qualified Students</th>
                  <th colSpan={4} scope="colgroup">Selected Students</th>
                </tr>
                <tr>
                  <th scope="col" className="school-nmmss-sub">NMMSS (Code 1)</th>
                  <th scope="col" className="school-nmmss-sub">SNSS and SSSS (Code 2)</th>
                  <th scope="col" className="school-nmmss-sub">Total</th>
                  <th scope="col" className="school-nmmss-sub">NMMSS</th>
                  <th scope="col" className="school-nmmss-sub">SNSS</th>
                  <th scope="col" className="school-nmmss-sub">SSSS</th>
                  <th scope="col" className="school-nmmss-sub">Total</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="school-nmmss-unavailable">Loading…</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="school-nmmss-unavailable">
                      No {level === 'district' ? 'districts' : level === 'block' ? 'blocks' : 'schools'} found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr
                      key={String(rowKey(row) ?? idx)}
                      className={clickable ? 'scert-nmmss-row-link' : undefined}
                      onClick={clickable ? () => openRow(row) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openRow(row);
                              }
                            }
                          : undefined
                      }
                      tabIndex={clickable ? 0 : undefined}
                      title={clickable ? `Open ${level === 'district' ? 'blocks' : 'schools'} of ${rowName(row)}` : undefined}
                    >
                      <td className="school-nmmss-num beo-nmmss-sno">{idx + 1}</td>
                      <th scope="row" className="beo-nmmss-school">{rowName(row) || '—'}</th>
                      <td className={numClass}>{fmt(row.enrolled)}</td>
                      <td className={numClass}>{fmt(row.registered_nmmss)}</td>
                      <td className={numClass}>{fmt(row.registered_snss_ssss)}</td>
                      <td className={`${numClass} school-nmmss-grand`}>{fmt(row.registered_total)}</td>
                      <td className={numClass}>{fmt(row.appeared)}</td>
                      <PendingCells count={5} />
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="beo-nmmss-total-row">
                    <th colSpan={2} scope="row" className="beo-nmmss-total-label">Total</th>
                    <td className={numClass}>{fmt(totals.enrolled)}</td>
                    <td className={numClass}>{fmt(totals.registered_nmmss)}</td>
                    <td className={numClass}>{fmt(totals.registered_snss_ssss)}</td>
                    <td className={`${numClass} school-nmmss-grand`}>{fmt(totals.registered_total)}</td>
                    <td className={numClass}>{fmt(totals.appeared)}</td>
                    <PendingCells count={5} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <p className="school-nmmss-note beo-nmmss-note" role="note">
            {clickable && 'Click a row to open it. '}
            Qualified and Selected figures will appear once the NMMSS results are declared.
            {otherRegistered > 0 && (
              <>
                {' '}
                {fmt(otherRegistered)} registered student{otherRegistered !== 1 ? 's' : ''} without an
                exam code (1 or 2) {otherRegistered !== 1 ? 'are' : 'is'} not counted in the Registered columns.
              </>
            )}
          </p>
        </section>
      )}
    </div>
  );
}
