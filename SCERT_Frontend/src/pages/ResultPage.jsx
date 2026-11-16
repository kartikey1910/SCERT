import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import {
  getHierarchySummary,
  getResultCharts,
  getResultFilterOptions,
} from '../api/result.api.js';
import { OverallAnalyticsChart } from '../components/result/charts/OverallAnalyticsChart.jsx';
import { GenderAnalyticsChart } from '../components/result/charts/GenderAnalyticsChart.jsx';
import { CategoryAnalyticsChart } from '../components/result/charts/CategoryAnalyticsChart.jsx';
import { ResultFilterDrawer } from '../components/result/ResultFilterDrawer.jsx';
import { ResultHeaderBar } from '../components/result/ResultHeaderBar.jsx';
import { SelectedStudentsDownload } from '../components/result/SelectedStudentsDownload.jsx';

const pageStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
};

const sectionStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '20px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
  padding: '20px',
};

const subtitleStyle = {
  margin: '8px 0 0',
  fontSize: '14px',
  color: '#6b7280',
};

const statusStyle = {
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '14px',
};

const chartsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: '16px',
};

const chartShellStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '18px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  padding: '16px',
  minHeight: '340px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const chartTitleStyle = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 800,
  color: '#111827',
};

const chartSubtitleStyle = {
  margin: 0,
  fontSize: '13px',
  color: '#64748b',
};

const chartBodyStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const chartLoadingStyle = {
  width: '100%',
  minHeight: '250px',
  borderRadius: '14px',
  background: 'linear-gradient(90deg, #f8fafc 25%, #eef2f7 50%, #f8fafc 75%)',
  backgroundSize: '200% 100%',
};

const hierarchyShellStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  border: '1px solid #e5e7eb',
  borderRadius: '18px',
  background: '#fcfdff',
  padding: '16px',
};

const hierarchyHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
};

const breadcrumbStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
};

const crumbButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: '#4f46e5',
  fontSize: '13px',
  fontWeight: 700,
  padding: 0,
  cursor: 'pointer',
};

const crumbCurrentStyle = {
  color: '#111827',
  fontSize: '13px',
  fontWeight: 800,
};

const crumbSeparatorStyle = {
  color: '#94a3b8',
  fontSize: '13px',
  fontWeight: 700,
};

const hierarchyMetaStyle = {
  borderRadius: '999px',
  border: '1px solid #dbe3f0',
  background: '#f8fafc',
  color: '#334155',
  fontSize: '12px',
  fontWeight: 700,
  padding: '8px 12px',
};

const hierarchyTableWrapStyle = {
  width: '100%',
  overflowX: 'auto',
  borderRadius: '14px',
  border: '1px solid #e5e7eb',
  background: '#ffffff',
};

const hierarchyTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '860px',
};

const tableHeadCellStyle = {
  textAlign: 'left',
  padding: '14px 16px',
  background: '#f8fafc',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 800,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  borderBottom: '1px solid #e5e7eb',
};

const tableCellStyle = {
  padding: '14px 16px',
  fontSize: '14px',
  color: '#0f172a',
  borderBottom: '1px solid #eef2f7',
  verticalAlign: 'middle',
};

const drilldownButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: '#4f46e5',
  fontSize: '14px',
  fontWeight: 800,
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
};

const numberCellStyle = {
  ...tableCellStyle,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

function getScholarshipMode(scholarship) {
  const scholarshipId = Number(scholarship?.scholarship_id);
  const scholarshipName = String(scholarship?.scholarship_name || '').toLowerCase();

  if (
    scholarshipId === 3 ||
    /\bcm\b/i.test(scholarshipName) ||
    scholarshipName.includes('chief minister')
  ) {
    return 'CM';
  }

  if (
    scholarshipId === 6 ||
    scholarshipName.includes('nmmss') ||
    scholarshipName.includes('nmms') ||
    scholarshipName.includes('snss') ||
    scholarshipName.includes('ssss')
  ) {
    return 'NMMSS';
  }

  return 'GENERIC';
}

function getClassOptionsForScholarship(scholarship) {
  const mode = getScholarshipMode(scholarship);

  if (mode === 'CM') return ['6', '9'];
  if (mode === 'NMMSS') return ['8'];
  return ['6', '8', '9', '10', '11', '12'];
}

function toSelectOptions(items = [], allLabel) {
  return [{ value: '', label: allLabel }, ...items.filter(Boolean).map((item) => ({ value: item, label: item }))];
}

function getChartVisibility(filters) {
  return {
    participation: true,
    districts: !filters.district,
    gender: !filters.gender,
    category: !filters.category,
  };
}

function countActiveSideFilters(filters) {
  return ['district', 'block', 'school', 'category', 'gender'].reduce(
    (count, key) => (filters[key] ? count + 1 : count),
    0
  );
}

function getHierarchyLabel(level) {
  if (level === 'district') return 'District';
  if (level === 'block') return 'Block';
  return 'School';
}

function ChartCard({ title, subtitle, loading, children }) {
  return (
    <div style={chartShellStyle}>
      <div>
        <h3 style={chartTitleStyle}>{title}</h3>
        <p style={chartSubtitleStyle}>{subtitle}</p>
      </div>
      <div style={chartBodyStyle}>
        {loading ? <div style={chartLoadingStyle} /> : children}
      </div>
    </div>
  );
}

function HierarchyBreadcrumbs({ currentLevel, selectedDistrict, selectedBlock, onGoDistrict, onGoBlock }) {
  return (
    <div style={breadcrumbStyle}>
      {currentLevel === 'district' ? (
        <span style={crumbCurrentStyle}>District</span>
      ) : (
        <>
          <button type="button" onClick={onGoDistrict} style={crumbButtonStyle}>
            District
          </button>
          <span style={crumbSeparatorStyle}>&gt;</span>
        </>
      )}

      {currentLevel === 'block' ? (
        <span style={crumbCurrentStyle}>{selectedDistrict || 'Block'}</span>
      ) : null}

      {currentLevel === 'school' ? (
        <>
          <button type="button" onClick={onGoBlock} style={crumbButtonStyle}>
            {selectedDistrict || 'Block'}
          </button>
          <span style={crumbSeparatorStyle}>&gt;</span>
          <span style={crumbCurrentStyle}>{selectedBlock || 'School'}</span>
        </>
      ) : null}
    </div>
  );
}

function HierarchyTable({ currentLevel, rows, totalRow, loading, error, onRowClick, onGoDistrict, onGoBlock, selectedDistrict, selectedBlock }) {
  return (
    <div style={hierarchyShellStyle}>
      <div style={hierarchyHeaderStyle}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#111827' }}>
            Hierarchical Analytics
          </h3>
          <p style={{ ...chartSubtitleStyle, marginTop: '6px' }}>
            Backend-driven drilldown for district, block, and school participation analytics.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <div style={hierarchyMetaStyle}>{getHierarchyLabel(currentLevel)} Level</div>
          <HierarchyBreadcrumbs
            currentLevel={currentLevel}
            selectedDistrict={selectedDistrict}
            selectedBlock={selectedBlock}
            onGoDistrict={onGoDistrict}
            onGoBlock={onGoBlock}
          />
        </div>
      </div>

      {error ? (
        <div style={{ ...statusStyle, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>{error}</div>
      ) : null}

      {loading ? (
        <div style={{ ...statusStyle, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
          Loading hierarchy analytics...
        </div>
      ) : rows.length === 0 ? (
        <div style={{ ...statusStyle, background: '#f8fafc', border: '1px dashed #cbd5e1', color: '#475569' }}>
          No hierarchy data found for the current filters.
        </div>
      ) : (
        <div style={hierarchyTableWrapStyle}>
          <table style={hierarchyTableStyle}>
            <thead>
              <tr>
                <th style={tableHeadCellStyle}>{getHierarchyLabel(currentLevel)}</th>
                <th style={tableHeadCellStyle}>Registered In Class</th>
                <th style={tableHeadCellStyle}>Registered In Scholarship</th>
                <th style={tableHeadCellStyle}>Appeared In Scholarship</th>
                <th style={tableHeadCellStyle}>Selected In Scholarship</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canDrill = currentLevel !== 'school';
                return (
                  <tr key={`${currentLevel}-${row.name}`} style={{ background: canDrill ? '#ffffff' : '#fcfdff' }}>
                    <td style={tableCellStyle}>
                      {canDrill ? (
                        <button type="button" style={drilldownButtonStyle} onClick={() => onRowClick(row)}>
                          {row.name}
                        </button>
                      ) : (
                        <span style={{ fontWeight: 800 }}>{row.name}</span>
                      )}
                    </td>
                    <td style={numberCellStyle}>{row.registered_in_class ?? 0}</td>
                    <td style={numberCellStyle}>{row.registered_in_scholarship ?? 0}</td>
                    <td style={numberCellStyle}>{row.appeared_in_scholarship ?? 0}</td>
                    <td style={numberCellStyle}>{row.selected_in_scholarship ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
            {totalRow ? (
              <tfoot style={{ background: '#f8fafc', fontWeight: 800, borderTop: '2px solid #e2e8f0' }}>
                <tr>
                  <td style={tableCellStyle}>{totalRow.name || 'TOTAL'}</td>
                  <td style={numberCellStyle}>{totalRow.registered_in_class ?? 0}</td>
                  <td style={numberCellStyle}>{totalRow.registered_in_scholarship ?? 0}</td>
                  <td style={numberCellStyle}>{totalRow.appeared_in_scholarship ?? 0}</td>
                  <td style={numberCellStyle}>{totalRow.selected_in_scholarship ?? 0}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}

export default function ResultPage() {
  const {
    sessionId: selectedSessionId,
    scholarships = [],
    selectedScholarshipId,
  } = useSession() || {};

  const selectedScholarship = scholarships.find((item) => item.scholarship_id === selectedScholarshipId) || null;
  const scholarshipMode = getScholarshipMode(selectedScholarship);
  const classOptions = useMemo(() => getClassOptionsForScholarship(selectedScholarship), [selectedScholarship]);

  const emptySideFilters = useMemo(
    () => ({ district: '', block: '', school: '', category: '', gender: '' }),
    []
  );

  const [classFilter, setClassFilter] = useState(classOptions[0] || '');
  const [appliedFilters, setAppliedFilters] = useState(emptySideFilters);
  const [draftFilters, setDraftFilters] = useState(emptySideFilters);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ districts: [], blocks: [], schools: [] });
  const [chartsData, setChartsData] = useState({});
  const [chartsLoading, setChartsLoading] = useState(false);
  const [chartsError, setChartsError] = useState('');
  const [currentLevel, setCurrentLevel] = useState('district');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedBlock, setSelectedBlock] = useState('');
  const [hierarchyData, setHierarchyData] = useState([]);
  const [hierarchyTotal, setHierarchyTotal] = useState(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState('');

  useEffect(() => {
    if (!classOptions.length) return;
    if (!classOptions.includes(String(classFilter))) {
      setClassFilter(classOptions[0]);
    }
  }, [classFilter, classOptions]);

  const canQuery = useMemo(() => Boolean(selectedSessionId && selectedScholarshipId && classFilter), [selectedSessionId, selectedScholarshipId, classFilter]);
  const chartTypes = useMemo(() => ['overall_analytics', 'gender_analytics', 'category_analytics'], []);
  const activeFilterCount = useMemo(() => countActiveSideFilters(appliedFilters), [appliedFilters]);

  const resetHierarchyState = useCallback(() => {
    setCurrentLevel('district');
    setSelectedDistrict('');
    setSelectedBlock('');
  }, []);

  useEffect(() => {
    resetHierarchyState();
  }, [selectedSessionId, selectedScholarshipId, resetHierarchyState]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const data = await getResultFilterOptions({
        district: draftFilters.district,
        block: draftFilters.block,
      });

      const nextOptions = {
        districts: Array.isArray(data?.districts) ? data.districts : [],
        blocks: Array.isArray(data?.blocks) ? data.blocks : [],
        schools: Array.isArray(data?.schools) ? data.schools : [],
      };

      setFilterOptions(nextOptions);
      setDraftFilters((prev) => {
        const next = { ...prev };
        let changed = false;

        if (next.block && !nextOptions.blocks.includes(next.block)) {
          next.block = '';
          changed = true;
        }

        if (next.school && !nextOptions.schools.includes(next.school)) {
          next.school = '';
          changed = true;
        }

        return changed ? next : prev;
      });
    } catch (_) {
      setFilterOptions({ districts: [], blocks: [], schools: [] });
    }
  }, [draftFilters.block, draftFilters.district]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  const buildBaseParams = useCallback(() => ({
    session_id: selectedSessionId,
    scholarship_id: selectedScholarshipId,
    class: classFilter,
    district: appliedFilters.district,
    block: appliedFilters.block,
    school: appliedFilters.school,
    category: appliedFilters.category,
    gender: appliedFilters.gender,
  }), [selectedSessionId, selectedScholarshipId, classFilter, appliedFilters]);



  const fetchCharts = useCallback(async () => {
    if (!canQuery || chartTypes.length === 0) {
      setChartsData({});
      return;
    }

    setChartsLoading(true);
    setChartsError('');

    try {
      const data = await getResultCharts({
        ...buildBaseParams(),
        types: chartTypes.join(','),
      });

      setChartsData(data?.charts || {});
    } catch (error) {
      setChartsError(error?.message || 'Failed to load charts.');
      setChartsData({});
    } finally {
      setChartsLoading(false);
    }
  }, [buildBaseParams, canQuery, chartTypes]);



  const fetchHierarchyData = useCallback(async () => {
    if (!canQuery) {
      setHierarchyData([]);
      setHierarchyTotal(null);
      return;
    }

    const scopedDistrict = appliedFilters.district || (currentLevel !== 'district' ? selectedDistrict : '');
    const scopedBlock = appliedFilters.block || (currentLevel === 'school' ? selectedBlock : '');

    if (currentLevel === 'block' && !scopedDistrict) {
      setHierarchyData([]);
      setHierarchyTotal(null);
      return;
    }

    if (currentLevel === 'school' && (!scopedDistrict || !scopedBlock)) {
      setHierarchyData([]);
      setHierarchyTotal(null);
      return;
    }

    setHierarchyLoading(true);
    setHierarchyError('');

    try {
      const data = await getHierarchySummary({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
        class: classFilter,
        level: currentLevel,
        district: scopedDistrict || undefined,
        block: scopedBlock || undefined,
        school: appliedFilters.school || undefined,
        category: appliedFilters.category || undefined,
        gender: appliedFilters.gender || undefined,
      });

      setHierarchyData(Array.isArray(data?.rows) ? data.rows : []);
      setHierarchyTotal(data?.total || null);
    } catch (error) {
      setHierarchyError(error?.message || 'Failed to load hierarchical analytics.');
      setHierarchyData([]);
      setHierarchyTotal(null);
    } finally {
      setHierarchyLoading(false);
    }
  }, [
    appliedFilters.block,
    appliedFilters.category,
    appliedFilters.district,
    appliedFilters.gender,
    appliedFilters.school,
    canQuery,
    classFilter,
    currentLevel,
    selectedBlock,
    selectedDistrict,
    selectedScholarshipId,
    selectedSessionId,
  ]);


  useEffect(() => { fetchCharts(); }, [fetchCharts]);
  useEffect(() => { fetchHierarchyData(); }, [fetchHierarchyData]);

  const handleDrawerFilterChange = useCallback((key, value) => {
    setDraftFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'district') {
        next.block = '';
        next.school = '';
      }
      if (key === 'block') {
        next.school = '';
      }
      return next;
    });
  }, []);

  const handleOpenDrawer = useCallback(() => {
    setDraftFilters(appliedFilters);
    setDrawerOpen(true);
  }, [appliedFilters]);

  const handleCloseDrawer = useCallback(() => {
    setDraftFilters(appliedFilters);
    setDrawerOpen(false);
  }, [appliedFilters]);

  const handleApplyDrawer = useCallback(() => {
    setAppliedFilters(draftFilters);
    setDrawerOpen(false);
    resetHierarchyState();
  }, [draftFilters, resetHierarchyState]);

  const handleClearDrawer = useCallback(() => {
    setDraftFilters(emptySideFilters);
  }, [emptySideFilters]);

  const handleClassChange = useCallback((value) => {
    setClassFilter(String(value));
    resetHierarchyState();
  }, [resetHierarchyState]);

  const handleHierarchyRowClick = useCallback((row) => {
    if (currentLevel === 'district') {
      setSelectedDistrict(String(row.name || ''));
      setSelectedBlock('');
      setCurrentLevel('block');
      return;
    }

    if (currentLevel === 'block') {
      setSelectedBlock(String(row.name || ''));
      setCurrentLevel('school');
    }
  }, [currentLevel]);

  const handleGoDistrict = useCallback(() => {
    setCurrentLevel('district');
    setSelectedDistrict('');
    setSelectedBlock('');
  }, []);

  const handleGoBlock = useCallback(() => {
    setCurrentLevel('block');
    setSelectedBlock('');
  }, []);

  const districtOptions = useMemo(() => toSelectOptions(filterOptions.districts, 'All districts'), [filterOptions.districts]);
  const blockOptions = useMemo(() => toSelectOptions(filterOptions.blocks, 'All blocks'), [filterOptions.blocks]);
  const schoolOptions = useMemo(() => toSelectOptions(filterOptions.schools, 'All schools'), [filterOptions.schools]);

  const refreshResultData = useCallback(async () => {
    await Promise.all([fetchCharts(), fetchHierarchyData()]);
  }, [fetchCharts, fetchHierarchyData]);

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <ResultHeaderBar
          title="Results Dashboard"
          subtitle="Review uploaded result statistics for the active session and scholarship."
          classOptions={classOptions}
          classFilter={classFilter}
          onClassChange={handleClassChange}
          onOpenFilters={handleOpenDrawer}
          activeFilterCount={activeFilterCount}
        />

        <ResultFilterDrawer
          isOpen={drawerOpen}
          draftFilters={draftFilters}
          onChange={handleDrawerFilterChange}
          onApply={handleApplyDrawer}
          onClear={handleClearDrawer}
          onClose={handleCloseDrawer}
          districtOptions={districtOptions}
          blockOptions={blockOptions}
          schoolOptions={schoolOptions}
          categoryOptions={[
            { value: '', label: 'All categories' },
            { value: 'GENERAL', label: 'General' },
            { value: 'OBC', label: 'OBC' },
            { value: 'SC', label: 'SC' },
            { value: 'ST', label: 'ST' },
            { value: 'EWS', label: 'EWS' },
          ]}
          genderOptions={[
            { value: '', label: 'All genders' },
            { value: 'MALE', label: 'Male' },
            { value: 'FEMALE', label: 'Female' },
          ]}
        />
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#111827' }}>
                Selection Summary
              </h2>
              <p style={subtitleStyle}>
                Total registered students, approved scholarship registrations, appeared students, and selected students for the active filters.
              </p>
            </div>

            <div>
              <SelectedStudentsDownload
                sessionId={selectedSessionId}
                scholarshipId={selectedScholarshipId}
                classValue={classFilter}
                filters={appliedFilters}
              />
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94a3b8', textAlign: 'right' }}>
                Selected students, Class {classFilter || '—'} · full data, ordered by district then block
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            

            {chartsError ? (
              <div style={{ ...statusStyle, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>{chartsError}</div>
            ) : null}

            <div style={chartsGridStyle}>
              <ChartCard title="Overall Funnel Analytics" subtitle="Registered, appeared, and selected students." loading={chartsLoading}>
                <OverallAnalyticsChart data={chartsData.overall_analytics} />
              </ChartCard>

              <ChartCard title="Gender Funnel Analytics" subtitle="Participation flow separated by gender." loading={chartsLoading}>
                <GenderAnalyticsChart data={chartsData.gender_analytics} />
              </ChartCard>

              <ChartCard title="Category Funnel Analytics" subtitle="Participation flow separated by category." loading={chartsLoading}>
                <CategoryAnalyticsChart data={chartsData.category_analytics} />
              </ChartCard>
            </div>
          </div>

          <HierarchyTable
            currentLevel={currentLevel}
            rows={hierarchyData}
            totalRow={hierarchyTotal}
            loading={hierarchyLoading}
            error={hierarchyError}
            onRowClick={handleHierarchyRowClick}
            onGoDistrict={handleGoDistrict}
            onGoBlock={handleGoBlock}
            selectedDistrict={selectedDistrict || appliedFilters.district}
            selectedBlock={selectedBlock || appliedFilters.block}
          />
        </div>
      </section>
    </div>
  );
}
