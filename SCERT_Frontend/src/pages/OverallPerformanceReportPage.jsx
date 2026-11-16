import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from '../scert.session-context.jsx';
import { getOverallPerformanceReport, getOverallPerformanceGeoMaster } from '../api/result.api.js';
import { ReportPageLayout } from '../components/result/report/ReportPageLayout.jsx';
import { ReportCoverSection } from '../components/result/report/ReportCoverSection.jsx';
import { ReportOverviewSection } from '../components/result/report/ReportOverviewSection.jsx';
import { ParticipationAnalyticsSection } from '../components/result/report/ParticipationAnalyticsSection.jsx';
import { SchoolParticipationSection } from '../components/result/report/SchoolParticipationSection.jsx';
import { PerformanceAnalyticsSection } from '../components/result/report/PerformanceAnalyticsSection.jsx';
import { ComparativeAnalyticsSection } from '../components/result/report/ComparativeAnalyticsSection.jsx';
import { SubjectWisePerformanceSection } from '../components/result/report/SubjectWisePerformanceSection.jsx';

// ── Scholarship → available classes map ──────────────────────────────────────
function getClassesForScholarship(scholarship) {
  const name = String(scholarship?.scholarship_name || '').toLowerCase();
  const id = Number(scholarship?.scholarship_id);
  if (id === 6 || name.includes('nmms') || name.includes('snss')) return ['8'];
  if (id === 3 || /\bcm\b/i.test(name) || name.includes('chief minister')) return ['6', '9'];
  return ['6'];
}

const CLASS_LABELS = { '6': 'Class VI', '8': 'Class VIII (NMMS)', '9': 'Class IX' };

// ── Color keys by level ────────────────────────────────────────────────────────
const LEVEL_COLOR = { State: 'state', District: 'district', Block: 'block' };

// ── One report page — State, District, or Block — for one class ───────────────
/**
 * Only ever renders ONE node at a time (whichever the left-side nav is
 * currently pointed at), not the whole state+district+block tree — that's
 * the whole point of the drill-down nav: the server only computes the node
 * being viewed (see result.service.js:getOverallPerformanceAggregates), so
 * the page only ever needs to render one.
 */
function RenderReportNode({
  title, subtitle, level, levelName,
  data, parentData,
  selfLabel, parentLabel,
  comparison, compTargetName, compBaseName,
}) {
  if (!data) return null;

  const selfColorKey   = LEVEL_COLOR[level]                                    || 'district';
  const parentColorKey = LEVEL_COLOR[level === 'Block' ? 'District' : 'State'] || 'state';

  return (
    <ReportPageLayout isLastPage>
      <ReportCoverSection title={title} subtitle={subtitle} level={level} levelName={levelName} />

      <ReportOverviewSection
        overview={data.overview}
        participation={data.participation}
        schoolParticipation={data.school_participation}
      />

      {comparison && (
        <ComparativeAnalyticsSection
          comparison={comparison}
          targetName={compTargetName}
          baseName={compBaseName}
        />
      )}

      <ParticipationAnalyticsSection
        participation={data.participation}
        parentParticipation={parentData?.participation}
        selfLabel={selfLabel || levelName}
        parentLabel={parentLabel || 'Reference'}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
      />

      <SchoolParticipationSection
        schoolParticipation={data.school_participation}
        parentSchoolParticipation={parentData?.school_participation}
        selfLabel={selfLabel || levelName}
        parentLabel={parentLabel || 'Reference'}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
      />

      <PerformanceAnalyticsSection
        performance={data.performance}
        parentPerformance={parentData?.performance}
        selfLabel={selfLabel || levelName}
        parentLabel={parentLabel || 'Reference'}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
      />

      <SubjectWisePerformanceSection
        subjectWiseAnalytics={data.subject_wise_analytics}
        parentSubjectWiseAnalytics={parentData?.subject_wise_analytics}
        selfLabel={selfLabel || levelName}
        parentLabel={parentLabel || 'Reference'}
        selfColorKey={selfColorKey}
        parentColorKey={parentColorKey}
      />
    </ReportPageLayout>
  );
}

// ── Turns one class's { level, district_name, block_name, target, parent,
//    comparison } response into the title/labels RenderReportNode needs ──────
function ClassReportPage({ classKey, classData, scholarshipName, sessionName }) {
  if (!classData) return null;
  const classLabel = CLASS_LABELS[classKey] || `Class ${classKey}`;
  const subtitle = `${scholarshipName} · ${sessionName} · ${classLabel}`;
  const { level, district_name, block_name, target, parent, comparison } = classData;

  if (level === 'block') {
    return (
      <RenderReportNode
        title={`${block_name} Block`}
        subtitle={`${subtitle} — Block Report`}
        level="Block"
        levelName={block_name}
        selfLabel={`${block_name} Block`}
        parentLabel={`${district_name} District`}
        data={target}
        parentData={parent}
        comparison={comparison}
        compTargetName={block_name}
        compBaseName={district_name}
      />
    );
  }

  if (level === 'district') {
    return (
      <RenderReportNode
        title={`${district_name} District`}
        subtitle={`${subtitle} — District Report`}
        level="District"
        levelName={district_name}
        selfLabel={`${district_name} District`}
        parentLabel="State (Uttarakhand)"
        data={target}
        parentData={parent}
        comparison={comparison}
        compTargetName={district_name}
        compBaseName="State"
      />
    );
  }

  return (
    <RenderReportNode
      title="State Overall Performance"
      subtitle={`${subtitle} — State Aggregated Report`}
      level="State"
      levelName="Uttarakhand"
      selfLabel="Uttarakhand (State)"
      data={target}
    />
  );
}

// ── Left-side drill-down nav ────────────────────────────────────────────────
function ReportNav({ geoMaster, scope, onSelectState, onSelectDistrict, onSelectBlock }) {
  const activeDistrict = scope.district
    ? geoMaster?.districts?.find((d) => d.name === scope.district)
    : null;
  const items = activeDistrict ? activeDistrict.blocks : (geoMaster?.districts || []);
  const isStateActive = !scope.district;

  return (
    <nav style={styles.nav} className="print-hide">
      <button
        type="button"
        onClick={onSelectState}
        style={{ ...styles.navStateBtn, ...(isStateActive ? styles.navStateBtnActive : {}) }}
      >
        Uttarakhand State
      </button>

      <div style={styles.navListLabel}>
        {activeDistrict ? `Blocks in ${activeDistrict.name}` : 'Districts'}
      </div>

      {activeDistrict && (
        <button type="button" onClick={onSelectState} style={styles.navBackLink}>
          ‹ All Districts
        </button>
      )}

      <div style={styles.navList}>
        {!geoMaster && <div style={styles.navLoading}>Loading…</div>}
        {items.map((item) => {
          const isActive = activeDistrict
            ? scope.block === item.code
            : scope.district === item.name;
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => (activeDistrict ? onSelectBlock(item.code) : onSelectDistrict(item.name))}
              style={{ ...styles.navItemBtn, ...(isActive ? styles.navItemBtnActive : {}) }}
            >
              {item.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function OverallPerformanceReportPage() {
  const { sessionId, sessionName, scholarships = [], selectedScholarshipId } = useSession();

  const selectedScholarship = useMemo(
    () => scholarships.find(s => s.scholarship_id === selectedScholarshipId),
    [scholarships, selectedScholarshipId]
  );

  const classOptions = useMemo(
    () => getClassesForScholarship(selectedScholarship),
    [selectedScholarship]
  );

  // { district: string|null, block: string|null } — block is a code, only
  // meaningful together with a district.
  const [scope, setScope] = useState({ district: null, block: null });
  const [classFilter, setClassFilter] = useState('all'); // 'all' | one of classOptions

  const [geoMaster, setGeoMaster] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  // Static nav tree — fetched once, independent of session/scholarship/class.
  useEffect(() => {
    getOverallPerformanceGeoMaster().then(setGeoMaster).catch(() => setGeoMaster(null));
  }, []);

  // Reset drill-down and class filter when the scholarship changes, since a
  // block/class picked under one scholarship may not apply to the next.
  // Adjusted during render (React's documented pattern for resetting state
  // when a prop changes) rather than in an effect, which would otherwise
  // fire an extra cascading render after every scholarship switch.
  const [scopedForScholarship, setScopedForScholarship] = useState(selectedScholarshipId);
  if (selectedScholarshipId !== scopedForScholarship) {
    setScopedForScholarship(selectedScholarshipId);
    setScope({ district: null, block: null });
    setClassFilter('all');
  }

  const effectiveClasses = classFilter === 'all' ? classOptions : [classFilter];
  const effectiveClassesKey = effectiveClasses.join(',');

  const loadReport = useCallback(async () => {
    if (!sessionId || !selectedScholarshipId || !effectiveClassesKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getOverallPerformanceReport({
        session_id:     sessionId,
        scholarship_id: selectedScholarshipId,
        class:          effectiveClassesKey,
        district:       scope.district || undefined,
        block:          scope.block || undefined,
      });
      setReportData(res);
    } catch (err) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [sessionId, selectedScholarshipId, effectiveClassesKey, scope.district, scope.block]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const scholarshipName = selectedScholarship?.scholarship_name || 'Scholarship';

  const selectState    = () => setScope({ district: null, block: null });
  const selectDistrict = (name) => setScope({ district: name, block: null });
  const selectBlock    = (code) => setScope((s) => ({ district: s.district, block: code }));

  // ── Render states ───────────────────────────────────────────────────────────
  if (!sessionId || !selectedScholarshipId) {
    return (
      <div style={styles.container}>
        {headerBar('Overall Performance Report', 'Publication-ready hierarchical analytical reporting engine')}
        <div style={styles.placeholder}>
          <div style={styles.placeholderTitle}>📋 Select Session &amp; Scholarship</div>
          <div style={styles.placeholderSub}>Use the global dropdown at the top to select a session and scholarship.</div>
        </div>
      </div>
    );
  }

  const classKeys = effectiveClasses.filter(c => reportData?.[c]);

  return (
    <div style={styles.container}>
      <div style={styles.headerBar} className="print-hide">
        <div>
          <div style={styles.headerTitle}>Overall Performance Report</div>
          <div style={styles.headerSub}>{scholarshipName} · Session {sessionName || sessionId}</div>
        </div>
        <button onClick={() => window.print()} style={styles.printBtn}>
          🖨️ Print / Export PDF
        </button>
      </div>

      <div style={styles.layout}>
        <ReportNav
          geoMaster={geoMaster}
          scope={scope}
          onSelectState={selectState}
          onSelectDistrict={selectDistrict}
          onSelectBlock={selectBlock}
        />

        <div style={styles.main}>
          <div style={styles.toolbar} className="print-hide">
            <div style={styles.legendBar}>
              <span style={styles.legendDot('#3b82f6')} /> State
              <span style={styles.legendDot('#10b981')} /> District
              <span style={styles.legendDot('#f59e0b')} /> Block
            </div>

            {classOptions.length > 1 && (
              <div style={styles.classFilterBar}>
                <button
                  type="button"
                  onClick={() => setClassFilter('all')}
                  style={{ ...styles.classChip, ...(classFilter === 'all' ? styles.classChipActive : {}) }}
                >
                  All Classes
                </button>
                {classOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setClassFilter(c)}
                    style={{ ...styles.classChip, ...(classFilter === c ? styles.classChipActive : {}) }}
                  >
                    {CLASS_LABELS[c] || `Class ${c}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading && (
            <div style={styles.placeholder}>
              <div style={styles.placeholderTitle}>⏳ Loading report…</div>
              <div style={styles.placeholderSub}>This page only fetches the node you're viewing, so it should be quick.</div>
            </div>
          )}

          {!loading && error && (
            <div style={{ ...styles.placeholder, color: '#ef4444' }}>
              <div style={styles.placeholderTitle}>⚠️ Error Loading Report</div>
              <div style={styles.placeholderSub}>{error}</div>
            </div>
          )}

          {!loading && !error && !classKeys.length && (
            <div style={styles.placeholder}>
              <div style={styles.placeholderTitle}>No data yet</div>
              <div style={styles.placeholderSub}>Results may not be uploaded for this scope yet.</div>
            </div>
          )}

          {!loading && !error && (
            <div style={styles.reportWrapper}>
              <style>{`@media print { .print-hide { display: none !important; } }`}</style>
              {classKeys.map((cls) => (
                <ClassReportPage
                  key={cls}
                  classKey={cls}
                  classData={reportData[cls]}
                  scholarshipName={scholarshipName}
                  sessionName={sessionName || sessionId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function headerBar(title, sub) {
  return (
    <div style={styles.headerBar} className="print-hide">
      <div>
        <div style={styles.headerTitle}>{title}</div>
        {sub && <div style={styles.headerSub}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' },
  headerBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#0f172a', padding: '20px 28px', borderRadius: '12px', color: '#fff',
  },
  headerTitle: { fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' },
  headerSub:   { fontSize: '13px', color: '#94a3b8', marginTop: '4px' },
  printBtn: {
    background: '#3b82f6', color: '#fff', border: 'none',
    padding: '10px 22px', borderRadius: '8px', cursor: 'pointer',
    fontWeight: 700, fontSize: '14px',
  },

  layout: { display: 'flex', gap: '16px', alignItems: 'flex-start' },

  nav: {
    width: '240px', flexShrink: 0, background: '#fff', borderRadius: '12px',
    border: '1px solid #e2e8f0', padding: '14px', display: 'flex', flexDirection: 'column',
    gap: '8px', position: 'sticky', top: '16px', maxHeight: 'calc(100vh - 32px)',
  },
  navStateBtn: {
    textAlign: 'left', background: '#f1f5f9', color: '#0f172a', border: 'none',
    borderRadius: '8px', padding: '12px 14px', fontWeight: 800, fontSize: '14px', cursor: 'pointer',
  },
  navStateBtnActive: { background: '#1e293b', color: '#fff' },
  navListLabel: {
    fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginTop: '6px', padding: '0 4px',
  },
  navBackLink: {
    textAlign: 'left', background: 'none', border: 'none', color: '#3b82f6',
    fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: '0 4px 4px 4px',
  },
  navList: { display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' },
  navLoading: { fontSize: '13px', color: '#94a3b8', padding: '8px 4px' },
  navItemBtn: {
    textAlign: 'left', background: 'none', border: 'none', color: '#334155',
    borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  navItemBtnActive: { background: '#dbeafe', color: '#1d4ed8', fontWeight: 800 },

  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
    background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '10px 16px',
  },
  legendBar: {
    display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', fontWeight: 700, color: '#334155',
  },
  legendDot: (color) => ({
    display: 'inline-block', width: '12px', height: '12px',
    borderRadius: '50%', background: color, flexShrink: 0,
  }),
  classFilterBar: { display: 'flex', gap: '8px' },
  classChip: {
    background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: '20px',
    padding: '6px 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
  },
  classChipActive: { background: '#1e3a5f', color: '#93c5fd' },

  reportWrapper: { background: '#f1f5f9', borderRadius: '12px', padding: '32px 16px' },
  placeholder: {
    textAlign: 'center', padding: '80px 40px',
    background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0',
  },
  placeholderTitle: { fontSize: '18px', fontWeight: 700, color: '#334155' },
  placeholderSub:   { fontSize: '14px', color: '#64748b', marginTop: '8px' },
};
