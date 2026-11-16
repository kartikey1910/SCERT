import React from 'react';

export function ReportMetricCard({ label, value, highlight }) {
  return (
    <div style={{
      background: highlight ? '#f8fafc' : '#ffffff',
      border: `1px solid ${highlight ? '#cbd5e1' : '#e2e8f0'}`,
      borderRadius: '8px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '24px', fontWeight: 800, color: highlight ? '#0f172a' : '#334155' }}>{value}</span>
    </div>
  );
}
