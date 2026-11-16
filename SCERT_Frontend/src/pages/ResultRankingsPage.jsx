import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import {
  getResultCharts,
  getResultFilterOptions,
  getTopBlocks,
  getTopDistricts,
  getTopRankers,
  getTopSchools,
} from '../api/result.api.js';
import { ResultTabs } from '../components/result/ResultTabs.jsx';
import { ResultTable } from '../components/result/ResultTable.jsx';
import { MarksDistributionChart } from '../components/result/charts/MarksDistributionChart.jsx';
import { TopDistrictsChart } from '../components/result/charts/TopDistrictsChart.jsx';
import { TopBlocksChart } from '../components/result/charts/TopBlocksChart.jsx';
import { TopSchoolsChart } from '../components/result/charts/TopSchoolsChart.jsx';
import { GenderRankDistributionChart } from '../components/result/charts/GenderRankDistributionChart.jsx';
import { ResultFilterDrawer } from '../components/result/ResultFilterDrawer.jsx';
import { ResultHeaderBar } from '../components/result/ResultHeaderBar.jsx';

const TOP_RANKERS = 'top-rankers';
const TOP_DISTRICTS = 'top-districts';
const TOP_BLOCKS = 'top-blocks';
const TOP_SCHOOLS = 'top-schools';

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

const titleStyle = {
  margin: 0,
  fontSize: '28px',
  fontWeight: 800,
  color: '#111827',
};

const subtitleStyle = {
  margin: '8px 0 0',
  fontSize: '14px',
  color: '#6b7280',
};

const helperStyle = {
  margin: '14px 0 0',
  fontSize: '13px',
  color: '#64748b',
};

const headerRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
};

const badgeStyle = {
  borderRadius: '999px',
  border: '1px solid #dbe3f0',
  background: '#f8fafc',
  color: '#334155',
  fontSize: '12px',
  fontWeight: 700,
  padding: '8px 12px',
};

const chartsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
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

const statusStyle = {
  borderRadius: '12px',
  padding: '12px 14px',
  fontSize: '14px',
};


function toSelectOptions(items = [], allLabel) {
  return [{ value: '', label: allLabel }, ...items.filter(Boolean).map((item) => ({ value: item, label: item }))];
}

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

function buildRankerColumns() {
  return [
    { key: 'rank', label: 'Rank' },
    { key: 'roll_number', label: 'Roll Number' },
    { key: 'student_name', label: 'Student Name' },
    { key: 'district_name', label: 'District' },
    { key: 'block_code', label: 'Block' },
    { key: 'school_name', label: 'School' },
    { key: 'total_marks', label: 'Total Marks' },
    { key: 'mat_marks', label: 'MAT Marks' },
    { key: 'sat_marks', label: 'SAT Marks' },
    { key: 'gender', label: 'Gender' },
    { key: 'category', label: 'Category' },
  ];
}

function buildDistrictColumns() {
  return [
    { key: 'rank', label: 'Rank' },
    { key: 'district_name', label: 'District' },
    { key: 'scholarship_registered', label: 'Registered in Scholarship' },
    { key: 'selected_students', label: 'Selected Students' },
  ];
}

function buildBlockColumns() {
  return [
    { key: 'rank', label: 'Rank' },
    { key: 'block_name', label: 'Block', render: (row) => row.block_name || row.block_code || '—' },
    { key: 'district_name', label: 'District', render: (row) => row.district_name || '—' },
    { key: 'scholarship_registered', label: 'Registered in Scholarship' },
    { key: 'selected_students', label: 'Selected Students' },
  ];
}

function buildSchoolColumns() {
  return [
    { key: 'rank', label: 'Rank' },
    { key: 'school_name', label: 'School' },
    { key: 'scholarship_registered', label: 'Registered in Scholarship' },
    { key: 'selected_students', label: 'Selected Students' },
  ];
}

function getRankingChartVisibility(filters) {
  return {
    marks_distribution: true,
    districts: !filters.district,
    blocks: Boolean(filters.district) && !filters.block,
    schools: Boolean(filters.block) && !filters.school,
    gender_rank_distribution: !filters.gender,
  };
}

function countActiveSideFilters(filters) {
  return ['district', 'block', 'school', 'category', 'gender'].reduce(
    (count, key) => (filters[key] ? count + 1 : count),
    0
  );
}

function ChartCard({ title, subtitle, loading, children }) {
  return (
    <div style={chartShellStyle}>
      <div>
        <h3 style={chartTitleStyle}>{title}</h3>
        <p style={chartSubtitleStyle}>{subtitle}</p>
      </div>
      <div style={chartBodyStyle}>{loading ? <div style={chartLoadingStyle} /> : children}</div>
    </div>
  );
}

const TABS = [
  { value: TOP_RANKERS, label: 'Top Rankers' },
  { value: TOP_DISTRICTS, label: 'Top Districts' },
  { value: TOP_BLOCKS, label: 'Top Blocks' },
  { value: TOP_SCHOOLS, label: 'Top Schools' },
];

export default function ResultRankingsPage() {
  const {
    sessionId: selectedSessionId,
    scholarships = [],
    selectedScholarshipId,
  } = useSession() || {};

  const selectedScholarship = useMemo(
    () => scholarships.find((item) => item.scholarship_id === selectedScholarshipId) || null,
    [scholarships, selectedScholarshipId]
  );

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
  const [activeTab, setActiveTab] = useState(TOP_RANKERS);
  const [tableData, setTableData] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [chartsData, setChartsData] = useState({});
  const [chartsLoading, setChartsLoading] = useState(false);
  const [chartsError, setChartsError] = useState('');

  useEffect(() => {
    if (!classOptions.length) return;
    if (!classOptions.includes(String(classFilter))) {
      setClassFilter(classOptions[0]);
    }
  }, [classFilter, classOptions]);

  const canQuery = useMemo(() => Boolean(selectedSessionId && selectedScholarshipId && classFilter), [selectedSessionId, selectedScholarshipId, classFilter]);
  const chartVisibility = useMemo(() => getRankingChartVisibility(appliedFilters), [appliedFilters]);
  const chartTypes = useMemo(() => {
    const next = [];
    if (chartVisibility.marks_distribution) next.push('marks_distribution');
    if (chartVisibility.districts) next.push('districts');
    if (chartVisibility.blocks) next.push('blocks');
    if (chartVisibility.schools) next.push('schools');
    if (chartVisibility.gender_rank_distribution) next.push('gender_rank_distribution');
    return next;
  }, [chartVisibility]);
  const activeFilterCount = useMemo(() => countActiveSideFilters(appliedFilters), [appliedFilters]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const data = await getResultFilterOptions({
        district: draftFilters.district,
        block: draftFilters.block,
      });

      const next = {
        districts: Array.isArray(data?.districts) ? data.districts : [],
        blocks: Array.isArray(data?.blocks) ? data.blocks : [],
        schools: Array.isArray(data?.schools) ? data.schools : [],
      };

      setFilterOptions(next);
      setDraftFilters((prev) => {
        const updated = { ...prev };
        let changed = false;

        if (updated.block && !next.blocks.includes(updated.block)) {
          updated.block = '';
          changed = true;
        }

        if (updated.school && !next.schools.includes(updated.school)) {
          updated.school = '';
          changed = true;
        }

        return changed ? updated : prev;
      });
    } catch (_) {
      setFilterOptions({ districts: [], blocks: [], schools: [] });
    }
  }, [draftFilters.block, draftFilters.district]);

  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);

  const fetchData = useCallback(async () => {
    if (!canQuery) {
      setTableData([]);
      setTotalRows(0);
      return;
    }

    setLoadingData(true);
    setError('');

    const params = {
      session_id: selectedSessionId,
      scholarship_id: selectedScholarshipId,
      class: classFilter,
      district: appliedFilters.district,
      block: appliedFilters.block,
      school: appliedFilters.school,
      category: appliedFilters.category,
      gender: appliedFilters.gender,
    };

    try {
      let response;

      if (activeTab === TOP_RANKERS) {
        response = await getTopRankers({ ...params, page, limit });
        setTableData(Array.isArray(response?.data) ? response.data : []);
        setTotalRows(Number(response?.total || 0));
      } else if (activeTab === TOP_DISTRICTS) {
        response = await getTopDistricts(params);
        setTableData(Array.isArray(response) ? response : []);
        setTotalRows(Array.isArray(response) ? response.length : 0);
      } else if (activeTab === TOP_BLOCKS) {
        response = await getTopBlocks(params);
        setTableData(Array.isArray(response) ? response : []);
        setTotalRows(Array.isArray(response) ? response.length : 0);
      } else {
        response = await getTopSchools(params);
        setTableData(Array.isArray(response) ? response : []);
        setTotalRows(Array.isArray(response) ? response.length : 0);
      }
    } catch (fetchError) {
      setTableData([]);
      setTotalRows(0);
      setError(fetchError?.message || 'Unable to load result rankings right now.');
    } finally {
      setLoadingData(false);
    }
  }, [activeTab, canQuery, classFilter, appliedFilters, limit, page, selectedScholarshipId, selectedSessionId]);

  const fetchCharts = useCallback(async () => {
    if (!canQuery || chartTypes.length === 0) {
      setChartsData({});
      return;
    }

    setChartsLoading(true);
    setChartsError('');

    try {
      const data = await getResultCharts({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
        class: classFilter,
        district: appliedFilters.district,
        block: appliedFilters.block,
        school: appliedFilters.school,
        category: appliedFilters.category,
        gender: appliedFilters.gender,
        types: chartTypes.join(','),
      });

      setChartsData(data?.charts || {});
    } catch (fetchError) {
      setChartsData({});
      setChartsError(fetchError?.message || 'Unable to load ranking charts right now.');
    } finally {
      setChartsLoading(false);
    }
  }, [canQuery, chartTypes, classFilter, appliedFilters, selectedScholarshipId, selectedSessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { fetchData(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    const timer = window.setTimeout(() => { fetchCharts(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchCharts, activeTab]);

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
    setPage(1);
  }, [draftFilters]);

  const handleClearDrawer = useCallback(() => {
    setDraftFilters(emptySideFilters);
  }, [emptySideFilters]);

  const handleTabChange = useCallback((nextTab) => {
    setActiveTab(nextTab);
    setPage(1);
  }, []);

  const districtOptions = useMemo(() => toSelectOptions(filterOptions.districts, 'All Districts'), [filterOptions.districts]);
  const blockOptions = useMemo(() => toSelectOptions(filterOptions.blocks, 'All Blocks'), [filterOptions.blocks]);
  const schoolOptions = useMemo(() => toSelectOptions(filterOptions.schools, 'All Schools'), [filterOptions.schools]);
  const categoryOptions = useMemo(() => toSelectOptions(['General', 'OBC', 'SC', 'ST', 'EWS'], 'All Categories'), []);
  const genderOptions = useMemo(() => toSelectOptions(['Male', 'Female', 'Other'], 'All Genders'), []);

  const columns = useMemo(() => {
    if (activeTab === TOP_RANKERS) return buildRankerColumns();
    if (activeTab === TOP_DISTRICTS) return buildDistrictColumns();
    if (activeTab === TOP_BLOCKS) return buildBlockColumns();
    return buildSchoolColumns();
  }, [activeTab]);

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <ResultHeaderBar
          title="Result Rankings"
          subtitle="Explore top rankers and selected-student rankings using the active session and scholarship from the SCERT dashboard header."
          classOptions={classOptions}
          classFilter={classFilter}
          onClassChange={(value) => { setClassFilter(String(value)); setPage(1); }}
          onOpenFilters={handleOpenDrawer}
          activeFilterCount={activeFilterCount}
          extraAction={
            <div style={badgeStyle}>
              {activeTab === TOP_RANKERS
                ? `${totalRows} ranker record${totalRows === 1 ? '' : 's'}`
                : `${totalRows} ranking row${totalRows === 1 ? '' : 's'}`}
            </div>
          }
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
          categoryOptions={categoryOptions}
          genderOptions={genderOptions}
        />

        <p style={helperStyle}>
          The session and scholarship come from the global SCERT dropdowns. Class stays inline, and the rest of the filters are available in the filter drawer.
        </p>
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#111827' }}>
              Ranking Analytics
            </h2>
            <p style={subtitleStyle}>
              Performance and comparative ranking charts update automatically for the active Result filters.
            </p>
          </div>

          {chartsError ? (
            <div style={{ ...statusStyle, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              {chartsError}
            </div>
          ) : null}

          <div style={chartsGridStyle}>
            {chartVisibility.marks_distribution ? (
              <ChartCard title="Marks Distribution" subtitle="Selected-student marks spread for the active ranking filters." loading={chartsLoading}>
                <MarksDistributionChart data={chartsData.marks_distribution || []} />
              </ChartCard>
            ) : null}

            {chartVisibility.districts ? (
              <ChartCard title="Top Districts" subtitle="District-wise selected student performance." loading={chartsLoading}>
                <TopDistrictsChart data={chartsData.districts || []} />
              </ChartCard>
            ) : null}

            {chartVisibility.blocks ? (
              <ChartCard title="Top Blocks" subtitle="Block-wise selected student performance for the chosen district." loading={chartsLoading}>
                <TopBlocksChart data={chartsData.blocks || []} />
              </ChartCard>
            ) : null}

            {chartVisibility.schools ? (
              <ChartCard title="Top Schools" subtitle="School-wise selected student performance for the chosen block." loading={chartsLoading}>
                <TopSchoolsChart data={chartsData.schools || []} />
              </ChartCard>
            ) : null}

            {chartVisibility.gender_rank_distribution ? (
              <ChartCard title="Gender Rank Distribution" subtitle="Marks-bucket performance split by gender among selected students." loading={chartsLoading}>
                <GenderRankDistributionChart data={chartsData.gender_rank_distribution || []} />
              </ChartCard>
            ) : null}
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <ResultTabs tabs={TABS} activeTab={activeTab} onChange={handleTabChange} />
          <ResultTable
            columns={columns}
            rows={tableData}
            loading={loadingData}
            error={error}
            emptyMessage="No ranking data found for the selected filters."
            pagination={activeTab === TOP_RANKERS ? { page, limit, total: totalRows } : null}
            onPageChange={setPage}
          />
        </div>
      </section>
    </div>
  );
}
