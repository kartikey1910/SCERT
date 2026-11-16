/**
 * Status cards for a district's NMMSS dashboard: what is still waiting with
 * its BEOs, what they have sent on to SCERT, and what SCERT has approved.
 * Shared between the District dashboard home and the District Reports >
 * Progress Reports page, which both show the same NMMSS table.
 */
export const districtNmmssCards = (counts) => [
  { key: 'pending_at_beo', label: 'Pending Applications', value: Number(counts.pending_at_beo || 0), tone: 'orange' },
  { key: 'pending', label: 'Submitted Applications', value: Number(counts.pending || 0), tone: 'yellow', view: 'reports-submitted' },
  { key: 'approved', label: 'Approved Applications', value: Number(counts.approved || 0), tone: 'green', view: 'reports-approved' },
];
