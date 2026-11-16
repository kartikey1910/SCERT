import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';

const normalizeCode = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  return Number.isNaN(n) ? s.toUpperCase() : String(n);
};

const getBlockKey = (beo) => {
  const blockCodeKey = normalizeCode(beo?.block_code);
  const blockNameKey = String(beo?.block_name ?? '').trim().toUpperCase();
  const unitIdKey = String(beo?.unit_id ?? '').trim().toUpperCase();
  if (blockCodeKey || blockNameKey) {
    return `${blockCodeKey}|${blockNameKey}`;
  }
  if (unitIdKey) return `UNIT:${unitIdKey}`;
  return `USER:${String(beo?.user_id ?? '').trim()}`;
};

const compareBlockCodesAsc = (a, b) => {
  const aCodeRaw = String(a?.block_code ?? '').trim();
  const bCodeRaw = String(b?.block_code ?? '').trim();
  const aNum = Number(aCodeRaw);
  const bNum = Number(bCodeRaw);
  const aIsNum = aCodeRaw !== '' && !Number.isNaN(aNum);
  const bIsNum = bCodeRaw !== '' && !Number.isNaN(bNum);

  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return aCodeRaw.localeCompare(bCodeRaw, undefined, { numeric: true, sensitivity: 'base' });
};

export function ScertListBeoPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, selectedScholarshipId } = useSession();

  const [level, setLevel] = useState('district'); // district | beo
  const [selectedDistrict, setSelectedDistrict] = useState(null); // { district_code, district_name }

  const [districts, setDistricts] = useState([]);
  const [beos, setBeos] = useState([]);
  const [allBeos, setAllBeos] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef(null);

  const [reimbursementRate, setReimbursementRate] = useState(30);
  const [logisticsRate, setLogisticsRate] = useState(20);

  const canFetch = Boolean(auth?.token);

  useEffect(() => {
    if (!canFetch) return;
    const fetchRates = async () => {
      try {
        const data = await get('/api/scert/rates/system?report_type=BEO_REPORT', { token: auth?.token });
        const rates = data.rates || [];
        const rRate = rates.find(r => r.rate_key === 'BEO_REIMBURSEMENT_PER_STUDENT');
        const lRate = rates.find(r => r.rate_key === 'BEO_LOGISTICS_PER_KM');
        if (rRate) setReimbursementRate(Number(rRate.rate_value));
        if (lRate) setLogisticsRate(Number(lRate.rate_value));
      } catch (err) {
        console.error('Failed to load dynamic rates', err);
      }
    };
    fetchRates();
  }, [canFetch, auth?.token]);

  // Fetch all BEOs and group by district
  const fetchBeos = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.set('limit', '5000');
      if (selectedScholarshipId) params.set('scholarship_id', selectedScholarshipId);
      const data = await get(`/api/scert/beos?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      const beoList = Array.isArray(data.data) ? data.data : [];
      setAllBeos(beoList);

      // Group by district and count unique blocks
      const districtMap = new Map();
      
      beoList.forEach((beo) => {
        const dc = normalizeCode(beo.district_code);
        if (!districtMap.has(dc)) {
          districtMap.set(dc, {
            district_code: dc,
            district_name: beo.district_name || `District ${dc}`,
            blocks: new Set(),
          });
        }
        districtMap.get(dc).blocks.add(getBlockKey(beo));
      });

      // Convert to array with block counts
      const districtList = Array.from(districtMap.values()).map((d) => ({
        district_code: d.district_code,
        district_name: d.district_name,
        total_blocks: d.blocks.size,
      }));

      districtList.sort((a, b) => a.district_name.localeCompare(b.district_name));
      setDistricts(districtList);
    } catch (err) {
      console.error('Failed to fetch BEOs:', err);
      setError(err.message || 'Failed to load BEO data');
      toast.error(`Failed to load BEO list: ${toast.getErrorMessage(err)}`);
      setDistricts([]);
      setAllBeos([]);
    } finally {
      setLoading(false);
    }
  }, [canFetch, auth?.token, sessionId, selectedScholarshipId]);

  const fetchBeosForDistrict = useCallback(
    (districtCode) => {
      const normalizedDistrictCode = normalizeCode(districtCode);
      const filteredBeos = allBeos.filter(
        (beo) => normalizeCode(beo.district_code) === normalizedDistrictCode
      );

      setBeos(filteredBeos);
    },
    [allBeos]
  );

  // Initial load
  useEffect(() => {
    setLevel('district');
    setSelectedDistrict(null);
    setBeos([]);

    if (canFetch) {
      fetchBeos();
    } else {
      setDistricts([]);
      setAllBeos([]);
    }
  }, [canFetch, fetchBeos, sessionId, selectedScholarshipId]);

  const isDistrictView = level === 'district';
  const isBeoView = level === 'beo';
  const sortedBeos = [...beos].sort(compareBlockCodesAsc);
  const beoTotals = sortedBeos.reduce(
    (acc, beo) => {
      const distance = Number(beo.distance_from_ceo_office ?? 0);
      const registered = Number(beo.registered_students ?? 0);
      const appeared = Number(beo.appeared_students ?? 0);
      const reimbursement = appeared * reimbursementRate;
      const logistics = distance * logisticsRate;
      const contingency = Number(beo.contingency ?? 0);
      const other = Number(beo.other ?? 0);
      const total = reimbursement + logistics + contingency + other;

      return {
        registered: acc.registered + registered,
        appeared: acc.appeared + appeared,
        reimbursement: acc.reimbursement + reimbursement,
        logistics: acc.logistics + logistics,
        contingency: acc.contingency + contingency,
        other: acc.other + other,
        total: acc.total + total,
      };
    },
    {
      registered: 0,
      appeared: 0,
      reimbursement: 0,
      logistics: 0,
      contingency: 0,
      other: 0,
      total: 0,
    }
  );

  useEffect(() => {
    const onDocClick = (event) => {
      if (!downloadMenuRef.current) return;
      if (!downloadMenuRef.current.contains(event.target)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, level, districts.length, beos.length]);

  const title = isDistrictView
    ? 'BEO Account Details'
    : `BEO Account Details — ${selectedDistrict?.district_name || selectedDistrict?.district_code || ''}`;

  const subtitle = isDistrictView
    ? 'District-wise summary of BEO officers.'
    : 'BEO details under selected district.';

  const handleRefresh = () => {
    if (isDistrictView) {
      fetchBeos();
    } else if (selectedDistrict?.district_code) {
      fetchBeosForDistrict(selectedDistrict.district_code);
    }
  };

  const activeRowsCount = isDistrictView ? districts.length : sortedBeos.length;
  const totalPages = Math.max(1, Math.ceil(activeRowsCount / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(activeRowsCount, startIdx + PAGE_SIZE);
  const pageDistricts = districts.slice(startIdx, endIdx);
  const pageBeos = sortedBeos.slice(startIdx, endIdx);

  const downloadBeoExcel = () => {
    if (!Array.isArray(beos) || beos.length === 0) {
      toast.info('No BEO data to download');
      return;
    }

    const escapeCsv = (value) => {
      const safe = value == null ? '' : String(value);
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const escapeHtml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const heading = 'National Means Cum Merit, Dr Shivanand Nautiyal and Sridev Suman Scholarship Scheme';
    const subtitle = 'List of BEO with account details';
    const headers = [
      'Block Code',
      'Block Name',
      'Account No.',
      'IFSC Code',
      'Bank Name',
      'Distance from CEO office',
      'Registered Student',
      'Appeared Student',
      `Reimbursement @ Rs ${reimbursementRate} rupee per appeared student`,
      `Logistics cost @ Rs ${logisticsRate} rupee per Km`,
      'Contingency',
      'Other',
      'Total Amount',
    ];
    const dataRows = [];

    sortedBeos.forEach((beo) => {
      const distance = Number(beo.distance_from_ceo_office ?? 0);
      const registered = Number(beo.registered_students ?? 0);
      const appeared = Number(beo.appeared_students ?? 0);
      const reimbursement = appeared * reimbursementRate;
      const logistics = distance * logisticsRate;
      const contingency = Number(beo.contingency ?? 0);
      const other = Number(beo.other ?? 0);
      const total = reimbursement + logistics + contingency + other;

      dataRows.push([
        beo.block_code || '—',
        beo.block_name || '—',
        beo.beo_account_no || '—',
        beo.beo_ifsc_code || '—',
        beo.beo_bank_name || '—',
        Number.isFinite(distance) ? `${distance} km` : '—',
        registered,
        appeared,
        reimbursement,
        logistics,
        contingency || '',
        other || '',
        total,
      ]);
    });

    const totalRow = [
      '',
      'Total',
      '',
      '',
      '',
      '',
      beoTotals.registered,
      beoTotals.appeared,
      beoTotals.reimbursement,
      beoTotals.logistics,
      beoTotals.contingency || '',
      beoTotals.other || '',
      beoTotals.total,
    ];
    const csvRows = [headers, ...dataRows, totalRow];
    const csv = `\uFEFF${csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`;
    const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const fileName = 'list_of_beo_with_account_details.csv';

    const link = document.createElement('a');
    link.href = csvUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    const tableRowsHtml = dataRows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
      )
      .join('');
    const previewHtml = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>BEO Export Preview</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
          h2, h3 { text-align: center; margin: 0 0 8px; }
          .actions { text-align: right; margin-bottom: 10px; }
          .btn { display: inline-block; padding: 8px 12px; border: 1px solid #9ca3af; border-radius: 8px; text-decoration: none; color: #111827; }
          .table-wrap { overflow: auto; border: 1px solid #d1d5db; border-radius: 10px; }
          table { width: 100%; border-collapse: collapse; min-width: 1200px; }
          th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 13px; white-space: nowrap; }
          th { background: #f3f4f6; font-weight: 700; }
        </style>
      </head>
      <body>
        <h2>${escapeHtml(heading)}</h2>
        <h3>${escapeHtml(subtitle)}</h3>
        <div class="actions">
          <a class="btn" href="${csvUrl}" download="${escapeHtml(fileName)}">Download CSV</a>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${tableRowsHtml}</tbody>
          </table>
        </div>
      </body>
      </html>
    `;
    const previewBlob = new Blob([previewHtml], { type: 'text/html;charset=utf-8;' });
    const previewUrl = URL.createObjectURL(previewBlob);
    window.open(previewUrl, '_blank', 'noopener,noreferrer');

    setTimeout(() => {
      URL.revokeObjectURL(csvUrl);
      URL.revokeObjectURL(previewUrl);
    }, 120000);
    setShowDownloadMenu(false);
  };

  const downloadBeoPdf = () => {
    if (!Array.isArray(sortedBeos) || sortedBeos.length === 0) {
      toast.info('No BEO data to download');
      return;
    }

    const heading = 'National Means Cum Merit, Dr Shivanand Nautiyal and Sridev Suman Scholarship Scheme';
    const subtitle = 'List of BEO with account details';
    const rowsHtml = sortedBeos
      .map((beo) => {
        const distance = Number(beo.distance_from_ceo_office ?? 0);
        const registered = Number(beo.registered_students ?? 0);
        const appeared = Number(beo.appeared_students ?? 0);
        const reimbursement = appeared * reimbursementRate;
        const logistics = distance * logisticsRate;
        const contingency = Number(beo.contingency ?? 0);
        const other = Number(beo.other ?? 0);
        const total = reimbursement + logistics + contingency + other;

        return `
          <tr>
            <td>${beo.block_code || '—'}</td>
            <td>${beo.block_name || '—'}</td>
            <td>${beo.beo_account_no || '—'}</td>
            <td>${beo.beo_ifsc_code || '—'}</td>
            <td>${beo.beo_bank_name || '—'}</td>
            <td>${Number.isFinite(distance) ? `${distance} km` : '—'}</td>
            <td>${registered}</td>
            <td>${appeared}</td>
            <td>₹${reimbursement.toLocaleString('en-IN')}</td>
            <td>₹${logistics.toLocaleString('en-IN')}</td>
            <td>${contingency ? `₹${contingency.toLocaleString('en-IN')}` : '—'}</td>
            <td>${other ? `₹${other.toLocaleString('en-IN')}` : '—'}</td>
            <td>₹${total.toLocaleString('en-IN')}</td>
          </tr>
        `;
      })
      .join('');
    const totalsRowHtml = `
      <tr>
        <td></td>
        <td><strong>Total</strong></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td><strong>${beoTotals.registered}</strong></td>
        <td><strong>${beoTotals.appeared}</strong></td>
        <td><strong>₹${beoTotals.reimbursement.toLocaleString('en-IN')}</strong></td>
        <td><strong>₹${beoTotals.logistics.toLocaleString('en-IN')}</strong></td>
        <td><strong>${beoTotals.contingency ? `₹${beoTotals.contingency.toLocaleString('en-IN')}` : '—'}</strong></td>
        <td><strong>${beoTotals.other ? `₹${beoTotals.other.toLocaleString('en-IN')}` : '—'}</strong></td>
        <td><strong>₹${beoTotals.total.toLocaleString('en-IN')}</strong></td>
      </tr>
    `;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>List of BEO with account details</title>
        <style>
          @media print { @page { size: A4 landscape; margin: 10mm; } }
          body { font-family: Arial, sans-serif; color: #111827; margin: 10px; }
          h2, h3 { text-align: center; margin: 0; }
          h3 { margin: 6px 0 12px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #000; padding: 6px 4px; text-align: center; vertical-align: middle; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h2>${heading}</h2>
        <h3>${subtitle}</h3>
        <table>
          <thead>
            <tr>
              <th>Block Code</th>
              <th>Block Name</th>

              <th>Account No.</th>
              <th>IFSC Code</th>
              <th>Bank Name</th>
              <th>Distance from CEO office</th>
              <th>Registered Student</th>
              <th>Appeared Student</th>
              <th>Reimbursement @ Rs ${reimbursementRate} rupee per appeared student</th>
              <th>Logistics cost @ Rs ${logisticsRate} rupee per Km</th>
              <th>Contingency</th>
              <th>Other</th>
              <th>Total Amount</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}${totalsRowHtml}</tbody>
        </table>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow pop-ups to download PDF');
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
    setShowDownloadMenu(false);
  };

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="view-title">{title}</h3>
              
            </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!isDistrictView && (
            <button
              type="button"
              className="scert-btn-secondary"
              onClick={() => {
                setLevel('district');
                setSelectedDistrict(null);
                setBeos([]);
              }}
              disabled={loading}
            >
              ← Back
            </button>
          )}

          <button
            type="button"
            className="scert-btn-secondary"
            onClick={handleRefresh}
            disabled={!canFetch || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {isBeoView ? (
            <div ref={downloadMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="scert-btn-primary"
                onClick={() => setShowDownloadMenu((prev) => !prev)}
                disabled={loading || beos.length === 0}
              >
                Download
              </button>
              {showDownloadMenu ? (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '110%',
                    minWidth: 170,
                    background: '#fff',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    zIndex: 30,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={downloadBeoPdf}
                    className="scert-btn-secondary"
                    style={{ width: '100%', borderRadius: 0, border: 'none', textAlign: 'left' }}
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={downloadBeoExcel}
                    className="scert-btn-secondary"
                    style={{ width: '100%', borderRadius: 0, border: 'none', textAlign: 'left' }}
                  >
                    Download CSV
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading…</div>
      ) : isDistrictView ? (
        districts.length === 0 ? (
          <div className="empty-state">No districts found.</div>
        ) : (
          <>
            <div className="smart-table-wrap scert-beo-contact-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="smart-table">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>S.No</th>
                    <th>District Name</th>
                    <th style={{ width: 160 }}>No. of Blocks</th>
                  </tr>
                </thead>
                <tbody>
                  {pageDistricts.map((d, idx) => (
                    <tr
                      key={d.district_code}
                      style={{ cursor: 'pointer' }}
                      title="Click to view BEO details"
                      onClick={() => {
                        setSelectedDistrict({
                          district_code: d.district_code,
                          district_name: d.district_name,
                        });
                        setLevel('beo');
                        fetchBeosForDistrict(d.district_code);
                      }}
                    >
                      <td className="smart-table-strong">{startIdx + idx + 1}</td>
                      <td className="smart-table-strong">{d.district_name || '—'}</td>
                      <td className="smart-table-strong">{d.total_blocks ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
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
                Showing <strong>{activeRowsCount === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
                <strong>{activeRowsCount}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
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
        )
      ) : (
        <>
          {beos.length === 0 ? (
            <div className="empty-state">No BEO records found for this district.</div>
          ) : (
            <>
              <div className="smart-table-wrap scert-beo-contact-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="smart-table">
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Block Code</th>
                      <th>Block Name</th>

                      <th>Account No.</th>
                      <th>IFSC Code</th>
                      <th>Bank Name</th>
                      <th>Distance from CEO office</th>
                      <th>Registered Student</th>
                      <th>Appeared Student</th>
                      <th>Reimbursement @ Rs {reimbursementRate} rupee per appeared student</th>
                      <th>Logistics cost @ Rs {logisticsRate} rupee per Km</th>
                      <th>Contingency</th>
                      <th>Other</th>
                      <th>Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageBeos.map((beo) => {
                      const distance = Number(beo.distance_from_ceo_office ?? 0);
                      const registered = Number(beo.registered_students ?? 0);
                      const appeared = Number(beo.appeared_students ?? 0);
                      const reimbursement = appeared * reimbursementRate;
                      const logistics = distance * logisticsRate;
                      const contingency = beo.contingency || 0;
                      const other = beo.other || 0;
                      const total = reimbursement + logistics + contingency + other;

                      return (
                        <tr key={beo.user_id} className={window.getSubmissionRoleRowClass(beo)}>
                          <td className="smart-table-strong">{beo.block_code || '—'}</td>
                          <td className="smart-table-strong">{beo.block_name || '—'}</td>
                          <td>{beo.beo_account_no || '—'}</td>
                          <td>{beo.beo_ifsc_code || '—'}</td>
                          <td>{beo.beo_bank_name || '—'}</td>
                          <td>{Number.isFinite(distance) ? `${distance} km` : '—'}</td>
                          <td>{registered}</td>
                          <td>{appeared}</td>
                          <td>₹{reimbursement.toLocaleString('en-IN')}</td>
                          <td>₹{logistics.toLocaleString('en-IN')}</td>
                          <td>{contingency ? `₹${contingency.toLocaleString('en-IN')}` : '—'}</td>
                          <td>{other ? `₹${other.toLocaleString('en-IN')}` : '—'}</td>
                          <td className="smart-table-strong">₹{total.toLocaleString('en-IN')}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="smart-table-strong"></td>
                      <td className="smart-table-strong">Total</td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td className="smart-table-strong">{beoTotals.registered}</td>
                      <td className="smart-table-strong">{beoTotals.appeared}</td>
                      <td className="smart-table-strong">₹{beoTotals.reimbursement.toLocaleString('en-IN')}</td>
                      <td className="smart-table-strong">₹{beoTotals.logistics.toLocaleString('en-IN')}</td>
                      <td className="smart-table-strong">
                        {beoTotals.contingency ? `₹${beoTotals.contingency.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="smart-table-strong">
                        {beoTotals.other ? `₹${beoTotals.other.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="smart-table-strong">₹{beoTotals.total.toLocaleString('en-IN')}</td>
                    </tr>
                  </tbody>
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
                  Showing <strong>{activeRowsCount === 0 ? 0 : startIdx + 1}</strong>-<strong>{endIdx}</strong> of{' '}
                  <strong>{activeRowsCount}</strong> (Page <strong>{safePage}</strong> / <strong>{totalPages}</strong>)
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

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{beos.length}</strong> BEO(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
