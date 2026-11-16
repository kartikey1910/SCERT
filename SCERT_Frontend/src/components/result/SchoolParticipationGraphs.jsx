import React from 'react';
import { GroupedBarChart } from './charts/GroupedBarChart.jsx';

const CHART_KEYS = [
  { key: 'totalSchools', label: 'Total Schools' },
  { key: 'participatedSchools', label: 'Participated Schools' },
];

const CHART_COLORS = {
  totalSchools: '#94a3b8',        // Neutral/muted
  participatedSchools: '#3b82f6', // Primary highlight
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: '24px',
  marginTop: '24px',
  marginBottom: '32px',
};

const cardStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '16px',
  background: '#ffffff',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
  padding: '20px',
};

const titleStyle = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#334155',
  marginBottom: '16px',
  textAlign: 'center',
};

const emptyData = [
  { name: 'N/A', totalSchools: 0, participatedSchools: 0 }
];

export function SchoolParticipationGraphs({ summary }) {
  if (!summary) return null;

  // Graph 1: Government School Categories
  const govData = [
    { name: 'GIC', totalSchools: summary.totalGic || 0, participatedSchools: summary.gicParticipated || 0 },
    { name: 'GHS', totalSchools: summary.totalGhs || 0, participatedSchools: summary.ghsParticipated || 0 },
    { name: 'GUPS', totalSchools: summary.totalGups || 0, participatedSchools: summary.gupsParticipated || 0 },
  ];

  // Graph 2: School Management Categories
  const mgmtData = [
    { name: 'Govt Aided', totalSchools: summary.totalGovtAided || 0, participatedSchools: summary.govtAidedParticipated || 0 },
    { name: 'Local Body', totalSchools: summary.totalLocalBody || 0, participatedSchools: summary.localBodyParticipated || 0 },
    { name: 'Dept of Edu', totalSchools: summary.totalDeptEdu || 0, participatedSchools: summary.deptEduParticipated || 0 },
  ];

  // Graph 3: School Area Participation
  const areaData = [
    { name: 'Rural', totalSchools: summary.totalRural || 0, participatedSchools: summary.ruralParticipated || 0 },
    { name: 'Urban', totalSchools: summary.totalUrban || 0, participatedSchools: summary.urbanParticipated || 0 },
  ];

  // Optional: Find global max across all 3 charts to keep heights strictly comparable
  const allValues = [...govData, ...mgmtData, ...areaData].flatMap(d => [d.totalSchools, d.participatedSchools]);
  const sharedMax = Math.max(...allValues, 10); // Ensure at least scale to 10 if all 0

  return (
    <div style={gridStyle}>
      <div style={cardStyle}>
        <div style={titleStyle}>Government School Categories</div>
        <GroupedBarChart
          data={govData}
          keys={CHART_KEYS}
          colors={CHART_COLORS}
          height={280}
          sharedMax={sharedMax}
        />
      </div>

      <div style={cardStyle}>
        <div style={titleStyle}>School Management Categories</div>
        <GroupedBarChart
          data={mgmtData}
          keys={CHART_KEYS}
          colors={CHART_COLORS}
          height={280}
          sharedMax={sharedMax}
        />
      </div>

      <div style={cardStyle}>
        <div style={titleStyle}>School Area Participation</div>
        <GroupedBarChart
          data={areaData}
          keys={CHART_KEYS}
          colors={CHART_COLORS}
          height={280}
          sharedMax={sharedMax}
        />
      </div>
    </div>
  );
}
