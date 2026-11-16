import { useMemo, useEffect, useState } from 'react';
import { getExamAnalyticsTable } from '../../api/result.api.js';

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

export function ExamAnalyticsTable({
  sessionId,
  scholarshipId,
  classValue,
  appliedFilters,
  currentLevel,
  selectedDistrict,
  selectedBlock,
  onLevelChange
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId || !scholarshipId || !classValue) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    const params = {
      session_id: sessionId,
      scholarship_id: scholarshipId,
      class: classValue,
      ...appliedFilters
    };

    getExamAnalyticsTable(params, currentLevel)
      .then((res) => {
        if (!isMounted) return;
        setData(res);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Failed to load table data');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [sessionId, scholarshipId, classValue, appliedFilters, currentLevel]);

  const totals = useMemo(() => {
    return data.reduce(
      (acc, row) => {
        acc.totalStudents += Number(row.total_students || 0);
        acc.sumMat += Number(row.avg_mat_score || 0) * Number(row.total_students || 0);
        acc.sumSat += Number(row.avg_sat_score || 0) * Number(row.total_students || 0);
        acc.highestMat = Math.max(acc.highestMat, Number(row.highest_mat_score || 0));
        acc.highestSat = Math.max(acc.highestSat, Number(row.highest_sat_score || 0));
        return acc;
      },
      {
        totalStudents: 0,
        sumMat: 0,
        sumSat: 0,
        highestMat: 0,
        highestSat: 0
      }
    );
  }, [data]);

  const avgMat = totals.totalStudents > 0 ? (totals.sumMat / totals.totalStudents).toFixed(2) : 0;
  const avgSat = totals.totalStudents > 0 ? (totals.sumSat / totals.totalStudents).toFixed(2) : 0;

  const handleRowClick = (row) => {
    if (currentLevel === 'district') {
      onLevelChange('block', row.name, null);
    } else if (currentLevel === 'block') {
      onLevelChange('school', selectedDistrict, row.name);
    }
  };

  return (
    <div>
      <div style={breadcrumbStyle}>
        <span style={currentLevel === 'district' ? { color: '#0f172a' } : linkStyle} onClick={() => onLevelChange('district', '', '')}>
          All Districts
        </span>
        {(currentLevel === 'block' || currentLevel === 'school') && (
          <>
            <span>/</span>
            <span style={currentLevel === 'block' ? { color: '#0f172a' } : linkStyle} onClick={() => onLevelChange('block', selectedDistrict, '')}>
              {selectedDistrict}
            </span>
          </>
        )}
        {currentLevel === 'school' && (
          <>
            <span>/</span>
            <span style={{ color: '#0f172a' }}>{selectedBlock}</span>
          </>
        )}
      </div>

      <div style={tableContainerStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>
                {currentLevel === 'district' ? 'District' : currentLevel === 'block' ? 'Block' : 'School'}
              </th>
              <th style={{...thStyle, textAlign: 'right'}}>Avg MAT</th>
              <th style={{...thStyle, textAlign: 'right'}}>High MAT</th>
              <th style={{...thStyle, textAlign: 'right'}}>Avg SAT</th>
              <th style={{...thStyle, textAlign: 'right'}}>High SAT</th>
              <th style={{...thStyle, textAlign: 'right'}}>Total Students</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#dc2626' }}>{error}</td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading analytics...</td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>No data found.</td>
              </tr>
            ) : (
              <>
                {data.map((row, i) => {
                  const avgMatRow = Number(row.avg_mat_score || 0).toFixed(2);
                  const avgSatRow = Number(row.avg_sat_score || 0).toFixed(2);
                  return (
                    <tr key={row.name || i} style={i % 2 === 0 ? { background: '#ffffff' } : { background: '#fafafa' }}>
                      <td 
                        style={(currentLevel === 'district' || currentLevel === 'block') ? nameTdStyle : tdStyle}
                        onClick={() => handleRowClick(row)}
                      >
                        {row.name || 'Unknown'}
                      </td>
                      <td style={{...tdStyle, textAlign: 'right'}}>{avgMatRow}</td>
                      <td style={{...tdStyle, textAlign: 'right'}}>{row.highest_mat_score}</td>
                      <td style={{...tdStyle, textAlign: 'right'}}>{avgSatRow}</td>
                      <td style={{...tdStyle, textAlign: 'right'}}>{row.highest_sat_score}</td>
                      <td style={{...tdStyle, textAlign: 'right', color: '#0f172a'}}>{row.total_students}</td>
                    </tr>
                  )
                })}
                <tr style={totalRowStyle}>
                  <td style={tdStyle}>Total</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{avgMat}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.highestMat}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{avgSat}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.highestSat}</td>
                  <td style={{...tdStyle, textAlign: 'right'}}>{totals.totalStudents}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
