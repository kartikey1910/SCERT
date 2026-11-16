import { GroupedBarChart } from '../charts/GroupedBarChart.jsx';

const CHART_KEYS = [
  { key: 'correctPercent', label: 'Correct %' },
  { key: 'incorrectPercent', label: 'Incorrect %' },
];

const CHART_COLORS = {
  correctPercent: '#10b981', // Emerald 500
  incorrectPercent: '#ef4444', // Red 500
};

export function SubjectWiseCharts({ data }) {
  const genderData = Array.isArray(data?.gender_analysis) ? data.gender_analysis : [];
  const categoryData = Array.isArray(data?.category_analysis) ? data.category_analysis : [];
  const schoolTypeData = Array.isArray(data?.school_type_analysis) ? data.school_type_analysis : [];
  const schoolLocationData = Array.isArray(data?.school_location_analysis) ? data.school_location_analysis : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
      
      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>Gender Breakdown</h3>
        <GroupedBarChart data={genderData} keys={CHART_KEYS} colors={CHART_COLORS} />
      </div>

      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>Category Breakdown</h3>
        <GroupedBarChart data={categoryData} keys={CHART_KEYS} colors={CHART_COLORS} />
      </div>

      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>School Type Breakdown</h3>
        <GroupedBarChart data={schoolTypeData} keys={CHART_KEYS} colors={CHART_COLORS} />
      </div>

      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>School Location Breakdown</h3>
        <GroupedBarChart data={schoolLocationData} keys={CHART_KEYS} colors={CHART_COLORS} />
      </div>

    </div>
  );
}
