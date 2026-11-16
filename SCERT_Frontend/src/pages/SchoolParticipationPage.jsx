import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import {
  getResultFilterOptions,
  getSchoolParticipationSummary,
  getSchoolParticipationHierarchy,
  getRemainingSchools
} from '../api/result.api.js';
import { SchoolParticipationStats } from '../components/result/SchoolParticipationStats.jsx';
import { SchoolParticipationGraphs } from '../components/result/SchoolParticipationGraphs.jsx';
import { SchoolParticipationHierarchyTable } from '../components/result/SchoolParticipationHierarchyTable.jsx';
import { RemainingSchoolsTable } from '../components/result/RemainingSchoolsTable.jsx';
import { ResultFilterDrawer } from '../components/result/ResultFilterDrawer.jsx';
import { ResultHeaderBar } from '../components/result/ResultHeaderBar.jsx';

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

function countActiveSideFilters(filters) {
  return ['district', 'block', 'school', 'category', 'gender'].reduce(
    (count, key) => (filters[key] ? count + 1 : count),
    0
  );
}

export default function SchoolParticipationPage() {
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
  const [summary, setSummary] = useState({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [hierarchyData, setHierarchyData] = useState([]);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState('');
  
  const [remainingRows, setRemainingRows] = useState([]);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const [remainingError, setRemainingError] = useState('');
  const [remainingTotal, setRemainingTotal] = useState(0);

  const [currentLevel, setCurrentLevel] = useState('district');
  const [selectedDistrict, setSelectedDistrict] = useState('');

  const [page, setPage] = useState(1);
  const [limit] = useState(25);

  useEffect(() => {
    if (!classOptions.length) return;
    if (!classOptions.includes(String(classFilter))) {
      setClassFilter(classOptions[0]);
    }
  }, [classFilter, classOptions]);

  const canQuery = useMemo(
    () => Boolean(selectedSessionId && selectedScholarshipId && classFilter),
    [selectedSessionId, selectedScholarshipId, classFilter]
  );
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

  const buildParams = useCallback(() => ({
    session_id: selectedSessionId,
    scholarship_id: selectedScholarshipId,
    class: classFilter,
    district: appliedFilters.district,
    block: appliedFilters.block,
    school: appliedFilters.school,
    category: appliedFilters.category,
    gender: appliedFilters.gender,
  }), [selectedSessionId, selectedScholarshipId, classFilter, appliedFilters]);

  const fetchSummary = useCallback(async () => {
    if (!canQuery) {
      setSummary({});
      return;
    }

    setSummaryLoading(true);
    setSummaryError('');
    try {
      const data = await getSchoolParticipationSummary(buildParams());
      setSummary(data || {});
    } catch (error) {
      setSummary({});
      setSummaryError(error?.message || 'Failed to load participation summary.');
    } finally {
      setSummaryLoading(false);
    }
  }, [buildParams, canQuery]);

  const fetchHierarchyData = useCallback(async () => {
    if (!canQuery) {
      setHierarchyData([]);
      return;
    }

    setHierarchyLoading(true);
    setHierarchyError('');
    try {
      const params = buildParams();
      if (currentLevel === 'block' && selectedDistrict) {
        params.district = selectedDistrict;
      }
      const data = await getSchoolParticipationHierarchy(params);
      setHierarchyData(Array.isArray(data) ? data : []);
    } catch (error) {
      setHierarchyData([]);
      setHierarchyError(error?.message || 'Failed to load hierarchy data.');
    } finally {
      setHierarchyLoading(false);
    }
  }, [buildParams, canQuery, currentLevel, selectedDistrict]);

  const fetchRemainingSchoolsData = useCallback(async () => {
    if (!canQuery) {
      setRemainingRows([]);
      setRemainingTotal(0);
      return;
    }

    setRemainingLoading(true);
    setRemainingError('');
    try {
      const data = await getRemainingSchools({
        ...buildParams(),
        page,
        limit,
      });
      setRemainingRows(Array.isArray(data?.data) ? data.data : []);
      setRemainingTotal(Number(data?.total || 0));
    } catch (error) {
      setRemainingRows([]);
      setRemainingTotal(0);
      setRemainingError(error?.message || 'Failed to load remaining schools.');
    } finally {
      setRemainingLoading(false);
    }
  }, [buildParams, canQuery, page, limit]);

  useEffect(() => {
    const timer = window.setTimeout(() => { fetchSummary(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchSummary]);

  useEffect(() => {
    const timer = window.setTimeout(() => { fetchHierarchyData(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchHierarchyData]);

  useEffect(() => {
    const timer = window.setTimeout(() => { fetchRemainingSchoolsData(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchRemainingSchoolsData]);

  const handleHierarchyRowClick = useCallback((level, name) => {
    if (level === 'district') {
      setSelectedDistrict(name);
      setCurrentLevel('block');
    }
  }, []);

  const handleGoDistrict = useCallback(() => {
    setCurrentLevel('district');
    setSelectedDistrict('');
  }, []);

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
    setCurrentLevel('district');
    setSelectedDistrict('');
    setPage(1);
  }, [draftFilters]);

  const handleClearDrawer = useCallback(() => {
    setDraftFilters(emptySideFilters);
  }, [emptySideFilters]);

  const districtOptions = useMemo(() => toSelectOptions(filterOptions.districts, 'All Districts'), [filterOptions.districts]);
  const blockOptions = useMemo(() => toSelectOptions(filterOptions.blocks, 'All Blocks'), [filterOptions.blocks]);
  const schoolOptions = useMemo(() => toSelectOptions(filterOptions.schools, 'All Schools'), [filterOptions.schools]);
  const categoryOptions = useMemo(() => toSelectOptions(['General', 'OBC', 'SC', 'ST', 'EWS'], 'All Categories'), []);
  const genderOptions = useMemo(() => toSelectOptions(['Male', 'Female', 'Other'], 'All Genders'), []);

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <ResultHeaderBar
          title="School Participation"
          subtitle="Review school participation using selected-student results for the active Result scope."
          classOptions={classOptions}
          classFilter={classFilter}
          onClassChange={(value) => { setClassFilter(String(value)); setPage(1); }}
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
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#111827' }}>Participation Summary</h2>
            <p style={subtitleStyle}>School participation counts derived from selected students in the Result Module.</p>
          </div>

          {summaryError ? (
            <div style={{ ...statusStyle, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>{summaryError}</div>
          ) : null}

          <SchoolParticipationStats summary={summary} loading={summaryLoading} />
          {!summaryLoading && !summaryError && <SchoolParticipationGraphs summary={summary} />}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#111827' }}>School Participation Hierarchy</h2>
            <p style={subtitleStyle}>Participating schools ordered by classification for the active filters.</p>
          </div>

          <SchoolParticipationHierarchyTable
            currentLevel={currentLevel}
            selectedDistrict={selectedDistrict}
            rows={hierarchyData}
            loading={hierarchyLoading}
            error={hierarchyError}
            onRowClick={handleHierarchyRowClick}
            onGoDistrict={handleGoDistrict}
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#111827' }}>Remaining Schools</h2>
            <p style={subtitleStyle}>Schools from which no applications were received for the active filters.</p>
          </div>

          <RemainingSchoolsTable
            rows={remainingRows}
            loading={remainingLoading}
            error={remainingError}
            page={page}
            limit={limit}
            total={remainingTotal}
            onPageChange={setPage}
          />
        </div>
      </section>
    </div>
  );
}
