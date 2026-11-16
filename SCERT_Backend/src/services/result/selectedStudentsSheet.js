/**
 * "Selected Students" — the official चयनित अभ्यर्थियों की सूची.
 *
 * Layout is fixed by the department's own template
 * (`Format for result cm 2026.xlsx`): a merged Hindi title row, then 15
 * columns. Unlike the Full Result tab — which mirrors whatever the agency
 * happened to upload — this one is a published document with a prescribed
 * shape, so the columns ARE hardcoded here on purpose.
 *
 * Values still come from result_students.raw_row (the uploaded cell text)
 * so GENDER/CAST/SCHOOL TYPE read as the agency wrote them.
 *
 * WEIGHTAGE SC/ST is a single column in the template but arrives as two
 * (SCSTMAT + SCSTSAT). Verified against the real selected sheets:
 * class 6 row 2 is 47 + 52 + 3 + 3 = 105 = TOTMARKS, so the template's
 * one column is the sum of the pair.
 */

/** DATE arrives as "YYYY-MM-DD"; the template prints DD/MM/YYYY. */
function formatDob(value, rawFallback = null) {
  if (!value) return rawFallback ? String(rawFallback) : "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

function num(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function plain(value) {
  return value === null || value === undefined ? "" : String(value);
}

/** Prefers the uploaded cell text, falling back to the normalised column. */
function raw(row, field, fallback) {
  const v = row.raw_row ? row.raw_row[field] : undefined;
  if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
  return fallback === null || fallback === undefined ? "" : String(fallback);
}

/**
 * `width` sizes the Excel column; `pdfWidth` sizes the PDF one, and the
 * two cannot be the same number. Excel scrolls sideways for ever, so
 * there every column can be as wide as its longest value. A landscape A4
 * page has 802pt for all fifteen columns put together, and the pdfWidths
 * below add up to exactly that, so nothing gets proportionally squeezed
 * on the way out.
 *
 * The budget was measured against the real data. Columns whose values are
 * a fixed shape — roll number, DOB, gender, category — get enough width
 * to never wrap, because a wrap there costs a second line on every one of
 * the thousands of rows. The four marks columns hold two or three digits
 * but carry long headers, so they are sized to let the header break
 * cleanly between words and no wider. What is left goes to the free-text
 * columns, where long values wrap and that is unavoidable at this page
 * size. Sharing one number with Excel had the marks headers claiming a
 * fifth of the page while every row ran to two or three lines.
 */
const COLUMNS = [
  { key: "sno",       header: "S.No.",             width: 40,  pdfWidth: 30,  align: "center", serial: true },
  { key: "roll_no",   header: "ROLL No",           width: 82,  pdfWidth: 56,  align: "left",   get: (r) => raw(r, "roll_number", r.roll_number) },
  { key: "cname",     header: "CANDIDATE'S NAME",  width: 130, pdfWidth: 74,  align: "left",   get: (r) => raw(r, "student_name", r.student_name) },
  { key: "fname",     header: "FATHER'S NAME",     width: 130, pdfWidth: 74,  align: "left",   get: (r) => raw(r, "father_name", r.father_name) },
  { key: "dob",       header: "DOB",               width: 68,  pdfWidth: 52,  align: "center", get: (r) => raw(r, "dob", formatDob(r.dob, r.dob_raw)) },
  { key: "gender",    header: "GENDER",            width: 58,  pdfWidth: 44,  align: "center", get: (r) => raw(r, "gender", r.gender) },
  { key: "cast",      header: "CAST",              width: 48,  pdfWidth: 31,  align: "center", get: (r) => raw(r, "category", r.category) },
  { key: "school",    header: "SCHOOL NAME",       width: 150, pdfWidth: 89, align: "left",   get: (r) => raw(r, "school_name", r.school_name) },
  { key: "block",     header: "BLOCK NAME",        width: 100, pdfWidth: 64,  align: "left",   get: (r) => raw(r, "block_name", r.block_name) },
  { key: "district",  header: "DISTRICT NAME",     width: 92,  pdfWidth: 58,  align: "left",   get: (r) => raw(r, "district_name", r.district_name) },
  { key: "sch_type",  header: "SCHOOL TYPE",       width: 78,  pdfWidth: 54,  align: "center", get: (r) => raw(r, "school_type", r.school_type_code) },
  { key: "mat",       header: "MAT MARKS",         width: 60,  pdfWidth: 38,  align: "right",  get: (r) => num(r.mat_marks) },
  { key: "sat",       header: "SAT MARKS",         width: 60,  pdfWidth: 38,  align: "right",  get: (r) => num(r.sat_marks) },
  { key: "weightage", header: "WEIGHTAGE SC/ST",   width: 76,  pdfWidth: 60,  align: "right",
    get: (r) => num((Number(r.scst_mat_marks) || 0) + (Number(r.scst_sat_marks) || 0)) },
  { key: "total",     header: "TOTAL MARKS",       width: 68,  pdfWidth: 38,  align: "right",  get: (r) => num(r.total_marks) },
];

/**
 * The template's merged title row. The level wording differs by class and
 * the session year is substituted rather than frozen at 2026-27.
 */
function sheetTitle(classValue, sessionName) {
  const session = sessionName ? String(sessionName) : "";
  const level = String(classValue) === "9"
    ? "माध्यमिक स्तर (कक्षा-9)"
    : "जूनियर स्तर (कक्षा-6)";
  return `मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृति योजना ${session}, ${level} हेतु चयनित अभ्यर्थियों की सूची`;
}

/** English equivalent, used where Devanagari cannot be rendered. */
function sheetTitleEn(classValue, sessionName) {
  const session = sessionName ? String(sessionName) : "";
  const level = String(classValue) === "9" ? "Secondary Level (Class-9)" : "Junior Level (Class-6)";
  return `Chief Minister Meritorious Student Incentive Scholarship Scheme ${session} — ${level} — List of Selected Candidates`;
}

function describeColumns() {
  return COLUMNS.map(({ key, header, align }) => ({ key, header, align }));
}

function exportColumns() {
  return COLUMNS.map(({ key, header, width, pdfWidth, align }) => ({
    key, header, width, pdfWidth, align,
  }));
}

function toSheetRows(rows, startSerial = 1) {
  return rows.map((row, i) => {
    const out = {};
    for (const col of COLUMNS) {
      out[col.key] = col.serial ? String(startSerial + i) : col.get(row);
    }
    return out;
  });
}

/** result_students columns the getters read. */
const SELECT_COLUMNS = [
  "roll_number", "student_name", "father_name", "dob", "dob_raw", "gender",
  "category", "school_name", "block_name", "district_name", "school_type_code",
  "mat_marks", "sat_marks", "scst_mat_marks", "scst_sat_marks", "total_marks",
  "raw_row",
];

module.exports = {
  COLUMNS,
  SELECT_COLUMNS,
  describeColumns,
  exportColumns,
  toSheetRows,
  sheetTitle,
  sheetTitleEn,
};
