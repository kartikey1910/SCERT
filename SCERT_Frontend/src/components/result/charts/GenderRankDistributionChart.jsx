const wrapStyle = {
  width: '100%',
  minHeight: '260px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '16px',
  flexWrap: 'wrap',
};

const emptyStyle = {
  color: '#64748b',
  fontSize: '14px',
  fontWeight: 600,
  textAlign: 'center',
};

const legendStyle = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  alignItems: 'center',
};

const COLORS = {
  Male: '#2563eb',
  Female: '#ec4899',
  Other: '#10b981',
};

export function GenderRankDistributionChart({ data = [] }) {
  const chartData = data.filter((item) => Number(item?.count || 0) > 0);

  if (chartData.length === 0) {
    return <div style={wrapStyle}><div style={emptyStyle}>No gender rank distribution available for the selected filters.</div></div>;
  }

  const ranges = Array.from(new Set(chartData.map((item) => item.range)));
  const genders = Array.from(new Set(chartData.map((item) => item.gender)));
  const normalized = ranges.map((range) => {
    const entry = { range };
    genders.forEach((gender) => {
      entry[gender] = Number(chartData.find((item) => item.range === range && item.gender === gender)?.count || 0);
    });
    entry.total = genders.reduce((sum, gender) => sum + entry[gender], 0);
    return entry;
  });

  const maxTotal = Math.max(...normalized.map((item) => item.total), 0);
  if (maxTotal <= 0) {
    return <div style={wrapStyle}><div style={emptyStyle}>No gender rank distribution available for the selected filters.</div></div>;
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={legendStyle}>
        {genders.map((gender) => (
          <div key={gender} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '999px', background: COLORS[gender] || '#64748b' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>{gender}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {normalized.map((item) => (
          <div key={item.range} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 48px', gap: '10px', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>{item.range}</div>
            <div style={{ display: 'flex', height: '14px', borderRadius: '999px', overflow: 'hidden', background: '#e2e8f0' }}>
              {genders.map((gender) => {
                const value = item[gender];
                const width = item.total > 0 ? (value / item.total) * 100 : 0;
                return value > 0 ? (
                  <div key={gender} style={{ width: `${width}%`, background: COLORS[gender] || '#64748b' }} />
                ) : null;
              })}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>{item.total}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
