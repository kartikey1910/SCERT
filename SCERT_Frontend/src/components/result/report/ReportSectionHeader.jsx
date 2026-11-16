import React from 'react';

export function ReportSectionHeader({ title, subtitle }) {
  return (
    <div style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px' }}>
      <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{title}</h2>
      {subtitle && <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{subtitle}</p>}
    </div>
  );
}
