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

export function MarksDistributionChart({ data = [] }) {
  const chartData = data.filter((item) => Number(item?.count || 0) > 0);
  const maxValue = Math.max(...chartData.map((item) => Number(item.count || 0)), 0);

  if (maxValue <= 0) {
    return <div style={wrapStyle}><div style={emptyStyle}>No marks distribution available for the selected filters.</div></div>;
  }

  const width = 520;
  const height = 260;
  const left = 42;
  const bottom = 46;
  const top = 20;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left - 20;
  const barWidth = Math.max(22, Math.floor(chartWidth / Math.max(chartData.length * 1.6, 1)));
  const gap = chartData.length > 1 ? (chartWidth - barWidth * chartData.length) / (chartData.length - 1) : 0;

  return (
    <div style={wrapStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '100%' }} role="img" aria-label="Marks distribution chart">
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={left} y1={height - bottom} x2={width - 10} y2={height - bottom} stroke="#cbd5e1" strokeWidth="1.5" />
        {chartData.map((item, index) => {
          const value = Number(item.count || 0);
          const x = left + index * (barWidth + gap);
          const barHeight = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
          const y = height - bottom - barHeight;
          return (
            <g key={`${item.range}-${index}`}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="8" fill="#2563eb" opacity="0.92" />
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="800" fill="#0f172a">
                {value}
              </text>
              <text x={x + barWidth / 2} y={height - 16} textAnchor="middle" fontSize="10" fontWeight="700" fill="#475569">
                {item.range}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
