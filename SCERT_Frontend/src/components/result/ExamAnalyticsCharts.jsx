import { useEffect, useState } from 'react';
import { GroupedBarChart } from './charts/GroupedBarChart.jsx';
import { getExamAnalyticsCharts } from '../../api/result.api.js';

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '16px',
};

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '16px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const titleStyle = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 800,
  color: '#1e293b',
};

const loadingStyle = {
  height: '280px',
  borderRadius: '12px',
  background: 'linear-gradient(90deg, #f8fafc 25%, #eef2f7 50%, #f8fafc 75%)',
  backgroundSize: '200% 100%',
  animation: 'pulse 1.5s infinite',
};

const keys = [
  { key: 'avg_mat_score', label: 'Avg MAT' },
  { key: 'highest_mat_score', label: 'Highest MAT' },
  { key: 'avg_sat_score', label: 'Avg SAT' },
  { key: 'highest_sat_score', label: 'Highest SAT' },
];

const colors = {
  avg_mat_score: '#3b82f6',
  highest_mat_score: '#1d4ed8',
  avg_sat_score: '#8b5cf6',
  highest_sat_score: '#6d28d9',
};

function ChartCard({ title, data, loading, error }) {
  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>{title}</h3>
      {loading ? (
        <div style={loadingStyle} />
      ) : error ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#ef4444' }}>{error}</div>
      ) : (
        <GroupedBarChart data={data} keys={keys} colors={colors} />
      )}
    </div>
  );
}

export function ExamAnalyticsCharts({ sessionId, scholarshipId, classValue, appliedFilters }) {
  const [data, setData] = useState({ gender: [], category: [], schoolType: [], location: [] });
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

    Promise.all([
      getExamAnalyticsCharts(params, 'gender'),
      getExamAnalyticsCharts(params, 'category'),
      getExamAnalyticsCharts(params, 'school_type'),
      getExamAnalyticsCharts(params, 'school_location')
    ])
      .then(([genderRes, categoryRes, schoolTypeRes, locationRes]) => {
        if (!isMounted) return;
        setData({
          gender: genderRes.map(item => ({ name: item.label || 'Unknown', ...item })),
          category: categoryRes.map(item => ({ name: item.label || 'Unknown', ...item })),
          schoolType: schoolTypeRes.map(item => ({ name: item.label || 'Unknown', ...item })),
          location: locationRes.map(item => ({ name: item.label || 'Unknown', ...item }))
        });
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load charts:", err);
        setError(err.message || 'Failed to load chart data');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [sessionId, scholarshipId, classValue, appliedFilters]);

  return (
    <div style={gridStyle}>
      <ChartCard title="Gender Analytics" data={data.gender} loading={loading} error={error} />
      <ChartCard title="Category Analytics" data={data.category} loading={loading} error={error} />
      <ChartCard title="School Type Analytics" data={data.schoolType} loading={loading} error={error} />
      <ChartCard title="Location Analytics" data={data.location} loading={loading} error={error} />
    </div>
  );
}
