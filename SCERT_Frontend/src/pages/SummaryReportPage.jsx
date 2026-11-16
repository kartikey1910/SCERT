import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import { getSummaryReport } from '../api/result.api.js';
import { SummaryReportTable } from '../components/result/report/SummaryReportTable.jsx';

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
};

const sectionStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '20px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
  padding: '20px',
};

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: '16px',
};

const titleStyle = { margin: 0, fontSize: '28px', fontWeight: 800, color: '#111827' };
const subtitleStyle = { margin: '10px 0 0 0', fontSize: '14px', color: '#6b7280' };

/**
 * Summary Report — one combined district/block summary sourced from
 * result_block_summary, the sheet the agency uploads directly. There is a
 * single block-summary upload (not one per class), so this report has no
 * class filter and, since the sheet is already a district/block-level
 * aggregate with no per-student rows, no district/block/category filters
 * either — it's always the whole-state table.
 */
export function SummaryReportPage() {
  const { sessionId: selectedSessionId, selectedScholarshipId } = useSession() || {};

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchSummaryReport = useCallback(async () => {
    if (!selectedSessionId || !selectedScholarshipId) {
      setData(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await getSummaryReport({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
      });
      setData(response);
    } catch (err) {
      setData(null);
      setError(err?.message || 'Failed to load summary report.');
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId, selectedScholarshipId]);

  useEffect(() => { fetchSummaryReport(); }, [fetchSummaryReport]);

  const handleExportPDF = () => {
    // PDF Export Logic Will Go Here
    console.log('Exporting PDF...', data);
  };

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={headerRowStyle}>
          <div>
            <h1 style={titleStyle}>Summary Report</h1>
            <p style={subtitleStyle}>Consolidated district-wise and block-wise selection summary.</p>
          </div>
          <button
            onClick={handleExportPDF}
            style={{
              padding: '10px 20px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
            }}
          >
            Export PDF
          </button>
        </div>
      </section>

      <section style={sectionStyle}>
        <SummaryReportTable data={data} loading={loading} error={error} />
      </section>
    </div>
  );
}
