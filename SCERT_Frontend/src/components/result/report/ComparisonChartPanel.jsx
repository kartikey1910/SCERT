import React from 'react';

/**
 * ComparisonChartPanel
 *
 * Renders two charts side-by-side (or stacked on print/narrow screens).
 * Props:
 *   leftTitle   – e.g. "State Participation"
 *   rightTitle  – e.g. "Almora District Participation"
 *   leftColor   – accent color for the left card border
 *   rightColor  – accent color for the right card border
 *   leftChart   – ReactNode
 *   rightChart  – ReactNode
 *   hideIfSolo  – if true and no rightChart, render only leftChart without wrapper
 */
export function ComparisonChartPanel({
  leftTitle,
  rightTitle,
  leftColor = '#3b82f6',
  rightColor = '#10b981',
  leftChart,
  rightChart,
}) {
  // If no right chart provided (state-only page), just show single card
  if (!rightChart) {
    return (
      <div style={{ ...cardStyle, borderTop: `3px solid ${leftColor}` }}>
        {leftTitle && <div style={{ ...cardTitleStyle, color: leftColor }}>{leftTitle}</div>}
        {leftChart}
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ ...cardStyle, borderTop: `3px solid ${leftColor}`, flex: 1, minWidth: 0 }}>
        {leftTitle && <div style={{ ...cardTitleStyle, color: leftColor }}>{leftTitle}</div>}
        {leftChart}
      </div>
      <div style={{ ...cardStyle, borderTop: `3px solid ${rightColor}`, flex: 1, minWidth: 0 }}>
        {rightTitle && <div style={{ ...cardTitleStyle, color: rightColor }}>{rightTitle}</div>}
        {rightChart}
      </div>
    </div>
  );
}

const panelStyle = {
  display: 'flex',
  gap: '16px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',   // stacks on narrow / print
};

const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  padding: '14px 14px 10px',
  display: 'flex',
  flexDirection: 'column',
  minWidth: '260px',
  flex: 1,
};

const cardTitleStyle = {
  fontSize: '11px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  marginBottom: '10px',
};
