/**
 * Result sheet parsing profiles.
 *
 * The exam agency supplies the same logical data under several different
 * header spellings across classes and years — "MATMRK" vs "MAT MRK",
 * "SCHDIST" vs "DISTT" vs "DISTRICT1", "QBOOK" (class 6) vs "BNO" (class 9).
 * Rather than hardcode one layout, headers are normalized (uppercased,
 * non-alphanumerics stripped) and resolved through an alias table, so a
 * single parser reads the 18-, 27- and 36-column variants.
 */

// ---------------------------------------------------------------------
// Header normalization
// ---------------------------------------------------------------------

/**
 * "SC/ST MAT" -> "SCSTMAT", "MAT MRK" -> "MATMRK", "Abs Sat" -> "ABSSAT"
 */
function normalizeHeader(value) {
  return String(value == null ? "" : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Alias lists are in priority order: the first spelling that carries a
 * value for a given row wins. This matters because some sheets ship both
 * SCHDIST (populated) and DISTRICT1 (empty).
 */
const STUDENT_FIELD_ALIASES = {
  serial_no:          ["SN", "SNO", "SERIALNO"],
  block_code:         ["BLOCKCODE"],
  app_display_id:     ["APPID", "APPLICATIONID"],
  roll_number:        ["ROLLNO", "ROLLNUMBER", "ROLL"],
  sr_number:          ["SR", "SRNO", "SRNUMBER"],
  student_name:       ["CNAME", "STUDENTNAME", "CANDIDATENAME"],
  father_name:        ["FNAME", "FATHERNAME"],
  mother_name:        ["MNAME", "MOTHERNAME"],
  dob:                ["DOB1", "DOB", "DATEOFBIRTH"],
  dob_alt:            ["DOB2"],
  dob_invalid:        ["DOBINV"],
  gender:             ["GENDER", "SEX"],
  category:           ["CAT", "CATEGORY"],
  divyang:            ["PH", "DIVYANG", "DIVYANGTA"],
  aadhaar_number:     ["AADHARNO", "AADHAARNO", "AADHAR", "AADHAARNUMBER"],
  village:            ["VILLAGE"],
  post_office:        ["PO", "POSTOFFICE"],
  district_name:      ["SCHDIST", "DISTT", "DISTRICT1", "DISTRICT", "DISTRICTNAME"],
  block_name:         ["SCHBLOCK", "BLOCK", "BLOCKNAME"],
  school_name:        ["SCHNAME", "SCHOOLNAME"],
  school_type:        ["SCHTYPE", "SCHOOLTYPE"],
  school_category:    ["SCHCAT", "SCHOOLCATEGORY"],
  prev_school_name:   ["PSCHNAME", "PREVSCHOOLNAME"],
  prev_school_type:   ["PSCHTYPE", "PREVSCHOOLTYPE"],
  center_code:        ["CENTCODE", "CENTERCODE", "CENTRECODE"],
  center_name:        ["CENTNAME", "CENTERNAME", "CENTRENAME"],
  mobile_number:      ["MONO", "MOBILE", "MOBILENO", "MOBILENUMBER"],
  paper_set:          ["PAPER"],
  mat_marks:          ["MATMRK", "MATMARKS", "MATMARK"],
  sat_marks:          ["SATMRK", "SATMARKS", "SATMARK"],
  scst_mat_marks:     ["SCSTMAT"],
  scst_sat_marks:     ["SCSTSAT"],
  total_marks:        ["TOTMARKS", "TOTALMARKS", "TOTAL"],
  selected:           ["SELECTED"],
  mat_attendance:     ["ABSMAT"],
  sat_attendance:     ["ABSSAT"],
  overall_attendance: ["ABS"],
};

const RESPONSE_FIELD_ALIASES = {
  roll_number:     ["ROLLNO", "ROLLNUMBER", "ROLL"],
  booklet_number:  ["QBOOK", "BNO", "BOOKLETNO", "BOOKLETNUMBER"],
  paper:           ["PAPER"],
  gender:          ["SEX", "GENDER"],
  category:        ["CAT", "CATEGORY"],
  flag:            ["FLG", "FLAG"],
  op:              ["OP"],
  total_blank:     ["TOTBLANK"],
  total_wrong:     ["TOTWRONG"],
  total_right:     ["TOTRIGHT"],
  total_marks:     ["TOTMARKS", "TOTALMARKS"],
};

const SUMMARY_FIELD_ALIASES = {
  district_name: ["DISTRICT", "DISTRICTNAME", "DISTT"],
  block_name:    ["BLOCK", "BLOCKNAME"],
  registered:    ["REGISTERED", "REG", "TOTALREGISTERED"],
  absent:        ["ABSENT", "ABS"],
  present:       ["PRESENT", "PRE"],
  selected:      ["SELECTED", "TOTALSELECTED"],
  selected_gen:  ["GEN", "GENERAL"],
  selected_obc:  ["OBC"],
  selected_sc:   ["SC"],
  selected_st:   ["ST"],
  selected_ews:  ["EWS"],
};

/**
 * Maps each canonical field to every column number whose header matched
 * one of its aliases, ordered by alias priority.
 *
 * @returns {Map<string, number[]>}
 */
function buildHeaderIndex(headerCells, aliasTable) {
  // normalized header -> [column numbers]
  const byHeader = new Map();
  headerCells.forEach((raw, zeroBased) => {
    const key = normalizeHeader(raw);
    if (!key) return;
    if (!byHeader.has(key)) byHeader.set(key, []);
    byHeader.get(key).push(zeroBased + 1);
  });

  const index = new Map();
  for (const [field, aliases] of Object.entries(aliasTable)) {
    const cols = [];
    for (const alias of aliases) {
      const matched = byHeader.get(alias);
      if (matched) cols.push(...matched);
    }
    if (cols.length) index.set(field, cols);
  }
  return index;
}

/** Question columns are Q001..Q100 style; returns [{ questionNumber, col }]. */
function findQuestionColumns(headerCells) {
  const out = [];
  headerCells.forEach((raw, zeroBased) => {
    const key = normalizeHeader(raw);
    const match = key.match(/^Q(\d{1,3})$/);
    if (match) {
      out.push({ questionNumber: parseInt(match[1], 10), col: zeroBased + 1 });
    }
  });
  out.sort((a, b) => a.questionNumber - b.questionNumber);
  return out;
}

// ---------------------------------------------------------------------
// Code maps
// ---------------------------------------------------------------------

// Confirmed against the order of the official block summary sheet
// (GEN, OBC, SC, ST, EWS).
const CATEGORY_BY_CODE = { 1: "GEN", 2: "OBC", 3: "SC", 4: "ST", 5: "EWS" };
const CATEGORY_LABELS = new Set(["GEN", "OBC", "SC", "ST", "EWS"]);

const GENDER_BY_CODE = { 1: "MALE", 2: "FEMALE", 3: "OTHER" };

function resolveCategory(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { code: null, label: null };
  }
  const text = String(raw).trim().toUpperCase();

  if (/^\d+$/.test(text)) {
    const code = parseInt(text, 10);
    return { code, label: CATEGORY_BY_CODE[code] || null };
  }
  if (CATEGORY_LABELS.has(text)) {
    const code = Number(
      Object.keys(CATEGORY_BY_CODE).find((k) => CATEGORY_BY_CODE[k] === text)
    );
    return { code: Number.isFinite(code) ? code : null, label: text };
  }
  if (text === "GENERAL") return { code: 1, label: "GEN" };
  return { code: null, label: null };
}

function resolveGender(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { code: null, label: null };
  }
  const text = String(raw).trim().toUpperCase();

  if (/^\d+$/.test(text)) {
    const code = parseInt(text, 10);
    return { code, label: GENDER_BY_CODE[code] || null };
  }
  if (text === "M" || text === "MALE") return { code: 1, label: "MALE" };
  if (text === "F" || text === "FEMALE") return { code: 2, label: "FEMALE" };
  if (text === "O" || text === "OTHER") return { code: 3, label: "OTHER" };
  return { code: null, label: null };
}

// ---------------------------------------------------------------------
// Value normalizers
// ---------------------------------------------------------------------

function cellValue(cell) {
  const value = cell == null ? null : cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value instanceof Date) return value;
    if (value.result !== undefined) return value.result;
    if (value.text !== undefined) return value.text;
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    return null;
  }
  return value;
}

function normalizeText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text) return null;
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInteger(value) {
  const parsed = normalizeNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function normalizeDigits(value, maxLength) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  return maxLength ? digits.slice(0, maxLength) : digits;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Sheets use DD/MM/YYYY. Parsing must never fall through to JS Date's
 * MM/DD assumption, which would silently turn 08/02/2014 into 2 August.
 *
 * @returns {{ date: string|null, raw: string|null }} date as YYYY-MM-DD
 */
function normalizeDate(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { date: null, raw: null };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value.toISOString().slice(0, 10), raw: null };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const converted = new Date(EXCEL_EPOCH_UTC + value * 86400000);
    if (!Number.isNaN(converted.getTime())) {
      return { date: converted.toISOString().slice(0, 10), raw: null };
    }
  }

  const raw = String(value).trim();

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const iso = buildIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    return iso ? { date: iso, raw: null } : { date: null, raw };
  }

  // YYYY-MM-DD
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const iso = buildIsoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    if (iso) return { date: iso, raw: null };
  }

  return { date: null, raw };
}

/**
 * Builds YYYY-MM-DD, rejecting dates that do not exist on the calendar.
 *
 * The sheets genuinely contain values like 31/11/2011, and `new Date()`
 * silently rolls those forward (31 Nov becomes 1 Dec) instead of failing,
 * so the components are compared back after parsing. Such rows are stored
 * with dob NULL, the original text in dob_raw, and dob_invalid set.
 */
function buildIsoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const roundTripped =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day;

  return roundTripped ? iso : null;
}

/** Sheets encode attendance as P / A — never as a boolean. */
function normalizeAttendance(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  if (text === "P" || text === "PRESENT") return "P";
  if (text === "A" || text === "ABSENT") return "A";
  return null;
}

const TRUE_TOKENS = new Set(["Y", "YES", "1", "TRUE", "T", "S"]);
const FALSE_TOKENS = new Set(["N", "NO", "0", "FALSE", "F"]);

function normalizeFlag(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim().toUpperCase();
  if (!text) return false;
  if (TRUE_TOKENS.has(text)) return true;
  if (FALSE_TOKENS.has(text)) return false;
  // A non-empty value that isn't a recognised negative counts as set
  // (e.g. PH may carry a disability-type code rather than Y).
  return true;
}

/**
 * Answer options are A-D. '*' marks a multiply-shaded bubble and an empty
 * cell means unattempted; both are stored so they can be told apart, but
 * neither can ever be correct.
 */
function normalizeAnswer(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  if (text === "*") return "*";
  if (/^[A-Z]$/.test(text)) return text;
  if (/^[1-9]$/.test(text)) return text;
  return text.slice(0, 5);
}

// ---------------------------------------------------------------------
// Paper codes
// ---------------------------------------------------------------------

/**
 * Response workbooks carry one worksheet per paper — MAT, MATB, SAT — and
 * the sheet's own PAPER column reads "MAT" for both MAT and MATB. The
 * booklet variant therefore only survives in the sheet name, and losing it
 * means booklet-B students get scored against the booklet-A key.
 *
 * MAT  + class 6 -> MAT6
 * MATB + class 6 -> MAT6B   (matches the MAT6B row in KEY.xlsx)
 * SAT  + class 9 -> SAT9
 *
 * @returns {{ examType: string, bookletCode: string|null, paperCode: string }|null}
 */
function derivePaperCode(sheetName, classValue) {
  const key = normalizeHeader(sheetName);
  const match = key.match(/^(MAT|SAT)([A-Z0-9]*)$/);
  if (!match) return null;

  const examType = match[1];
  let suffix = match[2] || "";

  // Sheets are sometimes named "MAT6" / "MAT6B"; drop a class number that
  // is already accounted for by classValue so it isn't doubled.
  const classText = String(classValue);
  if (suffix.startsWith(classText)) suffix = suffix.slice(classText.length);

  const bookletCode = suffix || null;
  return {
    examType,
    bookletCode,
    paperCode: `${examType}${classText}${suffix}`,
  };
}

/** Splits a key file's paper code (MAT6B) back into its parts. */
function parsePaperCode(paperCode, classValue) {
  const key = normalizeHeader(paperCode);
  const match = key.match(/^(MAT|SAT)(.*)$/);
  if (!match) return null;

  const examType = match[1];
  let rest = match[2] || "";
  const classText = String(classValue);
  if (rest.startsWith(classText)) rest = rest.slice(classText.length);

  return { examType, bookletCode: rest || null, paperCode: key };
}

module.exports = {
  normalizeHeader,
  buildHeaderIndex,
  findQuestionColumns,
  STUDENT_FIELD_ALIASES,
  RESPONSE_FIELD_ALIASES,
  SUMMARY_FIELD_ALIASES,
  CATEGORY_BY_CODE,
  GENDER_BY_CODE,
  resolveCategory,
  resolveGender,
  cellValue,
  normalizeText,
  normalizeNumber,
  normalizeInteger,
  normalizeDigits,
  normalizeDate,
  normalizeAttendance,
  normalizeFlag,
  normalizeAnswer,
  derivePaperCode,
  parsePaperCode,
};
