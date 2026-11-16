const wrapStyle = {
  width: '100%',
  minHeight: '260px',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'center',
};

const listStyle = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const emptyStyle = {
  color: '#64748b',
  fontSize: '14px',
  fontWeight: 600,
  textAlign: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
};

export function TopDistrictsChart({ data = [] }) {
  const chartData = data.filter((item) => Number(item?.selected_students || 0) > 0);
  const maxValue = Math.max(...chartData.map((item) => Number(item.selected_students || 0)), 0);

  if (maxValue <= 0) {
    return <div style={wrapStyle}><div style={emptyStyle}>No district performance data available.</div></div>;
  }

  return (
    <div style={wrapStyle}>
      <div style={listStyle}>
        {chartData.map((item, index) => {
          const value = Number(item.selected_students || 0);
          const percent = maxValue > 0 ? (value / maxValue) * 100 : 0;
          return (
            <div key={`${item.district_name}-${index}`} style={{ display: 'grid', gridTemplateColumns: '148px 1fr 54px', gap: '10px', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.district_name || 'Unknown'}>
                {item.district_name || 'Unknown'}
              </div>
              <div style={{ height: '12px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', borderRadius: '999px', background: 'linear-gradient(90deg, #7c3aed 0%, #a855f7 100%)' }} />
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>{value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
