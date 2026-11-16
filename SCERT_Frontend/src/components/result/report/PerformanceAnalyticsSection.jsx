import React from 'react';
import { ReportSectionHeader } from './ReportSectionHeader.jsx';
import { ComparisonChartPanel } from './ComparisonChartPanel.jsx';
import { GroupedBarChart } from '../charts/GroupedBarChart.jsx';

const COLORS = {
  state:    '#3b82f6',
  district: '#10b981',
  block:    '#f59e0b',
};

const PERF_KEYS = [
  { key: 'avg_mat_score',     label: 'Avg MAT' },
  { key: 'highest_mat_score', label: 'High MAT' },
  { key: 'avg_sat_score',     label: 'Avg SAT' },
  { key: 'highest_sat_score', label: 'High SAT' },
];

const PERF_COLORS = {
  avg_mat_score:     '#3b82f6',
  highest_mat_score: '#1d4ed8',
  avg_sat_score:     '#8b5cf6',
  highest_sat_score: '#6d28d9',
};

// All known gender labels — always shown
const GENDER_LABELS   = ['Male', 'Female'];
const CATEGORY_LABELS = ['GEN', 'OBC', 'SC', 'ST', 'EWS'];

/** Normalize a raw gender string to 'Male' | 'Female' | null */
function normalizeGenderLabel(raw) {
  const u = String(raw || '').trim().toUpperCase();
  if (u === '1' || u === 'MALE' || u === 'M' || u === 'MALE') return 'Male';
  if (u === '2' || u === 'FEMALE' || u === 'F' || u === 'FEMALE') return 'Female';
  return null;
}

/**
 * Normalise a performance array so every label from `allLabels` is present.
 * For gender groups, raw labels are merged into Male/Female/Other before indexing.
 */
function normalizePerf(arr = [], knownLabels = [], isGender = false) {
  const byLabel = {};
  arr.forEach(item => {
    const key = isGender ? normalizeGenderLabel(item.label) : item.label;
    if (!byLabel[key]) {
      byLabel[key] = { ...item, label: key };
    } else {
      // Merge counts for duplicate normalized labels
      const existing = byLabel[key];
      const prevCount = existing.total_students || 0;
      const newCount  = item.total_students     || 0;
      const combined  = prevCount + newCount;
      byLabel[key] = {
        label: key,
        avg_mat_score:     combined > 0 ? ((existing.avg_mat_score * prevCount + item.avg_mat_score * newCount) / combined) : 0,
        highest_mat_score: Math.max(existing.highest_mat_score || 0, item.highest_mat_score || 0),
        avg_sat_score:     combined > 0 ? ((existing.avg_sat_score * prevCount + item.avg_sat_score * newCount) / combined) : 0,
        highest_sat_score: Math.max(existing.highest_sat_score || 0, item.highest_sat_score || 0),
        total_students:    combined,
      };
    }
  });

  // All labels: known ones + any that came from data
  const allLabels = Array.from(new Set([...knownLabels, ...Object.keys(byLabel)]));

  return allLabels.map(label => ({
    name:               label,
    avg_mat_score:      Number((byLabel[label]?.avg_mat_score     || 0).toFixed(2)),
    highest_mat_score:  byLabel[label]?.highest_mat_score || 0,
    avg_sat_score:      Number((byLabel[label]?.avg_sat_score     || 0).toFixed(2)),
    highest_sat_score:  byLabel[label]?.highest_sat_score || 0,
    total_students:     byLabel[label]?.total_students    || 0,
  }));
}

function perfSharedMax(selfData = [], parentData = []) {
  const vals = [...selfData, ...parentData].flatMap(d =>
    PERF_KEYS.map(k => Number(d[k.key]) || 0)
  );
  return Math.max(...vals, 1);
}

function PerfGroup({ groupKey, groupLabel, selfPerf, parentPerf, selfColorKey, parentColorKey, knownLabels, selfLabel, parentLabel }) {
  const isGender  = groupKey === 'gender';
  const selfArr   = normalizePerf(selfPerf?.[groupKey],   knownLabels, isGender);
  const parentArr = parentPerf ? normalizePerf(parentPerf[groupKey], knownLabels, isGender) : null;
  const sharedMax = perfSharedMax(selfArr, parentArr || []);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={subTitleStyle}>{groupLabel}</div>
      <ComparisonChartPanel
        leftTitle={parentArr ? parentLabel : selfLabel}
        rightTitle={parentArr ? selfLabel : undefined}
        leftColor={COLORS[parentArr ? parentColorKey : selfColorKey]}
        rightColor={COLORS[selfColorKey]}
        leftChart={
          <GroupedBarChart
            data={parentArr || selfArr}
            keys={PERF_KEYS}
            colors={PERF_COLORS}
            height={240}
            sharedMax={sharedMax}
          />
        }
        rightChart={parentArr ? (
          <GroupedBarChart
            data={selfArr}
            keys={PERF_KEYS}
            colors={PERF_COLORS}
            height={240}
            sharedMax={sharedMax}
          />
        ) : null}
      />
    </div>
  );
}

/**
 * Props:
 *   performance         – current level performance object { gender[], category[], school_type[], school_location[] }
 *   parentPerformance   – parent level (optional, same shape)
 *   selfLabel           – display label for this level
 *   parentLabel         – display label for parent
 *   selfColorKey        – 'state' | 'district' | 'block'
 *   parentColorKey      – 'state' | 'district'
 */
export function PerformanceAnalyticsSection({
  performance,
  parentPerformance,
  selfLabel = 'This Level',
  parentLabel = 'Parent Level',
  selfColorKey = 'district',
  parentColorKey = 'state',
}) {
  if (!performance) return null;

  return (
    <div style={{ marginBottom: '32px' }}>
      <ReportSectionHeader
        title="Performance Analytics"
        subtitle="MAT and SAT scores grouped by gender, category, school type, and location."
      />

      <PerfGroup
        groupKey="gender"
        groupLabel="By Gender"
        selfPerf={performance}
        parentPerf={parentPerformance}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={GENDER_LABELS}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
      />
      <PerfGroup
        groupKey="category"
        groupLabel="By Category"
        selfPerf={performance}
        parentPerf={parentPerformance}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={CATEGORY_LABELS}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
      />
      <PerfGroup
        groupKey="school_type"
        groupLabel="By School Type"
        selfPerf={performance}
        parentPerf={parentPerformance}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={[]}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
      />
      <PerfGroup
        groupKey="school_location"
        groupLabel="By School Location"
        selfPerf={performance}
        parentPerf={parentPerformance}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={['Rural', 'Urban']}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
      />
    </div>
  );
}

const subTitleStyle = {
  fontSize: '12px',
  fontWeight: 800,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '10px',
};
