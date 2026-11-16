import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { get } from './apiClient.js';
import { useToast } from './ToastContext.jsx';
import { useSession } from './scert.session-context.jsx';

const toNumber = (value) => {
  const n = Number(String(value ?? '').trim());
  return Number.isNaN(n) ? null : n;
};

const compareDistrictCodeAsc = (a, b) => {
  const aCode = String(a?.district_code ?? '').trim();
  const bCode = String(b?.district_code ?? '').trim();
  const aNum = toNumber(aCode);
  const bNum = toNumber(bCode);

  if (aNum !== null && bNum !== null) return aNum - bNum;
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
};

const firstPresent = (obj, keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

export function ScertCeoDetailsPage() {
  const { auth } = useAuth();
  const toast = useToast();
  const { sessionId, sessions, selectedScholarshipId, scholarships } = useSession();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  const selectedScholarshipName = String(
    scholarships?.find((s) => String(s.scholarship_id) === String(selectedScholarshipId))?.scholarship_name || '-'
  );
  const selectedSessionName = String(
    sessions?.find((s) => String(s.session_id) === String(sessionId))?.session_name || '-'
  );

  const fetchRows = useCallback(async () => {
    if (!auth?.token) return;

    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      if (selectedScholarshipId) params.set('scholarship_id', selectedScholarshipId);
      if (sessionId) params.set('session_id', sessionId);

      const data = await get(`/api/scert/districts?${params.toString()}`, {
        token: auth.token,
        sessionId,
      });
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (err) {
      const msg = err?.message || 'Failed to load CEO details';
      setError(msg);
      setRows([]);
      toast.error(`Failed to load CEO details: ${toast.getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, [auth?.token, selectedScholarshipId, sessionId, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, selectedScholarshipId, rows.length]);

  const sortedRows = useMemo(() => [...rows].sort(compareDistrictCodeAsc), [rows]);
  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(totalRows, startIdx + PAGE_SIZE);
  const pageRows = sortedRows.slice(startIdx, endIdx);

  const buildExportRows = () =>
    sortedRows.map((row, idx) => [
      idx + 1,
      row.district_name || '—',
      firstPresent(row, ['office_email', 'email', 'ceo_email', 'contact_email']) || '—',
      firstPresent(row, ['office_contact_no', 'contact_number', 'office_phone', 'ceo_mobile', 'mobile_number']) || '—',
      firstPresent(row, ['ceo_name', 'name_of_ceo']) || '—',
      firstPresent(row, ['ceo_mobile', 'mobile_no', 'ceo_phone']) || '—',
      firstPresent(row, ['dealing_person_name', 'name_of_dealing_person', 'dealing_name']) || '—',
      firstPresent(row, ['dealing_person_mobile', 'dealing_mobile', 'dealing_person_phone']) || '—',
    ]);

  const escapeCsv = (value) => {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const downloadCsv = () => {
    if (!sortedRows.length) {
      toast.info('No CEO details to download');
      return;
    }

    const headers = [
      'S.No',
      'District',
      'Office Mail ID',
      'Office Contact No',
      'Name of CEO',
      'Mobile No',
      'Name of Dealing Person',
      'Mobile No',
    ];
    const rowsData = buildExportRows();
    const csvContent = [
      ['Scholarship', selectedScholarshipName],
      ['Session', selectedSessionName],
      [],
      headers,
      ...rowsData,
    ]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scert_ceo_details_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    if (!sortedRows.length) {
      toast.info('No CEO details to download');
      return;
    }

    const headers = [
      'S.No',
      'District',
      'Office Mail ID',
      'Office Contact No',
      'Name of CEO',
      'Mobile No',
      'Name of Dealing Person',
      'Mobile No',
    ];
    const rowsData = buildExportRows();
    const generatedAt = new Date().toLocaleString();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>CEO Details Report</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          body { font-family: Arial, sans-serif; margin: 0; font-size: 10px; }
          .title { text-align: center; font-size: 16px; font-weight: 700; margin: 0 0 6px; }
          .meta { text-align: center; font-size: 11px; margin: 0 0 10px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 4px; font-size: 8px; text-align: center; word-break: break-word; }
          th { background: #f3f4f6; font-weight: 700; }
        </style>
      </head>
      <body>
        <p class="title">Contact Details of Chief Education Officers</p>
        <p class="meta"><strong>Scholarship:</strong> ${escapeHtml(selectedScholarshipName)} | <strong>Session:</strong> ${escapeHtml(selectedSessionName)} | <strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
        <table>
          <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${rowsData.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
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
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  return (
    <div className="applications-view">
      <div className="view-header-row">
        <div>
          <h3 className="view-title">Contact details of the Chief Education Officers</h3>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="scert-btn-secondary" onClick={downloadPdf}>
            Download PDF
          </button>
          <button type="button" className="scert-btn-secondary" onClick={downloadCsv}>
            Download CSV
          </button>
          <button
            type="button"
            className="scert-btn-secondary"
            onClick={fetchRows}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">{error}</div>
      ) : loading ? (
        <div className="loading-state">Loading…</div>
      ) : sortedRows.length === 0 ? (
        <div className="empty-state">No CEO details found.</div>
      ) : (
        <>
          <div className="smart-table-wrap scert-ceo-details-table-wrap beo-submitted-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="smart-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 70 }}>S.No</th>
                  <th style={{ minWidth: 170 }}>District</th>
                  <th style={{ minWidth: 190 }}>Office Mail ID</th>
                  <th style={{ minWidth: 170 }}>Office Contact No</th>
                  <th style={{ minWidth: 170 }}>Name of CEO</th>
                  <th style={{ minWidth: 140 }}>Mobile No</th>
                  <th style={{ minWidth: 220 }}>Name of Dealing Person</th>
                  <th style={{ minWidth: 150 }}>Mobile No</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, idx) => (
                  <tr key={`${row.user_id}-${row.district_code}-${idx}`}>
                    <td className="smart-table-strong">{startIdx + idx + 1}</td>
                    <td>{row.district_name || '—'}</td>
                    <td>{firstPresent(row, ['office_email', 'email', 'ceo_email', 'contact_email']) || '—'}</td>
                    <td>{firstPresent(row, ['office_contact_no', 'contact_number', 'office_phone', 'ceo_mobile', 'mobile_number']) || '—'}</td>
                    <td>{firstPresent(row, ['ceo_name', 'name_of_ceo']) || '—'}</td>
                    <td>{firstPresent(row, ['ceo_mobile', 'mobile_no', 'ceo_phone']) || '—'}</td>
                    <td>{firstPresent(row, ['dealing_person_name', 'name_of_dealing_person', 'dealing_name']) || '—'}</td>
                    <td>{firstPresent(row, ['dealing_person_mobile', 'dealing_mobile', 'dealing_person_phone']) || '—'}</td>
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
              Total: <strong>{sortedRows.length}</strong> CEO(s)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
