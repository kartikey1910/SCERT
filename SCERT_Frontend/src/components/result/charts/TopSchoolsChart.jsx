const wrapStyle = {
  width: '100%',
  minHeight: '260px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const emptyStyle = {
  color: '#64748b',
  fontSize: '14px',
  fontWeight: 600,
  textAlign: 'center',
};

export function TopSchoolsChart({ data = [] }) {
  const chartData = data.filter((item) => Number(item?.selected_students || 0) > 0).slice(0, 8);
  const maxValue = Math.max(...chartData.map((item) => Number(item.selected_students || 0)), 0);

  if (maxValue <= 0) {
    return <div style={wrapStyle}><div style={emptyStyle}>No school performance data available.</div></div>;
  }

  const width = 520;
  const height = 280;
  const left = 24;
  const bottom = 72;
  const top = 20;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left - 20;
  const barWidth = Math.max(26, Math.floor(chartWidth / Math.max(chartData.length * 1.8, 1)));
  const gap = chartData.length > 1 ? (chartWidth - barWidth * chartData.length) / (chartData.length - 1) : 0;

  return (
    <div style={wrapStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%' }} role="img" aria-label="Top schools chart">
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={left} y1={height - bottom} x2={width - 10} y2={height - bottom} stroke="#cbd5e1" strokeWidth="1.5" />
        {chartData.map((item, index) => {
          const value = Number(item.selected_students || 0);
          const x = left + index * (barWidth + gap);
          const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
          const y = height - bottom - barHeight;
          const label = String(item.school_name || 'Unknown');
          const shortLabel = label.length > 16 ? `${label.slice(0, 16)}…` : label;
          return (
            <g key={`${item.school_name}-${index}`}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="8" fill="#0f766e" opacity="0.94" />
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="800" fill="#0f172a">
                {value}
              </text>
              <text x={x + barWidth / 2} y={height - 14} textAnchor="end" transform={`rotate(-35 ${x + barWidth / 2} ${height - 14})`} fontSize="10" fontWeight="700" fill="#475569">
                {shortLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
