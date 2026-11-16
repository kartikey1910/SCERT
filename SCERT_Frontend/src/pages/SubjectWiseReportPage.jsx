import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../scert.session-context.jsx';
import { getSubjectWiseReport, getSubjectWiseFilterOptions } from '../api/result.api.js';
import { SubjectWiseTable } from '../components/result/report/SubjectWiseTable.jsx';
import { SubjectWiseCharts } from '../components/result/report/SubjectWiseCharts.jsx';
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

const multiSelectContainer = {
  border: '1px solid #d1d5db',
  borderRadius: '12px',
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  maxHeight: '150px',
  overflowY: 'auto',
  background: '#f8fafc'
};

const checkboxLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  cursor: 'pointer',
  color: '#374151'
};

function toSelectOptions(items = [], allLabel) {
  return [{ value: '', label: allLabel }, ...items.filter(Boolean).map((item) => ({ value: item, label: item }))];
}

function getScholarshipMode(scholarship) {
  const scholarshipId = Number(scholarship?.scholarship_id);
  const scholarshipName = String(scholarship?.scholarship_name || '').toLowerCase();

  if (scholarshipId === 3 || /\bcm\b/i.test(scholarshipName) || scholarshipName.includes('chief minister')) {
    return 'CM';
  }

  if (scholarshipId === 6 || scholarshipName.includes('nmmss') || scholarshipName.includes('nmms') || scholarshipName.includes('snss') || scholarshipName.includes('ssss')) {
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

export function SubjectWiseReportPage() {
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
  
  const [classFilter, setClassFilter] = useState(classOptions[0] || '');
  const [examType, setExamType] = useState('MAT');

  const emptySideFilters = useMemo(() => ({
    district: '', block: '', school: '', gender: '', category: '', school_type: '', school_category: '', area_type: ''
  }), []);

  const [appliedFilters, setAppliedFilters] = useState(emptySideFilters);
  const [draftFilters, setDraftFilters] = useState(emptySideFilters);
  
  const [appliedQuestionGroups, setAppliedQuestionGroups] = useState([]);
  const [draftQuestionGroups, setDraftQuestionGroups] = useState([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ districts: [], blocks: [], schools: [], question_groups: [] });
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!classOptions.length) return;
    if (!classOptions.includes(String(classFilter))) {
      setClassFilter(classOptions[0]);
    }
  }, [classFilter, classOptions]);

  const canQuery = useMemo(
    () => Boolean(selectedSessionId && selectedScholarshipId && classFilter && examType),
    [selectedSessionId, selectedScholarshipId, classFilter, examType]
  );

  const activeFilterCount = useMemo(() => {
    let count = Object.values(appliedFilters).filter(Boolean).length;
    if (appliedQuestionGroups.length > 0) count++;
    return count;
  }, [appliedFilters, appliedQuestionGroups]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const result = await getSubjectWiseFilterOptions({
        session_id: selectedSessionId,
        scholarship_id: selectedScholarshipId,
        class: classFilter,
        exam_type: examType,
        ...draftFilters
      });

      setFilterOptions({
        districts: Array.isArray(result?.districts) ? result.districts : [],
        blocks: Array.isArray(result?.blocks) ? result.blocks : [],
        schools: Array.isArray(result?.schools) ? result.schools : [],
        question_groups: Array.isArray(result?.question_groups) ? result.question_groups : [],
      });
    } catch (_) {
      setFilterOptions({ districts: [], blocks: [], schools: [], question_groups: [] });
    }
  }, [selectedSessionId, selectedScholarshipId, classFilter, examType, draftFilters]);

  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);

  const buildParams = useCallback(() => ({
    session_id: selectedSessionId,
    scholarship_id: selectedScholarshipId,
    class: classFilter,
    exam_type: examType,
    question_groups: appliedQuestionGroups.join(','),
    ...appliedFilters
  }), [selectedSessionId, selectedScholarshipId, classFilter, examType, appliedQuestionGroups, appliedFilters]);

  const fetchReport = useCallback(async () => {
    if (!canQuery) {
      setData(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await getSubjectWiseReport(buildParams());
      setData(response);
    } catch (err) {
      setData(null);
      setError(err?.message || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }, [buildParams, canQuery]);

  // Whenever core scopes change, reset applied question groups since the metadata changes
  useEffect(() => {
    setAppliedQuestionGroups([]);
    setDraftQuestionGroups([]);
  }, [classFilter, examType, selectedScholarshipId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { fetchReport(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchReport]);

  const handleDrawerFilterChange = useCallback((key, value) => {
    setDraftFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'district') {
        next.block = '';
        next.school = '';
      } else if (key === 'block') {
        next.school = '';
      }
      return next;
    });
  }, []);

  const handleOpenDrawer = useCallback(() => {
    setDraftFilters(appliedFilters);
    setDraftQuestionGroups(appliedQuestionGroups);
    setDrawerOpen(true);
  }, [appliedFilters, appliedQuestionGroups]);

  const handleCloseDrawer = useCallback(() => {
    setDraftFilters(appliedFilters);
    setDraftQuestionGroups(appliedQuestionGroups);
    setDrawerOpen(false);
  }, [appliedFilters, appliedQuestionGroups]);

  const handleApplyDrawer = useCallback(() => {
    setAppliedFilters(draftFilters);
    setAppliedQuestionGroups(draftQuestionGroups);
    setDrawerOpen(false);
  }, [draftFilters, draftQuestionGroups]);

  const handleClearDrawer = useCallback(() => {
    setDraftFilters(emptySideFilters);
    setDraftQuestionGroups([]);
  }, [emptySideFilters]);

  const toggleQuestionGroup = (name) => {
    setDraftQuestionGroups(prev => {
      if (prev.includes(name)) return prev.filter(g => g !== name);
      return [...prev, name];
    });
  };

  const districtOptions = useMemo(() => toSelectOptions(filterOptions.districts, 'All Districts'), [filterOptions.districts]);
  const blockOptions = useMemo(() => toSelectOptions(filterOptions.blocks, 'All Blocks'), [filterOptions.blocks]);
  const schoolOptions = useMemo(() => toSelectOptions(filterOptions.schools, 'All Schools'), [filterOptions.schools]);

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <ResultHeaderBar
              title="Subject Wise Analytical Report"
              subtitle="Question-group analytical performance breakdown."
              classOptions={classOptions}
              classFilter={classFilter}
              onClassChange={(value) => setClassFilter(String(value))}
              onOpenFilters={handleOpenDrawer}
              activeFilterCount={activeFilterCount}
            />
            
            <div style={{ display: 'flex', gap: '8px' }}>
              {['MAT', 'SAT'].map(type => (
                <button
                  key={type}
                  onClick={() => setExamType(type)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: examType === type ? '#2563eb' : '#fff',
                    color: examType === type ? '#fff' : '#475569',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

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
        >
          {filterOptions.question_groups.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}>Question Types (Select Multiple)</span>
              <div style={multiSelectContainer}>
                {filterOptions.question_groups.map(g => (
                  <label key={g.id} style={checkboxLabelStyle}>
                    <input 
                      type="checkbox" 
                      checked={draftQuestionGroups.includes(g.name)}
                      onChange={() => toggleQuestionGroup(g.name)}
                    />
                    {g.name} (Q{g.start}-Q{g.end})
                  </label>
                ))}
              </div>
            </div>
          )}
        </ResultFilterDrawer>
      </section>

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>Loading analytics...</div>}
      {error && <div style={{ textAlign: 'center', padding: '24px', color: '#ef4444' }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <section style={sectionStyle}>
            <div style={{ display: 'flex', gap: '24px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0', minWidth: '200px' }}>
                <div style={{ fontSize: '14px', color: '#166534', fontWeight: 600 }}>Evaluated Students</div>
                <div style={{ fontSize: '24px', color: '#15803d', fontWeight: 800 }}>{data.overview?.totalEvaluatedStudents || 0}</div>
              </div>
              <div style={{ padding: '16px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe', flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '14px', color: '#1e40af', fontWeight: 600 }}>Selected Groups</div>
                <div style={{ fontSize: '16px', color: '#1d4ed8', fontWeight: 700, marginTop: '4px' }}>
                  {data.overview?.selectedQuestionGroups || 'All Question Groups'}
                </div>
              </div>
            </div>
            <SubjectWiseCharts data={data} />
          </section>

          <section style={sectionStyle}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b', marginBottom: '16px', marginTop: 0 }}>Drilldown Report</h3>
            <SubjectWiseTable data={data} />
          </section>
        </>
      )}
    </div>
  );
}
