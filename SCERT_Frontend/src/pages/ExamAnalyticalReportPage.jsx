import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from '../scert.session-context.jsx';
import { ResultHeaderBar } from '../components/result/ResultHeaderBar.jsx';
import { ResultFilterDrawer } from '../components/result/ResultFilterDrawer.jsx';
import { ExamAnalyticsCharts } from '../components/result/ExamAnalyticsCharts.jsx';
import { ExamAnalyticsTable } from '../components/result/ExamAnalyticsTable.jsx';
import { getExamAnalyticsSummary, getExamAnalyticsFilters } from '../api/result.api.js';

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

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '16px',
  marginBottom: '24px'
};

const summaryCardStyle = {
  background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const summaryLabelStyle = {
  fontSize: '13px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
};

const summaryValueStyle = {
  fontSize: '24px',
  fontWeight: 800,
  color: '#0f172a'
};

function getScholarshipMode(scholarship) {
  const scholarshipId = Number(scholarship?.scholarship_id);
  const scholarshipName = String(scholarship?.scholarship_name || '').toLowerCase();

  if (scholarshipId === 3 || /\bcm\b/i.test(scholarshipName) || scholarshipName.includes('chief minister')) return 'CM';
  if (scholarshipId === 6 || scholarshipName.includes('nmms') || scholarshipName.includes('snss') || scholarshipName.includes('ssss')) return 'NMMSS';
  return 'GENERIC';
}

function getClassOptionsForScholarship(scholarship) {
  const mode = getScholarshipMode(scholarship);
  if (mode === 'CM') return ['6', '9'];
  if (mode === 'NMMSS') return ['8'];
  return ['6', '8', '9', '10', '11', '12'];
}

export function ExamAnalyticalReportPage() {
  const { sessionId, scholarships = [], selectedScholarshipId } = useSession();
  
  const selectedScholarship = useMemo(() => scholarships.find(s => s.scholarship_id === selectedScholarshipId), [scholarships, selectedScholarshipId]);
  const classOptions = useMemo(() => getClassOptionsForScholarship(selectedScholarship), [selectedScholarship]);
  
  const [classValue, setClassValue] = useState('');
  
  useEffect(() => {
    if (classOptions.length > 0 && !classOptions.includes(String(classValue))) {
      setClassValue(classOptions[0]);
    }
  }, [classOptions, classValue]);
  
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  
  const [draftFilters, setDraftFilters] = useState({
    district: '', block: '', school: '', gender: '', category: '', school_type: '', school_location: ''
  });
  const [appliedFilters, setAppliedFilters] = useState({
    district: '', block: '', school: '', gender: '', category: '', school_type: '', school_location: ''
  });

  const [filterOptions, setFilterOptions] = useState({
    districts: [], blocks: [], schools: [], categories: [], school_types: [], school_locations: []
  });

  const [summaryData, setSummaryData] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [currentLevel, setCurrentLevel] = useState('district');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedBlock, setSelectedBlock] = useState('');

  // Fetch Summary
  useEffect(() => {
    if (!sessionId || !selectedScholarshipId || !classValue) {
      setSummaryData(null);
      return;
    }
    setSummaryLoading(true);
    getExamAnalyticsSummary({
      session_id: sessionId,
      scholarship_id: selectedScholarshipId,
      class: classValue,
      ...appliedFilters
    })
      .then(res => setSummaryData(res))
      .catch(err => console.error(err))
      .finally(() => setSummaryLoading(false));
  }, [sessionId, selectedScholarshipId, classValue, appliedFilters]);

  // Fetch Filter Options
  useEffect(() => {
    if (!sessionId || !selectedScholarshipId || !classValue) return;

    getExamAnalyticsFilters({
      session_id: sessionId,
      scholarship_id: selectedScholarshipId,
      class: classValue,
      ...draftFilters
    })
      .then(res => {
        setFilterOptions(res);
      })
      .catch(err => console.error(err));
  }, [sessionId, selectedScholarshipId, classValue, draftFilters]);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(draftFilters);
    // Reset table drilldown level to match applied district/block filter
    if (draftFilters.block || draftFilters.school) {
      setCurrentLevel('school');
      setSelectedDistrict(draftFilters.district);
      setSelectedBlock(draftFilters.block);
    } else if (draftFilters.district) {
      setCurrentLevel('block');
      setSelectedDistrict(draftFilters.district);
      setSelectedBlock('');
    } else {
      setCurrentLevel('district');
      setSelectedDistrict('');
      setSelectedBlock('');
    }
    setFilterDrawerOpen(false);
  }, [draftFilters]);

  const handleClearFilters = useCallback(() => {
    const empty = { district: '', block: '', school: '', gender: '', category: '', school_type: '', school_location: '' };
    setDraftFilters(empty);
    setAppliedFilters(empty);
    setCurrentLevel('district');
    setSelectedDistrict('');
    setSelectedBlock('');
    setFilterDrawerOpen(false);
  }, []);

  const handleLevelChange = (level, district, block) => {
    setCurrentLevel(level);
    setSelectedDistrict(district);
    setSelectedBlock(block);
    
    setAppliedFilters(prev => ({
      ...prev,
      district: district || '',
      block: block || '',
      school: level === 'school' ? prev.school : ''
    }));
    
    setDraftFilters(prev => ({
      ...prev,
      district: district || '',
      block: block || '',
      school: level === 'school' ? prev.school : ''
    }));
  };

  const hasActiveFilters = Object.values(appliedFilters).some(v => v !== '');

  const mappedFilterOptions = useMemo(() => {
    return {
      districts: [{ value: '', label: 'All Districts' }, ...filterOptions.districts.map(d => ({ value: d, label: d }))],
      blocks: [{ value: '', label: 'All Blocks' }, ...filterOptions.blocks.map(b => ({ value: b, label: b }))],
      schools: [{ value: '', label: 'All Schools' }, ...filterOptions.schools.map(s => ({ value: s, label: s }))],
      categories: [{ value: '', label: 'All Categories' }, ...filterOptions.categories.map(c => ({ value: c, label: c }))],
      schoolTypes: [{ value: '', label: 'All School Types' }, ...filterOptions.school_types.map(t => ({ value: t, label: t }))],
      schoolLocations: [{ value: '', label: 'All Locations' }, ...filterOptions.school_locations.map(l => ({ value: l, label: l }))]
    };
  }, [filterOptions]);

  const showContent = sessionId && selectedScholarshipId && classValue;

  return (
    <div style={pageStyle}>
      <ResultHeaderBar
        title="Exam Analytical Report"
        subtitle="Performance analytics for MAT and SAT examinations."
        classOptions={classOptions}
        classValue={classValue}
        onClassChange={setClassValue}
        onOpenFilters={() => setFilterDrawerOpen(true)}
        hasActiveFilters={hasActiveFilters}
      />

      <ResultFilterDrawer
        isOpen={filterDrawerOpen}
        draftFilters={draftFilters}
        onChange={(key, val) => setDraftFilters(prev => ({ ...prev, [key]: val }))}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        onClose={() => {
          setDraftFilters(appliedFilters);
          setFilterDrawerOpen(false);
        }}
        districtOptions={mappedFilterOptions.districts}
        blockOptions={mappedFilterOptions.blocks}
        schoolOptions={mappedFilterOptions.schools}
        categoryOptions={mappedFilterOptions.categories}
        genderOptions={[
          { value: '', label: 'All Genders' },
          { value: 'MALE', label: 'Male' },
          { value: 'FEMALE', label: 'Female' }
        ]}
        schoolTypeOptions={mappedFilterOptions.schoolTypes}
        areaTypeOptions={mappedFilterOptions.schoolLocations}
      />

      {showContent ? (
        <>
          <section style={sectionStyle}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 800 }}>Overall Performance Summary</h2>
            <div style={summaryGridStyle}>
              <div style={summaryCardStyle}>
                <span style={summaryLabelStyle}>Avg MAT Score</span>
                <span style={summaryValueStyle}>{summaryLoading ? '...' : Number(summaryData?.avg_mat_score || 0).toFixed(2)}</span>
              </div>
              <div style={summaryCardStyle}>
                <span style={summaryLabelStyle}>Highest MAT</span>
                <span style={summaryValueStyle}>{summaryLoading ? '...' : summaryData?.highest_mat_score || 0}</span>
              </div>
              <div style={summaryCardStyle}>
                <span style={summaryLabelStyle}>Avg SAT Score</span>
                <span style={summaryValueStyle}>{summaryLoading ? '...' : Number(summaryData?.avg_sat_score || 0).toFixed(2)}</span>
              </div>
              <div style={summaryCardStyle}>
                <span style={summaryLabelStyle}>Highest SAT</span>
                <span style={summaryValueStyle}>{summaryLoading ? '...' : summaryData?.highest_sat_score || 0}</span>
              </div>
              <div style={summaryCardStyle}>
                <span style={summaryLabelStyle}>Total Students</span>
                <span style={summaryValueStyle}>{summaryLoading ? '...' : summaryData?.total_students || 0}</span>
              </div>
            </div>

            <ExamAnalyticsCharts
              sessionId={sessionId}
              scholarshipId={selectedScholarshipId}
              classValue={classValue}
              appliedFilters={appliedFilters}
            />
          </section>

          <section style={sectionStyle}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 800 }}>Drilldown Analytics</h2>
            <ExamAnalyticsTable
              sessionId={sessionId}
              scholarshipId={selectedScholarshipId}
              classValue={classValue}
              appliedFilters={appliedFilters}
              currentLevel={currentLevel}
              selectedDistrict={selectedDistrict}
              selectedBlock={selectedBlock}
              onLevelChange={handleLevelChange}
            />
          </section>
        </>
      ) : (
        <div style={{ ...sectionStyle, textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
          Please select a Session, Scholarship, and Class to view exam analytics.
        </div>
      )}
    </div>
  );
}
