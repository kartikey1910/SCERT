const shellStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  flexWrap: 'wrap',
};

const titleStyle = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 800,
  color: '#111827',
};

const subtitleStyle = {
  margin: 0,
  fontSize: '14px',
  color: '#6b7280',
};

const actionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const classGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
};

const classButtonStyle = {
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#374151',
  borderRadius: '14px',
  padding: '12px 18px',
  fontSize: '14px',
  fontWeight: 800,
  cursor: 'pointer',
  minHeight: '48px',
  minWidth: '108px',
  transition: 'all 0.18s ease',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

const activeClassButtonStyle = {
  border: '1px solid transparent',
  background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
  color: '#ffffff',
  boxShadow: '0 10px 20px rgba(124, 58, 237, 0.18)',
};

const filterButtonStyle = {
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#374151',
  borderRadius: '14px',
  padding: '12px 18px',
  fontSize: '14px',
  fontWeight: 800,
  cursor: 'pointer',
  minHeight: '48px',
  whiteSpace: 'nowrap',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

export function ResultHeaderBar({
  title,
  subtitle,
  classOptions = [],
  classFilter,
  onClassChange,
  onOpenFilters,
  activeFilterCount = 0,
  extraAction = null,
}) {
  return (
    <div style={shellStyle}>
      <div style={rowStyle}>
        <h1 style={titleStyle}>{title}</h1>

        <div style={actionsStyle}>
          <div style={classGroupStyle}>
            {classOptions.map((value) => {
              const isActive = String(classFilter) === String(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onClassChange?.(String(value))}
                  style={{
                    ...classButtonStyle,
                    ...(isActive ? activeClassButtonStyle : {}),
                  }}
                >
                  {`Class ${value}`}
                </button>
              );
            })}
          </div>

          <button type="button" onClick={onOpenFilters} style={filterButtonStyle}>
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>

          {extraAction}
        </div>
      </div>

      {subtitle ? <p style={subtitleStyle}>{subtitle}</p> : null}
    </div>
  );
}
