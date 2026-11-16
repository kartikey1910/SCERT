import React from 'react';

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
  textAlign: 'left',
  background: '#fff',
};

const thStyle = {
  padding: '12px 16px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#334155',
  fontWeight: '600',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const tdStyle = {
  padding: '12px 16px',
  border: '1px solid #e2e8f0',
  color: '#475569',
};

const districtRowStyle = {
  background: '#f1f5f9',
  fontWeight: 'bold',
};

const grandTotalRowStyle = {
  background: '#e2e8f0',
  fontWeight: 'bold',
  color: '#0f172a',
};

export function SummaryReportTable({ data, loading, error }) {
  if (loading) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading summary report data...</div>;
  }

  if (error) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#ef4444' }}>{error}</div>;
  }

  if (!data || !data.districts || data.districts.length === 0) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No data available for the selected filters.</div>;
  }

  const { districts, grand_totals } = data;

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>District</th>
            <th style={thStyle}>Block</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Present</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Absent</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Total Selected</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>GEN</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>OBC</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>SC</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>ST</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>EWS</th>
          </tr>
        </thead>
        <tbody>
          {districts.map((district) => (
            <React.Fragment key={district.district_name}>
              {district.rows.map((row, i) => (
                <tr key={`${district.district_name}-${row.block_name}`}>
                  {i === 0 ? (
                    <td style={{ ...tdStyle, fontWeight: 'bold' }} rowSpan={district.rows.length}>
                      {district.district_name}
                    </td>
                  ) : null}
                  <td style={tdStyle}>{row.block_name}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.present_students}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.absent_students}</td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: '600' }}>{row.total_selected}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.gen_selected}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.obc_selected}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.sc_selected}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.st_selected}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{row.ews_selected}</td>
                </tr>
              ))}
              <tr style={districtRowStyle}>
                <td style={tdStyle} colSpan={2}>
                  {district.district_name} TOTAL
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.present_students}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.absent_students}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.total_selected}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.gen_selected}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.obc_selected}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.sc_selected}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.st_selected}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{district.totals.ews_selected}</td>
              </tr>
            </React.Fragment>
          ))}
          {grand_totals && (
            <tr style={grandTotalRowStyle}>
              <td style={tdStyle} colSpan={2}>GRAND TOTAL</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.present_students}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.absent_students}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.total_selected}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.gen_selected}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.obc_selected}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.sc_selected}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.st_selected}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{grand_totals.ews_selected}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
