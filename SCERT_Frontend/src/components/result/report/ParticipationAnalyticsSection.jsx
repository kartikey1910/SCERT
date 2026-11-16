import React from 'react';
import { ReportSectionHeader } from './ReportSectionHeader.jsx';
import { ComparisonChartPanel } from './ComparisonChartPanel.jsx';

// Comparison color palette
const COLORS = {
  state:    '#3b82f6',  // blue
  district: '#10b981',  // emerald
  block:    '#f59e0b',  // amber
};

const pct = (value, base) => {
  if (!base || base === 0) return 0;
  return Number(((value / base) * 100).toFixed(1));
};

// Build data for a single level — each step's % is relative to total_registered_students (= 100%)
function buildFunnelData(participation) {
  const base = participation?.total_registered_students || 0;
  const examReg  = participation?.registered_in_scholarship || 0;
  const appeared = participation?.appeared_students           || 0;
  const selected = participation?.selected_students           || 0;

  return [
    { name: 'Class Reg',  value: base,     percent: 100              },
    { name: 'Exam Reg',   value: examReg,  percent: pct(examReg,  base) },
    { name: 'Appeared',   value: appeared, percent: pct(appeared, base) },
    { name: 'Selected',   value: selected, percent: pct(selected, base) },
  ];
}

const BAR_KEY = [{ key: 'value', label: 'Students' }];

// ─── Inline funnel chart using SVG ─────────────────────────────────────────
// Shows a funnel-style bar chart where the bar label includes both the raw
// number and the % of total class registration.
function FunnelBarChart({ data, color, height = 260 }) {
  if (!data || data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.value), 1);

  const svgWidth    = 520;
  const svgHeight   = height;
  const marginLeft  = 48;
  const marginRight = 12;
  const marginTop   = 22;
  const marginBottom = 56;

  const innerW = svgWidth - marginLeft - marginRight;
  const innerH = svgHeight - marginTop - marginBottom;

  const groupWidth = innerW / data.length;
  const barWidth   = Math.max(groupWidth * 0.55, 20);

  const yTicks = [0.25, 0.5, 0.75, 1].map(m => ({
    value: Math.round(maxVal * m),
    y:     marginTop + innerH - innerH * m,
  }));

  const MIN_BAR_H = 2;

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={{ width: '100%', height: 'auto', overflow: 'visible' }}
      role="img"
      aria-label="Student Participation Funnel Chart"
    >
      {/* Axes */}
      <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={marginTop + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
      <line x1={marginLeft} y1={marginTop + innerH} x2={svgWidth - marginRight} y2={marginTop + innerH} stroke="#cbd5e1" strokeWidth="1.5" />

      {/* Y grid + ticks */}
      {yTicks.map(t => (
        <g key={t.value}>
          <line x1={marginLeft} y1={t.y} x2={svgWidth - marginRight} y2={t.y} stroke="#f1f5f9" strokeWidth="1" />
          <text x={marginLeft - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="inherit">
            {t.value.toLocaleString()}
          </text>
        </g>
      ))}

      {/* Bars */}
      {data.map((d, i) => {
        const gx      = marginLeft + i * groupWidth;
        const centerX = gx + groupWidth / 2;
        const bx      = centerX - barWidth / 2;
        const bHeight = Math.max((d.value / maxVal) * innerH, MIN_BAR_H);
        const by      = marginTop + innerH - bHeight;
        const isZero  = d.value === 0;

        return (
          <g key={d.name}>
            {/* Bar */}
            <rect
              x={bx}
              y={by}
              width={barWidth}
              height={bHeight}
              rx={isZero ? 0 : 4}
              fill={color}
              opacity={isZero ? 0.25 : 0.88}
            />

            {/* % badge above bar */}
            <text
              x={centerX}
              y={by - 5}
              textAnchor="middle"
              fontSize="10"
              fontWeight="800"
              fill={isZero ? '#94a3b8' : color}
            >
              {d.percent}%
            </text>

            {/* X label */}
            <text
              x={centerX}
              y={marginTop + innerH + 16}
              textAnchor="middle"
              fontSize="11"
              fill="#475569"
              fontWeight="700"
            >
              {d.name}
            </text>

            {/* Small % subtitle below x label */}
            <text
              x={centerX}
              y={marginTop + innerH + 30}
              textAnchor="middle"
              fontSize="9"
              fill={color}
              fontWeight="600"
            >
              of class reg.
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Summary row beneath each chart ─────────────────────────────────────────
function FunnelSummaryRow({ data, color }) {
  return (
    <div style={{ display: 'flex', gap: '0', borderTop: '1px solid #f1f5f9', paddingTop: '8px', marginTop: '2px' }}>
      {data.map((d, i) => (
        <div
          key={d.name}
          style={{
            flex: 1,
            textAlign: 'center',
            borderRight: i < data.length - 1 ? '1px solid #f1f5f9' : 'none',
            paddingBottom: '4px',
          }}
        >
          <div style={{ fontSize: '18px', fontWeight: 900, color: d.value === 0 ? '#94a3b8' : '#0f172a', lineHeight: 1.1 }}>
            {d.value.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 800, color, lineHeight: 1.2, marginTop: '2px' }}>
            {d.percent}%
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>
            {d.name}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * ParticipationAnalyticsSection
 *
 * Shows the student participation funnel with counts AND percentages.
 * "Class Reg" = 100%. All other stages shown as % of that base.
 *
 * Props:
 *   participation       – current level's participation object
 *   parentParticipation – parent level's (optional)
 *   selfLabel / parentLabel
 *   selfColorKey / parentColorKey  –  'state' | 'district' | 'block'
 */
export function ParticipationAnalyticsSection({
  participation,
  parentParticipation,
  selfLabel = 'This Level',
  parentLabel = 'Parent Level',
  selfColorKey = 'district',
  parentColorKey = 'state',
}) {
  const selfData   = buildFunnelData(participation);
  const parentData = parentParticipation ? buildFunnelData(parentParticipation) : null;

  const selfColor   = COLORS[selfColorKey]   || COLORS.state;
  const parentColor = COLORS[parentColorKey] || COLORS.state;

  // Use the same Y-axis max for side-by-side charts
  const selfMax   = Math.max(...selfData.map(d => d.value), 0);
  const parentMax = parentData ? Math.max(...parentData.map(d => d.value), 0) : 0;
  const sharedMax = Math.max(selfMax, parentMax, 1);

  // Temporarily re-scale for shared display by overriding the chart's internal max;
  // We pass a special prop `overrideMax` below to normalise both charts identically.
  // Since we have a custom chart here, just pass sharedMax as a prop.

  return (
    <div style={{ marginBottom: '32px' }}>
      <ReportSectionHeader
        title="Student Participation Funnel"
        subtitle="Pipeline from total class strength to final selection. Percentages are relative to total class-registered students (= 100%)."
      />

      <ComparisonChartPanel
        leftTitle={parentData ? `${parentLabel} Participation` : `${selfLabel} Participation`}
        rightTitle={parentData ? `${selfLabel} Participation` : undefined}
        leftColor={parentData ? parentColor : selfColor}
        rightColor={selfColor}
        leftChart={
          <div>
            <FunnelBarChart
              data={parentData || selfData}
              color={parentData ? parentColor : selfColor}
              height={250}
            />
            <FunnelSummaryRow
              data={parentData || selfData}
              color={parentData ? parentColor : selfColor}
            />
          </div>
        }
        rightChart={parentData ? (
          <div>
            <FunnelBarChart
              data={selfData}
              color={selfColor}
              height={250}
            />
            <FunnelSummaryRow
              data={selfData}
              color={selfColor}
            />
          </div>
        ) : null}
      />
    </div>
  );
}
