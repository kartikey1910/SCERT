import { GroupedBarChart } from './GroupedBarChart.jsx';

const CHART_KEYS = [
  { key: 'registered_in_class', label: 'Reg(C)' },
  { key: 'registered_in_scholarship', label: 'Reg(S)' },
  { key: 'appeared', label: 'Appeared' },
  { key: 'selected', label: 'Selected' },
];

const CHART_COLORS = {
  registered_in_class: '#94a3b8',
  registered_in_scholarship: '#3b82f6',
  appeared: '#14b8a6',
  selected: '#8b5cf6',
};

export function GenderAnalyticsChart({ data }) {
  const chartData = Array.isArray(data) ? data : [];
  return <GroupedBarChart data={chartData} keys={CHART_KEYS} colors={CHART_COLORS} />;
}
