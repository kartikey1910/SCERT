import React from 'react';
import { GroupedBarChart } from '../charts/GroupedBarChart.jsx';
import { ReportSectionHeader } from './ReportSectionHeader.jsx';
import { ComparisonChartPanel } from './ComparisonChartPanel.jsx';

// Correct % = green-blue, Incorrect % = amber-red
const CHART_KEYS = [
  { key: 'correctPercent',   label: 'Correct %' },
  { key: 'incorrectPercent', label: 'Incorrect %' },
];
const CHART_COLORS = {
  correctPercent:   '#10b981',
  incorrectPercent: '#f59e0b',
};
const LEVEL_COLORS = {
  state:    '#3b82f6',
  district: '#10b981',
  block:    '#f59e0b',
};

// Normalise: ensure all known labels are present with 0 if missing
function normaliseData(arr = [], knownLabels = []) {
  const byName = {};
  arr.forEach(r => { byName[r.name] = r; });
  const allLabels = Array.from(new Set([...knownLabels, ...Object.keys(byName)]));
  return allLabels.map(label => ({
    name:             label,
    correctPercent:   Number(byName[label]?.correctPercent   ?? 0),
    incorrectPercent: Number(byName[label]?.incorrectPercent ?? 0),
    totalStudents:    byName[label]?.totalStudents ?? 0,
  }));
}

const GENDER_LABELS   = ['Male', 'Female', 'Other'];
const CATEGORY_LABELS = ['GEN', 'OBC', 'SC', 'ST', 'EWS'];
const LOCATION_LABELS = ['Rural', 'Urban'];

function sharedMax(selfData, parentData) {
  const all = [...(selfData || []), ...(parentData || [])];
  return Math.max(...all.flatMap(d => [Number(d.correctPercent) || 0, Number(d.incorrectPercent) || 0]), 1);
}

/**
 * One demographic comparison chart (e.g. "By Gender").
 */
function DemoGroup({ label, selfData, parentData, selfLabel, parentLabel, selfColorKey, parentColorKey, knownLabels }) {
  const selfArr   = normaliseData(selfData,   knownLabels);
  const parentArr = parentData ? normaliseData(parentData, knownLabels) : null;
  const maxVal    = sharedMax(selfArr, parentArr);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={subTitleStyle}>{label}</div>
      <ComparisonChartPanel
        leftTitle={parentArr ? parentLabel : selfLabel}
        rightTitle={parentArr ? selfLabel : undefined}
        leftColor={LEVEL_COLORS[parentArr ? parentColorKey : selfColorKey]}
        rightColor={LEVEL_COLORS[selfColorKey]}
        leftChart={
          <GroupedBarChart
            data={parentArr || selfArr}
            keys={CHART_KEYS}
            colors={CHART_COLORS}
            height={220}
            sharedMax={maxVal}
          />
        }
        rightChart={parentArr ? (
          <GroupedBarChart
            data={selfArr}
            keys={CHART_KEYS}
            colors={CHART_COLORS}
            height={220}
            sharedMax={maxVal}
          />
        ) : null}
      />
    </div>
  );
}

/**
 * SubjectWisePerformanceSection
 *
 * Shows consolidated Correct % / Incorrect % breakdowns by demographic dimension.
 * Question types are aggregated internally — NO question-type labels shown.
 *
 * Props:
 *   subjectWiseAnalytics       – { gender_analysis, category_analysis, school_type_analysis, school_location_analysis }
 *   parentSubjectWiseAnalytics – same shape (optional, for comparison)
 *   selfLabel / parentLabel
 *   selfColorKey / parentColorKey
 */
export function SubjectWisePerformanceSection({
  subjectWiseAnalytics,
  parentSubjectWiseAnalytics,
  selfLabel = 'This Level',
  parentLabel = 'Parent Level',
  selfColorKey = 'district',
  parentColorKey = 'state',
}) {
  const sw  = subjectWiseAnalytics;
  const psw = parentSubjectWiseAnalytics;

  if (!sw || (!sw.gender_analysis?.length && !sw.category_analysis?.length)) return null;

  return (
    <div style={{ marginBottom: '32px' }}>
      <ReportSectionHeader
        title="Subject Wise Performance Analytics"
        subtitle="Consolidated correct/incorrect % across all question types, broken down by demographic dimensions."
      />

      <DemoGroup
        label="By Gender"
        selfData={sw.gender_analysis}
        parentData={psw?.gender_analysis}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={GENDER_LABELS}
      />

      <DemoGroup
        label="By Category"
        selfData={sw.category_analysis}
        parentData={psw?.category_analysis}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={CATEGORY_LABELS}
      />

      <DemoGroup
        label="By School Type"
        selfData={sw.school_type_analysis}
        parentData={psw?.school_type_analysis}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={[]}
      />

      <DemoGroup
        label="By School Location"
        selfData={sw.school_location_analysis}
        parentData={psw?.school_location_analysis}
        selfLabel={selfLabel}
        parentLabel={parentLabel}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
        knownLabels={LOCATION_LABELS}
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
