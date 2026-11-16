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

const blockRowStyle = {
  background: '#f8fafc',
  fontWeight: '600',
};

export function SubjectWiseTable({ data }) {
  const tableData = Array.isArray(data?.table_data) ? data.table_data : [];

  if (tableData.length === 0) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No data available for the selected filters.</div>;
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', maxHeight: '600px' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Group Name</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Total Students</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Total Responses Evaluated</th>
            <th style={{ ...thStyle, textAlign: 'center', color: '#10b981' }}>Correct Responses</th>
            <th style={{ ...thStyle, textAlign: 'center', color: '#ef4444' }}>Incorrect/Blank Responses</th>
            <th style={{ ...thStyle, textAlign: 'center', color: '#10b981' }}>Correct %</th>
            <th style={{ ...thStyle, textAlign: 'center', color: '#ef4444' }}>Incorrect %</th>
          </tr>
        </thead>
        <tbody>
          {tableData.map((districtNode) => (
            <React.Fragment key={districtNode.district_name}>
              {districtNode.blocks.map((blockNode) => (
                <React.Fragment key={blockNode.block_name}>
                  {blockNode.schools.map((school) => (
                    <tr key={school.name} className={window.getSubmissionRoleRowClass(school)}>
                      <td style={tdStyle}>{school.name}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{school.totalStudents}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{school.totalQuestions}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{school.correctCount}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{school.incorrectCount}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{school.correctPercent}%</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{school.incorrectPercent}%</td>
                    </tr>
                  ))}
                  <tr style={blockRowStyle}>
                    <td style={tdStyle}>{blockNode.block_totals.name}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{blockNode.block_totals.totalStudents}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{blockNode.block_totals.totalQuestions}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{blockNode.block_totals.correctCount}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{blockNode.block_totals.incorrectCount}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{blockNode.block_totals.correctPercent}%</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{blockNode.block_totals.incorrectPercent}%</td>
                  </tr>
                </React.Fragment>
              ))}
              <tr style={districtRowStyle}>
                <td style={tdStyle}>{districtNode.district_totals.name}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{districtNode.district_totals.totalStudents}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{districtNode.district_totals.totalQuestions}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{districtNode.district_totals.correctCount}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{districtNode.district_totals.incorrectCount}</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{districtNode.district_totals.correctPercent}%</td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>{districtNode.district_totals.incorrectPercent}%</td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
