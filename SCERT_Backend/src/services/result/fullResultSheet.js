/**
 * "Full Result" sheet layout.
 *
 * The Full Result tab reproduces the exam agency's uploaded workbook —
 * same columns, same header spellings — so SCERT reads on screen exactly
 * what they received as a file.
 *
 * The layout is DERIVED from the upload, not hardcoded. Three different
 * column layouts are in circulation for the same logical data (an 18-col
 * "ALL DATA" sheet, a 27-col "SELECTED" sheet, and a 36-col agency
 * export), and which one arrives varies by class and by year. Hardcoding
 * one of them would show empty columns the sheet never had, and silently
 * drop columns it did have — the current production upload, for instance,
 * carries APPID, SR, AADHARNO, PH, PSCHNAME and PSCHTYPE, none of which
 * appear in the 18-col sample.
 *
 * So the column set comes from the keys actually present in
 * result_students.raw_row for the scope being viewed, and the values come
 * from raw_row itself — the untouched cell text as uploaded, before any
 * normalisation. That means "MALE"/"SC"/"Dept of Edu" appear here exactly
 * as the agency wrote them, rather than the codes or resolved labels the
 * typed columns hold.
 *
 * raw_row keys are our canonical field names (the uploader resolves the
 * header aliases at ingest and the original header text is not kept), so
 * ordering and header spelling are reconstructed from the alias table:
 * FIELD_ORDER below is the declaration order of STUDENT_FIELD_ALIASES,
 * and each header is that field's primary alias — the spelling the agency
 * uses in its widest export.
 */

const P = require("./sheetProfiles");

/**
 * Canonical column order — identity, demographics, location, school,
 * centre, marks, outcome, attendance. Taken from the declaration order of
 * STUDENT_FIELD_ALIASES so a new alias entry lands in the right place
 * without touching this file.
 */
const FIELD_ORDER = Object.keys(P.STUDENT_FIELD_ALIASES);

/** Right-aligned in the UI and PDF: numeric-ish fields. */
const NUMERIC_FIELDS = new Set([
  "mat_marks", "sat_marks", "scst_mat_marks", "scst_sat_marks", "total_marks",
]);

/** Narrow, centred fields — codes and single-letter flags. */
const CENTERED_FIELDS = new Set([
  "serial_no", "block_code", "gender", "category", "divyang", "dob", "dob_alt",
  "dob_invalid", "school_type", "school_category", "prev_school_type",
  "center_code", "paper_set", "selected",
  "mat_attendance", "sat_attendance", "overall_attendance",
]);

/** Rough PDF column widths; the PDF util scales these to fit the page. */
const FIELD_WIDTHS = {
  serial_no: 38, block_code: 46, app_display_id: 84, roll_number: 84, sr_number: 44,
  student_name: 120, father_name: 120, mother_name: 110,
  dob: 64, dob_alt: 64, dob_invalid: 44, gender: 46, category: 36, divyang: 36,
  aadhaar_number: 90, village: 90, post_office: 80,
  district_name: 82, block_name: 92, school_name: 130,
  school_type: 62, school_category: 62, prev_school_name: 120, prev_school_type: 62,
  center_code: 48, center_name: 110, mobile_number: 76, paper_set: 44,
  mat_marks: 50, sat_marks: 50, scst_mat_marks: 52, scst_sat_marks: 52,
  total_marks: 56, selected: 54,
  mat_attendance: 46, sat_attendance: 46, overall_attendance: 40,
};

/** The agency's own spelling for a field — the first alias in its list. */
function headerFor(field) {
  const aliases = P.STUDENT_FIELD_ALIASES[field];
  return (aliases && aliases[0]) || field.toUpperCase();
}

/**
 * Column descriptors for the fields the upload actually contained,
 * in canonical order. Anything present in the data but absent from the
 * alias table still appears, rather than being silently dropped.
 */
function describeColumns(presentFields = []) {
  const present = new Set(presentFields);
  const ordered = FIELD_ORDER.filter((f) => present.has(f));
  const extras = presentFields.filter((f) => !FIELD_ORDER.includes(f)).sort();

  return [...ordered, ...extras].map((field) => ({
    key: field,
    header: headerFor(field),
    align: NUMERIC_FIELDS.has(field) ? "right" : CENTERED_FIELDS.has(field) ? "center" : "left",
    width: FIELD_WIDTHS[field] || 90,
  }));
}

/**
 * Maps DB rows to sheet-shaped rows, reading straight out of raw_row.
 *
 * `serial_no` falls back to a running count when the sheet had no SN
 * column; `startSerial` continues that numbering across pages.
 */
function toSheetRows(rows, columns, startSerial = 1) {
  return rows.map((row, i) => {
    const raw = row.raw_row || {};
    const out = {};
    for (const col of columns) {
      const value = raw[col.key];
      if (col.key === "serial_no" && (value === null || value === undefined || value === "")) {
        out[col.key] = String(startSerial + i);
      } else {
        out[col.key] = value === null || value === undefined ? "" : String(value);
      }
    }
    return out;
  });
}

module.exports = {
  FIELD_ORDER,
  headerFor,
  describeColumns,
  toSheetRows,
};
