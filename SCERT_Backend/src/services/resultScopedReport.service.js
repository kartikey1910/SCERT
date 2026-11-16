/**
 * Shared engine for the officer-facing result reports.
 *
 * District and BEO see the same two reports — the full All-Students list
 * and the official selected-candidates list — differing only in scope:
 * a district sees every block in its district, a BEO sees only its own
 * block. Everything else (columns, ordering, publish gating, filters,
 * pagination, PDF/XLSX shape) is identical, so it lives here once and
 * both controllers stay thin.
 *
 * Scoping comes from result_students.district_name / block_name, which
 * sheetProfiles maps from the sheet's SCHDIST / SCHBLOCK columns — the
 * SCHOOL's district and block, which is the required scope for both
 * roles, and needs no join to school_profiles.
 */

const pool = require("../config/db");

// ---------------------------------------------------------------------
// Publish gating
// ---------------------------------------------------------------------

/**
 * Officers see result data only once SCERT has released it to departments.
 *
 * This is deliberately NOT the public switch. is_published controls the
 * home-page lookup; is_officer_published controls School, BEO and District
 * access. They used to be one switch, so taking the public lookup down
 * also blanked every office's lists. Sheets may be uploaded well before
 * they are official, so nothing downstream may return a row until this
 * passes.
 */
async function isReleasedToOfficers(sessionId, scholarshipId) {
  const res = await pool.query(
    `SELECT 1 FROM scert_db.result_publications
      WHERE session_id = $1 AND scholarship_id = $2 AND is_officer_published = TRUE
      LIMIT 1`,
    [sessionId, scholarshipId]
  );
  return res.rows.length > 0;
}

function notPublishedPayload(scope, columns = []) {
  return {
    published: false,
    scope,
    columns,
    rows: [],
    blocks: [],
    summary: { total: 0, selected: 0, appeared: 0, absent: 0 },
    page: 1,
    page_size: 0,
    total: 0,
    total_pages: 1,
    message: "Results have not been declared yet.",
  };
}

// ---------------------------------------------------------------------
// Scope matching
// ---------------------------------------------------------------------

/** Every district spelling that should resolve to the same bucket. */
function districtMatchVariants(name) {
  const base = String(name || "").trim().toUpperCase();
  if (!base) return [];
  if (base === "HARDWAR" || base === "HARIDWAR") return ["HARDWAR", "HARIDWAR"];
  return [base];
}

/**
 * Builds the WHERE clause (and any needed JOIN) shared by the rows,
 * count, block-list and summary queries, so totals can never disagree
 * with the rows on screen.
 *
 * `scope` is one of:
 *   district : { districtName }
 *   BEO      : { districtName, blockName }
 *   school   : { schoolUserId }
 *
 * District/BEO match on NAME rather than block code, deliberately. Both
 * agree in the current data (verified: all 95 blocks match beo_profiles
 * on name and code alike). But the two can drift — an older agency sheet
 * numbered Almora's blocks 8-11 differently from the master list. If that
 * ever recurs, a name mismatch shows the officer nothing (visible, safe),
 * whereas a code mismatch would silently show them another block's
 * students.
 *
 * A school is matched by foreign key instead — result_students.application_id
 * -> scholarship_applications.created_by_school_user_id. Every uploaded row
 * carries a matched application (verified: 88,351/88,351), so this is exact
 * and avoids depending on the sheet's free-text school names, which vary in
 * spelling and punctuation.
 */
function buildScopeClause({ sessionId, scholarshipId, scope, filters = {} }) {
  const clauses = [];
  const values = [];
  let joinClause = "";

  if (sessionId !== null && sessionId !== undefined) {
    values.push(sessionId);
    clauses.push(`rs.session_id = $${values.length}`);
  }
  if (scholarshipId !== null && scholarshipId !== undefined) {
    values.push(scholarshipId);
    clauses.push(`rs.scholarship_id = $${values.length}`);
  }

  if (scope.schoolUserId) {
    joinClause = `JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id`;
    values.push(scope.schoolUserId);
    clauses.push(`sa.created_by_school_user_id = $${values.length}`);
  }

  // Only applied when the scope actually carries a district — a school
  // scope is already pinned by the foreign key above, and pushing an
  // empty variant array here would match nothing at all.
  if (scope.districtName) {
    values.push(districtMatchVariants(scope.districtName));
    clauses.push(`UPPER(TRIM(COALESCE(rs.district_name, ''))) = ANY($${values.length}::text[])`);
  }

  if (scope.blockName) {
    values.push(String(scope.blockName).trim().toUpperCase());
    clauses.push(`UPPER(TRIM(COALESCE(rs.block_name, ''))) = $${values.length}`);
  }

  if (filters.classValue) {
    values.push(Number(filters.classValue));
    clauses.push(`rs."class" = $${values.length}`);
  }
  // Only meaningful for a district officer; a BEO is already pinned to
  // one block by the scope above.
  if (filters.blockName) {
    values.push(String(filters.blockName).trim().toUpperCase());
    clauses.push(`UPPER(TRIM(COALESCE(rs.block_name, ''))) = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${String(filters.search).trim().toLowerCase()}%`);
    clauses.push(
      `(LOWER(COALESCE(rs.roll_number, '')) LIKE $${values.length}
        OR LOWER(COALESCE(rs.student_name, '')) LIKE $${values.length}
        OR LOWER(COALESCE(rs.school_name, '')) LIKE $${values.length})`
    );
  }
  if (filters.status === "SELECTED") clauses.push(`rs.is_selected = TRUE`);
  else if (filters.status === "NOT_SELECTED") clauses.push(`rs.is_selected = FALSE AND rs.is_absent = FALSE`);
  else if (filters.status === "ABSENT") clauses.push(`rs.is_absent = TRUE`);

  return { whereClause: clauses.join(" AND "), values, joinClause };
}

// ---------------------------------------------------------------------
// All-Students report
// ---------------------------------------------------------------------

const ALL_STUDENTS_COLUMNS = [
  { key: "block_name", label: "Block" },
  { key: "block_code", label: "Block Code" },
  { key: "school_name", label: "School Name" },
  { key: "roll_number", label: "Roll No." },
  { key: "app_display_id", label: "Application ID" },
  { key: "sr_number", label: "SR No." },
  { key: "student_name", label: "Student Name" },
  { key: "father_name", label: "Father's Name" },
  { key: "mother_name", label: "Mother's Name" },
  { key: "dob", label: "Date of Birth" },
  { key: "gender", label: "Gender" },
  { key: "category", label: "Category" },
  { key: "is_divyang", label: "Divyang" },
  { key: "aadhaar_number", label: "Aadhaar No." },
  { key: "mobile_number", label: "Mobile No." },
  { key: "village", label: "Village" },
  { key: "post_office", label: "Post Office" },
  { key: "prev_school_name", label: "Previous School" },
  { key: "school_type_code", label: "School Type" },
  { key: "school_category_code", label: "School Category" },
  { key: "center_code", label: "Center Code" },
  { key: "center_name", label: "Center Name" },
  { key: "paper_set", label: "Paper Set" },
  { key: "mat_marks", label: "MAT Marks" },
  { key: "sat_marks", label: "SAT Marks" },
  { key: "scst_mat_marks", label: "SC/ST MAT" },
  { key: "scst_sat_marks", label: "SC/ST SAT" },
  { key: "total_marks", label: "Total Marks" },
  { key: "mat_attendance", label: "MAT Att." },
  { key: "sat_attendance", label: "SAT Att." },
  { key: "overall_attendance", label: "Overall Att." },
  { key: "is_absent", label: "Absent" },
  { key: "is_selected", label: "Selected" },
];

const ALL_STUDENTS_FIELDS = `
  rs.result_student_id, rs."class"::int AS class_value,
  rs.block_name, rs.block_code, rs.school_name,
  rs.roll_number, rs.app_display_id, rs.sr_number,
  rs.student_name, rs.father_name, rs.mother_name,
  rs.dob, rs.gender, rs.category, rs.is_divyang,
  rs.aadhaar_number, rs.mobile_number, rs.village, rs.post_office,
  rs.prev_school_name, rs.school_type_code, rs.school_category_code,
  rs.center_code, rs.center_name, rs.paper_set,
  rs.mat_marks, rs.sat_marks, rs.scst_mat_marks, rs.scst_sat_marks, rs.total_marks,
  rs.mat_attendance, rs.sat_attendance, rs.overall_attendance,
  rs.is_absent, rs.is_selected
`;

const ALL_STUDENTS_ORDER = `
  ORDER BY
    NULLIF(REGEXP_REPLACE(COALESCE(rs.block_code, ''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
    rs.block_name ASC NULLS LAST,
    NULLIF(REGEXP_REPLACE(COALESCE(rs.roll_number, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
    rs.roll_number ASC
`;

/**
 * @param scope        { districtName, blockName? } plus any extra keys the
 *                     caller wants echoed back to the client.
 * @param includeBlocks whether to return the block dropdown (district
 *                      only — a BEO has exactly one block).
 */
async function getAllStudents({ sessionId, scholarshipId, scope, filters, page, pageSize, includeBlocks }) {
  if (!(await isReleasedToOfficers(sessionId, scholarshipId))) {
    return notPublishedPayload(scope, ALL_STUDENTS_COLUMNS);
  }

  const offset = (page - 1) * pageSize;
  const main = buildScopeClause({ sessionId, scholarshipId, scope, filters });
  // Block list is built without the block filter so choosing a block
  // never empties the dropdown that produced it.
  const listScope = buildScopeClause({ sessionId, scholarshipId, scope, filters: { ...filters, blockName: null } });

  const queries = [
    pool.query(
      `SELECT ${ALL_STUDENTS_FIELDS} FROM scert_db.result_students rs ${main.joinClause}
        WHERE ${main.whereClause} ${ALL_STUDENTS_ORDER}
        LIMIT ${pageSize} OFFSET ${offset}`,
      main.values
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_students rs ${main.joinClause} WHERE ${main.whereClause}`,
      main.values
    ),
    // Summary uses the SAME scope as the rows so the tiles always agree
    // with the table beneath them.
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE rs.is_selected)::int AS selected,
              COUNT(*) FILTER (WHERE NOT rs.is_absent)::int AS appeared,
              COUNT(*) FILTER (WHERE rs.is_absent)::int AS absent
         FROM scert_db.result_students rs ${main.joinClause} WHERE ${main.whereClause}`,
      main.values
    ),
  ];

  if (includeBlocks) {
    queries.push(
      pool.query(
        `SELECT rs.block_name, MIN(rs.block_code) AS block_code, COUNT(*)::int AS student_count
           FROM scert_db.result_students rs ${listScope.joinClause}
          WHERE ${listScope.whereClause} AND NULLIF(TRIM(COALESCE(rs.block_name, '')), '') IS NOT NULL
          GROUP BY rs.block_name
          ORDER BY NULLIF(REGEXP_REPLACE(COALESCE(MIN(rs.block_code), ''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
                   rs.block_name ASC`,
        listScope.values
      )
    );
  }

  const [rowsRes, countRes, summaryRes, blocksRes] = await Promise.all(queries);
  const total = countRes.rows[0]?.total || 0;

  return {
    published: true,
    scope,
    columns: ALL_STUDENTS_COLUMNS,
    rows: rowsRes.rows,
    blocks: blocksRes ? blocksRes.rows : [],
    summary: summaryRes.rows[0] || { total: 0, selected: 0, appeared: 0, absent: 0 },
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ---------------------------------------------------------------------
// Selected-students report (official published format)
//
// Columns and order come from the published selected-candidate list.
// GENDER, CASTE and SCHOOL TYPE carry the sheet's own codes rather than
// labels, matching the official document. WEIGHTAGE SC/ST is a single
// figure: the sum of the per-paper SCSTMAT + SCSTSAT values.
// ---------------------------------------------------------------------

const SELECTED_COLUMNS = [
  { key: "sno", label: "SN", pdfWidth: 30, xlsxWidth: 6, align: "right" },
  { key: "roll_number", label: "ROLL NO", pdfWidth: 66, xlsxWidth: 14 },
  { key: "student_name", label: "CANDIDATE NAME", pdfWidth: 104, xlsxWidth: 24 },
  { key: "father_name", label: "FATHER NAME", pdfWidth: 104, xlsxWidth: 24 },
  { key: "dob", label: "DOB", pdfWidth: 56, xlsxWidth: 12 },
  { key: "gender_code", label: "GENDER", pdfWidth: 42, xlsxWidth: 9, align: "right" },
  { key: "category_code", label: "CASTE", pdfWidth: 38, xlsxWidth: 8, align: "right" },
  { key: "school_name", label: "SCHOOL NAME", pdfWidth: 122, xlsxWidth: 30 },
  { key: "block_name", label: "BLOCK", pdfWidth: 78, xlsxWidth: 18 },
  { key: "district_name", label: "DISTRICT", pdfWidth: 66, xlsxWidth: 16 },
  { key: "school_type_code", label: "SCHOOL TYPE", pdfWidth: 48, xlsxWidth: 12, align: "right" },
  { key: "mat_marks", label: "MAT MARKS", pdfWidth: 48, xlsxWidth: 11, align: "right" },
  { key: "sat_marks", label: "SAT MARKS", pdfWidth: 48, xlsxWidth: 11, align: "right" },
  { key: "weightage", label: "WEIGHTAGE SC/ST", pdfWidth: 54, xlsxWidth: 15, align: "right" },
  { key: "total_marks", label: "TOTAL MARKS", pdfWidth: 50, xlsxWidth: 12, align: "right" },
];

const SELECTED_FIELDS = `
  rs.result_student_id, rs."class"::int AS class_value,
  rs.roll_number, rs.student_name, rs.father_name, rs.dob,
  rs.gender, rs.gender_code, rs.category, rs.category_code,
  rs.school_name, rs.school_type_code,
  rs.block_name, rs.block_code, rs.district_name,
  rs.mat_marks, rs.sat_marks, rs.scst_mat_marks, rs.scst_sat_marks, rs.total_marks
`;

/** Block-wise, then by merit — how the official list is printed. */
const SELECTED_ORDER = `
  ORDER BY
    NULLIF(REGEXP_REPLACE(COALESCE(rs.block_code, ''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
    rs.block_name ASC NULLS LAST,
    rs.total_marks DESC NULLS LAST,
    NULLIF(REGEXP_REPLACE(COALESCE(rs.roll_number, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST
`;

function formatDob(value) {
  if (!value) return "-";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatSelectedRow(row, index) {
  const wMat = num(row.scst_mat_marks);
  const wSat = num(row.scst_sat_marks);
  const weightage = wMat === null && wSat === null ? null : (wMat || 0) + (wSat || 0);

  return {
    sno: index + 1,
    roll_number: row.roll_number || "-",
    student_name: row.student_name || "-",
    father_name: row.father_name || "-",
    dob: formatDob(row.dob),
    // Derive from the label when the sheet left the numeric column blank,
    // so an official column is never empty just because one source
    // column was missing.
    gender_code: row.gender_code ?? (row.gender === "MALE" ? 1 : row.gender === "FEMALE" ? 2 : "-"),
    category_code: row.category_code ?? "-",
    school_name: row.school_name || "-",
    block_name: row.block_name || "-",
    district_name: row.district_name || "-",
    school_type_code: row.school_type_code ?? "-",
    mat_marks: num(row.mat_marks) ?? "-",
    sat_marks: num(row.sat_marks) ?? "-",
    weightage: weightage ?? "-",
    total_marks: num(row.total_marks) ?? "-",
  };
}

function selectedScope({ sessionId, scholarshipId, scope, filters }, overrides = {}) {
  return buildScopeClause({
    sessionId,
    scholarshipId,
    scope,
    filters: { ...filters, ...overrides, status: "SELECTED" },
  });
}

async function getSelectedStudents({ sessionId, scholarshipId, scope, filters, page, pageSize, includeBlocks }) {
  if (!(await isReleasedToOfficers(sessionId, scholarshipId))) {
    return notPublishedPayload(scope, SELECTED_COLUMNS);
  }

  const offset = (page - 1) * pageSize;
  const main = selectedScope({ sessionId, scholarshipId, scope, filters });
  const listScope = selectedScope({ sessionId, scholarshipId, scope, filters }, { blockName: null });

  const queries = [
    pool.query(
      `SELECT ${SELECTED_FIELDS} FROM scert_db.result_students rs ${main.joinClause}
        WHERE ${main.whereClause} ${SELECTED_ORDER}
        LIMIT ${pageSize} OFFSET ${offset}`,
      main.values
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_students rs ${main.joinClause} WHERE ${main.whereClause}`,
      main.values
    ),
  ];

  if (includeBlocks) {
    queries.push(
      pool.query(
        `SELECT rs.block_name, MIN(rs.block_code) AS block_code, COUNT(*)::int AS student_count
           FROM scert_db.result_students rs ${listScope.joinClause}
          WHERE ${listScope.whereClause} AND NULLIF(TRIM(COALESCE(rs.block_name, '')), '') IS NOT NULL
          GROUP BY rs.block_name
          ORDER BY NULLIF(REGEXP_REPLACE(COALESCE(MIN(rs.block_code), ''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
                   rs.block_name ASC`,
        listScope.values
      )
    );
  }

  const [rowsRes, countRes, blocksRes] = await Promise.all(queries);
  const total = countRes.rows[0]?.total || 0;

  return {
    published: true,
    scope,
    columns: SELECTED_COLUMNS,
    // Serial numbers continue across pages so the screen matches the
    // downloaded report.
    rows: rowsRes.rows.map((r, i) => formatSelectedRow(r, offset + i)),
    blocks: blocksRes ? blocksRes.rows : [],
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Full selected list, unpaginated, for the PDF/XLSX download. */
async function getSelectedStudentsForExport({ sessionId, scholarshipId, scope, filters }) {
  const main = selectedScope({ sessionId, scholarshipId, scope, filters });
  const res = await pool.query(
    `SELECT ${SELECTED_FIELDS} FROM scert_db.result_students rs ${main.joinClause}
      WHERE ${main.whereClause} ${SELECTED_ORDER}`,
    main.values
  );
  return res.rows.map(formatSelectedRow);
}

async function getReportMetaNames(sessionId, scholarshipId) {
  const res = await pool.query(
    `SELECT s.session_name, sc.scholarship_name
       FROM scert_db.academic_sessions s
       CROSS JOIN scert_db.scholarships sc
      WHERE s.session_id = $1 AND sc.scholarship_id = $2`,
    [sessionId, scholarshipId]
  );
  return {
    sessionName: res.rows[0]?.session_name || `Session ${sessionId}`,
    scholarshipName: res.rows[0]?.scholarship_name || `Scholarship ${scholarshipId}`,
  };
}

/**
 * A cheap fingerprint of the rows a download would contain.
 *
 * Folded into the report cache key so that re-uploading a sheet, or
 * publishing/unpublishing, yields a different key and therefore a fresh
 * render — no explicit cache invalidation needed anywhere. Both aggregates
 * are answered from the (session, scholarship, class) index, so this costs
 * far less than the render it protects.
 */
async function getDataVersion({ sessionId, scholarshipId }) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(MAX(rs.result_student_id), 0)::text AS max_id,
            COALESCE(MAX(rs.updated_at), 'epoch')::text AS max_updated
       FROM scert_db.result_students rs
      WHERE rs.session_id = $1 AND rs.scholarship_id = $2`,
    [sessionId, scholarshipId]
  );
  const pub = await pool.query(
    `SELECT COALESCE(officer_published_at, 'epoch')::text AS released_at
       FROM scert_db.result_publications
      WHERE session_id = $1 AND scholarship_id = $2`,
    [sessionId, scholarshipId]
  );
  const r = res.rows[0] || {};
  return `${r.n || 0}:${r.max_id || 0}:${r.max_updated || ""}:${pub.rows[0]?.released_at || ""}`;
}

/**
 * Serves a selected-students download, using the on-disk report cache.
 *
 * Rendering is the expensive part (~780 ms of CPU for a 3,468-row PDF, all
 * of it on the worker's single thread), and officers re-download the same
 * report repeatedly, so a cache hit turns that into a file read. On a hit
 * nothing is queried or rendered at all.
 */
async function sendCachedSelectedDownload(res, { ctx, format, filename, sheetName, pdf }) {
  const { renderTablePdfBuffer } = require("../utils/pdfTable.util");
  const { renderTableXlsxBuffer } = require("../utils/xlsxTable.util");
  const reportCache = require("../utils/reportCache");

  const dataVersion = await getDataVersion(ctx);

  const { buffer, hit } = await reportCache.getOrCreate(
    {
      ext: format,
      parts: {
        kind: "selected-students",
        format,
        dataVersion,
        sessionId: ctx.sessionId,
        scholarshipId: ctx.scholarshipId,
        scope: ctx.scope,
        filters: ctx.filters,
      },
    },
    async () => {
      const rows = await getSelectedStudentsForExport(ctx);
      if (format === "xlsx") {
        return renderTableXlsxBuffer({
          sheetName,
          columns: SELECTED_COLUMNS.map((c) => ({ key: c.key, label: c.label, width: c.xlsxWidth })),
          rows,
        });
      }
      return renderTablePdfBuffer({
        ...pdf,
        columns: SELECTED_COLUMNS.map((c) => ({ key: c.key, label: c.label, width: c.pdfWidth, align: c.align })),
        rows,
        metaLines: [...(pdf.metaLines || []), `Total Selected: ${rows.length}`],
        layout: "landscape",
        bodyFontSize: 7,
        margin: 20,
      });
    }
  );

  res.setHeader(
    "Content-Type",
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf"
  );
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.setHeader("X-Report-Cache", hit ? "HIT" : "MISS");
  res.send(buffer);
}

module.exports = {
  isReleasedToOfficers,
  notPublishedPayload,
  buildScopeClause,
  ALL_STUDENTS_COLUMNS,
  SELECTED_COLUMNS,
  getAllStudents,
  getSelectedStudents,
  getSelectedStudentsForExport,
  getReportMetaNames,
  getDataVersion,
  sendCachedSelectedDownload,
};
