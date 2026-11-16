import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';

export function ScertListCeoPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, selectedScholarshipId, scholarships, sessions } = useSession();

  const [ceos, setCeos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef(null);

  const [reimbursementRate, setReimbursementRate] = useState(30);
  const [logisticsRate, setLogisticsRate] = useState(20);

  const canFetch = Boolean(auth?.token);

  useEffect(() => {
    if (!canFetch) return;
    const fetchRates = async () => {
      try {
        const data = await get('/api/scert/rates/system?report_type=CEO_REPORT', { token: auth?.token });
        const rates = data.rates || [];
        const rRate = rates.find(r => r.rate_key === 'CEO_REIMBURSEMENT_PER_STUDENT');
        const lRate = rates.find(r => r.rate_key === 'CEO_LOGISTICS_PER_KM');
        if (rRate) setReimbursementRate(Number(rRate.rate_value));
        if (lRate) setLogisticsRate(Number(lRate.rate_value));
      } catch (err) {
        console.error('Failed to load dynamic rates', err);
      }
    };
    fetchRates();
  }, [canFetch, auth?.token]);

  const fetchCeos = useCallback(async () => {
    if (!canFetch) return;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      if (selectedScholarshipId) params.set('scholarship_id', selectedScholarshipId);
      if (sessionId) params.set('session_id', sessionId);

      const data = await get(`/api/scert/districts?${params.toString()}`, {
        token: auth?.token,
        sessionId,
      });

      setCeos(Array.isArray(data?.data) ? data.data : []);
    } catch (err) {
      console.error('Failed to fetch CEOs:', err);
      setError(err.message || 'Failed to load CEO data');
      toast.error(`Failed to load CEO list: ${toast.getErrorMessage(err)}`);
      setCeos([]);
    } finally {
      setLoading(false);
    }
  }, [canFetch, auth?.token, sessionId, selectedScholarshipId]);

  useEffect(() => {
    if (canFetch) {
      fetchCeos();
    } else {
      setCeos([]);
    }
  }, [canFetch, fetchCeos, sessionId, selectedScholarshipId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, ceos.length]);

  const selectedScholarshipName = String(
    scholarships?.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || ''
  );
  const selectedSessionName = String(
    sessions?.find((s) => String(s.session_id) === String(sessionId))?.session_name || '2026'
  );
  const isNmmssSelected =
    /\bNMMSS\b/i.test(selectedScholarshipName) || /\bNMMS\b/i.test(selectedScholarshipName);
  const sortedCeos = [...ceos].sort((a, b) => {
    const aCodeRaw = String(a?.district_code ?? '').trim();
    const bCodeRaw = String(b?.district_code ?? '').trim();
    const aNum = Number(aCodeRaw);
    const bNum = Number(bCodeRaw);
    const aIsNum = aCodeRaw !== '' && !Number.isNaN(aNum);
    const bIsNum = bCodeRaw !== '' && !Number.isNaN(bNum);

    if (aIsNum && bIsNum) return aNum - bNum;
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return aCodeRaw.localeCompare(bCodeRaw, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalRows = sortedCeos.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE);
  const pageCeos = sortedCeos.slice(startIdx, endIdx);
  const ceoTotals = sortedCeos.reduce(
    (acc, ceo) => {
      const registered = Number(ceo.registered_students ?? 0);
      const appeared = Number(ceo.appeared_students ?? 0);
      const reimbursement = appeared * reimbursementRate;
      const logistics = 0;
      const contingency = Number(ceo.contingency ?? 0);
      const other = Number(ceo.other ?? 0);
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

  const downloadCsv = () => {
    if (!Array.isArray(sortedCeos) || sortedCeos.length === 0) {
      toast.info('No CEO data to download');
      return;
    }

    const nmmssHeading = `National Means Cum Merit, Dr Shivanand Nautiyal and Sridev Suman Scholarship Scheme- ${selectedSessionName}                                     List of CEO with account details`;
    const cmHeading = `Cheif Minister Meritorious Student Insentive Scholarship Scheme- ${selectedSessionName}`;
    const subtitleLine = 'List of CEO with account details';

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

    const heading = isNmmssSelected ? nmmssHeading : cmHeading;
    const headers = [
      'District Code',
      'Name of District',
      'Account No.',
      'IFSC Code',
      'Bank Name',
      'Distance from Paper Distribution Center',
      'Registered Students',
      'Appeared Student',
      `Reimbursement @ Rs ${reimbursementRate} rupee per appeared student`,
      `Logistics cost @ Rs ${logisticsRate} rupee per Km`,
      'Contingency',
      'Other',
      'Total Amount',
    ];
    const dataRows = [];

    sortedCeos.forEach((ceo) => {
      const registered = Number(ceo.registered_students ?? 0);
      const appeared = Number(ceo.appeared_students ?? 0);
      const distance = Number(ceo.distance_from_paper_distribution_center_km ?? 0);
      const reimbursement = appeared * reimbursementRate;
      const logistics = distance * logisticsRate;
      const contingency = Number(ceo.contingency ?? 0);
      const other = Number(ceo.other ?? 0);
      const total = reimbursement + logistics + contingency + other;
      dataRows.push([
        ceo.district_code || '—',
        ceo.district_name || '—',
        ceo.ceo_account_no || '—',
        ceo.ceo_ifsc_code || '—',
        ceo.ceo_bank_name || '—',
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
      ceoTotals.registered,
      ceoTotals.appeared,
      ceoTotals.reimbursement,
      ceoTotals.logistics,
      ceoTotals.contingency || '',
      ceoTotals.other || '',
      ceoTotals.total,
    ];
    const csvRows = [headers, ...dataRows, totalRow];
    const csv = `\uFEFF${csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`;
    const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const fileName = `list_of_ceo_with_account_details_${selectedSessionName}.csv`;

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
        <title>CEO Export Preview</title>
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
        <h3>${escapeHtml(subtitleLine)}</h3>
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

  const downloadPdf = () => {
    if (!Array.isArray(sortedCeos) || sortedCeos.length === 0) {
      toast.info('No CEO data to download');
      return;
    }

    const heading = isNmmssSelected
      ? `National Means Cum Merit, Dr Shivanand Nautiyal and Sridev Suman Scholarship Scheme- ${selectedSessionName}`
      : `Cheif Minister Meritorious Student Insentive Scholarship Scheme- ${selectedSessionName}`;
    const subtitle = 'List of CEO with account details';

    const rowsHtml = sortedCeos
      .map((ceo) => {
        const registered = Number(ceo.registered_students ?? 0);
        const appeared = Number(ceo.appeared_students ?? 0);
        const distance = Number(ceo.distance_from_paper_distribution_center_km ?? 0);
        const reimbursement = appeared * reimbursementRate;
        const logistics = distance * logisticsRate;
        const contingency = Number(ceo.contingency ?? 0);
        const other = Number(ceo.other ?? 0);
        const total = reimbursement + logistics + contingency + other;

        return `
          <tr>
            <td>${ceo.district_code || '—'}</td>
            <td>${ceo.district_name || '—'}</td>
            <td>${ceo.ceo_account_no || '—'}</td>
            <td>${ceo.ceo_ifsc_code || '—'}</td>
            <td>${ceo.ceo_bank_name || '—'}</td>
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
        <td><strong>${ceoTotals.registered}</strong></td>
        <td><strong>${ceoTotals.appeared}</strong></td>
        <td><strong>₹${ceoTotals.reimbursement.toLocaleString('en-IN')}</strong></td>
        <td><strong>₹${ceoTotals.logistics.toLocaleString('en-IN')}</strong></td>
        <td><strong>${ceoTotals.contingency ? `₹${ceoTotals.contingency.toLocaleString('en-IN')}` : '—'}</strong></td>
        <td><strong>${ceoTotals.other ? `₹${ceoTotals.other.toLocaleString('en-IN')}` : '—'}</strong></td>
        <td><strong>₹${ceoTotals.total.toLocaleString('en-IN')}</strong></td>
      </tr>
    `;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <title>List of CEO with account details</title>
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
              <th>District Code</th>
              <th>Name of District</th>
              <th>Account No.</th>
              <th>IFSC Code</th>
              <th>Bank Name</th>
              <th>Distance from Paper Distribution Center</th>
              <th>Registered Students</th>
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
              <h3 className="view-title">CEO Account Details</h3>
              
            </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchCeos}
            disabled={!canFetch || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <div ref={downloadMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="scert-btn-primary"
              onClick={() => setShowDownloadMenu((prev) => !prev)}
              disabled={loading || ceos.length === 0}
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
                  onClick={downloadPdf}
                  className="scert-btn-secondary"
                  style={{ width: '100%', borderRadius: 0, border: 'none', textAlign: 'left' }}
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="scert-btn-secondary"
                  style={{ width: '100%', borderRadius: 0, border: 'none', textAlign: 'left' }}
                >
                  Download CSV
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading…</div>
      ) : ceos.length === 0 ? (
        <div className="empty-state">No CEO records found.</div>
      ) : (
        <>
          <div className="smart-table-wrap scert-ceo-contact-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>District Code</th>
                  <th>Name of District</th>
                  <th>Account No.</th>
                  <th>IFSC Code</th>
                  <th>Bank Name</th>
                  <th>Distance from Paper Distribution Center</th>
                  <th>Registered Students</th>
                  <th>Appeared Student</th>
                  <th>Reimbursement @ Rs {reimbursementRate} rupee per appeared student</th>
                  <th>Logistics cost @ Rs {logisticsRate} rupee per Km</th>
                  <th>Contingency</th>
                  <th>Other</th>
                  <th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {pageCeos.map((ceo) => {
                  const registered = Number(ceo.registered_students ?? 0);
                  const appeared = Number(ceo.appeared_students ?? 0);
                  const distance = Number(ceo.distance_from_paper_distribution_center_km ?? 0);
                  const reimbursement = appeared * reimbursementRate;
                  const logistics = distance * logisticsRate;
                  const contingency = Number(ceo.contingency ?? 0);
                  const other = Number(ceo.other ?? 0);
                  const total = reimbursement + logistics + contingency + other;

                  return (
                    <tr key={ceo.user_id} className={window.getSubmissionRoleRowClass(ceo)}>
                      <td className="smart-table-strong">{ceo.district_code || '—'}</td>
                      <td className="smart-table-strong">{ceo.district_name || '—'}</td>
                      <td>{ceo.ceo_account_no || '—'}</td>
                      <td>{ceo.ceo_ifsc_code || '—'}</td>
                      <td>{ceo.ceo_bank_name || '—'}</td>
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
                  <td className="smart-table-strong">{ceoTotals.registered}</td>
                  <td className="smart-table-strong">{ceoTotals.appeared}</td>
                  <td className="smart-table-strong">₹{ceoTotals.reimbursement.toLocaleString('en-IN')}</td>
                  <td className="smart-table-strong">₹{ceoTotals.logistics.toLocaleString('en-IN')}</td>
                  <td className="smart-table-strong">
                    {ceoTotals.contingency ? `₹${ceoTotals.contingency.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="smart-table-strong">
                    {ceoTotals.other ? `₹${ceoTotals.other.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="smart-table-strong">₹{ceoTotals.total.toLocaleString('en-IN')}</td>
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

          <div className="table-footer">
            <span className="table-count">
              Total: <strong>{ceos.length}</strong> CEO(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
