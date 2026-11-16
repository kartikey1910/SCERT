import { useMemo } from 'react';

const tableContainerStyle = {
  width: '100%',
  overflowX: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: '13px',
};

const thStyle = {
  background: '#f8fafc',
  padding: '12px 16px',
  fontWeight: 700,
  color: '#475569',
  borderBottom: '1px solid #e5e7eb',
  borderRight: '1px solid #f1f5f9',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  borderRight: '1px solid #f1f5f9',
  color: '#1e293b',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const totalRowStyle = {
  background: '#f1f5f9',
  fontWeight: 800,
};

const nameTdStyle = {
  ...tdStyle,
  color: '#2563eb',
  cursor: 'pointer',
  textDecoration: 'underline',
};

const breadcrumbStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#475569',
  marginBottom: '16px',
};

const linkStyle = {
  color: '#2563eb',
  cursor: 'pointer',
  textDecoration: 'underline',
};

export function SchoolParticipationHierarchyTable({
  currentLevel = 'district',
  selectedDistrict = '',
  rows = [],
  loading = false,
  error = '',
  onRowClick,
  onGoDistrict,
}) {
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.totalSchools += Number(row.totalSchools || 0);
        acc.totalSchoolsParticipated += Number(row.totalSchoolsParticipated || 0);
        acc.remainingSchools += Number(row.remainingSchools || 0);
        acc.gicParticipated += Number(row.gicParticipated || 0);
        acc.ghsParticipated += Number(row.ghsParticipated || 0);
        acc.gupsParticipated += Number(row.gupsParticipated || 0);
        acc.govtAidedParticipated += Number(row.govtAidedParticipated || 0);
        acc.localBodyParticipated += Number(row.localBodyParticipated || 0);
        acc.deptEduParticipated += Number(row.deptEduParticipated || 0);
        acc.ruralParticipated += Number(row.ruralParticipated || 0);
        acc.urbanParticipated += Number(row.urbanParticipated || 0);
        return acc;
      },
      {
        totalSchools: 0,
        totalSchoolsParticipated: 0,
        remainingSchools: 0,
        gicParticipated: 0,
        ghsParticipated: 0,
        gupsParticipated: 0,
        govtAidedParticipated: 0,
        localBodyParticipated: 0,
        deptEduParticipated: 0,
        ruralParticipated: 0,
        urbanParticipated: 0,
      }
    );
  }, [rows]);

  return (
    <div>
      <div style={breadcrumbStyle}>
        <span style={currentLevel === 'district' ? { color: '#0f172a' } : linkStyle} onClick={onGoDistrict}>
          All Districts
        </span>
        {currentLevel === 'block' && (
          <>
            <span>/</span>
            <span style={{ color: '#0f172a' }}>{selectedDistrict}</span>
          </>
        )}
      </div>

      <div style={tableContainerStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>{currentLevel === 'district' ? 'District' : 'Block'}</th>
              <th style={{...thStyle, textAlign: 'right'}}>Total Schools</th>
              <th style={{...thStyle, textAlign: 'right'}}>Participated</th>
              <th style={{...thStyle, textAlign: 'right'}}>Remaining</th>
              <th style={{...thStyle, textAlign: 'right'}}>GIC</th>
              <th style={{...thStyle, textAlign: 'right'}}>GHS</th>
              <th style={{...thStyle, textAlign: 'right'}}>GUPS</th>
              <th style={{...thStyle, textAlign: 'right'}}>Govt. Aided</th>
              <th style={{...thStyle, textAlign: 'right'}}>Local Body</th>
              <th style={{...thStyle, textAlign: 'right'}}>Dept. Edu</th>
              <th style={{...thStyle, textAlign: 'right'}}>Rural</th>
              <th style={{...thStyle, textAlign: 'right'}}>Urban</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={12} style={{ padding: '20px', textAlign: 'center', color: '#dc2626' }}>
                  {error}
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={12} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                  Loading analytics...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                  No participation data found.
                </td>
              </tr>
            ) : (
              <>
                {rows.map((row, i) => (
                  <tr key={row.name || i} style={i % 2 === 0 ? { background: '#ffffff' } : { background: '#fafafa' }}>
                    <td 
                      style={currentLevel === 'district' ? nameTdStyle : tdStyle}
                      onClick={() => {
                        if (currentLevel === 'district' && onRowClick) {
                          onRowClick('district', row.name);
                        }
                      }}
                    >
                      {row.name || 'Unknown'}
                    </td>
                    <td style={{...tdStyle, textAlign: 'right', color: '#0f172a'}}>{row.totalSchools}</td>
                    <td style={{...tdStyle, textAlign: 'right', color: '#0f172a'}}>{row.totalSchoolsParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right', color: '#dc2626'}}>{row.remainingSchools}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.gicParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.ghsParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.gupsParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.govtAidedParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.localBodyParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.deptEduParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.ruralParticipated}</td>
                    <td style={{...tdStyle, textAlign: 'right'}}>{row.urbanParticipated}</td>
                  </tr>
                ))}
                <tr style={totalRowStyle}>
                  <td style={tdStyle}>Total</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.totalSchools}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.totalSchoolsParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.remainingSchools}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.gicParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.ghsParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.gupsParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.govtAidedParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.localBodyParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.deptEduParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.ruralParticipated}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.urbanParticipated}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
