/**
 * The full, official name to show for a scholarship.
 *
 * scholarships.scholarship_name stays short on purpose. Dozens of places —
 * roll-number generation and the application controller on the backend,
 * and the School, BEO and District screens here — recognise NMMSS by
 * testing that name for the word "NMMSS". The official three-scheme title
 * contains no such word, so writing it into the database would silently
 * switch NMMSS off everywhere. The long form therefore lives here, as a
 * display label only.
 */

const NMMSS_FULL_NAME =
  'National Means-cum-Merit Scholarship Scheme / Sivanand Nautiyal Scholarship Scheme / Sridev Suman Scholarship Scheme';

/** Same test the rest of the app uses to recognise the NMMSS scholarship. */
function isNmmss(name) {
  return /\bNMMSS\b/i.test(name) || /\bNMMS\b/i.test(name);
}

export function getScholarshipDisplayName(scholarship) {
  const name = String(scholarship?.scholarship_name || '').trim();
  if (isNmmss(name)) return NMMSS_FULL_NAME;
  return name;
}
