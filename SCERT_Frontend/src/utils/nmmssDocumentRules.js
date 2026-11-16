/**
 * Which documents an NMMSS applicant has to upload.
 *
 * NMMSS covers three schemes, and the backend assigns each application an
 * exam code from caste, parental income and Class VII percentage:
 *
 *   code 1 — National Means-cum-Merit: income is part of the test, so the
 *            income certificate is required, and reserved categories also
 *            supply a caste certificate.
 *   code 2 — Sivanand Nautiyal / Sridev Suman: no income condition, so
 *            neither the income nor the caste certificate applies.
 *
 *              code 1                       code 2
 *   GEN        marksheet, aadhaar,          marksheet, aadhaar
 *              income
 *   SC/ST/OBC  marksheet, aadhaar,          marksheet, aadhaar
 *              income, caste
 *   (either)   Divyangta certificate when Divyangta = YES
 *
 * The code is computed on the server and returned by the save and load
 * endpoints. It is never recomputed here: the eligibility rule already
 * lives in the backend, and a second copy in the browser would drift.
 *
 * When there is no code - the application has not been saved yet, or the
 * server could not work one out (marks below the cut-off, say) - the two
 * conditional certificates follow the applicant's own answers instead:
 * caste certificate for SC / ST / OBC, income certificate for "Up to
 * 3,50,000". Reading an answer is not recomputing the eligibility rule; it
 * only decides which upload boxes to show.
 *
 * Only NMMSS is affected. For every other scholarship these helpers return
 * null, which means "no opinion — keep the existing behaviour".
 */

const NMMSS_PATTERN = /\bNMMSS\b|\bNMMS\b|SNSS|SSSS/i;

/** Categories that supply a caste certificate under code 1. */
const RESERVED_CATEGORIES = ['sc', 'st', 'obc'];

export function isNmmssScholarship(scholarshipName) {
  return NMMSS_PATTERN.test(String(scholarshipName || ''));
}

const norm = (value) => String(value ?? '').trim().toLowerCase();
const compactKey = (field) => norm(field?.field_key).replace(/\s+/g, '');
const isFileField = (field) => String(field?.field_type || '').trim().toUpperCase() === 'FILE';

const matchesDoc = (field, tokens) => {
  const key = compactKey(field);
  const label = norm(field?.field_label);
  return tokens.some((t) => key.includes(t) || label.includes(t));
};

// Matched on FILE fields only, so the caste/income/Divyangta *questions* on
// step 1 (all RADIO) can never be mistaken for their certificates.
const isIncomeCertificateDoc = (f) =>
  isFileField(f) && matchesDoc(f, ['annual_income', 'income_certificate', 'annual income', 'income certificate']);
const isCasteCertificateDoc = (f) =>
  isFileField(f) && matchesDoc(f, ['caste_certificate', 'caste certificate']);
export const isDivyangtaCertificateDoc = (f) =>
  isFileField(f) && matchesDoc(f, ['divyang', 'disability_certificate', 'disability certificate']);

/** Parental-income ceiling for code 1, in rupees. The backend uses the same figure. */
const INCOME_LIMIT = 350000;

/**
 * One parental-income answer as "up to the ceiling" (true), "above it"
 * (false) or unreadable (null). Mirrors how the backend reads the same
 * answer: option value 1 / "Up to ..." is under, 2 / "More than ..." is
 * over, and a bare figure is compared with the ceiling.
 */
function parseIncomeUnderLimit(raw) {
  const text = norm(raw);
  if (!text) return null;
  const compact = text.replace(/\s+/g, '');
  if (compact === '1' || text.includes('up to') || text.includes('upto') || text.includes('<=')) return true;
  if (compact === '2' || text.includes('more than') || text.includes('>=') || text.includes('>')) return false;
  const figures = text.replace(/,/g, '').match(/\d+/g);
  const figure = figures ? Number(figures.find((n) => n.length > 2) || figures[0]) : NaN;
  return Number.isFinite(figure) ? figure <= INCOME_LIMIT : null;
}

/**
 * The parental-income answer as true (up to the ceiling), false (above it)
 * or null (not answered, or not readable).
 */
export function readIncomeUnderLimit(values, fields = []) {
  const field = (fields || []).find((f) => !isFileField(f) && compactKey(f).includes('income'));
  const raw = field ? values?.[field.field_key] : values?.parental_annual_income;
  const direct = parseIncomeUnderLimit(raw);
  if (direct !== null) return direct;
  // The stored value may be an option code the parse cannot read; its label can.
  const option = (field?.options || []).find((o) => norm(o?.option_value) === norm(raw));
  return option ? parseIncomeUnderLimit(option.option_label) : null;
}

/**
 * Should this document field be shown?
 *
 * @returns {boolean|null} true/false to decide it, or null when NMMSS has
 *   no rule for this field and the caller should keep its own logic.
 *
 * With an exam code the documents follow the code. Without one they follow
 * the applicant's answers (caste, and the income option via
 * `incomeUnderLimit`). An answer that has not been given yet still shows the
 * document: an extra upload box is a far smaller problem than a missing
 * certificate.
 */
export function nmmssDocumentVisibility({
  field,
  scholarshipName,
  examCode,
  casteValue,
  incomeUnderLimit,
  disabilityYes,
}) {
  if (!isNmmssScholarship(scholarshipName)) return null;
  if (!isFileField(field)) return null;

  if (isDivyangtaCertificateDoc(field)) return Boolean(disabilityYes);

  const isIncome = isIncomeCertificateDoc(field);
  const isCaste = isCasteCertificateDoc(field);
  if (!isIncome && !isCaste) return null; // marksheet, aadhaar, photo, signature

  const codeKnown = examCode !== null && examCode !== undefined && examCode !== '';
  if (!codeKnown) {
    if (isIncome) return incomeUnderLimit ?? true;
    return !norm(casteValue) || RESERVED_CATEGORIES.includes(norm(casteValue));
  }
  const isCodeOne = Number(examCode) === 1;

  if (isIncome) return isCodeOne;
  return isCodeOne && RESERVED_CATEGORIES.includes(norm(casteValue));
}

/** The caste/category answer, whatever the form calls that field. */
export function readCasteValue(values, fields = []) {
  // Question fields only: "caste_certificate" is an upload that happens to
  // contain the word, and must never be read as the answer.
  const field = (fields || []).find((f) => {
    if (isFileField(f)) return false;
    const key = compactKey(f);
    return key.includes('caste') || key.includes('category');
  });
  if (field) return values?.[field.field_key] ?? '';
  return values?.caste_category ?? values?.category ?? '';
}

/**
 * Every upload that is on screen is mandatory. Only the conditional
 * documents (caste, income, Divyangta) are ever off screen, and those follow
 * the same visibility rules the form uses to show them.
 *
 * @returns {boolean|null} null when the field is not a file upload, so the
 *   caller keeps its own rule for ordinary questions.
 */
export function isUploadRequired({ field, nmmssRule, showCasteCertificate, disabilityYes }) {
  if (!isFileField(field)) return null;
  if (nmmssRule === false) return false;
  if (nmmssRule === true) return true;
  if (isCasteCertificateDoc(field) && !showCasteCertificate) return false;
  if (isDivyangtaCertificateDoc(field) && !disabilityYes) return false;
  return true;
}
