import React from 'react';
import { ReportSectionHeader } from './ReportSectionHeader.jsx';
import { ComparisonChartPanel } from './ComparisonChartPanel.jsx';
import { GroupedBarChart } from '../charts/GroupedBarChart.jsx';

// Comparison color palette
const COLORS = {
  state:    '#3b82f6',
  district: '#10b981',
  block:    '#f59e0b',
};

// All fixed category labels — always shown even if 0
const CATEGORY_LABELS = ['GIC', 'GHS', 'GUPS', 'Aided', 'Local Bd', 'Dept Edu'];
const AREA_LABELS     = ['Rural', 'Urban'];

function buildCategoryData(sp) {
  return [
    { name: 'GIC',      value: sp?.gic_schools              || 0 },
    { name: 'GHS',      value: sp?.ghs_schools              || 0 },
    { name: 'GUPS',     value: sp?.gups_schools             || 0 },
    { name: 'Aided',    value: sp?.govt_aided               || 0 },
    { name: 'Local Bd', value: sp?.local_body               || 0 },
    { name: 'Dept Edu', value: sp?.dept_of_edu              || 0 },
  ];
}

function buildAreaData(sp) {
  return [
    { name: 'Rural', value: sp?.rural || 0 },
    { name: 'Urban', value: sp?.urban || 0 },
  ];
}

function sharedMaxFor(a, b, field = 'value') {
  const aMax = Math.max(...(a || []).map(d => d[field] || 0), 0);
  const bMax = Math.max(...(b || []).map(d => d[field] || 0), 0);
  return Math.max(aMax, bMax, 1);
}

/**
 * Props:
 *   schoolParticipation       – current level
 *   parentSchoolParticipation – parent level (optional)
 *   selfLabel / parentLabel   – display labels
 *   selfColorKey / parentColorKey – 'state' | 'district' | 'block'
 */
export function SchoolParticipationSection({
  schoolParticipation,
  parentSchoolParticipation,
  selfLabel = 'This Level',
  parentLabel = 'Parent Level',
  selfColorKey = 'district',
  parentColorKey = 'state',
}) {
  const selfCat   = buildCategoryData(schoolParticipation);
  const parentCat = parentSchoolParticipation ? buildCategoryData(parentSchoolParticipation) : null;
  const catMax    = sharedMaxFor(selfCat, parentCat);

  const selfArea   = buildAreaData(schoolParticipation);
  const parentArea = parentSchoolParticipation ? buildAreaData(parentSchoolParticipation) : null;
  const areaMax    = sharedMaxFor(selfArea, parentArea);

  const selfCatColors   = { value: COLORS[selfColorKey]   || COLORS.district };
  const parentCatColors = { value: COLORS[parentColorKey] || COLORS.state    };
  const catKeys = [{ key: 'value', label: 'Schools' }];

  return (
    <div style={{ marginBottom: '32px' }}>
      <ReportSectionHeader
        title="School Participation"
        subtitle="Schools participating by category and geographical area."
      />

      {/* School Category comparison */}
      <div style={{ marginBottom: '16px' }}>
        <div style={subTitleStyle}>School Category</div>
        <ComparisonChartPanel
          leftTitle={parentCat ? `${parentLabel} — School Category` : `${selfLabel} — School Category`}
          rightTitle={parentCat ? `${selfLabel} — School Category` : undefined}
          leftColor={COLORS[parentCat ? parentColorKey : selfColorKey]}
          rightColor={COLORS[selfColorKey]}
          leftChart={
            <GroupedBarChart
              data={parentCat || selfCat}
              keys={catKeys}
              colors={parentCat ? parentCatColors : selfCatColors}
              height={220}
              sharedMax={catMax}
            />
          }
          rightChart={parentCat ? (
            <GroupedBarChart
              data={selfCat}
              keys={catKeys}
              colors={selfCatColors}
              height={220}
              sharedMax={catMax}
            />
          ) : null}
        />
      </div>

      {/* Area comparison */}
      <div>
        <div style={subTitleStyle}>School Area (Rural vs Urban)</div>
        <ComparisonChartPanel
          leftTitle={parentArea ? `${parentLabel} — Area` : `${selfLabel} — Area`}
          rightTitle={parentArea ? `${selfLabel} — Area` : undefined}
          leftColor={COLORS[parentArea ? parentColorKey : selfColorKey]}
          rightColor={COLORS[selfColorKey]}
          leftChart={
            <GroupedBarChart
              data={parentArea || selfArea}
              keys={[{ key: 'value', label: 'Schools' }]}
              colors={parentArea ? parentCatColors : selfCatColors}
              height={200}
              sharedMax={areaMax}
            />
          }
          rightChart={parentArea ? (
            <GroupedBarChart
              data={selfArea}
              keys={[{ key: 'value', label: 'Schools' }]}
              colors={selfCatColors}
              height={200}
              sharedMax={areaMax}
            />
          ) : null}
        />
      </div>
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
