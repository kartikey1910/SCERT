import React from 'react';

export function ReportCoverSection({ title, subtitle, level, levelName }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', borderBottom: '4px solid #1e293b', marginBottom: '32px' }}>
      <div style={{ fontSize: '14px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>
        {level} Report {levelName ? `— ${levelName}` : ''}
      </div>
      <h1 style={{ margin: '0 0 16px 0', fontSize: '32px', fontWeight: 900, color: '#0f172a' }}>{title}</h1>
      <p style={{ margin: 0, fontSize: '16px', color: '#475569', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
        {subtitle}
      </p>
    </div>
  );
}
