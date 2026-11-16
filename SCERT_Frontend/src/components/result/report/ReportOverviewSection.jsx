import React from 'react';
import { ReportSectionHeader } from './ReportSectionHeader.jsx';
import { ReportMetricCard } from './ReportMetricCard.jsx';

export function ReportOverviewSection({ overview, participation, schoolParticipation }) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <ReportSectionHeader title="Executive Overview" subtitle="High-level participation and evaluation metrics." />
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <ReportMetricCard label="Registered (Class)" value={(participation?.total_registered_students || 0).toLocaleString()} highlight />
        <ReportMetricCard label="Registered (Exam)" value={(participation?.registered_in_scholarship || 0).toLocaleString()} highlight />
        <ReportMetricCard label="Appeared" value={(participation?.appeared_students || 0).toLocaleString()} highlight />
        <ReportMetricCard label="Schools Participated" value={(schoolParticipation?.total_schools_participated || 0).toLocaleString()} highlight />
      </div>
    </div>
  );
}
