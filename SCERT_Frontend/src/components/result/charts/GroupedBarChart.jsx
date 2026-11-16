/**
 * GroupedBarChart
 * Props:
 *   data      – array of { name, [key]: value, ... }
 *   keys      – [{ key, label }]
 *   colors    – { [key]: color }
 *   height    – SVG inner height (default 260)
 *   sharedMax – optional override for Y-axis max (for paired charts with same scale)
 */
export function GroupedBarChart({ data = [], keys = [], colors = {}, height: chartHeightProp = 260, sharedMax }) {
  const wrapStyle = { width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' };
  const emptyStyle = { color: '#94a3b8', fontSize: '13px', fontWeight: 600, textAlign: 'center', padding: '40px 0' };

  if (!data || data.length === 0) {
    return <div style={wrapStyle}><div style={emptyStyle}>No data available.</div></div>;
  }

  // Compute max — use sharedMax if provided, else derive from data
  const dataMax = Math.max(...data.flatMap(d => keys.map(k => Number(d[k.key]) || 0)), 0);
  const maxValue = (sharedMax != null && sharedMax > 0) ? sharedMax : (dataMax > 0 ? dataMax : 1);

  const svgWidth = 540;
  const svgHeight = chartHeightProp;
  const marginLeft = 44;
  const marginRight = 12;
  const marginTop = 22;
  const maxLabelLen = Math.max(...data.map(d => String(d.name || '').length), 0);
  const marginBottom = maxLabelLen > 10 ? 64 : 44;

  const innerW = svgWidth - marginLeft - marginRight;
  const innerH = svgHeight - marginTop - marginBottom;

  const groupWidth = innerW / Math.max(data.length, 1);
  const barWidth = Math.max((groupWidth * 0.82) / Math.max(keys.length, 1), 4);

  const yTicks = [0.25, 0.5, 0.75, 1].map(m => ({
    value: Math.round(maxValue * m),
    y: marginTop + innerH - innerH * m,
  }));

  const truncate = (str, max = 14) => {
    const s = String(str || '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  // Minimum bar height so zero-value bars are still visible as a line
  const MIN_BAR_H = 2;

  return (
    <div style={wrapStyle}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible' }}
        role="img"
        aria-label="Analytics Bar Chart"
      >
        {/* Axes */}
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={marginTop + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={marginLeft} y1={marginTop + innerH} x2={svgWidth - marginRight} y2={marginTop + innerH} stroke="#cbd5e1" strokeWidth="1.5" />

        {/* Y grid + ticks */}
        {yTicks.map(t => (
          <g key={t.value}>
            <line x1={marginLeft} y1={t.y} x2={svgWidth - marginRight} y2={t.y} stroke="#f1f5f9" strokeWidth="1" />
            <text x={marginLeft - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="inherit">
              {t.value}
            </text>
          </g>
        ))}

        {/* Bars + X labels */}
        {data.map((group, i) => {
          const gx = marginLeft + i * groupWidth;
          const centerX = gx + groupWidth / 2;
          const labelLen = String(group.name || '').length;
          const rotateDeg = labelLen > 10 ? -38 : 0;
          return (
            <g key={group.name || `group-${i}`}>
              {/* X axis label */}
              {rotateDeg !== 0 ? (
                <text
                  x={centerX}
                  y={marginTop + innerH + 14}
                  textAnchor="end"
                  fontSize="10"
                  fill="#475569"
                  fontWeight="600"
                  transform={`rotate(${rotateDeg}, ${centerX}, ${marginTop + innerH + 14})`}
                >
                  {truncate(group.name, 18)}
                </text>
              ) : (
                <text
                  x={centerX}
                  y={marginTop + innerH + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#475569"
                  fontWeight="700"
                >
                  {truncate(group.name, 13)}
                </text>
              )}

              {/* Bars — always render even for 0 */}
              {keys.map((k, j) => {
                const val = Number(group[k.key]) || 0;
                // Postgres AVG() returns full decimal precision (e.g.
                // 19.0026948486845235) — round for display the same way
                // every other consumer of this data already does.
                const rounded = Math.round(val * 100) / 100;
                const displayVal = Number.isInteger(rounded) ? rounded : rounded.toFixed(2);
                const bHeight = Math.max((val / maxValue) * innerH, MIN_BAR_H);
                const bx = gx + (groupWidth * 0.09) + j * barWidth;
                const by = marginTop + innerH - bHeight;
                const isZero = val === 0;
                return (
                  <g key={k.key}>
                    <rect
                      x={bx}
                      y={by}
                      width={Math.max(barWidth - 3, 3)}
                      height={bHeight}
                      rx={isZero ? 0 : 3}
                      fill={colors[k.key] || '#3b82f6'}
                      opacity={isZero ? 0.25 : 0.92}
                    />
                    {/* Value label above bar — always show */}
                    <text
                      x={bx + Math.max(barWidth - 3, 3) / 2}
                      y={by - 4}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fill={isZero ? '#94a3b8' : '#0f172a'}
                    >
                      {displayVal}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {keys.length > 1 && (
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '2px' }}>
          {keys.map(k => (
            <div key={k.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '10px', height: '10px', background: colors[k.key] || '#3b82f6', borderRadius: '3px', flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: '#475569', fontWeight: 600 }}>{k.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
