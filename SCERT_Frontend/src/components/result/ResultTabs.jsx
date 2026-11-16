const wrapStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
};

const tabStyle = {
  border: '1px solid #dbe3f0',
  background: '#fff',
  color: '#475569',
  borderRadius: '999px',
  padding: '10px 16px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 0.18s ease',
};

const activeTabStyle = {
  ...tabStyle,
  borderColor: '#4f46e5',
  background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)',
  color: '#312e81',
  boxShadow: '0 8px 20px rgba(79, 70, 229, 0.14)',
};

export function ResultTabs({ tabs = [], activeTab, onChange }) {
  return (
    <div style={wrapStyle}>
      {tabs.map((tab) => {
        const isActive = tab.value === activeTab;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            style={isActive ? activeTabStyle : tabStyle}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
