import React from 'react';
import { ReportSectionHeader } from './ReportSectionHeader.jsx';
import { GroupedBarChart } from '../charts/GroupedBarChart.jsx';

export function ComparativeAnalyticsSection({ comparison, targetName, baseName }) {
  if (!comparison) return null;

  const data = [
    {
      name: 'MAT Average',
      [targetName]: comparison.target_avg_mat_score,
      [baseName]: comparison.base_avg_mat_score
    },
    {
      name: 'SAT Average',
      [targetName]: comparison.target_avg_sat_score,
      [baseName]: comparison.base_avg_sat_score
    }
  ];

  const keys = [
    { key: targetName, label: targetName },
    { key: baseName, label: baseName }
  ];

  const colors = {
    [targetName]: '#2563eb', // Blue for target
    [baseName]: '#94a3b8'    // Slate for base
  };

  const matDiff = comparison.diff_mat;
  const satDiff = comparison.diff_sat;

  return (
    <div style={{ marginBottom: '32px', padding: '24px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <ReportSectionHeader title="Benchmarking Analysis" subtitle={`Comparing ${targetName} against ${baseName}`} />
      
      <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
        <div style={{ flex: 2 }}>
          <GroupedBarChart data={data} keys={keys} colors={colors} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '16px', background: '#ffffff', borderLeft: `4px solid ${matDiff >= 0 ? '#10b981' : '#ef4444'}`, borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>MAT PERFORMANCE</div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '6px' }}>
              {Math.abs(matDiff)} points {matDiff >= 0 ? 'higher' : 'lower'} than {baseName} average.
            </div>
          </div>
          <div style={{ padding: '16px', background: '#ffffff', borderLeft: `4px solid ${satDiff >= 0 ? '#10b981' : '#ef4444'}`, borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>SAT PERFORMANCE</div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '6px' }}>
              {Math.abs(satDiff)} points {satDiff >= 0 ? 'higher' : 'lower'} than {baseName} average.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
