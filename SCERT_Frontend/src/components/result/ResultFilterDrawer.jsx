import { useEffect } from 'react';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.34)',
  backdropFilter: 'blur(2px)',
  transition: 'opacity 0.22s ease',
  zIndex: 1200,
};

const panelStyle = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(380px, 100vw)',
  background: '#ffffff',
  boxShadow: '-12px 0 36px rgba(15, 23, 42, 0.14)',
  borderLeft: '1px solid #e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  transition: 'transform 0.24s ease',
  zIndex: 1201,
};

const headerStyle = {
  padding: '18px 20px 16px',
  borderBottom: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
};

const titleStyle = {
  margin: 0,
  fontSize: '20px',
  fontWeight: 800,
  color: '#111827',
};

const subtitleStyle = {
  margin: '6px 0 0',
  fontSize: '13px',
  color: '#64748b',
  lineHeight: 1.5,
};

const closeButtonStyle = {
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: '10px',
  padding: '8px 10px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
};

const bodyStyle = {
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  overflowY: 'auto',
  flex: 1,
};

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const labelStyle = {
  fontSize: '13px',
  fontWeight: 700,
  color: '#374151',
};

const inputStyle = {
  width: '100%',
  border: '1px solid #d1d5db',
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '14px',
  boxSizing: 'border-box',
  background: '#fff',
  color: '#111827',
};

const footerStyle = {
  padding: '16px 20px 20px',
  borderTop: '1px solid #e5e7eb',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '10px',
};

const primaryButtonStyle = {
  border: 'none',
  background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
  color: '#fff',
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '14px',
  fontWeight: 800,
  cursor: 'pointer',
};

const secondaryButtonStyle = {
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
};

function SelectField({ label, value, onChange, options, disabled = false }) {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>{label}</label>
      <select value={value} onChange={onChange} style={inputStyle} disabled={disabled}>
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ResultFilterDrawer({
  isOpen,
  draftFilters,
  onChange,
  onApply,
  onClear,
  onClose,
  children,
  districtOptions = [],
  blockOptions = [],
  schoolOptions = [],
  categoryOptions = [],
  genderOptions = [],
  schoolTypeOptions = [
    { value: '', label: 'All School Types' },
    { value: 'Govt Aided', label: 'Govt Aided' },
    { value: 'Dept of Edu', label: 'Dept of Edu' },
    { value: 'Local Body', label: 'Local Body' }
  ],
  schoolCategoryOptions = [
    { value: '', label: 'All Categories' },
    { value: 'Govt. Aided', label: 'Govt. Aided' },
    { value: 'Local Body', label: 'Local Body' }
  ],
  areaTypeOptions = [
    { value: '', label: 'All Area Types' },
    { value: 'Rural', label: 'Rural' },
    { value: 'Urban', label: 'Urban' }
  ],
}) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      <div
        style={{
          ...overlayStyle,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={onClose}
        aria-hidden={!isOpen}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Result filters"
        style={{
          ...panelStyle,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        <div style={headerStyle}>
          <div>
            <h2 style={titleStyle}>Filters</h2>
            <p style={subtitleStyle}>Adjust district, block, school, category, and gender filters here.</p>
          </div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            Close
          </button>
        </div>

        <div style={bodyStyle}>
          {children}

          <SelectField
            label="District"
            value={draftFilters.district}
            onChange={(event) => onChange('district', event.target.value)}
            options={districtOptions}
          />

          <SelectField
            label="Block"
            value={draftFilters.block}
            onChange={(event) => onChange('block', event.target.value)}
            options={blockOptions}
            disabled={blockOptions.length <= 1}
          />

          <SelectField
            label="School"
            value={draftFilters.school}
            onChange={(event) => onChange('school', event.target.value)}
            options={schoolOptions}
            disabled={schoolOptions.length <= 1}
          />

          <SelectField
            label="Category"
            value={draftFilters.category}
            onChange={(event) => onChange('category', event.target.value)}
            options={categoryOptions}
          />

          <SelectField
            label="Gender"
            value={draftFilters.gender}
            onChange={(event) => onChange('gender', event.target.value)}
            options={genderOptions}
          />

          <SelectField
            label="School Type"
            value={draftFilters.school_type}
            onChange={(event) => onChange('school_type', event.target.value)}
            options={schoolTypeOptions}
          />

          <SelectField
            label="School Category"
            value={draftFilters.school_category}
            onChange={(event) => onChange('school_category', event.target.value)}
            options={schoolCategoryOptions}
          />

          <SelectField
            label="Area Type"
            value={draftFilters.area_type}
            onChange={(event) => onChange('area_type', event.target.value)}
            options={areaTypeOptions}
          />
        </div>

        <div style={footerStyle}>
          <button type="button" onClick={onApply} style={primaryButtonStyle}>
            Apply Filters
          </button>
          <button type="button" onClick={onClear} style={secondaryButtonStyle}>
            Clear Filters
          </button>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
