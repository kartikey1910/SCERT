const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '14px',
};

const cardStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '18px',
  background: '#ffffff',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
  padding: '18px',
  minHeight: '112px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: '10px',
};

const labelStyle = {
  fontSize: '13px',
  fontWeight: 800,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#6b7280',
  lineHeight: 1.4,
};

const valueStyle = {
  fontSize: '34px',
  fontWeight: 900,
  color: '#111827',
  lineHeight: 1,
};

const loadingShellStyle = {
  ...cardStyle,
  background: 'linear-gradient(90deg, #f8fafc 25%, #eef2f7 50%, #f8fafc 75%)',
  backgroundSize: '200% 100%',
};

const cards = [
  { key: 'totalSchools', label: 'Total Schools' },
  { key: 'totalSchoolsParticipated', label: 'Participated Schools' },
  { key: 'remainingSchools', label: 'Remaining Schools' },
];

export function SchoolParticipationStats({ summary = {}, loading = false }) {
  return (
    <div style={gridStyle}>
      {cards.map((card) => (
        <div key={card.key} style={loading ? loadingShellStyle : cardStyle}>
          <div style={labelStyle}>{card.label}</div>
          <div style={valueStyle}>{loading ? '...' : Number(summary?.[card.key] || 0)}</div>
        </div>
      ))}
    </div>
  );
}
