const pool = require("../config/db");
const { getQuestionGroups } = require('./metadata/questionGroups');
const districtBlockMaster = require("../master-data/district-block.master.json");
const { createClient } = require("redis");

const INSERT_CHUNK_SIZE = 500;

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const analyticsCacheClient = createClient({ url: redisUrl });
analyticsCacheClient.on("error", (err) =>
  console.error("result analytics redis error:", err)
);
analyticsCacheClient.connect().catch((err) =>
  console.error("result analytics redis connect error:", err)
);

const ANALYTICS_CACHE_TTL_SECONDS = 120;

async function readAnalyticsCache(key) {
  try {
    if (!analyticsCacheClient.isReady) return null;
    const cached = await analyticsCacheClient.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error("Redis get error (result analytics):", err.message);
    return null;
  }
}

async function writeAnalyticsCache(key, value) {
  try {
    if (!analyticsCacheClient.isReady) return;
    await analyticsCacheClient.setEx(key, ANALYTICS_CACHE_TTL_SECONDS, JSON.stringify(value));
  } catch (err) {
    console.error("Redis set error (result analytics):", err.message);
  }
}

function analyticsCacheKey(prefix, { sessionId, scholarshipId, classValue, filters = {}, extra = "" }) {
  const filterPart = ["district", "block", "school", "category", "gender", "school_type", "school_category", "area_type"]
    .map((k) => `${k}=${filters[k] || ""}`)
    .join("&");
  return `${prefix}:${sessionId}:${scholarshipId}:${classValue}:${filterPart}:${extra}`;
}

// ---------------------------------------------------------------------
// Canonical district/block ordering — the same district-block.master.json
// already used by scert.centersSummary.controller.js, so "district order
// 1, 2, 3..." here matches what every other report in the app calls
// district 1, 2, 3.
// ---------------------------------------------------------------------

function normalizeLookupName(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Runs async tasks with a cap on how many are in flight at once.
 *
 * A report that fires all its queries through one Promise.all holds that
 * many pool connections simultaneously. With a 12-connection pool per
 * worker, the 9-query Overall Performance report needed 36 connections
 * once four users opened it together, and requests started failing with
 * "timeout exceeded when trying to connect" — starving every other
 * endpoint on that worker, not just this report.
 *
 * Capping in-flight queries keeps one request's footprint small enough
 * that concurrent users queue politely instead of exhausting the pool.
 * Total time is barely affected, because the database was the bottleneck
 * rather than the client's willingness to wait.
 */
async function runWithConcurrencyLimit(taskFns, limit = 3) {
  const results = new Array(taskFns.length);
  let next = 0;

  async function worker() {
    while (next < taskFns.length) {
      const index = next++;
      results[index] = await taskFns[index]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, taskFns.length) }, () => worker())
  );
  return results;
}

function getCanonicalDistricts() {
  return Object.values(districtBlockMaster || {})
    .map((d) => ({
      code: String(d.district_code),
      name: d.district_name,
      normalized: normalizeLookupName(d.district_name),
    }))
    .filter((d) => d.code && d.name)
    .sort((a, b) => Number(a.code) - Number(b.code));
}
exports.getCanonicalDistricts = getCanonicalDistricts;

function getCanonicalBlocksForDistrict(districtName) {
  const target = normalizeLookupName(districtName);
  // "Haridwar" is spelled "Hardwar" in the master data (matching the
  // normalization applied everywhere else in this file).
  const targetNormalized = target === "HARIDWAR" ? "HARDWAR" : target;

  const entry = Object.values(districtBlockMaster || {}).find(
    (d) => normalizeLookupName(d.district_name) === targetNormalized
  );
  if (!entry || !entry.blocks) return [];

  return Object.values(entry.blocks)
    .map((b) => ({
      code: String(b.block_code),
      name: b.block_name,
      normalized: normalizeLookupName(b.block_name),
    }))
    .filter((b) => b.code && b.name)
    .sort((a, b) => Number(a.code) - Number(b.code));
}
exports.getCanonicalBlocksForDistrict = getCanonicalBlocksForDistrict;

/**
 * Folds a free-text district name to its canonical spelling so that
 * casing variants ("Hardwar" / "HARDWAR") and the Haridwar/Hardwar
 * spelling split group as one district rather than several. Anything not
 * in the master list is returned as-is rather than dropped.
 */
let districtByNormalizedCache = null;
function resolveCanonicalDistrictName(rawName) {
  const name = rawName || "Unknown";
  if (!districtByNormalizedCache) {
    districtByNormalizedCache = new Map(
      getCanonicalDistricts().map((d) => [d.normalized, d.name])
    );
  }
  let key = normalizeLookupName(name);
  if (key === "HARIDWAR") key = "HARDWAR";
  return districtByNormalizedCache.get(key) || name;
}

let blockByCodeCache = null;
/** Block codes are unique state-wide (Hardwar's are 34-39, say), so a block
 * can be looked up without knowing its district first. */
function getCanonicalBlockByCode(blockCode) {
  if (!blockByCodeCache) {
    blockByCodeCache = new Map();
    for (const d of Object.values(districtBlockMaster || {})) {
      for (const b of Object.values(d.blocks || {})) {
        if (b.block_code) blockByCodeCache.set(String(b.block_code), { name: b.block_name, districtName: d.district_name });
      }
    }
  }
  return blockByCodeCache.get(String(blockCode || "").trim()) || null;
}

// ---------------------------------------------------------------------
// Shared cohort resolvers for the Selection Summary charts + hierarchy
// table.
//
// The old code ran an independently-scoped query per chart type
// (overall/gender/category), each with a LATERAL join per outer row to
// resolve caste/gender from the dynamic application-answers table, and
// getHierarchySummary ran the same pattern again — up to 6-8 heavy queries
// per page load. Against real data (51k applications) a single one of
// those LATERAL-joined queries took up to 28s.
//
// These resolvers replace the correlated LATERAL subquery with a
// DISTINCT ON CTE scoped by ff.scholarship_id (a handful of fields instead
// of a per-row re-scan), run ONCE per request, and let callers derive
// whatever grouping they need (gender, category, district, block, school)
// in JS from the one result set.
// ---------------------------------------------------------------------

async function resolveApprovedApplicationCohort({ sessionId, scholarshipId, classValue, filters = {} }) {
  const clauses = [
    `sa.session_id = $1`,
    `sa.scholarship_id = $2`,
    `sa.status = 'APPROVED'`,
    `${buildApplicationClassExpression("sa")} = $3`,
  ];
  const values = [sessionId, scholarshipId, String(classValue)];

  if (filters.district) {
    let distVal = normalizeLookupName(filters.district);
    if (distVal === "HARIDWAR" || distVal === "HARDWAR") distVal = "HARDWAR";
    values.push(distVal);
    clauses.push(
      `(CASE WHEN UPPER(TRIM(COALESCE(sp_student.district_name, sp_creator.district_name, ''))) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(COALESCE(sp_student.district_name, sp_creator.district_name, ''))) END) = $${values.length}`
    );
  }
  if (filters.block) {
    values.push(filters.block);
    clauses.push(
      `(COALESCE(sp_student.block_name, sp_creator.block_name) = $${values.length} OR COALESCE(sp_student.block_code, sp_creator.block_code) = $${values.length})`
    );
  }
  if (filters.school) {
    values.push(filters.school);
    clauses.push(`COALESCE(sp_student.school_name, sp_creator.school_name) = $${values.length}`);
  }
  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`COALESCE(sp_student.school_type, sp_creator.school_type) = $${values.length}`);
  }
  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(`COALESCE(sp_student.school_category, sp_creator.school_category) = $${values.length}`);
  }
  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(`COALESCE(sp_student.school_location, sp_creator.school_location) = $${values.length}`);
  }

  values.push(scholarshipId);
  const scholarshipIdParam = values.length;

  const query = `
    WITH caste_resolved AS (
      SELECT DISTINCT ON (aa.application_id) aa.application_id,
        UPPER(TRIM(COALESCE(aa.value_text, aa.value_number::text, ''))) AS category
      FROM scert_db.scholarship_application_answers aa
      JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
      WHERE ff.scholarship_id = $${scholarshipIdParam}
        AND LOWER(TRIM(ff.field_key)) IN ('caste_category', 'caste')
      ORDER BY aa.application_id, ff.sort_order ASC, ff.field_id ASC
    ),
    gender_resolved AS (
      SELECT DISTINCT ON (aa.application_id) aa.application_id,
        UPPER(TRIM(COALESCE(aa.value_text, aa.value_number::text, ''))) AS gender
      FROM scert_db.scholarship_application_answers aa
      JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
      WHERE ff.scholarship_id = $${scholarshipIdParam}
        AND LOWER(TRIM(ff.field_key)) = 'sex'
      ORDER BY aa.application_id, ff.sort_order ASC, ff.field_id ASC
    )
    SELECT
      sa.application_id,
      sa.center_id,
      CASE WHEN UPPER(TRIM(COALESCE(sp_student.district_name, sp_creator.district_name, ''))) IN ('HARDWAR', 'HARIDWAR')
           THEN 'HARDWAR'
           ELSE NULLIF(UPPER(TRIM(COALESCE(sp_student.district_name, sp_creator.district_name, ''))), '')
      END AS district_name,
      COALESCE(NULLIF(TRIM(sp_student.block_name), ''), NULLIF(TRIM(sp_creator.block_name), ''), NULLIF(TRIM(sp_student.block_code), ''), NULLIF(TRIM(sp_creator.block_code), '')) AS block_name,
      COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code,
      COALESCE(NULLIF(TRIM(sp_student.school_name), ''), NULLIF(TRIM(sp_creator.school_name), '')) AS school_name,
      CASE
        WHEN UPPER(TRIM(COALESCE(gr.gender::text, st.gender::text, ''))) IN ('1', 'MALE', 'M') THEN 'Male'
        WHEN UPPER(TRIM(COALESCE(gr.gender::text, st.gender::text, ''))) IN ('2', 'FEMALE', 'F') THEN 'Female'
        ELSE NULL
      END AS gender,
      NULLIF(UPPER(TRIM(COALESCE(cr.category, ''))), '') AS category
    FROM scert_db.scholarship_applications sa
    LEFT JOIN scert_db.student_profiles st ON st.user_id = sa.student_user_id
    LEFT JOIN scert_db.school_profiles sp_student ON sp_student.udise_code = st.udise_code
    LEFT JOIN scert_db.school_profiles sp_creator ON sp_creator.user_id = sa.created_by_school_user_id
    LEFT JOIN caste_resolved cr ON cr.application_id = sa.application_id
    LEFT JOIN gender_resolved gr ON gr.application_id = sa.application_id
    WHERE ${clauses.join(" AND ")}
  `;

  const res = await pool.query(query, values);
  return res.rows;
}

async function resolveSchoolStrengthCohort({ classValue, filters = {} }) {
  const clauses = [`sss.class_level = $1`];
  const values = [classValue];

  if (filters.district) {
    let distVal = normalizeLookupName(filters.district);
    if (distVal === "HARIDWAR" || distVal === "HARDWAR") distVal = "HARDWAR";
    values.push(distVal);
    clauses.push(
      `(CASE WHEN UPPER(TRIM(sp.district_name)) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(sp.district_name)) END) = $${values.length}`
    );
  }
  if (filters.block) {
    // Compared against both name and code — filters.block is a block NAME
    // (see getFilterOptions), and the old code here compared against
    // block_code only, so a block filter silently matched nothing.
    values.push(filters.block);
    clauses.push(`(sp.block_name = $${values.length} OR sp.block_code = $${values.length})`);
  }
  if (filters.school) {
    values.push(filters.school);
    clauses.push(`sp.school_name = $${values.length}`);
  }
  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`sp.school_type = $${values.length}`);
  }
  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(`sp.school_category = $${values.length}`);
  }
  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(`sp.school_location = $${values.length}`);
  }

  const query = `
    SELECT
      sss.category,
      sss.boys_count,
      sss.girls_count,
      CASE WHEN UPPER(TRIM(sp.district_name)) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE NULLIF(UPPER(TRIM(sp.district_name)), '') END AS district_name,
      COALESCE(NULLIF(TRIM(sp.block_name), ''), NULLIF(TRIM(sp.block_code), '')) AS block_name,
      sp.block_code,
      NULLIF(TRIM(sp.school_name), '') AS school_name
    FROM scert_db.school_student_strength sss
    JOIN scert_db.school_profiles sp ON sp.user_id = sss.school_user_id
    WHERE ${clauses.join(" AND ")}
  `;

  const res = await pool.query(query, values);
  return res.rows;
}

/**
 * Every uploaded result_students row in scope — the ALL_STUDENTS sheet is
 * the full registered roster, not just those who showed up, so "selected"
 * and "appeared" are both just filtered views of this one set:
 *   selected -> is_selected
 *   appeared -> NOT is_absent (mat/sat/overall attendance from the sheet's
 *               ABSMAT/ABSSAT/ABS columns — present if any one is 'P')
 * is_absent is computed once at upload time in resultUpload.service.js, so
 * this only has to read the column, not re-derive the P/A logic.
 */
async function resolveResultStudentCohort({ sessionId, scholarshipId, classValue, filters = {} }) {
  const resultFilter = buildOptionalResultStudentFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    alias: "rs",
  });

  const res = await pool.query(
    `SELECT rs.application_id, rs.district_name, rs.block_name, rs.block_code, rs.school_name,
            rs.gender, rs.category, rs.is_selected, rs.is_absent
       FROM scert_db.result_students rs
      WHERE ${resultFilter.whereClause}`,
    resultFilter.values
  );
  return res.rows;
}

/**
 * Full selected-students listing for the PDF/XLSX download — every column
 * captured from the uploaded Selected Students sheet, ordered district 1
 * (its blocks in order), then district 2 (its blocks in order), and so on,
 * using the same canonical district-block.master.json codes the
 * Hierarchical Analytics table orders by. Unrecognised district/block
 * names (a school profile with a typo, say) sort after every known one
 * rather than silently vanishing.
 */
exports.getSessionAndScholarshipNames = async ({ sessionId, scholarshipId }) => {
  const [sessionRes, scholarshipRes] = await Promise.all([
    pool.query(`SELECT session_name FROM scert_db.academic_sessions WHERE session_id = $1`, [sessionId]),
    pool.query(`SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $1`, [scholarshipId]),
  ]);
  return {
    sessionName: sessionRes.rows[0]?.session_name || `Session ${sessionId}`,
    scholarshipName: scholarshipRes.rows[0]?.scholarship_name || `Scholarship ${scholarshipId}`,
  };
};

exports.getSelectedStudentsExport = async ({ sessionId, scholarshipId, classValue, filters = {} }) => {
  const resultFilter = buildOptionalResultStudentFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    alias: "rs",
    onlySelected: true,
  });

  const res = await pool.query(
    `SELECT
       rs.roll_number, rs.app_display_id, rs.sr_number,
       rs.student_name, rs.father_name, rs.mother_name,
       rs.dob, rs.dob_invalid, rs.gender, rs.category, rs.is_divyang,
       rs.aadhaar_number, rs.mobile_number,
       rs.district_name, rs.block_name, rs.block_code, rs.school_name,
       rs.school_type_code, rs.school_category_code,
       rs.prev_school_name, rs.prev_school_type,
       rs.center_code, rs.center_name, rs.paper_set,
       rs.mat_marks, rs.sat_marks, rs.scst_mat_marks, rs.scst_sat_marks, rs.total_marks,
       rs.mat_attendance, rs.sat_attendance, rs.overall_attendance
     FROM scert_db.result_students rs
     WHERE ${resultFilter.whereClause}`,
    resultFilter.values
  );

  const districtOrder = new Map(getCanonicalDistricts().map((d, i) => [d.normalized, i]));
  const blockOrderByDistrict = new Map(); // normalized district -> Map(normalized block -> index)

  function blockIndex(districtName, blockName) {
    const dKey = normalizeLookupName(districtName);
    if (!blockOrderByDistrict.has(dKey)) {
      blockOrderByDistrict.set(
        dKey,
        new Map(getCanonicalBlocksForDistrict(districtName).map((b, i) => [b.normalized, i]))
      );
    }
    const blocks = blockOrderByDistrict.get(dKey);
    const bKey = normalizeLookupName(blockName);
    return blocks.has(bKey) ? blocks.get(bKey) : Number.MAX_SAFE_INTEGER;
  }

  return res.rows.sort((a, b) => {
    const da = districtOrder.get(normalizeLookupName(a.district_name)) ?? Number.MAX_SAFE_INTEGER;
    const db = districtOrder.get(normalizeLookupName(b.district_name)) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;

    const ba = blockIndex(a.district_name, a.block_name);
    const bb = blockIndex(b.district_name, b.block_name);
    if (ba !== bb) return ba - bb;

    return String(a.roll_number || "").localeCompare(String(b.roll_number || ""));
  });
};

function normalizeCategoryFilterValue(value) {
  const v = String(value || "").toUpperCase().trim();
  if (!v) return null;
  if (v === "GENERAL") return "GEN";
  return v;
}

/**
 * Everything getCharts and getHierarchySummary both need, resolved once.
 *
 * Gender/category filters are applied here in JS (against the already
 * SQL-resolved fields) rather than at the SQL WHERE clause, so every
 * caller sees consistently-filtered data without re-deriving the logic
 * per chart type. school_student_strength has no per-student gender
 * column (only boys_count/girls_count), so a gender filter narrows which
 * COLUMN each caller reads instead of which rows are returned — callers
 * that need the true Male/Female breakdown (rather than the globally
 * filtered total) pass their own gender key to sumStrength() and ignore
 * bundle.genderFilter, matching how the per-chart-type queries this
 * replaced already behaved.
 */
async function resolveSelectionCohortBundle({ sessionId, scholarshipId, classValue, filters = {} }) {
  const [applications, strengthRows, resultRows] = await Promise.all([
    resolveApprovedApplicationCohort({ sessionId, scholarshipId, classValue, filters }),
    resolveSchoolStrengthCohort({ classValue, filters }),
    resolveResultStudentCohort({ sessionId, scholarshipId, classValue, filters }),
  ]);

  const genderFilter = filters.gender ? String(filters.gender).toUpperCase().trim() : null;
  const categoryFilter = normalizeCategoryFilterValue(filters.category);
  const applicationGender = (a) => (a.gender === "Male" ? "MALE" : a.gender === "Female" ? "FEMALE" : "");

  const filteredApplications = applications.filter((a) => {
    if (genderFilter && applicationGender(a) !== genderFilter) return false;
    if (categoryFilter && String(a.category || "").toUpperCase() !== categoryFilter) return false;
    return true;
  });

  const filteredResultRows = resultRows.filter((r) => {
    if (genderFilter && String(r.gender || "").toUpperCase() !== genderFilter) return false;
    if (categoryFilter && String(r.category || "").toUpperCase() !== categoryFilter) return false;
    return true;
  });

  // school_student_strength has no EWS bucket at all.
  const filteredStrengthRows = categoryFilter
    ? (categoryFilter === "EWS" ? [] : strengthRows.filter((r) => String(r.category || "").toUpperCase() === categoryFilter))
    : strengthRows;

  return {
    applications: filteredApplications,
    strengthRows: filteredStrengthRows,
    selectedRows: filteredResultRows.filter((r) => r.is_selected),
    appearedRows: filteredResultRows.filter((r) => !r.is_absent),
    genderFilter,
  };
}

function sumStrength(rows, genderFilter) {
  return rows.reduce((total, row) => {
    if (genderFilter === "MALE") return total + (Number(row.boys_count) || 0);
    if (genderFilter === "FEMALE") return total + (Number(row.girls_count) || 0);
    return total + (Number(row.boys_count) || 0) + (Number(row.girls_count) || 0);
  }, 0);
}

function buildApplicationClassExpression(aliasApp = "sa") {
  return `COALESCE(NULLIF(TRIM(${aliasApp}."class"::text), ''), CASE WHEN ${aliasApp}.scholarship_id = 6 THEN '8' ELSE NULL END)`;
}

function buildResultStudentFilterClause({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
  alias = "rs",
}) {
  const clauses = [
    `${alias}.session_id = $1`,
    `${alias}.scholarship_id = $2`,
    `${alias}."class" = $3`,
  ];
  const values = [sessionId, scholarshipId, classValue];

  if (filters.district) {
    values.push(filters.district);
    clauses.push(`${alias}.district_name = $${values.length}`);
  }

  if (filters.block) {
    values.push(filters.block);
    clauses.push(`${alias}.block_code = $${values.length}`);
  }

  if (filters.school) {
    values.push(filters.school);
    clauses.push(`${alias}.school_name = $${values.length}`);
  }

  if (filters.category) {
    values.push(filters.category);
    clauses.push(`${alias}.category = $${values.length}`);
  }

  if (filters.gender) {
    values.push(filters.gender);
    clauses.push(`${alias}.gender = $${values.length}`);
  }

  return {
    whereClause: clauses.join(" AND "),
    values,
  };
}

function buildOptionalResultStudentFilterClause({
  sessionId = null,
  scholarshipId = null,
  classValue = null,
  filters = {},
  alias = "rs",
  districtExpr = null,
  blockExpr = null,
  schoolExpr = null,
  categoryExpr = null,
  genderExpr = null,
  onlySelected = false,
}) {
  const clauses = [];
  const values = [];
  const resolvedDistrictExpr = districtExpr || `${alias}.district_name`;
  const resolvedBlockExpr = blockExpr || `${alias}.block_code`;
  const resolvedSchoolExpr = schoolExpr || `${alias}.school_name`;
  const resolvedCategoryExpr = categoryExpr || `${alias}.category`;
  const resolvedGenderExpr = genderExpr || `${alias}.gender`;
  const resolvedSchoolTypeExpr = `COALESCE(sp_student.school_type, sp_creator.school_type)`;
  const resolvedSchoolCategoryExpr = `COALESCE(sp_student.school_category, sp_creator.school_category)`;
  const resolvedAreaTypeExpr = `COALESCE(sp_student.school_location, sp_creator.school_location)`;

  if (sessionId !== null && sessionId !== undefined) {
    values.push(sessionId);
    clauses.push(`${alias}.session_id = $${values.length}`);
  }

  if (scholarshipId !== null && scholarshipId !== undefined) {
    values.push(scholarshipId);
    clauses.push(`${alias}.scholarship_id = $${values.length}`);
  }

  if (classValue !== null && classValue !== undefined) {
    values.push(classValue);
    clauses.push(`${alias}."class" = $${values.length}`);
  }

  if (filters.district) {
    let distVal = String(filters.district).toUpperCase().trim();
    if (distVal === 'HARIDWAR' || distVal === 'HARDWAR') distVal = 'HARDWAR';
    values.push(distVal);
    clauses.push(`(CASE WHEN UPPER(TRIM(${resolvedDistrictExpr})) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(${resolvedDistrictExpr})) END) = $${values.length}`);
  }

  if (filters.block) {
    values.push(filters.block);
    clauses.push(`${resolvedBlockExpr} = $${values.length}`);
  }

  if (filters.school) {
    values.push(filters.school);
    clauses.push(`${resolvedSchoolExpr} = $${values.length}`);
  }

  if (filters.category) {
    values.push(filters.category);
    clauses.push(`${resolvedCategoryExpr} = $${values.length}`);
  }

  if (filters.gender) {
    values.push(filters.gender);
    clauses.push(`${resolvedGenderExpr} = $${values.length}`);
  }

  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`${resolvedSchoolTypeExpr} = $${values.length}`);
  }

  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(`${resolvedSchoolCategoryExpr} = $${values.length}`);
  }

  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(`${resolvedAreaTypeExpr} = $${values.length}`);
  }

  if (onlySelected) {
    clauses.push(`${alias}.is_selected = true`);
  }

  return {
    whereClause: clauses.length ? clauses.join(" AND ") : "1=1",
    values,
  };
}

function buildResolvedResultLocationExpressions({
  aliasResult = "rs",
  aliasStudentSchool = "sp_student",
  aliasCreatorSchool = "sp_creator",
}) {
  return {
    districtExpr: `COALESCE(NULLIF(TRIM(${aliasStudentSchool}.district_name), ''), NULLIF(TRIM(${aliasCreatorSchool}.district_name), ''), NULLIF(TRIM(${aliasResult}.district_name), ''))`,
    blockExpr: `COALESCE(NULLIF(TRIM(${aliasStudentSchool}.block_code), ''), NULLIF(TRIM(${aliasCreatorSchool}.block_code), ''), NULLIF(TRIM(${aliasResult}.block_code), ''))`,
    schoolExpr: `COALESCE(NULLIF(TRIM(${aliasStudentSchool}.school_name), ''), NULLIF(TRIM(${aliasCreatorSchool}.school_name), ''), NULLIF(TRIM(${aliasResult}.school_name), ''))`,
  };
}

function buildSchoolStrengthFilterClause({
  classValue,
  filters = {},
  aliasStrength = "sss",
  aliasSchool = "sp",
}) {
  const clauses = [`${aliasStrength}.class_level = $1`];
  const values = [classValue];

  if (filters.district) {
    values.push(filters.district);
    clauses.push(`${aliasSchool}.district_name = $${values.length}`);
  }

  if (filters.block) {
    values.push(filters.block);
    clauses.push(`${aliasSchool}.block_code = $${values.length}`);
  }

  if (filters.school) {
    values.push(filters.school);
    clauses.push(`${aliasSchool}.school_name = $${values.length}`);
  }

  if (filters.category) {
    values.push(filters.category);
    clauses.push(`${aliasStrength}.category = $${values.length}`);
  }

  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`${aliasSchool}.school_type = $${values.length}`);
  }

  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(`${aliasSchool}.school_category = $${values.length}`);
  }

  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(`${aliasSchool}.school_location = $${values.length}`);
  }

  return {
    whereClause: clauses.join(" AND "),
    values,
  };
}

function buildApplicationScopeFilterClause({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
  aliasApp = "sa",
  aliasStudent = "st",
  aliasStudentSchool = "sp_student",
  aliasCreatorSchool = "sp_creator",
  aliasCategory = "caste_info",
}) {
  const clauses = [
    `${aliasApp}.session_id = $1`,
    `${aliasApp}.scholarship_id = $2`,
    `${aliasApp}.status = 'APPROVED'`,
    `${buildApplicationClassExpression(aliasApp)} = $3`,
  ];
  const values = [sessionId, scholarshipId, String(classValue)];

  if (filters.district) {
    let distVal = String(filters.district).toUpperCase().trim();
    if (distVal === 'HARIDWAR' || distVal === 'HARDWAR') distVal = 'HARDWAR';
    values.push(distVal);
    const distRaw = `COALESCE(${aliasStudentSchool}.district_name, ${aliasCreatorSchool}.district_name)`;
    clauses.push(
      `(CASE WHEN UPPER(TRIM(${distRaw})) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(${distRaw})) END) = $${values.length}`
    );
  }

  if (filters.block) {
    values.push(filters.block);
    clauses.push(
      `(COALESCE(${aliasStudentSchool}.block_name, ${aliasCreatorSchool}.block_name) = ${values.length} OR COALESCE(${aliasStudentSchool}.block_code, ${aliasCreatorSchool}.block_code) = ${values.length})`
    );
  }

  if (filters.school) {
    values.push(filters.school);
    clauses.push(
      `COALESCE(${aliasStudentSchool}.school_name, ${aliasCreatorSchool}.school_name) = $${values.length}`
    );
  }

  if (filters.gender) {
    values.push(String(filters.gender).toUpperCase().trim());
    clauses.push(
      `UPPER(TRIM(COALESCE(${aliasStudent}.gender, ''))) = $${values.length}`
    );
  }

  if (filters.category) {
    values.push(String(filters.category).toUpperCase().trim());
    clauses.push(
      `UPPER(TRIM(COALESCE(${aliasCategory}.category, ''))) = $${values.length}`
    );
  }

  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(
      `COALESCE(${aliasStudentSchool}.school_type, ${aliasCreatorSchool}.school_type) = $${values.length}`
    );
  }

  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(
      `COALESCE(${aliasStudentSchool}.school_category, ${aliasCreatorSchool}.school_category) = $${values.length}`
    );
  }

  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(
      `COALESCE(${aliasStudentSchool}.school_location, ${aliasCreatorSchool}.school_location) = $${values.length}`
    );
  }

  return {
    whereClause: clauses.join(" AND "),
    values,
  };
}

function buildSchoolParticipationFilterClause({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
  aliasResult = "rs",
  aliasApplication = "sa",
  aliasSchool = "sp",
}) {
  const clauses = [
    `${aliasResult}.session_id = $1`,
    `${aliasResult}.scholarship_id = $2`,
    `${aliasResult}."class" = $3`,
    `${aliasResult}.is_selected = true`,
  ];
  const values = [sessionId, scholarshipId, classValue];

  if (filters.district) {
    let distVal = String(filters.district).toUpperCase().trim();
    if (distVal === 'HARIDWAR' || distVal === 'HARDWAR') distVal = 'HARDWAR';
    values.push(distVal);
    clauses.push(`(CASE WHEN UPPER(TRIM(${aliasSchool}.district_name)) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(${aliasSchool}.district_name)) END) = $${values.length}`);
  }

  if (filters.block) {
    values.push(filters.block);
    clauses.push(`${aliasSchool}.block_code = $${values.length}`);
  }

  if (filters.school) {
    values.push(filters.school);
    clauses.push(`${aliasSchool}.school_name = $${values.length}`);
  }

  if (filters.category) {
    values.push(String(filters.category).toUpperCase().trim());
    clauses.push(
      `UPPER(TRIM(COALESCE(${aliasResult}.category, ''))) = $${values.length}`
    );
  }

  if (filters.gender) {
    values.push(String(filters.gender).toUpperCase().trim());
    clauses.push(
      `UPPER(TRIM(COALESCE(${aliasResult}.gender, ''))) = $${values.length}`
    );
  }

  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`${aliasSchool}.school_type = $${values.length}`);
  }

  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(`${aliasSchool}.school_category = $${values.length}`);
  }

  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(`${aliasSchool}.school_location = $${values.length}`);
  }

  return {
    whereClause: clauses.join(" AND "),
    values,
  };
}

// buildHierarchyApplicationFilterClause, buildHierarchyLevelExpressions and
// shiftPlaceholderNumbers were removed here — they only existed to support
// the old getHierarchySummary implementation, which now goes through
// resolveSelectionCohortBundle instead (see below).

async function deleteExistingRows(client, sessionId, scholarshipId, classValue) {
  const res = await client.query(
    `
    SELECT upload_id
    FROM scert_db.result_uploads
    WHERE session_id = $1
      AND scholarship_id = $2
      AND "class" = $3
    `,
    [sessionId, scholarshipId, classValue]
  );

  if (res.rows.length === 0) return;

  const uploadIds = res.rows.map((row) => row.upload_id);

  await client.query(
    `
    DELETE FROM scert_db.result_students
    WHERE upload_id = ANY($1)
    `,
    [uploadIds]
  );

  await client.query(
    `
    DELETE FROM scert_db.result_unmatched_logs
    WHERE upload_id = ANY($1)
    `,
    [uploadIds]
  );

  await client.query(
    `
    DELETE FROM scert_db.result_uploads
    WHERE upload_id = ANY($1)
    `,
    [uploadIds]
  );
}

async function createUploadRecord(client, sessionId, scholarshipId, classValue, fileName, uploadedBy) {
  const result = await client.query(
    `
    INSERT INTO scert_db.result_uploads (
      session_id,
      scholarship_id,
      "class",
      file_name,
      uploaded_by,
      total_records,
      matched_records,
      unmatched_records
    )
    VALUES ($1, $2, $3, $4, $5, 0, 0, 0)
    RETURNING upload_id
    `,
    [sessionId, scholarshipId, classValue, fileName, uploadedBy]
  );

  return result.rows[0].upload_id;
}

async function findApplicationMatches(client, rollNumbers) {
  if (!rollNumbers.length) {
    return new Map();
  }

  const result = await client.query(
    `
    SELECT application_id, student_user_id, roll_number
    FROM scert_db.scholarship_applications
    WHERE roll_number = ANY($1::text[])
    `,
    [rollNumbers]
  );

  const matches = new Map();
  for (const row of result.rows) {
    if (!matches.has(row.roll_number)) {
      matches.set(row.roll_number, row);
    }
  }

  return matches;
}

async function bulkInsertResultStudents(client, rows) {
  for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const base = rowIndex * 23;
      values.push(
        row.upload_id,
        row.session_id,
        row.scholarship_id,
        row.class,
        row.roll_number,
        row.student_name,
        row.father_name,
        row.mother_name,
        row.dob,
        row.gender,
        row.category,
        row.district_name,
        row.block_code,
        row.school_name,
        row.center_name,
        row.mat_marks,
        row.sat_marks,
        row.total_marks,
        row.is_selected,
        row.is_absent,
        row.is_matched,
        row.application_id,
        row.student_user_id
      );

      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23})`;
    });

    await client.query(
      `
      INSERT INTO scert_db.result_students (
        upload_id,
        session_id,
        scholarship_id,
        "class",
        roll_number,
        student_name,
        father_name,
        mother_name,
        dob,
        gender,
        category,
        district_name,
        block_code,
        school_name,
        center_name,
        mat_marks,
        sat_marks,
        total_marks,
        is_selected,
        is_absent,
        is_matched,
        application_id,
        student_user_id
      )
      VALUES ${placeholders.join(", ")}
      `,
      values
    );
  }
}

async function bulkInsertUnmatchedLogs(client, rows) {
  if (!rows.length) return;

  for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const base = rowIndex * 8;
      values.push(
        row.upload_id,
        row.session_id,
        row.scholarship_id,
        row.class,
        row.roll_number,
        row.student_name,
        row.reason
      );

      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    await client.query(
      `
      INSERT INTO scert_db.result_unmatched_logs (
        upload_id,
        session_id,
        scholarship_id,
        "class",
        roll_number,
        student_name,
        reason
      )
      VALUES ${placeholders.join(", ")}
      `,
      values
    );
  }
}

async function updateUploadStats(client, uploadId, total, matched, unmatched) {
  await client.query(
    `
    UPDATE scert_db.result_uploads
    SET
      total_records = $1,
      matched_records = $2,
      unmatched_records = $3
    WHERE upload_id = $4
    `,
    [total, matched, unmatched, uploadId]
  );
}

exports.uploadSelectedStudents = async ({
  sessionId,
  scholarshipId,
  classValue,
  fileName,
  uploadedBy,
  rows,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await deleteExistingRows(client, sessionId, scholarshipId, classValue);
    const uploadId = await createUploadRecord(
      client,
      sessionId,
      scholarshipId,
      classValue,
      fileName,
      uploadedBy
    );

    const rollNumbers = Array.from(
      new Set(rows.map((row) => row.roll_number).filter(Boolean))
    );
    const applicationMatches = await findApplicationMatches(client, rollNumbers);

    let matchedCount = 0;
    let unmatchedCount = 0;

    const resultStudentRows = [];
    const unmatchedRows = [];

    for (const row of rows) {
      const match = applicationMatches.get(row.roll_number) || null;
      const isMatched = Boolean(match);

      if (isMatched) {
        matchedCount += 1;
      } else {
        unmatchedCount += 1;
        unmatchedRows.push({
          upload_id: uploadId,
          session_id: sessionId,
          scholarship_id: scholarshipId,
          class: classValue,
          roll_number: row.roll_number,
          student_name: row.student_name,
          reason: "Application not found for roll number",
        });
      }

      resultStudentRows.push({
        upload_id: uploadId,
        session_id: sessionId,
        scholarship_id: scholarshipId,
        class: classValue,
        roll_number: row.roll_number,
        student_name: row.student_name,
        father_name: row.father_name,
        mother_name: row.mother_name,
        dob: row.dob,
        gender: row.gender,
        category: row.category,
        district_name: row.district_name,
        block_code: row.block_code,
        school_name: row.school_name,
        center_name: row.center_name,
        mat_marks: row.mat_marks,
        sat_marks: row.sat_marks,
        total_marks: row.total_marks,
        is_selected: row.is_selected,
        is_absent: row.is_absent,
        is_matched: isMatched,
        application_id: match ? match.application_id : null,
        student_user_id: match ? match.student_user_id : null,
      });
    }

    await bulkInsertResultStudents(client, resultStudentRows);
    await bulkInsertUnmatchedLogs(client, unmatchedRows);
    await updateUploadStats(client, uploadId, rows.length, matchedCount, unmatchedCount);

    await client.query("COMMIT");

    return {
      total_uploaded: rows.length,
      matched: matchedCount,
      unmatched: unmatchedCount,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
};

exports.getFilterOptions = async ({ district = null, block = null }) => {
  const districtParams = [];
  const districtWhere = [];
  const normalizedDistrictSql = `NULLIF(TRIM(REGEXP_REPLACE(COALESCE(sp.district_name, ''), '\\s*\\([0-9]+\\)\\s*$', '', 'g')), '')`;
  const normalizedBlockSql = `NULLIF(TRIM(REGEXP_REPLACE(COALESCE(sp.block_name, ''), '\\s*\\([0-9]+\\)\\s*$', '', 'g')), '')`;

  if (district) {
    districtParams.push(district);
    districtWhere.push(
      `LOWER(COALESCE(${normalizedDistrictSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${districtParams.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
    );
  }

  if (block) {
    districtParams.push(block);
    districtWhere.push(
      `LOWER(COALESCE(${normalizedBlockSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${districtParams.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
    );
  }

  const schoolWhereClause = districtWhere.length
    ? `WHERE ${districtWhere.join(" AND ")}`
    : "";

  const [districtsRes, blocksRes, schoolsRes] = await Promise.all([
    pool.query(
      `
      SELECT MIN(${normalizedDistrictSql}) AS district_name
      FROM scert_db.school_profiles sp
      WHERE ${normalizedDistrictSql} IS NOT NULL
      GROUP BY LOWER(${normalizedDistrictSql})
      ORDER BY district_name ASC
      `
    ),
    pool.query(
      `
      SELECT MIN(${normalizedBlockSql}) AS block_name
      FROM scert_db.school_profiles sp
      WHERE ${normalizedBlockSql} IS NOT NULL
        ${district ? `AND LOWER(COALESCE(${normalizedDistrictSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($1, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))` : ""}
      GROUP BY LOWER(${normalizedBlockSql})
      ORDER BY block_name ASC
      `,
      district ? [district] : []
    ),
    pool.query(
      `
      SELECT MIN(NULLIF(TRIM(COALESCE(sp.school_name, '')), '')) AS school_name
      FROM scert_db.school_profiles sp
      ${schoolWhereClause}
        ${schoolWhereClause ? "AND" : "WHERE"} NULLIF(TRIM(COALESCE(sp.school_name, '')), '') IS NOT NULL
      GROUP BY LOWER(TRIM(COALESCE(sp.school_name, '')))
      ORDER BY school_name ASC
      `,
      districtParams
    ),
  ]);

  return {
    districts: districtsRes.rows
      .map((row) => row.district_name)
      .filter(Boolean),
    blocks: blocksRes.rows
      .map((row) => row.block_name)
      .filter(Boolean),
    schools: schoolsRes.rows
      .map((row) => row.school_name)
      .filter(Boolean),
  };
};


exports.getSubjectWiseFilterOptions = async ({ sessionId, scholarshipId, classValue, examType, filters = {} }) => {
  const question_groups = getQuestionGroups(scholarshipId, '', classValue, examType);
  
  // Also get the standard dimension options (district, block, etc) based on the current scope.
  // We can reuse the filter logic from getExamAnalyticsFilters if it exists, or just query them here.
  // For simplicity, we can just return standard options for District and Block if we want, or query them.
  // Let's do a simple query for districts and blocks based on uploaded results.
  const resultFilter = buildOptionalResultStudentFilterClause({
    sessionId, scholarshipId, classValue, filters,
    alias: 'rs',
    districtExpr: 'sp.district_name',
    blockExpr: 'sp.block_name',
    schoolExpr: 'sp.school_name',
    categoryExpr: 'caste_info.category',
    genderExpr: 'app_gender_info.gender'
  });

  const baseJoins = `
    FROM scert_db.result_students rs
    LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
    LEFT JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
  `;

  const [districts, blocks, schools] = await Promise.all([
    pool.query(`SELECT DISTINCT sp.district_name AS value ${baseJoins} WHERE ${resultFilter.whereClause} AND sp.district_name IS NOT NULL ORDER BY value`, resultFilter.values),
    pool.query(`SELECT DISTINCT sp.block_name AS value ${baseJoins} WHERE ${resultFilter.whereClause} AND sp.block_name IS NOT NULL ORDER BY value`, resultFilter.values),
    pool.query(`SELECT DISTINCT sp.school_name AS value ${baseJoins} WHERE ${resultFilter.whereClause} AND sp.school_name IS NOT NULL ORDER BY value`, resultFilter.values),
  ]);

  return {
    districts: districts.rows.map(r => r.value),
    blocks: blocks.rows.map(r => r.value),
    schools: schools.rows.map(r => r.value),
    question_groups,
  };
};

exports.getSubjectWiseReportData = async ({ sessionId, scholarshipId, classValue, examType, questionGroups = [], filters = {} }) => {
  const allGroups = getQuestionGroups(scholarshipId, '', classValue, examType);
  
  // Filter groups based on user selection. If empty, use all.
  let selectedGroups = allGroups;
  if (questionGroups.length > 0) {
    selectedGroups = allGroups.filter(g => questionGroups.includes(g.name));
  }

  // If no groups found, return empty report
  if (selectedGroups.length === 0) {
    return { overview: {}, gender_analysis: [], category_analysis: [], school_type_analysis: [], school_location_analysis: [], table_data: [] };
  }

  // Determine the question numbers to fetch
  const questionNumbers = [];
  selectedGroups.forEach(g => {
    for (let i = g.start; i <= g.end; i++) {
      questionNumbers.push(i);
    }
  });

  if (questionNumbers.length === 0) {
    return { overview: {}, gender_analysis: [], category_analysis: [], school_type_analysis: [], school_location_analysis: [], table_data: [] };
  }

  // category/gender come straight off result_students, where the upload
  // pipeline already resolved them. Re-deriving them per row via LATERAL
  // subqueries against the 1.59M-row scholarship_application_answers table
  // — twice, once here and once inside responsesQuery below — is what made
  // this report take 45 seconds for a single request, long enough to hold a
  // worker and a database connection hostage under any real load.
  const resultFilter = buildOptionalResultStudentFilterClause({
    sessionId, scholarshipId, classValue, filters,
    alias: 'rs',
    districtExpr: 'sp.district_name',
    blockExpr: 'sp.block_name',
    schoolExpr: 'sp.school_name',
    categoryExpr: 'rs.category',
    genderExpr: 'rs.gender'
  });

  const studentsQuery = `
    SELECT
      rs.roll_number,
      sp.district_name,
      sp.block_name,
      sp.school_name,
      COALESCE(stype.derived_school_type, 'Other') AS school_type,
      COALESCE(sp.school_location, 'Other') AS school_location,
      UPPER(TRIM(COALESCE(rs.category, 'Other'))) AS category,
      UPPER(TRIM(COALESCE(rs.gender, 'Other'))) AS gender
    FROM scert_db.result_students rs
    LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
    LEFT JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN LOWER(TRIM(COALESCE(sp.school_type, ''))) IN ('aided', 'govt aided', 'govt. aided', 'govt add.', 'high school aided') THEN 'Govt Aided'
        WHEN LOWER(TRIM(COALESCE(sp.school_type, ''))) IN ('local body') THEN 'Local Body'
        ELSE 'Dept of Edu'
      END AS derived_school_type
    ) stype ON true
    WHERE ${resultFilter.whereClause}
  `;

  const keysQuery = `
    SELECT question_number, correct_answer
    FROM scert_db.result_answer_keys
    WHERE session_id = $1 AND scholarship_id = $2 AND class = $3 AND UPPER(exam_type) = $4
      AND question_number = ANY($5::int[])
  `;

  // We only pull responses for the students matching the filter. This requires a subquery or join.
  const responsesQuery = `
    SELECT r.roll_number, r.question_number, r.marked_answer
    FROM scert_db.result_student_responses r
    WHERE r.session_id = $1 AND r.scholarship_id = $2 AND r.class = $3 AND UPPER(r.exam_type) = $4
      AND r.question_number = ANY($5::int[])
      AND r.roll_number IN (
        SELECT rs.roll_number
        FROM scert_db.result_students rs
        LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
        LEFT JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
        WHERE ${resultFilter.whereClause.replace(/\$([0-9]+)/g, (match, p1) => "$" + (parseInt(p1) + 5))}
      )
  `;

  const [studentsRes, keysRes, responsesRes] = await Promise.all([
    pool.query(studentsQuery, resultFilter.values),
    pool.query(keysQuery, [sessionId, scholarshipId, classValue, examType, questionNumbers]),
    pool.query(responsesQuery, [sessionId, scholarshipId, classValue, examType, questionNumbers, ...resultFilter.values])
  ]);

  const students = studentsRes.rows;
  const answerKeysMap = {};
  keysRes.rows.forEach(k => {
    answerKeysMap[k.question_number] = String(k.correct_answer || '').trim().toUpperCase();
  });

  const responsesByRollNumber = {};
  responsesRes.rows.forEach(r => {
    if (!responsesByRollNumber[r.roll_number]) responsesByRollNumber[r.roll_number] = {};
    responsesByRollNumber[r.roll_number][r.question_number] = String(r.marked_answer || '').trim().toUpperCase();
  });

  const genderStats = {};
  const categoryStats = {};
  const schoolTypeStats = {};
  const schoolLocationStats = {};
  const tableDataMap = {};

  const initStats = (map, key) => {
    if (!map[key]) {
      map[key] = { group: key, totalStudents: 0, correctCount: 0, totalQuestions: 0 };
    }
  };

  const initTableNode = (district, block, school) => {
    const key = `${district}||${block}||${school}`;
    if (!tableDataMap[key]) {
      tableDataMap[key] = { district, block, school, totalStudents: 0, correctCount: 0, totalQuestions: 0 };
    }
    return tableDataMap[key];
  };

  const numQuestions = questionNumbers.length;

  students.forEach(student => {
    const roll = student.roll_number;
    const g = student.gender === 'MALE' ? 'Male' : (student.gender === 'FEMALE' ? 'Female' : 'Other');
    const c = ['GEN', 'GENERAL'].includes(student.category) ? 'GEN' : (['OBC', 'SC', 'ST', 'EWS'].includes(student.category) ? student.category : 'Other');
    const st = student.school_type;
    const loc = student.school_location;

    initStats(genderStats, g);
    initStats(categoryStats, c);
    initStats(schoolTypeStats, st);
    initStats(schoolLocationStats, loc);
    
    // District names arrive as free text from school_profiles, where the
    // same district appears under different casing — "Hardwar" (4,779
    // students) and "HARDWAR" (16) were being reported as two separate
    // districts, giving 14 rows for 13 districts. Fold to the canonical
    // spelling before grouping, the same way the other result reports do.
    const tNode = initTableNode(
      resolveCanonicalDistrictName(student.district_name),
      student.block_name || 'Unknown',
      student.school_name || 'Unknown'
    );

    genderStats[g].totalStudents++;
    categoryStats[c].totalStudents++;
    schoolTypeStats[st].totalStudents++;
    schoolLocationStats[loc].totalStudents++;
    tNode.totalStudents++;

    genderStats[g].totalQuestions += numQuestions;
    categoryStats[c].totalQuestions += numQuestions;
    schoolTypeStats[st].totalQuestions += numQuestions;
    schoolLocationStats[loc].totalQuestions += numQuestions;
    tNode.totalQuestions += numQuestions;

    let studentCorrect = 0;
    const studentResMap = responsesByRollNumber[roll] || {};

    questionNumbers.forEach(qNum => {
      const correctAns = answerKeysMap[qNum];
      const markedAns = studentResMap[qNum];
      if (correctAns && markedAns && correctAns === markedAns) {
        studentCorrect++;
      }
    });

    genderStats[g].correctCount += studentCorrect;
    categoryStats[c].correctCount += studentCorrect;
    schoolTypeStats[st].correctCount += studentCorrect;
    schoolLocationStats[loc].correctCount += studentCorrect;
    tNode.correctCount += studentCorrect;
  });

  const formatStats = (map, order) => {
    const result = [];
    const keys = order ? order.filter(k => map[k]) : Object.keys(map).sort();
    
    // Also include keys from order that might not be in map to show 0 values
    if (order) {
      order.forEach(k => {
        if (!map[k]) map[k] = { group: k, totalStudents: 0, correctCount: 0, totalQuestions: 0 };
      });
    }

    const allKeys = order || Object.keys(map).sort();
    allKeys.forEach(k => {
      const d = map[k];
      const incorrectCount = d.totalQuestions - d.correctCount;
      result.push({
        name: k,
        totalStudents: d.totalStudents,
        totalQuestions: d.totalQuestions,
        correctCount: d.correctCount,
        incorrectCount: incorrectCount,
        correctPercent: d.totalQuestions > 0 ? ((d.correctCount / d.totalQuestions) * 100).toFixed(1) : 0,
        incorrectPercent: d.totalQuestions > 0 ? ((incorrectCount / d.totalQuestions) * 100).toFixed(1) : 0,
      });
    });
    return result;
  };

  const genderAnalysis = formatStats(genderStats, ['Male', 'Female', 'Other']);
  const categoryAnalysis = formatStats(categoryStats, ['GEN', 'OBC', 'SC', 'ST', 'EWS', 'Other']);
  const schoolTypeAnalysis = formatStats(schoolTypeStats, ['Govt Aided', 'Dept of Edu', 'Local Body']);
  const schoolLocationAnalysis = formatStats(schoolLocationStats, ['Rural', 'Urban', 'Other']);

  // Format table data into hierarchical District -> Block -> School
  const tableData = [];
  const districtsMap = {};

  Object.values(tableDataMap).forEach(d => {
    const incorrectCount = d.totalQuestions - d.correctCount;
    const row = {
      name: d.school,
      totalStudents: d.totalStudents,
      totalQuestions: d.totalQuestions,
      correctCount: d.correctCount,
      incorrectCount: incorrectCount,
      correctPercent: d.totalQuestions > 0 ? ((d.correctCount / d.totalQuestions) * 100).toFixed(1) : 0,
      incorrectPercent: d.totalQuestions > 0 ? ((incorrectCount / d.totalQuestions) * 100).toFixed(1) : 0,
    };

    if (!districtsMap[d.district]) districtsMap[d.district] = { blocks: {}, totals: { totalStudents: 0, correctCount: 0, totalQuestions: 0 } };
    if (!districtsMap[d.district].blocks[d.block]) districtsMap[d.district].blocks[d.block] = { schools: [], totals: { totalStudents: 0, correctCount: 0, totalQuestions: 0 } };

    districtsMap[d.district].blocks[d.block].schools.push(row);
    
    // Add to block totals
    districtsMap[d.district].blocks[d.block].totals.totalStudents += d.totalStudents;
    districtsMap[d.district].blocks[d.block].totals.correctCount += d.correctCount;
    districtsMap[d.district].blocks[d.block].totals.totalQuestions += d.totalQuestions;

    // Add to district totals
    districtsMap[d.district].totals.totalStudents += d.totalStudents;
    districtsMap[d.district].totals.correctCount += d.correctCount;
    districtsMap[d.district].totals.totalQuestions += d.totalQuestions;
  });

  const calcRow = (name, t) => {
    const incorrectCount = t.totalQuestions - t.correctCount;
    return {
      name,
      totalStudents: t.totalStudents,
      totalQuestions: t.totalQuestions,
      correctCount: t.correctCount,
      incorrectCount: incorrectCount,
      correctPercent: t.totalQuestions > 0 ? ((t.correctCount / t.totalQuestions) * 100).toFixed(1) : 0,
      incorrectPercent: t.totalQuestions > 0 ? ((incorrectCount / t.totalQuestions) * 100).toFixed(1) : 0,
    };
  };

  Object.keys(districtsMap).sort().forEach(dist => {
    const districtNode = {
      district_name: dist,
      district_totals: calcRow(dist + ' TOTAL', districtsMap[dist].totals),
      blocks: []
    };

    Object.keys(districtsMap[dist].blocks).sort().forEach(blk => {
      const bMap = districtsMap[dist].blocks[blk];
      districtNode.blocks.push({
        block_name: blk,
        block_totals: calcRow(blk + ' TOTAL', bMap.totals),
        schools: bMap.schools.sort((a,b) => a.name.localeCompare(b.name))
      });
    });

    tableData.push(districtNode);
  });

  return {
    overview: {
      totalEvaluatedStudents: students.length,
      selectedQuestionGroups: selectedGroups.map(g => g.name).join(', '),
      totalQuestionsCovered: numQuestions
    },
    gender_analysis: genderAnalysis,
    category_analysis: categoryAnalysis,
    school_type_analysis: schoolTypeAnalysis,
    school_location_analysis: schoolLocationAnalysis,
    table_data: tableData
  };
};

// ─── Internal: consolidated demographic correct/incorrect % aggregated hierarchically ─
// Returns: { state, byDistrict, byBlock } each containing
//   { gender_analysis, category_analysis, school_type_analysis, school_location_analysis }
// with rows: [{ name, correctPercent, incorrectPercent, totalStudents }]
async function computeSubjectWiseScoped({ sessionId, scholarshipId, classValue, districtName = null, blockCode = null }) {
  const classStr = String(classValue);

  // Get ALL question numbers for both MAT and SAT
  const matGroups = getQuestionGroups(scholarshipId, '', classValue, 'MAT');
  const satGroups = getQuestionGroups(scholarshipId, '', classValue, 'SAT');
  if (!matGroups.length && !satGroups.length) return null;

  // Scoping to one district/block (rather than pulling the whole class
  // roster every time) is what makes this affordable to run per report
  // page — a full class 6 is ~30k students x ~100 questions; a single
  // block is a few hundred.
  const scopeParams = [sessionId, scholarshipId, classStr];
  let scopeClause = '';
  if (districtName) {
    let distVal = normalizeLookupName(districtName);
    if (distVal === "HARIDWAR") distVal = "HARDWAR";
    scopeParams.push(distVal);
    scopeClause += ` AND (CASE WHEN UPPER(TRIM(COALESCE(sp.district_name, rs.district_name, ''))) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(COALESCE(sp.district_name, rs.district_name, ''))) END) = $${scopeParams.length}`;
  }
  if (blockCode) {
    scopeParams.push(blockCode);
    scopeClause += ` AND COALESCE(sp.block_code, rs.block_code) = $${scopeParams.length}`;
  }

  // Detailed student query with demographics. gender/category come straight
  // off result_students (resolved once at upload time) instead of two
  // per-row LATERAL joins to scholarship_application_answers — that
  // version measured ~29s alone against the full 41k-row class-6 roster.
  const studentsQuery = `
    SELECT DISTINCT rs.roll_number,
      COALESCE(rs.gender, '') AS gender,
      COALESCE(NULLIF(TRIM(rs.category), ''), 'Other') AS category,
      COALESCE(stype.derived_school_type, 'Other') AS school_type,
      COALESCE(NULLIF(TRIM(sp.school_location), ''), 'Unknown') AS school_location
    FROM scert_db.result_students rs
    LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
    LEFT JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN LOWER(TRIM(COALESCE(sp.school_type, ''))) IN ('aided', 'govt aided', 'govt. aided', 'govt add.', 'high school aided') THEN 'Govt Aided'
        WHEN LOWER(TRIM(COALESCE(sp.school_type, ''))) IN ('local body') THEN 'Local Body'
        ELSE 'Dept of Edu'
      END AS derived_school_type
    ) stype ON true
    WHERE rs.session_id = $1 AND rs.scholarship_id = $2 AND rs."class" = $3${scopeClause}
  `;

  // Fetch answer keys and responses for both exam types together; key by examType+qNum
  const keysQuery = `
    SELECT question_number, correct_answer, UPPER(exam_type) AS exam_type
    FROM scert_db.result_answer_keys
    WHERE session_id=$1 AND scholarship_id=$2 AND class=$3
  `;

  const responsesQuery = `
    SELECT r.roll_number, r.question_number, r.marked_answer, UPPER(r.exam_type) AS exam_type
    FROM scert_db.result_student_responses r
    WHERE r.session_id=$1 AND r.scholarship_id=$2 AND r.class=$3
      AND r.roll_number IN (
        SELECT rs.roll_number
        FROM scert_db.result_students rs
        LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
        LEFT JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
        WHERE rs.session_id=$1 AND rs.scholarship_id=$2 AND rs."class"=$3${scopeClause}
      )
  `;

  // Unscoped (state-level) queries here scan millions of rows in
  // result_student_responses — production's Postgres is a separate,
  // network-reached server with a 30s statement_timeout, which a plain
  // scan of that table blows through easily. A bare pool.query() can't be
  // scoped with SET LOCAL (it isn't inside a transaction, and each call may
  // land on a different pooled connection), so this checks out one client,
  // wraps the three queries in a transaction, and raises the timeout for
  // just that transaction. They still run as a pipelined batch on the same
  // connection rather than three truly parallel connections — a fine trade
  // for a report path that's cached for two minutes after the first hit.
  const client = await pool.connect();
  let studentsRes, keysRes, responsesRes;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '2min'");
    [studentsRes, keysRes, responsesRes] = await Promise.all([
      client.query(studentsQuery, scopeParams),
      client.query(keysQuery, [sessionId, scholarshipId, classStr]),
      client.query(responsesQuery, scopeParams),
    ]);
    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }

  // Build valid question set (examType+qNum must exist in an answer key)
  const validQSet = new Set();
  const answerKeyMap = {}; // `${examType}-${qNum}` -> correctAnswer
  keysRes.rows.forEach(k => {
    const key = `${k.exam_type}-${k.question_number}`;
    answerKeyMap[key] = String(k.correct_answer || '').trim().toUpperCase();
    validQSet.add(key);
  });

  // Build responses map: roll -> { `${examType}-${qNum}` -> markedAnswer }
  const responsesByRoll = {};
  responsesRes.rows.forEach(r => {
    if (!responsesByRoll[r.roll_number]) responsesByRoll[r.roll_number] = {};
    responsesByRoll[r.roll_number][`${r.exam_type}-${r.question_number}`] = String(r.marked_answer || '').trim().toUpperCase();
  });

  const normalizeGender = (raw) => {
    const u = String(raw || '').trim().toUpperCase();
    if (['1', 'MALE', 'M'].includes(u)) return 'Male';
    if (['2', 'FEMALE', 'F'].includes(u)) return 'Female';
    return 'Other';
  };
  const normalizeCategory = (raw) => {
    const u = String(raw || '').trim().toUpperCase();
    if (['GEN', 'GENERAL'].includes(u)) return 'GEN';
    if (['OBC', 'SC', 'ST', 'EWS'].includes(u)) return u;
    return 'Other';
  };

  // Accumulator for this one scope: demographicKey -> label -> { correct, total, students }
  const accum = { gender: {}, category: {}, school_type: {}, school_location: {} };
  const addTo = (dKey, label, correct, total) => {
    if (!accum[dKey][label]) accum[dKey][label] = { correct: 0, total: 0, students: 0 };
    accum[dKey][label].correct += correct;
    accum[dKey][label].total += total;
    accum[dKey][label].students++;
  };

  studentsRes.rows.forEach(student => {
    const roll = student.roll_number;
    const gender = normalizeGender(student.gender);
    const category = normalizeCategory(student.category);
    const schoolType = student.school_type || 'Other';
    const location = student.school_location || 'Unknown';

    const resMap = responsesByRoll[roll] || {};

    // Compute consolidated correct/total across ALL valid questions for this student
    let correct = 0, total = 0;
    validQSet.forEach(key => {
      const correctAns = answerKeyMap[key];
      if (!correctAns) return;
      total++;
      if (resMap[key] && resMap[key] === correctAns) correct++;
    });

    addTo('gender', gender, correct, total);
    addTo('category', category, correct, total);
    addTo('school_type', schoolType, correct, total);
    addTo('school_location', location, correct, total);
  });

  const GENDER_ORDER = ['Male', 'Female', 'Other'];
  const CATEGORY_ORDER = ['GEN', 'OBC', 'SC', 'ST', 'EWS', 'Other'];
  const SCHOOL_TYPE_ORDER = ['GIC', 'GHS', 'GUPS', 'Govt Aided', 'Local Body', 'Dept of Edu', 'Other'];
  const LOCATION_ORDER = ['Rural', 'Urban', 'Unknown'];

  const toArray = (map, order) => {
    // Ensure all expected labels exist
    const allLabels = Array.from(new Set([...order, ...Object.keys(map || {})]));
    return allLabels.map(label => {
      const d = map?.[label] || { correct: 0, total: 0, students: 0 };
      const cp = d.total > 0 ? Number(((d.correct / d.total) * 100).toFixed(1)) : 0;
      return { name: label, correctPercent: cp, incorrectPercent: Number((100 - cp).toFixed(1)), totalStudents: d.students };
    });
  };

  return {
    gender_analysis:          toArray(accum.gender, GENDER_ORDER),
    category_analysis:        toArray(accum.category, CATEGORY_ORDER),
    school_type_analysis:     toArray(accum.school_type, SCHOOL_TYPE_ORDER),
    school_location_analysis: toArray(accum.school_location, LOCATION_ORDER),
  };
}


exports.getSummaryReportData = async ({ sessionId, scholarshipId }) => {
  // result_block_summary is the district/block-wise sheet the agency
  // uploads directly (present/absent/selected, selected already split by
  // category) — authoritative for these figures, so this reads it as-is
  // rather than re-deriving the same numbers by joining
  // scholarship_applications -> attendance -> result_students (which this
  // function used to do, and which drifts from the agency's own count
  // whenever the derivation's assumptions don't match theirs).
  //
  // No class filter: there is one combined block-summary upload, not a
  // separate one per class, so this sums across whatever class rows exist
  // for a (district, block) rather than splitting the report by class.
  // No district/block filter either — the report shows the whole state.
  const result = await pool.query(
    `SELECT district_name, block_name,
            SUM(registered)::int AS registered,
            SUM(absent)::int AS absent,
            SUM(present)::int AS present,
            SUM(selected)::int AS selected,
            SUM(selected_gen)::int AS selected_gen,
            SUM(selected_obc)::int AS selected_obc,
            SUM(selected_sc)::int AS selected_sc,
            SUM(selected_st)::int AS selected_st,
            SUM(selected_ews)::int AS selected_ews
       FROM scert_db.result_block_summary
      WHERE session_id = $1 AND scholarship_id = $2
      GROUP BY district_name, block_name`,
    [sessionId, scholarshipId]
  );

  const districtsMap = {};
  const blocksByKey = {};
  const grand_totals = {
    present_students: 0,
    absent_students: 0,
    total_selected: 0,
    gen_selected: 0,
    obc_selected: 0,
    sc_selected: 0,
    st_selected: 0,
    ews_selected: 0,
  };
  const keysToSum = ['present_students', 'absent_students', 'total_selected', 'gen_selected', 'obc_selected', 'sc_selected', 'st_selected', 'ews_selected'];

  // Canonicalize casing so "Hardwar"/"HARDWAR"/"Haridwar" and any
  // block-name casing/spelling variant collapse into one row instead of
  // splitting the sheet's own totals across duplicate district/block
  // buckets — the same bug class fixed earlier in Selection Summary and
  // Top Rankers. Keyed by the canonical (district, block) pair rather than
  // pushed blindly, since the GROUP BY above only merges exact-text
  // duplicates — two different raw spellings of the same block still
  // arrive as separate SQL rows and must be summed together here.
  for (const row of result.rows) {
    const distKey = normalizeLookupName(row.district_name) === "HARIDWAR" ? "HARDWAR" : normalizeLookupName(row.district_name);
    const canonicalDistrict = getCanonicalDistricts().find((d) => d.normalized === distKey);
    const districtName = canonicalDistrict?.name || row.district_name || 'Unknown';
    const canonicalBlock = canonicalDistrict
      ? getCanonicalBlocksForDistrict(canonicalDistrict.name).find((b) => b.normalized === normalizeLookupName(row.block_name))
      : null;
    const blockName = canonicalBlock?.name || row.block_name || 'Unknown';

    if (!districtsMap[districtName]) {
      districtsMap[districtName] = {
        district_name: districtName,
        rows: [],
        totals: {
          present_students: 0,
          absent_students: 0,
          total_selected: 0,
          gen_selected: 0,
          obc_selected: 0,
          sc_selected: 0,
          st_selected: 0,
          ews_selected: 0,
        },
      };
    }

    const blockKey = `${districtName}||${blockName}`;
    if (!blocksByKey[blockKey]) {
      blocksByKey[blockKey] = {
        district_name: districtName,
        block_name: blockName,
        present_students: 0,
        absent_students: 0,
        total_selected: 0,
        gen_selected: 0,
        obc_selected: 0,
        sc_selected: 0,
        st_selected: 0,
        ews_selected: 0,
      };
      districtsMap[districtName].rows.push(blocksByKey[blockKey]);
    }
    const blockRow = blocksByKey[blockKey];

    const increments = {
      present_students: row.present || 0,
      absent_students: row.absent || 0,
      total_selected: row.selected || 0,
      gen_selected: row.selected_gen || 0,
      obc_selected: row.selected_obc || 0,
      sc_selected: row.selected_sc || 0,
      st_selected: row.selected_st || 0,
      ews_selected: row.selected_ews || 0,
    };
    for (const k of keysToSum) {
      blockRow[k] += increments[k];
      districtsMap[districtName].totals[k] += increments[k];
      grand_totals[k] += increments[k];
    }
  }

  // Sort districts in canonical 1-13 order, blocks in canonical order
  // within each district (falls back to alphabetical for anything not in
  // the master data rather than dropping it).
  const districtOrder = new Map(getCanonicalDistricts().map((d, i) => [d.normalized, i]));
  const districts = Object.values(districtsMap).sort((a, b) => {
    const da = districtOrder.get(normalizeLookupName(a.district_name)) ?? Number.MAX_SAFE_INTEGER;
    const db = districtOrder.get(normalizeLookupName(b.district_name)) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.district_name.localeCompare(b.district_name);
  });
  for (const d of districts) {
    const blockOrder = new Map(getCanonicalBlocksForDistrict(d.district_name).map((b, i) => [b.normalized, i]));
    d.rows.sort((a, b) => {
      const ba = blockOrder.get(normalizeLookupName(a.block_name)) ?? Number.MAX_SAFE_INTEGER;
      const bb = blockOrder.get(normalizeLookupName(b.block_name)) ?? Number.MAX_SAFE_INTEGER;
      if (ba !== bb) return ba - bb;
      return a.block_name.localeCompare(b.block_name);
    });
  }

  return { districts, grand_totals };
};

exports.getSelectionSummary = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
}) => {
  const selectedFilter = buildResultStudentFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    alias: "rs",
  });

  const schoolStrengthFilter = buildSchoolStrengthFilterClause({
    classValue,
    filters,
    aliasStrength: "sss",
    aliasSchool: "sp",
  });

  const applicationFilter = buildApplicationScopeFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    aliasApp: "sa",
    aliasStudent: "st",
    aliasStudentSchool: "sp_student",
    aliasCreatorSchool: "sp_creator",
    aliasCategory: "caste_info",
  });

  const normalizedGender = String(filters.gender || "").trim().toUpperCase();
  const schoolStrengthCountSql =
    normalizedGender === "MALE"
      ? "COALESCE(SUM(sss.boys_count), 0)::int"
      : normalizedGender === "FEMALE"
        ? "COALESCE(SUM(sss.girls_count), 0)::int"
        : "COALESCE(SUM(sss.boys_count + sss.girls_count), 0)::int";

  const [
    selectedRes,
    scholarshipRegisteredRes,
    appearedRes,
    totalRegisteredRes,
  ] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::int AS selected
      FROM scert_db.result_students rs
      WHERE ${selectedFilter.whereClause}
        AND rs.is_selected = true
      `,
      selectedFilter.values
    ),
    pool.query(
      `
      SELECT COUNT(*)::int AS scholarship_registered
      FROM scert_db.scholarship_applications sa
      LEFT JOIN scert_db.student_profiles st
        ON st.user_id = sa.student_user_id
      LEFT JOIN scert_db.school_profiles sp_student
        ON sp_student.udise_code = st.udise_code
      LEFT JOIN scert_db.school_profiles sp_creator
        ON sp_creator.user_id = sa.created_by_school_user_id
      LEFT JOIN LATERAL (
        SELECT UPPER(TRIM(COALESCE(aa.value_text, aa.value_number::text, ''))) AS category
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff
          ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND LOWER(TRIM(ff.field_key)) IN ('caste_category', 'caste')
        ORDER BY ff.sort_order ASC, ff.field_id ASC
        LIMIT 1
      ) caste_info ON true
      WHERE ${applicationFilter.whereClause}
      `,
      applicationFilter.values
    ),
    pool.query(
      `
      WITH app_base AS (
        SELECT
          sa.application_id,
          sa.center_id,
          sa.session_id,
          sa.scholarship_id
        FROM scert_db.scholarship_applications sa
        LEFT JOIN scert_db.student_profiles st
          ON st.user_id = sa.student_user_id
        LEFT JOIN scert_db.school_profiles sp_student
          ON sp_student.udise_code = st.udise_code
        LEFT JOIN scert_db.school_profiles sp_creator
          ON sp_creator.user_id = sa.created_by_school_user_id
        LEFT JOIN LATERAL (
          SELECT UPPER(TRIM(COALESCE(aa.value_text, aa.value_number::text, ''))) AS category
          FROM scert_db.scholarship_application_answers aa
          JOIN scert_db.scholarship_form_fields ff
            ON ff.field_id = aa.field_id
          WHERE aa.application_id = sa.application_id
            AND LOWER(TRIM(ff.field_key)) IN ('caste_category', 'caste')
          ORDER BY ff.sort_order ASC, ff.field_id ASC
          LIMIT 1
        ) caste_info ON true
        WHERE ${applicationFilter.whereClause}
      ),
      appeared_by_center AS (
        SELECT
          ab.center_id,
          COALESCE(SUM(CASE WHEN att.mat_status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS mat_present,
          COALESCE(SUM(CASE WHEN att.sat_status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS sat_present
        FROM app_base ab
        LEFT JOIN scert_db.center_exam_attendance_reports ar
          ON ar.session_id = ab.session_id
         AND ar.scholarship_id = ab.scholarship_id
         AND ar.center_id = ab.center_id
        LEFT JOIN scert_db.center_exam_student_attendance att
          ON att.report_id = ar.report_id
         AND att.application_id = ab.application_id
        WHERE ab.center_id IS NOT NULL
        GROUP BY ab.center_id
      )
      SELECT COALESCE(SUM(GREATEST(abc.mat_present, abc.sat_present)), 0)::int AS appeared
      FROM appeared_by_center abc
      `,
      applicationFilter.values
    ),
    pool.query(
      `
      SELECT ${schoolStrengthCountSql} AS total_registered_students
      FROM scert_db.school_student_strength sss
      JOIN scert_db.school_profiles sp
        ON sp.user_id = sss.school_user_id
      WHERE ${schoolStrengthFilter.whereClause}
      `,
      schoolStrengthFilter.values
    ),
  ]);

  return {
    total_registered_students: totalRegisteredRes.rows[0]?.total_registered_students || 0,
    scholarship_registered: scholarshipRegisteredRes.rows[0]?.scholarship_registered || 0,
    registered: scholarshipRegisteredRes.rows[0]?.scholarship_registered || 0,
    appeared: appearedRes.rows[0]?.appeared || 0,
    selected: selectedRes.rows[0]?.selected || 0,
  };
};

exports.getLatestUploadView = async ({
  sessionId,
  scholarshipId,
  classValue,
}) => {
  const { districtExpr, blockExpr, schoolExpr } =
    buildResolvedResultLocationExpressions({
      aliasResult: "rs",
      aliasStudentSchool: "sp_student",
      aliasCreatorSchool: "sp_creator",
    });

  const uploadRes = await pool.query(
    `
    SELECT
      upload_id,
      file_name,
      total_records,
      matched_records,
      unmatched_records,
      uploaded_by
    FROM scert_db.result_uploads
    WHERE session_id = $1
      AND scholarship_id = $2
      AND "class" = $3
    ORDER BY upload_id DESC
    LIMIT 1
    `,
    [sessionId, scholarshipId, classValue]
  );

  const upload = uploadRes.rows[0] || null;
  if (!upload) {
    return {
      upload: null,
      rows: [],
      unmatched_rows: [],
    };
  }

  const [rowsRes, unmatchedRes] = await Promise.all([
    pool.query(
      `
      SELECT
        rs.upload_id,
        rs.roll_number,
        rs.student_name,
        rs.father_name,
        rs.mother_name,
        rs.dob,
        rs.gender,
        rs.category,
        ${districtExpr} AS district_name,
        ${blockExpr} AS block_code,
        ${schoolExpr} AS school_name,
        rs.center_name,
        rs.mat_marks,
        rs.sat_marks,
        rs.total_marks,
        rs.is_selected,
        rs.is_absent,
        rs.is_matched,
        rs.application_id,
        rs.student_user_id
      FROM scert_db.result_students
      rs
      LEFT JOIN scert_db.scholarship_applications sa
        ON sa.application_id = rs.application_id
      LEFT JOIN scert_db.student_profiles st
        ON st.user_id = COALESCE(rs.student_user_id, sa.student_user_id)
      LEFT JOIN scert_db.school_profiles sp_student
        ON sp_student.udise_code = st.udise_code
      LEFT JOIN scert_db.school_profiles sp_creator
        ON sp_creator.user_id = sa.created_by_school_user_id
      WHERE rs.upload_id = $1
      ORDER BY
        NULLIF(REGEXP_REPLACE(COALESCE(rs.roll_number::text, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
        rs.roll_number::text ASC,
        rs.student_name ASC NULLS LAST
      `,
      [upload.upload_id]
    ),
    pool.query(
      `
      SELECT
        upload_id,
        roll_number,
        student_name,
        reason
      FROM scert_db.result_unmatched_logs
      WHERE upload_id = $1
      ORDER BY
        NULLIF(REGEXP_REPLACE(COALESCE(roll_number::text, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
        roll_number::text ASC,
        student_name ASC NULLS LAST
      `,
      [upload.upload_id]
    ),
  ]);

  return {
    upload,
    rows: rowsRes.rows,
    unmatched_rows: unmatchedRes.rows,
  };
};

exports.getAnalytics = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
}) => {
  const filter = buildResultStudentFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    alias: "rs",
  });

  const [categoryRes, genderRes, districtRes] = await Promise.all([
    pool.query(
      `
      SELECT rs.category, COUNT(*)::int AS count
      FROM scert_db.result_students rs
      WHERE ${filter.whereClause}
      GROUP BY rs.category
      ORDER BY rs.category ASC NULLS LAST
      `,
      filter.values
    ),
    pool.query(
      `
      SELECT rs.gender, COUNT(*)::int AS count
      FROM scert_db.result_students rs
      WHERE ${filter.whereClause}
      GROUP BY rs.gender
      ORDER BY rs.gender ASC NULLS LAST
      `,
      filter.values
    ),
    pool.query(
      `
      SELECT rs.district_name, COUNT(*)::int AS count
      FROM scert_db.result_students rs
      WHERE ${filter.whereClause}
      GROUP BY rs.district_name
      ORDER BY rs.district_name ASC NULLS LAST
      `,
      filter.values
    ),
  ]);

  return {
    category_distribution: categoryRes.rows,
    gender_distribution: genderRes.rows,
    district_wise_selected: districtRes.rows,
  };
};

exports.getTopRankers = async ({
  sessionId = null,
  scholarshipId = null,
  classValue = null,
  filters = {},
  page = 1,
  limit = 25,
}) => {
  const cacheKey = analyticsCacheKey("result_top_rankers", { sessionId, scholarshipId, classValue, filters, extra: `${page}:${limit}` });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const { districtExpr, blockExpr, schoolExpr } =
    buildResolvedResultLocationExpressions({
      aliasResult: "rs",
      aliasStudentSchool: "sp_student",
      aliasCreatorSchool: "sp_creator",
    });

  const filter = buildOptionalResultStudentFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    alias: "rs",
    districtExpr,
    blockExpr,
    schoolExpr,
    onlySelected: true,
  });

  const offset = (page - 1) * limit;

  const [totalRes, dataRes] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM scert_db.result_students rs
      WHERE ${filter.whereClause}
      `,
      filter.values
    ),
    pool.query(
      `
      WITH ranked AS (
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(rs.total_marks, 0) DESC,
              COALESCE(rs.mat_marks, 0) DESC,
              rs.roll_number::text ASC
          )::int AS rank,
          rs.roll_number,
          rs.student_name,
          ${districtExpr} AS district_name,
          ${blockExpr} AS block_code,
          ${schoolExpr} AS school_name,
          rs.total_marks,
          rs.mat_marks,
          rs.sat_marks,
          rs.gender,
          rs.category
        FROM scert_db.result_students rs
        LEFT JOIN scert_db.scholarship_applications sa
          ON sa.application_id = rs.application_id
        LEFT JOIN scert_db.student_profiles st
          ON st.user_id = COALESCE(rs.student_user_id, sa.student_user_id)
        LEFT JOIN scert_db.school_profiles sp_student
          ON sp_student.udise_code = st.udise_code
        LEFT JOIN scert_db.school_profiles sp_creator
          ON sp_creator.user_id = sa.created_by_school_user_id
        WHERE ${filter.whereClause}
      )
      SELECT *
      FROM ranked
      ORDER BY rank ASC
      LIMIT $${filter.values.length + 1}
      OFFSET $${filter.values.length + 2}
      `,
      [...filter.values, limit, offset]
    ),
  ]);

  const result = {
    total: totalRes.rows[0]?.total || 0,
    page,
    limit,
    data: dataRes.rows,
  };
  await writeAnalyticsCache(cacheKey, result);
  return result;
};

/**
 * Top Districts/Blocks/Schools used to run their own independent queries —
 * "selected" grouped by the resolved district/block/school expression,
 * "registered" grouped by a differently-COALESCEd raw expression (still
 * with the old per-row LATERAL join for caste, unused here since the
 * result is never selected, only sometimes referenced in the WHERE) — and
 * stitched the two together by exact string match on the display name.
 * That match was the bug: result_students stores names upper-case (from
 * the sheet) while school_profiles stores them proper-case, so a school's
 * unmatched students (falling back to the sheet's casing) silently landed
 * in a second, invisible bucket instead of being added to the real one —
 * confirmed against real data as a ~1-16 student undercount per district.
 * All three now read from the same resolveSelectionCohortBundle the
 * Selection Summary hierarchy table uses, grouped by normalizeLookupName,
 * so the numbers here are guaranteed to match that table exactly.
 */
exports.getTopDistricts = async ({
  sessionId = null,
  scholarshipId = null,
  classValue = null,
  filters = {},
}) => {
  const cacheKey = analyticsCacheKey("result_top_districts", { sessionId, scholarshipId, classValue, filters });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const bundle = await resolveSelectionCohortBundle({ sessionId, scholarshipId, classValue, filters });
  const canonicalNameByKey = new Map(getCanonicalDistricts().map((d) => [d.normalized, d.name]));

  const registeredByKey = new Map();
  for (const app of bundle.applications) {
    const key = normalizeLookupName(app.district_name);
    if (key) registeredByKey.set(key, (registeredByKey.get(key) || 0) + 1);
  }

  const selectedByKey = new Map();
  for (const row of bundle.selectedRows) {
    const key = normalizeLookupName(row.district_name);
    if (key) selectedByKey.set(key, (selectedByKey.get(key) || 0) + 1);
  }

  const result = [...selectedByKey.entries()]
    .map(([key, selected_students]) => ({
      district_name: canonicalNameByKey.get(key) || key,
      selected_students,
      scholarship_registered: registeredByKey.get(key) || 0,
    }))
    .sort((a, b) => b.selected_students - a.selected_students || a.district_name.localeCompare(b.district_name))
    .slice(0, 5)
    .map((row, index) => ({ rank: index + 1, ...row }));

  await writeAnalyticsCache(cacheKey, result);
  return result;
};

exports.getTopBlocks = async ({
  sessionId = null,
  scholarshipId = null,
  classValue = null,
  filters = {},
}) => {
  const cacheKey = analyticsCacheKey("result_top_blocks", { sessionId, scholarshipId, classValue, filters });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const bundle = await resolveSelectionCohortBundle({ sessionId, scholarshipId, classValue, filters });
  // Blocks are grouped by code (state-wide unique, e.g. "34"), not name —
  // codes don't carry the district-style casing mismatch, but a row with
  // no code at all still needs a key, so fall back to the normalized name.
  const keyOf = (row) => String(row.block_code || "").trim() || normalizeLookupName(row.block_name);

  const registeredByKey = new Map();
  for (const app of bundle.applications) {
    const key = keyOf(app);
    if (key) registeredByKey.set(key, (registeredByKey.get(key) || 0) + 1);
  }

  const selectedByKey = new Map();
  for (const row of bundle.selectedRows) {
    const key = keyOf(row);
    if (key) selectedByKey.set(key, (selectedByKey.get(key) || 0) + 1);
  }

  const result = [...selectedByKey.entries()]
    .map(([key, selected_students]) => {
      const canonical = getCanonicalBlockByCode(key);
      return {
        block_code: key,
        block_name: canonical?.name || null,
        district_name: canonical?.districtName || null,
        selected_students,
        scholarship_registered: registeredByKey.get(key) || 0,
      };
    })
    .sort((a, b) => b.selected_students - a.selected_students || a.block_code.localeCompare(b.block_code))
    .slice(0, 15)
    .map((row, index) => ({ rank: index + 1, ...row }));

  await writeAnalyticsCache(cacheKey, result);
  return result;
};

exports.getTopSchools = async ({
  sessionId = null,
  scholarshipId = null,
  classValue = null,
  filters = {},
}) => {
  const cacheKey = analyticsCacheKey("result_top_schools", { sessionId, scholarshipId, classValue, filters });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const bundle = await resolveSelectionCohortBundle({ sessionId, scholarshipId, classValue, filters });

  // No master list for individual schools, so keep whichever spelling looks
  // proper-case (school_profiles) over an all-caps one (the raw sheet).
  const displayNameByKey = new Map();
  const rememberDisplay = (raw) => {
    const key = normalizeLookupName(raw);
    if (!key) return;
    const existing = displayNameByKey.get(key);
    if (!existing || (existing === existing.toUpperCase() && raw !== raw.toUpperCase())) {
      displayNameByKey.set(key, raw);
    }
  };

  const registeredByKey = new Map();
  for (const app of bundle.applications) {
    rememberDisplay(app.school_name);
    const key = normalizeLookupName(app.school_name);
    if (key) registeredByKey.set(key, (registeredByKey.get(key) || 0) + 1);
  }

  const selectedByKey = new Map();
  for (const row of bundle.selectedRows) {
    rememberDisplay(row.school_name);
    const key = normalizeLookupName(row.school_name);
    if (key) selectedByKey.set(key, (selectedByKey.get(key) || 0) + 1);
  }

  const result = [...selectedByKey.entries()]
    .map(([key, selected_students]) => ({
      school_name: displayNameByKey.get(key) || key,
      selected_students,
      scholarship_registered: registeredByKey.get(key) || 0,
    }))
    .sort((a, b) => b.selected_students - a.selected_students || a.school_name.localeCompare(b.school_name))
    .slice(0, 25)
    .map((row, index) => ({ rank: index + 1, ...row }));

  await writeAnalyticsCache(cacheKey, result);
  return result;
};

// ---------------------------------------------------------------------
// School participation — a school "participated" if it has at least one
// student in the uploaded exam roster (result_students), regardless of
// whether that student matched an application, was selected, or attended.
// The old code required a join to center_exam_student_attendance, which is
// completely empty (a different, unrelated BEO workflow) — every
// participation number was silently zero. It also disagreed with
// getRemainingSchools, which separately defined "remaining" as "no
// scholarship_applications row" — a third, different criterion for the
// complementary case. All three now share one source of truth below.
// ---------------------------------------------------------------------

function isSchoolGic(s) { return /HSec/i.test(s.school_category || ""); }
function isSchoolGhs(s) { return /Sec/i.test(s.school_category || "") && !isSchoolGic(s); }
function isSchoolGups(s) { return /UPS/i.test(s.school_category || "") && !isSchoolGic(s) && !isSchoolGhs(s); }
function isSchoolAided(s) { return /Aided/i.test(s.school_category || "") || /Aided/i.test(s.school_type || ""); }
function isSchoolLocalBody(s) { return /Local/i.test(s.school_category || "") || /Local/i.test(s.school_type || ""); }
function isSchoolDeptEdu(s) { return /Dept/i.test(s.school_category || "") || /Dept/i.test(s.school_type || ""); }
function isSchoolRural(s) { return /Rural/i.test(s.school_location || ""); }
function isSchoolUrban(s) { return /Urban/i.test(s.school_location || ""); }
function classifySchoolShort(s) {
  if (isSchoolGic(s)) return "GIC";
  if (isSchoolGhs(s)) return "GHS";
  if (isSchoolGups(s)) return "GUPS";
  return "OTHER";
}

function buildSchoolProfileFilterClause({ filters = {}, alias = "sp" }) {
  const clauses = [];
  const values = [];

  if (filters.district) {
    let distVal = normalizeLookupName(filters.district);
    if (distVal === "HARIDWAR" || distVal === "HARDWAR") distVal = "HARDWAR";
    values.push(distVal);
    clauses.push(
      `(CASE WHEN UPPER(TRIM(${alias}.district_name)) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(${alias}.district_name)) END) = $${values.length}`
    );
  }
  if (filters.block) {
    values.push(filters.block);
    clauses.push(`(${alias}.block_name = $${values.length} OR ${alias}.block_code = $${values.length})`);
  }
  if (filters.school) {
    values.push(filters.school);
    clauses.push(`${alias}.school_name = $${values.length}`);
  }
  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`${alias}.school_type = $${values.length}`);
  }
  if (filters.school_category) {
    values.push(filters.school_category);
    clauses.push(`${alias}.school_category = $${values.length}`);
  }
  if (filters.area_type) {
    values.push(filters.area_type);
    clauses.push(`${alias}.school_location = $${values.length}`);
  }

  return { whereClause: clauses.length ? clauses.join(" AND ") : "1=1", values };
}

/**
 * Every school in scope (location/classification-filtered), each flagged
 * `participated` if it has at least one student who attended MAT or SAT
 * (result_students.is_absent = false), matched via roll number: the
 * student's application (rs.application_id) tells us its
 * created_by_school_user_id, which is the definitive school — not a text
 * match on the sheet's own SCHNAME column. A student whose roll number
 * never matched an application cannot be attributed to a school this way
 * and does not count toward any school's participation.
 *
 * Location/classification filters (district/block/school/type/category/
 * area) apply only to which schools are candidates, via school_profiles —
 * the authoritative source — not to the uploaded sheet's own location
 * text. Only gender/category narrow which student rows count as attended.
 */
async function resolveSchoolParticipationBundle({ sessionId, scholarshipId, classValue, filters = {} }) {
  const attendanceFilters = { category: filters.category, gender: filters.gender };
  const resultFilter = buildOptionalResultStudentFilterClause({
    sessionId, scholarshipId, classValue, filters: attendanceFilters, alias: "rs",
  });
  const schoolFilter = buildSchoolProfileFilterClause({ filters });

  const [rosterRes, schoolsRes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT sp.user_id
         FROM scert_db.result_students rs
         JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
         JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
        WHERE ${resultFilter.whereClause}
          AND rs.is_absent = false`,
      resultFilter.values
    ),
    pool.query(
      `SELECT sp.user_id, sp.school_name, sp.district_name, sp.block_name, sp.block_code,
              sp.school_category, sp.school_type, sp.school_location
         FROM scert_db.school_profiles sp
        WHERE ${schoolFilter.whereClause}`,
      schoolFilter.values
    ),
  ]);

  const participatedIds = new Set(rosterRes.rows.map((r) => r.user_id));

  return schoolsRes.rows.map((sp) => ({
    ...sp,
    participated: participatedIds.has(sp.user_id),
  }));
}

exports.getSchoolParticipationSummary = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
}) => {
  const cacheKey = analyticsCacheKey("result_school_participation_summary", { sessionId, scholarshipId, classValue, filters });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const schools = await resolveSchoolParticipationBundle({ sessionId, scholarshipId, classValue, filters });

  const bucket = (matcher) => {
    const matched = schools.filter(matcher);
    return { total: matched.length, participated: matched.filter((s) => s.participated).length };
  };

  const gic = bucket(isSchoolGic);
  const ghs = bucket(isSchoolGhs);
  const gups = bucket(isSchoolGups);
  const aided = bucket(isSchoolAided);
  const local = bucket(isSchoolLocalBody);
  const dept = bucket(isSchoolDeptEdu);
  const rural = bucket(isSchoolRural);
  const urban = bucket(isSchoolUrban);

  const totalSchools = schools.length;
  const totalSchoolsParticipated = schools.filter((s) => s.participated).length;

  const result = {
    totalSchools,
    totalSchoolsParticipated,
    remainingSchools: Math.max(0, totalSchools - totalSchoolsParticipated),

    totalGic: gic.total, gicParticipated: gic.participated,
    totalGhs: ghs.total, ghsParticipated: ghs.participated,
    totalGups: gups.total, gupsParticipated: gups.participated,
    totalGovtAided: aided.total, govtAidedParticipated: aided.participated,
    totalLocalBody: local.total, localBodyParticipated: local.participated,
    totalDeptEdu: dept.total, deptEduParticipated: dept.participated,
    totalRural: rural.total, ruralParticipated: rural.participated,
    totalUrban: urban.total, urbanParticipated: urban.participated,
  };

  await writeAnalyticsCache(cacheKey, result);
  return result;
};

exports.getSchoolParticipationHierarchy = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
}) => {
  const level = (filters.district && filters.district.trim() !== '') ? 'block' : 'district';
  const cacheKey = analyticsCacheKey("result_school_participation_hierarchy", { sessionId, scholarshipId, classValue, filters, extra: level });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const schools = await resolveSchoolParticipationBundle({ sessionId, scholarshipId, classValue, filters });

  const groupKey = level === 'district'
    ? (s) => normalizeLookupName(s.district_name)
    : (s) => String(s.block_code || "").trim();

  const groups = new Map();
  for (const s of schools) {
    const key = groupKey(s);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const entries = level === 'district'
    ? getCanonicalDistricts().map((d) => ({ name: d.name, key: d.normalized }))
    : getCanonicalBlocksForDistrict(filters.district).map((b) => ({ name: b.name, key: b.code }));

  const rows = entries.map(({ name, key }) => {
    const groupSchools = groups.get(key) || [];
    const bucket = (matcher) => {
      const matched = groupSchools.filter(matcher);
      return { total: matched.length, participated: matched.filter((s) => s.participated).length };
    };

    const gic = bucket(isSchoolGic);
    const ghs = bucket(isSchoolGhs);
    const gups = bucket(isSchoolGups);
    const aided = bucket(isSchoolAided);
    const local = bucket(isSchoolLocalBody);
    const dept = bucket(isSchoolDeptEdu);
    const rural = bucket(isSchoolRural);
    const urban = bucket(isSchoolUrban);

    const totalSchools = groupSchools.length;
    const totalSchoolsParticipated = groupSchools.filter((s) => s.participated).length;

    return {
      name,
      totalSchools,
      totalSchoolsParticipated,
      remainingSchools: Math.max(0, totalSchools - totalSchoolsParticipated),

      totalGic: gic.total, gicParticipated: gic.participated,
      totalGhs: ghs.total, ghsParticipated: ghs.participated,
      totalGups: gups.total, gupsParticipated: gups.participated,
      totalGovtAided: aided.total, govtAidedParticipated: aided.participated,
      totalLocalBody: local.total, localBodyParticipated: local.participated,
      totalDeptEdu: dept.total, deptEduParticipated: dept.participated,
      totalRural: rural.total, ruralParticipated: rural.participated,
      totalUrban: urban.total, urbanParticipated: urban.participated,
    };
  });

  await writeAnalyticsCache(cacheKey, rows);
  return rows;
};

exports.getRemainingSchools = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
  page = 1,
  limit = 25,
}) => {
  const cacheKey = analyticsCacheKey("result_remaining_schools", { sessionId, scholarshipId, classValue, filters, extra: `${page}:${limit}` });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const schools = await resolveSchoolParticipationBundle({ sessionId, scholarshipId, classValue, filters });

  const remaining = schools
    .filter((s) => !s.participated)
    .map((s) => ({
      school_name: s.school_name,
      district_name: s.district_name,
      block_name: s.block_name,
      school_classification: classifySchoolShort(s),
      school_type: s.school_type,
      school_location: s.school_location,
    }))
    .sort((a, b) =>
      (a.district_name || "").localeCompare(b.district_name || "") ||
      (a.school_name || "").localeCompare(b.school_name || "")
    );

  const total = remaining.length;
  const start = (page - 1) * limit;
  const result = { total, data: remaining.slice(start, start + limit) };

  await writeAnalyticsCache(cacheKey, result);
  return result;
};

exports.getSchoolParticipation = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
  page = 1,
  limit = 25,
}) => {
  const filter = buildSchoolParticipationFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    aliasResult: "rs",
    aliasApplication: "sa",
    aliasSchool: "sp",
  });
  const offset = (page - 1) * limit;

  const [totalRes, dataRes] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT sp.user_id
        FROM scert_db.result_students rs
        JOIN scert_db.scholarship_applications sa
          ON sa.application_id = rs.application_id
        JOIN scert_db.school_profiles sp
          ON sp.user_id = sa.created_by_school_user_id
        WHERE ${filter.whereClause}
        GROUP BY sp.user_id
      ) grouped_schools
      `,
      filter.values
    ),
    pool.query(
      `
      SELECT
        sp.school_name,
        sp.district_name,
        sp.block_name,
        sp.school_type,
        sp.school_category,
        COUNT(*)::int AS selected_students
      FROM scert_db.result_students rs
      JOIN scert_db.scholarship_applications sa
        ON sa.application_id = rs.application_id
      JOIN scert_db.school_profiles sp
        ON sp.user_id = sa.created_by_school_user_id
      WHERE ${filter.whereClause}
      GROUP BY
        sp.user_id,
        sp.school_name,
        sp.district_name,
        sp.block_name,
        sp.school_type,
        sp.school_category
      ORDER BY selected_students DESC, sp.school_name ASC
      LIMIT $${filter.values.length + 1}
      OFFSET $${filter.values.length + 2}
      `,
      [...filter.values, limit, offset]
    ),
  ]);

  return {
    total: totalRes.rows[0]?.total || 0,
    page,
    limit,
    data: dataRes.rows,
  };
};

/**
 * Names + display order for a hierarchy level. District and block use the
 * canonical district-block.master.json (same source scert.centersSummary
 * uses), so "district order 1, 2, 3..." here always matches the district
 * numbering used everywhere else in the app — a district/block with zero
 * students still appears, with zeros, rather than silently disappearing.
 * School has no equivalent master list, so it falls back to whichever
 * schools actually appear in the current scope, alphabetically.
 */
async function resolveHierarchyLevelEntries({ level, filters, bundle }) {
  if (level === "district") {
    return getCanonicalDistricts().map((d) => ({ name: d.name, key: d.normalized }));
  }

  if (level === "block") {
    return getCanonicalBlocksForDistrict(filters.district).map((b) => ({ name: b.name, key: b.normalized }));
  }

  // School level: no master list, so pull every school name touched by any
  // part of the cohort, matching the same location filters already applied
  // to that cohort.
  const names = new Set();
  for (const row of bundle.applications) if (row.school_name) names.add(row.school_name);
  for (const row of bundle.strengthRows) if (row.school_name) names.add(row.school_name);
  for (const row of bundle.appearedRows) if (row.school_name) names.add(row.school_name);
  for (const row of bundle.selectedRows) if (row.school_name) names.add(row.school_name);

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, key: normalizeLookupName(name) }));
}

exports.getHierarchySummary = async ({
  sessionId,
  scholarshipId,
  classValue,
  level,
  filters = {},
}) => {
  const cacheKey = analyticsCacheKey("result_hierarchy", { sessionId, scholarshipId, classValue, filters, extra: level });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const bundle = await resolveSelectionCohortBundle({ sessionId, scholarshipId, classValue, filters });
  const dimension = level === "district" ? "district_name" : level === "block" ? "block_name" : "school_name";

  const registeredInClassByKey = new Map();
  for (const row of bundle.strengthRows) {
    const key = normalizeLookupName(row[dimension]);
    if (!key) continue;
    const count = bundle.genderFilter === "MALE"
      ? Number(row.boys_count) || 0
      : bundle.genderFilter === "FEMALE"
        ? Number(row.girls_count) || 0
        : (Number(row.boys_count) || 0) + (Number(row.girls_count) || 0);
    registeredInClassByKey.set(key, (registeredInClassByKey.get(key) || 0) + count);
  }

  const registeredInScholarshipByKey = new Map();
  for (const app of bundle.applications) {
    const key = normalizeLookupName(app[dimension]);
    if (!key) continue;
    registeredInScholarshipByKey.set(key, (registeredInScholarshipByKey.get(key) || 0) + 1);
  }

  const appearedByKey = new Map();
  for (const row of bundle.appearedRows) {
    const key = normalizeLookupName(row[dimension]);
    if (!key) continue;
    appearedByKey.set(key, (appearedByKey.get(key) || 0) + 1);
  }

  const selectedByKey = new Map();
  for (const row of bundle.selectedRows) {
    const key = normalizeLookupName(row[dimension]);
    if (!key) continue;
    selectedByKey.set(key, (selectedByKey.get(key) || 0) + 1);
  }

  const entries = await resolveHierarchyLevelEntries({ level, filters, bundle });

  const rows = entries.map(({ name, key }) => ({
    name,
    registered_in_class: registeredInClassByKey.get(key) || 0,
    registered_in_scholarship: registeredInScholarshipByKey.get(key) || 0,
    appeared_in_scholarship: appearedByKey.get(key) || 0,
    selected_in_scholarship: selectedByKey.get(key) || 0,
  }));

  const total = rows.reduce(
    (acc, row) => {
      acc.registered_in_class += row.registered_in_class;
      acc.registered_in_scholarship += row.registered_in_scholarship;
      acc.appeared_in_scholarship += row.appeared_in_scholarship;
      acc.selected_in_scholarship += row.selected_in_scholarship;
      return acc;
    },
    {
      name: "TOTAL",
      registered_in_class: 0,
      registered_in_scholarship: 0,
      appeared_in_scholarship: 0,
      selected_in_scholarship: 0,
    }
  );

  const result = { rows, total };
  await writeAnalyticsCache(cacheKey, result);
  return result;
};

exports.getCharts = async ({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
  types = [],
}) => {
  const requestedTypes = Array.isArray(types) ? types : [];
  const cacheKey = analyticsCacheKey("result_charts", {
    sessionId, scholarshipId, classValue, filters,
    extra: [...requestedTypes].sort().join(","),
  });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const resultFilter = buildOptionalResultStudentFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    alias: "rs",
    districtExpr: `CASE WHEN UPPER(COALESCE(NULLIF(TRIM(sp_student.district_name), ''), NULLIF(TRIM(sp_creator.district_name), ''), NULLIF(TRIM(rs.district_name), ''))) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE COALESCE(NULLIF(TRIM(sp_student.district_name), ''), NULLIF(TRIM(sp_creator.district_name), ''), NULLIF(TRIM(rs.district_name), '')) END`,
    blockExpr: `COALESCE(NULLIF(TRIM(sp_student.block_name), ''), NULLIF(TRIM(sp_creator.block_name), ''), NULLIF(TRIM(sp_student.block_code), ''), NULLIF(TRIM(sp_creator.block_code), ''), NULLIF(TRIM(rs.block_code), ''))`,
    schoolExpr: `COALESCE(NULLIF(TRIM(sp_student.school_name), ''), NULLIF(TRIM(sp_creator.school_name), ''), NULLIF(TRIM(rs.school_name), ''))`,
    categoryExpr: `UPPER(TRIM(COALESCE(rs.category, '')))`,
    genderExpr: `UPPER(TRIM(COALESCE(rs.gender, '')))`,
  });

  const normalizeGenderSql = (...cols) => {
    const coalesceStr = `COALESCE(${cols.map(c => `${c}::text`).join(', ')}, '')`;
    return `CASE 
      WHEN UPPER(TRIM(${coalesceStr})) IN ('1', 'MALE', 'M') THEN 'Male' 
      WHEN UPPER(TRIM(${coalesceStr})) IN ('2', 'FEMALE', 'F') THEN 'Female' 
      ELSE NULL 
    END`;
  };
  const applicationFilter = buildApplicationScopeFilterClause({
    sessionId,
    scholarshipId,
    classValue,
    filters,
    aliasApp: "sa",
    aliasStudent: "st",
    aliasStudentSchool: "sp_student",
    aliasCreatorSchool: "sp_creator",
    aliasCategory: "caste_info",
  });
  const chartTasks = {};

  const registeredClassFilter = buildSchoolStrengthFilterClause({
    classValue,
    filters,
    aliasStrength: "sss",
    aliasSchool: "sp",
  });

  // overall/gender/category funnel charts share the same underlying cohort
  // (approved applications + school strength + selected results); resolving
  // it once here and aggregating in JS replaces what used to be 3 separate
  // LATERAL-joined queries per chart type (see resolveSelectionCohortBundle
  // docblock — each of those took up to ~28s against real data).
  const needsCohortBundle = ["overall_analytics", "gender_analytics", "category_analytics", "districts", "blocks", "schools"]
    .some((t) => requestedTypes.includes(t));
  const cohortBundlePromise = needsCohortBundle
    ? resolveSelectionCohortBundle({ sessionId, scholarshipId, classValue, filters })
    : null;

  if (requestedTypes.includes("overall_analytics")) {
    chartTasks.overall_analytics = cohortBundlePromise.then((bundle) => ([
      {
        name: "Total",
        registered_in_class: sumStrength(bundle.strengthRows, bundle.genderFilter),
        registered_in_scholarship: bundle.applications.length,
        appeared: bundle.appearedRows.length,
        selected: bundle.selectedRows.length,
      },
    ]));
  }

  if (requestedTypes.includes("gender_analytics")) {
    chartTasks.gender_analytics = cohortBundlePromise.then((bundle) => {
      const genders = ["Male", "Female"];
      return genders.map((g) => {
        const genderKey = g.toUpperCase();
        return {
          name: g,
          registered_in_class: sumStrength(bundle.strengthRows, genderKey),
          registered_in_scholarship: bundle.applications.filter((a) => a.gender === g).length,
          // result_students.gender is stored upper-case ("MALE"/"FEMALE"),
          // unlike the resolved application cohort's "Male"/"Female".
          appeared: bundle.appearedRows.filter((r) => String(r.gender || "").toUpperCase() === genderKey).length,
          selected: bundle.selectedRows.filter((r) => String(r.gender || "").toUpperCase() === genderKey).length,
        };
      });
    });
  }

  if (requestedTypes.includes("category_analytics")) {
    chartTasks.category_analytics = cohortBundlePromise.then((bundle) => {
      const strengthByCategory = new Map();
      for (const row of bundle.strengthRows) {
        const key = String(row.category || "").toUpperCase();
        strengthByCategory.set(key, (strengthByCategory.get(key) || 0) + (Number(row.boys_count) || 0) + (Number(row.girls_count) || 0));
      }

      const categories = ["GEN", "OBC", "SC", "ST"];
      return categories.map((c) => ({
        name: c,
        registered_in_class: strengthByCategory.get(c) || 0,
        registered_in_scholarship: bundle.applications.filter((a) => a.category === c).length,
        appeared: bundle.appearedRows.filter((r) => String(r.category || "").toUpperCase() === c).length,
        selected: bundle.selectedRows.filter((r) => String(r.category || "").toUpperCase() === c).length,
      }));
    });
  }

  // ---- marks_distribution: total_marks buckets for selected students ----
  if (requestedTypes.includes("marks_distribution")) {
    chartTasks.marks_distribution = pool.query(
      `SELECT
        CASE
          WHEN rs.total_marks::numeric < 20  THEN '0–19'
          WHEN rs.total_marks::numeric < 40  THEN '20–39'
          WHEN rs.total_marks::numeric < 60  THEN '40–59'
          WHEN rs.total_marks::numeric < 80  THEN '60–79'
          WHEN rs.total_marks::numeric < 100 THEN '80–99'
          WHEN rs.total_marks::numeric < 120 THEN '100–119'
          WHEN rs.total_marks::numeric < 140 THEN '120–139'
          WHEN rs.total_marks::numeric < 160 THEN '140–159'
          ELSE '160+'
        END AS range,
        COUNT(*)::int AS count,
        CASE
          WHEN rs.total_marks::numeric < 20  THEN 0
          WHEN rs.total_marks::numeric < 40  THEN 1
          WHEN rs.total_marks::numeric < 60  THEN 2
          WHEN rs.total_marks::numeric < 80  THEN 3
          WHEN rs.total_marks::numeric < 100 THEN 4
          WHEN rs.total_marks::numeric < 120 THEN 5
          WHEN rs.total_marks::numeric < 140 THEN 6
          WHEN rs.total_marks::numeric < 160 THEN 7
          ELSE 8
        END AS sort_order
      FROM scert_db.result_students rs
      LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
      LEFT JOIN scert_db.student_profiles st ON st.user_id = sa.student_user_id
      LEFT JOIN scert_db.school_profiles sp_student ON sp_student.udise_code = st.udise_code
      LEFT JOIN scert_db.school_profiles sp_creator ON sp_creator.user_id = sa.created_by_school_user_id
      WHERE ${resultFilter.whereClause} AND rs.is_selected = true AND rs.total_marks IS NOT NULL
      GROUP BY range, sort_order ORDER BY sort_order`,
      resultFilter.values
    ).then(r => r.rows);
  }

  // ---- districts: top districts by selected students ----
  // districts/blocks/schools charts used to group by a raw
  // COALESCE(sp_student.X, sp_creator.X, rs.X) expression with no case
  // normalization — a matched student's proper-case "Hardwar" (from
  // school_profiles) and an unmatched student's upper-case "HARDWAR"
  // (falling back to the uploaded sheet's own spelling) landed in two
  // separate GROUP BY buckets instead of one, undercounting the real one
  // and showing a second near-empty bar for the split-off remainder. Same
  // bug as getTopDistricts/Blocks/Schools, fixed the same way: read from
  // the bundle, group by the normalized key.
  if (requestedTypes.includes("districts")) {
    chartTasks.districts = cohortBundlePromise.then((bundle) => {
      const canonicalNameByKey = new Map(getCanonicalDistricts().map((d) => [d.normalized, d.name]));
      const countByKey = new Map();
      for (const row of bundle.selectedRows) {
        const key = normalizeLookupName(row.district_name);
        if (key) countByKey.set(key, (countByKey.get(key) || 0) + 1);
      }
      return [...countByKey.entries()]
        .map(([key, selected_students]) => ({ district_name: canonicalNameByKey.get(key) || key, selected_students }))
        .sort((a, b) => b.selected_students - a.selected_students)
        .slice(0, 20);
    });
  }

  if (requestedTypes.includes("blocks")) {
    chartTasks.blocks = cohortBundlePromise.then((bundle) => {
      const countByKey = new Map();
      for (const row of bundle.selectedRows) {
        const key = String(row.block_code || "").trim() || normalizeLookupName(row.block_name);
        if (key) countByKey.set(key, (countByKey.get(key) || 0) + 1);
      }
      return [...countByKey.entries()]
        .map(([key, selected_students]) => {
          const canonical = getCanonicalBlockByCode(key);
          return { block_code: key, block_name: canonical?.name || null, selected_students };
        })
        .sort((a, b) => b.selected_students - a.selected_students)
        .slice(0, 20);
    });
  }

  if (requestedTypes.includes("schools")) {
    chartTasks.schools = cohortBundlePromise.then((bundle) => {
      const displayNameByKey = new Map();
      const countByKey = new Map();
      for (const row of bundle.selectedRows) {
        const key = normalizeLookupName(row.school_name);
        if (!key) continue;
        countByKey.set(key, (countByKey.get(key) || 0) + 1);
        const existing = displayNameByKey.get(key);
        if (!existing || (existing === existing.toUpperCase() && row.school_name !== row.school_name.toUpperCase())) {
          displayNameByKey.set(key, row.school_name);
        }
      }
      return [...countByKey.entries()]
        .map(([key, selected_students]) => ({ school_name: displayNameByKey.get(key) || key, selected_students }))
        .sort((a, b) => b.selected_students - a.selected_students)
        .slice(0, 20);
    });
  }

  // ---- gender_rank_distribution: marks buckets split by gender ----
  if (requestedTypes.includes("gender_rank_distribution")) {
    // rs.gender is already the resolved value from the uploaded sheet
    // (populated once at upload time) — re-deriving it per row from the
    // dynamic application-answers table via a correlated subquery was both
    // redundant and the same expensive per-row pattern fixed elsewhere.
    const genderExpr = `CASE
      WHEN UPPER(TRIM(COALESCE(rs.gender::text, ''))) IN ('1','MALE','M') THEN 'Male'
      WHEN UPPER(TRIM(COALESCE(rs.gender::text, ''))) IN ('2','FEMALE','F') THEN 'Female'
      ELSE NULL END`;
    const rangeExpr = `CASE
      WHEN rs.total_marks::numeric < 40  THEN '0–39'
      WHEN rs.total_marks::numeric < 80  THEN '40–79'
      WHEN rs.total_marks::numeric < 120 THEN '80–119'
      WHEN rs.total_marks::numeric < 160 THEN '120–159'
      ELSE '160+' END`;
    const sortExpr = `CASE
      WHEN rs.total_marks::numeric < 40  THEN 0
      WHEN rs.total_marks::numeric < 80  THEN 1
      WHEN rs.total_marks::numeric < 120 THEN 2
      WHEN rs.total_marks::numeric < 160 THEN 3
      ELSE 4 END`;
    chartTasks.gender_rank_distribution = pool.query(
      `SELECT
          ${rangeExpr} AS range,
          ${genderExpr} AS gender,
          ${sortExpr}   AS sort_order,
          COUNT(*)::int AS count
        FROM scert_db.result_students rs
        WHERE ${resultFilter.whereClause} AND rs.is_selected = true AND rs.total_marks IS NOT NULL
        GROUP BY ${rangeExpr}, ${genderExpr}, ${sortExpr}
        ORDER BY sort_order`,
      resultFilter.values
    ).then(r => r.rows);
  }

  const chartEntries = await Promise.all(

    Object.entries(chartTasks).map(async ([key, task]) => [key, await task])
  );

  const result = {
    charts: Object.fromEntries(chartEntries),
  };
  await writeAnalyticsCache(cacheKey, result);
  return result;
};

exports.uploadAnswerKey = async ({
  sessionId,
  scholarshipId,
  classValue,
  originalFileName,
  rows
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const paperCodes = Array.from(new Set(rows.map(r => r.paperCode)));
    if (paperCodes.length === 0) {
      throw new Error("No valid paper codes found");
    }

    const batchRes = await client.query(
      `INSERT INTO scert_db.result_upload_batches 
       (session_id, scholarship_id, class, upload_type, original_file_name, total_rows, created_at) 
       VALUES ($1, $2, $3, 'ANSWER_KEY', $4, $5, NOW()) 
       RETURNING upload_batch_id`,
      [sessionId, scholarshipId, classValue, originalFileName || 'unknown.xlsx', rows.length]
    );
    const uploadBatchId = batchRes.rows[0].upload_batch_id;

    await client.query(
      `DELETE FROM scert_db.result_answer_keys
       WHERE session_id = $1 AND scholarship_id = $2 AND class = $3 AND paper_code = ANY($4)`,
      [sessionId, scholarshipId, classValue, paperCodes]
    );

    let valuesClause = [];
    let queryParams = [];
    let paramIndex = 1;

    for (const row of rows) {
      const examType = String(row.paperCode || '').toUpperCase().startsWith('MAT') ? 'MAT' : 'SAT';
      for (const [qCol, ans] of Object.entries(row.questions)) {
        const qNumMatch = qCol.match(/^Q(\d+)$/);
        if (qNumMatch) {
          const qNum = parseInt(qNumMatch[1], 10);
          valuesClause.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
          queryParams.push(uploadBatchId, sessionId, scholarshipId, classValue, row.paperCode, examType, qNum, ans);
        }
      }
    }

    if (valuesClause.length > 0) {
      const CHUNK_SIZE = 1000;
      for (let i = 0; i < valuesClause.length; i += CHUNK_SIZE) {
        const chunkValuesClause = valuesClause.slice(i, i + CHUNK_SIZE);
        const chunkQueryParams = queryParams.slice(i * 8, (i + CHUNK_SIZE) * 8);
        let chunkIdx = 1;
        const reIndexedClause = chunkValuesClause.map(() => `($${chunkIdx++}, $${chunkIdx++}, $${chunkIdx++}, $${chunkIdx++}, $${chunkIdx++}, $${chunkIdx++}, $${chunkIdx++}, $${chunkIdx++})`).join(", ");
        
        await client.query(
          `INSERT INTO scert_db.result_answer_keys (upload_batch_id, session_id, scholarship_id, class, paper_code, exam_type, question_number, correct_answer)
           VALUES ${reIndexedClause}`,
          chunkQueryParams
        );
      }
    }

    await client.query("COMMIT");

    return {
      success: true,
      upload_batch_id: uploadBatchId,
      inserted_questions: valuesClause.length,
      papers_processed: paperCodes.length
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

exports.uploadStudentResponses = async ({
  sessionId,
  scholarshipId,
  classValue,
  originalFileName,
  rows
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const paperCodes = Array.from(new Set(rows.map(r => r.paperCode)));
    const keysRes = await client.query(
      `SELECT paper_code, question_number, correct_answer 
       FROM scert_db.result_answer_keys
       WHERE session_id = $1 AND scholarship_id = $2 AND class = $3 AND paper_code = ANY($4)`,
      [sessionId, scholarshipId, classValue, paperCodes]
    );

    const answerKeyMap = new Map();
    for (const keyRow of keysRes.rows) {
      answerKeyMap.set(`${keyRow.paper_code}_${keyRow.question_number}`, keyRow.correct_answer);
    }

    const rollNumbers = Array.from(new Set(rows.map(r => r.rollNumber)));
    const appsRes = await client.query(
      `SELECT application_id, student_user_id, roll_number 
       FROM scert_db.scholarship_applications
       WHERE session_id = $1 AND scholarship_id = $2 AND class = $3 AND roll_number = ANY($4)`,
      [sessionId, scholarshipId, classValue, rollNumbers]
    );

    const appMap = new Map();
    for (const app of appsRes.rows) {
      appMap.set(app.roll_number, app);
    }

    let matchedStudents = 0;
    let unmatchedStudents = 0;
    let missingAnswerKeys = 0;
    let validationFailures = 0;

    let responseValues = [];
    const examScoreUpdates = new Map(); 

    for (const row of rows) {
      const app = appMap.get(row.rollNumber);
      if (!app) {
        unmatchedStudents++;
        continue;
      }
      matchedStudents++;

      let computedCorrect = 0;
      let computedWrong = 0;
      let computedBlank = 0;
      let hasMissingKeyForPaper = false;

      const examType = String(row.paperCode || '').toUpperCase().startsWith('MAT') ? 'MAT' : 'SAT';

      for (const [qCol, markedAns] of Object.entries(row.questions)) {
        const qNumMatch = qCol.match(/^Q(\d+)$/);
        if (qNumMatch) {
          const qNum = parseInt(qNumMatch[1], 10);
          const correctAns = answerKeyMap.get(`${row.paperCode}_${qNum}`);
          
          if (correctAns === undefined) {
            hasMissingKeyForPaper = true;
          }

          const normalizedAnswer = (markedAns === '*' || markedAns === '' || markedAns == null) 
            ? null 
            : String(markedAns).trim().toUpperCase();

          let isCorrect = false;
          if (normalizedAnswer === null) {
            computedBlank++;
            isCorrect = false;
          } else if (correctAns && normalizedAnswer === correctAns.trim().toUpperCase()) {
            computedCorrect++;
            isCorrect = true;
          } else {
            computedWrong++;
            isCorrect = false;
          }

          responseValues.push({
            sessionId,
            scholarshipId,
            classValue,
            rollNumber: row.rollNumber,
            applicationId: app.application_id,
            studentUserId: app.student_user_id,
            paperCode: row.paperCode,
            examType,
            qNum,
            markedAns: normalizedAnswer,
            isCorrect,
            totRight: row.totRight,
            totWrong: row.totWrong,
            totBlank: row.totBlank,
            totMarks: row.totMarks
          });
        }
      }

      if (hasMissingKeyForPaper) {
        missingAnswerKeys++;
      }

      const scoreValidated = computedCorrect === row.totRight;
      if (!scoreValidated) {
        validationFailures++;
      }

      for (const rv of responseValues.filter(rv => rv.rollNumber === row.rollNumber && rv.paperCode === row.paperCode)) {
        rv.scoreValidated = scoreValidated;
      }

      if (!examScoreUpdates.has(row.rollNumber)) {
        examScoreUpdates.set(row.rollNumber, {
          rollNumber: row.rollNumber,
          applicationId: app.application_id,
          studentUserId: app.student_user_id,
          matPaperCode: null,
          matScore: null,
          matCorrect: null,
          matWrong: null,
          matBlank: null,
          satPaperCode: null,
          satScore: null,
          satCorrect: null,
          satWrong: null,
          satBlank: null,
        });
      }

      const scoreData = examScoreUpdates.get(row.rollNumber);
      if (examType === 'MAT') {
        scoreData.matPaperCode = row.paperCode;
        scoreData.matScore = row.totMarks;
        scoreData.matCorrect = row.totRight;
        scoreData.matWrong = row.totWrong;
        scoreData.matBlank = row.totBlank;
      } else if (examType === 'SAT') {
        scoreData.satPaperCode = row.paperCode;
        scoreData.satScore = row.totMarks;
        scoreData.satCorrect = row.totRight;
        scoreData.satWrong = row.totWrong;
        scoreData.satBlank = row.totBlank;
      }
    }

    const batchRes = await client.query(
      `INSERT INTO scert_db.result_upload_batches 
       (session_id, scholarship_id, class, upload_type, original_file_name, total_rows, matched_rows, unmatched_rows, validation_failures, created_at) 
       VALUES ($1, $2, $3, 'STUDENT_RESPONSES', $4, $5, $6, $7, $8, NOW()) 
       RETURNING upload_batch_id`,
      [sessionId, scholarshipId, classValue, originalFileName || 'unknown.xlsx', rows.length, matchedStudents, unmatchedStudents, validationFailures]
    );
    const uploadBatchId = batchRes.rows[0].upload_batch_id;

    if (matchedStudents > 0) {
      await client.query(
        `DELETE FROM scert_db.result_student_responses
         WHERE session_id = $1 AND scholarship_id = $2 AND class = $3 AND roll_number = ANY($4) AND paper_code = ANY($5)`,
        [sessionId, scholarshipId, classValue, Array.from(examScoreUpdates.keys()), paperCodes]
      );

      if (responseValues.length > 0) {
        const CHUNK_SIZE = 1000; 
        for (let i = 0; i < responseValues.length; i += CHUNK_SIZE) {
          const chunk = responseValues.slice(i, i + CHUNK_SIZE);
          let chunkVals = [];
          let chunkParams = [];
          let pIdx = 1;

          for (const rv of chunk) {
            chunkVals.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
            chunkParams.push(uploadBatchId, rv.sessionId, rv.scholarshipId, rv.classValue, rv.rollNumber, rv.applicationId, rv.studentUserId, rv.paperCode, rv.examType, rv.qNum, rv.markedAns, rv.isCorrect, rv.totRight, rv.totWrong, rv.totBlank, rv.totMarks, rv.scoreValidated);
          }

          await client.query(
            `INSERT INTO scert_db.result_student_responses 
             (upload_batch_id, session_id, scholarship_id, class, roll_number, application_id, student_user_id, paper_code, exam_type, question_number, marked_answer, is_correct, total_correct, total_wrong, total_blank, raw_total_marks, score_validated)
             VALUES ${chunkVals.join(", ")}`,
            chunkParams
          );
        }
      }

      const scoresArray = Array.from(examScoreUpdates.values());
      if (scoresArray.length > 0) {
        const CHUNK_SIZE = 2000;
        for (let i = 0; i < scoresArray.length; i += CHUNK_SIZE) {
          const chunk = scoresArray.slice(i, i + CHUNK_SIZE);
          let chunkVals = [];
          let chunkParams = [];
          let pIdx = 1;

          for (const s of chunk) {
            chunkVals.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
            chunkParams.push(
              sessionId, scholarshipId, classValue, s.rollNumber, s.applicationId, s.studentUserId,
              s.matPaperCode, s.matScore, s.matCorrect, s.matWrong, s.matBlank,
              s.satPaperCode, s.satScore, s.satCorrect, s.satWrong, s.satBlank
            );
          }

          await client.query(
            `INSERT INTO scert_db.result_exam_scores
             (session_id, scholarship_id, class, roll_number, application_id, student_user_id, 
              mat_paper_code, mat_score, mat_correct, mat_wrong, mat_blank, 
              sat_paper_code, sat_score, sat_correct, sat_wrong, sat_blank)
             VALUES ${chunkVals.join(", ")}
             ON CONFLICT (session_id, scholarship_id, class, roll_number) DO UPDATE SET
               mat_paper_code = COALESCE(EXCLUDED.mat_paper_code, scert_db.result_exam_scores.mat_paper_code),
               mat_score = COALESCE(EXCLUDED.mat_score, scert_db.result_exam_scores.mat_score),
               mat_correct = COALESCE(EXCLUDED.mat_correct, scert_db.result_exam_scores.mat_correct),
               mat_wrong = COALESCE(EXCLUDED.mat_wrong, scert_db.result_exam_scores.mat_wrong),
               mat_blank = COALESCE(EXCLUDED.mat_blank, scert_db.result_exam_scores.mat_blank),
               sat_paper_code = COALESCE(EXCLUDED.sat_paper_code, scert_db.result_exam_scores.sat_paper_code),
               sat_score = COALESCE(EXCLUDED.sat_score, scert_db.result_exam_scores.sat_score),
               sat_correct = COALESCE(EXCLUDED.sat_correct, scert_db.result_exam_scores.sat_correct),
               sat_wrong = COALESCE(EXCLUDED.sat_wrong, scert_db.result_exam_scores.sat_wrong),
               sat_blank = COALESCE(EXCLUDED.sat_blank, scert_db.result_exam_scores.sat_blank)`,
            chunkParams
          );
        }
      }
    }

    await client.query("COMMIT");

    return {
      upload_batch_id: uploadBatchId,
      uploaded_students: rows.length,
      matched_students: matchedStudents,
      unmatched_students: unmatchedStudents,
      missing_answer_keys: missingAnswerKeys,
      validation_failures: validationFailures
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ==========================================
// EXAM ANALYTICAL REPORT APIs
// ==========================================

function buildExamAnalyticsFilterClause({
  sessionId,
  scholarshipId,
  classValue,
  filters = {},
}) {
  const clauses = [];
  const values = [];

  if (sessionId !== null && sessionId !== undefined) {
    values.push(sessionId);
    clauses.push(`e.session_id = $${values.length}`);
  }
  if (scholarshipId !== null && scholarshipId !== undefined) {
    values.push(scholarshipId);
    clauses.push(`e.scholarship_id = $${values.length}`);
  }
  if (classValue !== null && classValue !== undefined) {
    values.push(classValue);
    clauses.push(`e."class" = $${values.length}`);
  }
  if (filters.district) {
    let distVal = normalizeLookupName(filters.district);
    if (distVal === "HARIDWAR") distVal = "HARDWAR";
    values.push(distVal);
    clauses.push(
      `(CASE WHEN UPPER(TRIM(COALESCE(sp.district_name, ''))) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(COALESCE(sp.district_name, ''))) END) = $${values.length}`
    );
  }
  if (filters.block) {
    values.push(filters.block);
    clauses.push(`sp.block_code = $${values.length}`);
  }
  if (filters.school) {
    values.push(filters.school);
    clauses.push(`sp.school_name = $${values.length}`);
  }
  if (filters.gender) {
    values.push(String(filters.gender).trim());
    clauses.push(`gender_info.normalized_gender = $${values.length}`);
  }
  if (filters.category) {
    values.push(normalizeCategoryFilterValue(filters.category));
    clauses.push(`rs.category = $${values.length}`);
  }
  if (filters.school_type) {
    values.push(filters.school_type);
    clauses.push(`stype.derived_school_type = $${values.length}`);
  }
  if (filters.school_location) {
    values.push(filters.school_location);
    clauses.push(`sp.school_location = $${values.length}`);
  }

  return {
    whereClause: clauses.length ? clauses.join(" AND ") : "1=1",
    values,
  };
}

// category/gender used to be re-derived per row via two LATERAL subqueries
// against scholarship_application_answers (the same pattern that cost
// Selection Summary ~28s before it was fixed). result_exam_scores and
// result_students are populated by the same upload pipeline and share a
// unique (session_id, scholarship_id, class, roll_number) key, and
// result_students.category/gender are already resolved at upload time —
// so a plain indexed join replaces both LATERAL joins outright.
const ANALYTICS_BASE_FROM_CLAUSE = `
  scert_db.result_exam_scores e
  JOIN scert_db.scholarship_applications sa ON sa.application_id = e.application_id
  LEFT JOIN scert_db.result_students rs
    ON rs.session_id = e.session_id AND rs.scholarship_id = e.scholarship_id
   AND rs."class" = e."class" AND rs.roll_number = e.roll_number
  LEFT JOIN scert_db.student_profiles st ON st.user_id = e.student_user_id
  LEFT JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
  LEFT JOIN LATERAL (
    SELECT CASE
      WHEN rs.gender = 'MALE' THEN 'Male'
      WHEN rs.gender = 'FEMALE' THEN 'Female'
      ELSE NULL
    END AS normalized_gender
  ) gender_info ON true
  LEFT JOIN LATERAL (
    SELECT CASE
        WHEN LOWER(TRIM(COALESCE(sp.school_type, ''))) IN ('aided', 'govt aided', 'govt. aided', 'govt add.', 'high school aided') THEN 'Govt Aided'
        WHEN LOWER(TRIM(COALESCE(sp.school_type, ''))) IN ('local body') THEN 'Local Body'
        ELSE 'Dept of Edu'
    END AS derived_school_type
  ) stype ON true
`;

exports.getExamAnalyticsSummary = async ({ sessionId, scholarshipId, classValue, filters = {} }) => {
  const filter = buildExamAnalyticsFilterClause({ sessionId, scholarshipId, classValue, filters });

  const result = await pool.query(`
    SELECT 
      COALESCE(AVG(e.mat_score), 0) AS avg_mat_score,
      COALESCE(MAX(e.mat_score), 0) AS highest_mat_score,
      COALESCE(AVG(e.sat_score), 0) AS avg_sat_score,
      COALESCE(MAX(e.sat_score), 0) AS highest_sat_score,
      COUNT(*) AS total_students
    FROM ${ANALYTICS_BASE_FROM_CLAUSE}
    WHERE ${filter.whereClause}
  `, filter.values);

  return result.rows[0];
};

exports.getExamAnalyticsCharts = async ({ sessionId, scholarshipId, classValue, filters = {}, groupBy }) => {
  const filter = buildExamAnalyticsFilterClause({ sessionId, scholarshipId, classValue, filters });

  let groupExpr = '';
  if (groupBy === 'gender') groupExpr = "gender_info.normalized_gender";
  else if (groupBy === 'category') groupExpr = "COALESCE(NULLIF(rs.category, ''), 'Not Specified')";
  else if (groupBy === 'school_type') groupExpr = "stype.derived_school_type";
  else if (groupBy === 'school_location') groupExpr = "COALESCE(NULLIF(sp.school_location, ''), 'Not Specified')";
  else throw new Error("Invalid group_by parameter");

  const result = await pool.query(`
    SELECT 
      ${groupExpr} AS label,
      COALESCE(AVG(e.mat_score), 0) AS avg_mat_score,
      COALESCE(MAX(e.mat_score), 0) AS highest_mat_score,
      COALESCE(AVG(e.sat_score), 0) AS avg_sat_score,
      COALESCE(MAX(e.sat_score), 0) AS highest_sat_score,
      COUNT(*) AS total_students
    FROM ${ANALYTICS_BASE_FROM_CLAUSE}
    WHERE ${filter.whereClause}
    GROUP BY ${groupExpr}
    ORDER BY total_students DESC
  `, filter.values);

  return result.rows;
};

exports.getExamAnalyticsTable = async ({ sessionId, scholarshipId, classValue, filters = {}, level }) => {
  const filter = buildExamAnalyticsFilterClause({ sessionId, scholarshipId, classValue, filters });

  let groupExpr = '';
  if (level === 'district') {
    // Normalize casing/Hardwar-Haridwar in SQL so casing variants merge
    // into one aggregate instead of splitting avg/max/count across
    // duplicate rows; mapped back to its canonical display name below.
    groupExpr = `CASE WHEN UPPER(TRIM(COALESCE(sp.district_name, ''))) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE NULLIF(UPPER(TRIM(sp.district_name)), '') END`;
  }
  else if (level === 'block') groupExpr = 'sp.block_code';
  else if (level === 'school') groupExpr = 'sp.school_name';
  else throw new Error("Invalid level parameter");

  const result = await pool.query(`
    SELECT
      COALESCE(${groupExpr}, 'Unknown') AS name,
      COALESCE(AVG(e.mat_score), 0) AS avg_mat_score,
      COALESCE(MAX(e.mat_score), 0) AS highest_mat_score,
      COALESCE(AVG(e.sat_score), 0) AS avg_sat_score,
      COALESCE(MAX(e.sat_score), 0) AS highest_sat_score,
      COUNT(*) AS total_students
    FROM ${ANALYTICS_BASE_FROM_CLAUSE}
    WHERE ${filter.whereClause}
    GROUP BY ${groupExpr}
    ORDER BY name ASC
  `, filter.values);

  if (level !== 'district') return result.rows;

  // Map the normalized SQL key to its canonical display name and order
  // districts 1-13, same master data every other report here orders by.
  const canonicalDistricts = getCanonicalDistricts();
  const districtOrder = new Map(canonicalDistricts.map((d, i) => [d.normalized, i]));
  return result.rows
    .map((row) => {
      const canonical = canonicalDistricts.find((d) => d.normalized === normalizeLookupName(row.name));
      return { ...row, name: canonical?.name || row.name };
    })
    .sort((a, b) => {
      const da = districtOrder.get(normalizeLookupName(a.name)) ?? Number.MAX_SAFE_INTEGER;
      const db = districtOrder.get(normalizeLookupName(b.name)) ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
};

exports.getExamAnalyticsFilters = async ({ sessionId, scholarshipId, classValue, filters = {} }) => {
  const filter = buildExamAnalyticsFilterClause({ sessionId, scholarshipId, classValue, filters });

  const [districts, blocks, schools, categories, schoolTypes, schoolLocations] = await Promise.all([
    pool.query(`SELECT DISTINCT sp.district_name AS value FROM ${ANALYTICS_BASE_FROM_CLAUSE} WHERE ${filter.whereClause} AND sp.district_name IS NOT NULL ORDER BY value`, filter.values),
    pool.query(`SELECT DISTINCT sp.block_code AS value FROM ${ANALYTICS_BASE_FROM_CLAUSE} WHERE ${filter.whereClause} AND sp.block_code IS NOT NULL ORDER BY value`, filter.values),
    pool.query(`SELECT DISTINCT sp.school_name AS value FROM ${ANALYTICS_BASE_FROM_CLAUSE} WHERE ${filter.whereClause} AND sp.school_name IS NOT NULL ORDER BY value`, filter.values),
    pool.query(`SELECT DISTINCT rs.category AS value FROM ${ANALYTICS_BASE_FROM_CLAUSE} WHERE ${filter.whereClause} AND rs.category IS NOT NULL AND rs.category != '' ORDER BY value`, filter.values),
    pool.query(`SELECT DISTINCT stype.derived_school_type AS value FROM ${ANALYTICS_BASE_FROM_CLAUSE} WHERE ${filter.whereClause} ORDER BY value`, filter.values),
    pool.query(`SELECT DISTINCT sp.school_location AS value FROM ${ANALYTICS_BASE_FROM_CLAUSE} WHERE ${filter.whereClause} AND sp.school_location IS NOT NULL AND sp.school_location != '' ORDER BY value`, filter.values),
  ]);

  // Dedupe/canonicalize the district dropdown too — otherwise "Hardwar"
  // and "HARDWAR" would show as two separate, individually-wrong filter
  // options instead of the one real district.
  const canonicalDistricts = getCanonicalDistricts();
  const districtOrder = new Map(canonicalDistricts.map((d, i) => [d.normalized, i]));
  const districtNames = [...new Set(
    districts.rows.map((r) => {
      const canonical = canonicalDistricts.find((d) => d.normalized === normalizeLookupName(r.value));
      return canonical?.name || r.value;
    })
  )].sort((a, b) => {
    const da = districtOrder.get(normalizeLookupName(a)) ?? Number.MAX_SAFE_INTEGER;
    const db = districtOrder.get(normalizeLookupName(b)) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });

  return {
    districts: districtNames,
    blocks: blocks.rows.map(r => r.value),
    schools: schools.rows.map(r => r.value),
    categories: categories.rows.map(r => r.value),
    school_types: schoolTypes.rows.map(r => r.value),
    school_locations: schoolLocations.rows.map(r => r.value),
  };
};

// ==========================================
// VERIFICATION APIs
// ==========================================

exports.getUploadBatches = async () => {
  const result = await pool.query(
    `SELECT upload_batch_id, upload_type, original_file_name, total_rows, matched_rows, unmatched_rows, validation_failures, created_at
     FROM scert_db.result_upload_batches
     ORDER BY created_at DESC
     LIMIT 100`
  );
  return result.rows;
};

exports.getAnswerKeys = async ({ sessionId, scholarshipId, classValue, uploadBatchId }) => {
  let query = `
    SELECT paper_code, exam_type, question_number, correct_answer
    FROM scert_db.result_answer_keys
    WHERE 1=1
  `;
  const params = [];
  let pIdx = 1;

  if (uploadBatchId) { query += ` AND upload_batch_id = $${pIdx++}`; params.push(uploadBatchId); }
  if (sessionId) { query += ` AND session_id = $${pIdx++}`; params.push(sessionId); }
  if (scholarshipId) { query += ` AND scholarship_id = $${pIdx++}`; params.push(scholarshipId); }
  if (classValue) { query += ` AND class = $${pIdx++}`; params.push(classValue); }

  query += ` ORDER BY paper_code ASC, question_number ASC LIMIT 1000`;

  const result = await pool.query(query, params);
  return result.rows;
};

exports.getStudentResponses = async ({ sessionId, scholarshipId, classValue, uploadBatchId, paperCode, rollNumber }) => {
  let query = `
    SELECT roll_number, paper_code, exam_type, question_number, marked_answer, is_correct, score_validated
    FROM scert_db.result_student_responses
    WHERE 1=1
  `;
  const params = [];
  let pIdx = 1;

  if (uploadBatchId) { query += ` AND upload_batch_id = $${pIdx++}`; params.push(uploadBatchId); }
  if (sessionId) { query += ` AND session_id = $${pIdx++}`; params.push(sessionId); }
  if (scholarshipId) { query += ` AND scholarship_id = $${pIdx++}`; params.push(scholarshipId); }
  if (classValue) { query += ` AND class = $${pIdx++}`; params.push(classValue); }
  if (paperCode) { query += ` AND paper_code = $${pIdx++}`; params.push(paperCode); }
  if (rollNumber) { query += ` AND roll_number = $${pIdx++}`; params.push(rollNumber); }

  query += ` ORDER BY roll_number ASC, paper_code ASC, question_number ASC LIMIT 5000`;

  const result = await pool.query(query, params);
  return result.rows;
};

exports.getGeneratedScores = async ({ sessionId, scholarshipId, classValue, uploadBatchId }) => {
  // If we want to filter generated scores by the upload batch, it's slightly complex because
  // result_exam_scores doesn't have an upload_batch_id.
  // The query params specify upload_batch_id could be passed.
  // We can join with result_student_responses to filter by batch if provided.
  
  let query = `
    SELECT DISTINCT e.roll_number, e.mat_score, e.sat_score, e.total_score, e.mat_correct, e.sat_correct
    FROM scert_db.result_exam_scores e
  `;
  
  if (uploadBatchId) {
    query += ` JOIN scert_db.result_student_responses r ON e.session_id = r.session_id AND e.scholarship_id = r.scholarship_id AND e.class = r.class AND e.roll_number = r.roll_number `;
  }

  query += ` WHERE 1=1 `;
  
  const params = [];
  let pIdx = 1;

  if (uploadBatchId) { query += ` AND r.upload_batch_id = $${pIdx++}`; params.push(uploadBatchId); }
  if (sessionId) { query += ` AND e.session_id = $${pIdx++}`; params.push(sessionId); }
  if (scholarshipId) { query += ` AND e.scholarship_id = $${pIdx++}`; params.push(scholarshipId); }
  if (classValue) { query += ` AND e.class = $${pIdx++}`; params.push(classValue); }

  query += ` ORDER BY e.total_score DESC NULLS LAST LIMIT 1000`;

  const result = await pool.query(query, params);
  return result.rows;
};

exports.getUploadErrors = async ({ sessionId, scholarshipId, classValue, uploadBatchId }) => {
  let query = `
    SELECT roll_number, paper_code, COUNT(*) as validation_failures
    FROM scert_db.result_student_responses
    WHERE score_validated = false
  `;
  
  const params = [];
  let pIdx = 1;

  if (uploadBatchId) { query += ` AND upload_batch_id = $${pIdx++}`; params.push(uploadBatchId); }
  if (sessionId) { query += ` AND session_id = $${pIdx++}`; params.push(sessionId); }
  if (scholarshipId) { query += ` AND scholarship_id = $${pIdx++}`; params.push(scholarshipId); }
  if (classValue) { query += ` AND class = $${pIdx++}`; params.push(classValue); }

  query += ` GROUP BY roll_number, paper_code ORDER BY roll_number ASC LIMIT 1000`;

  const result = await pool.query(query, params);
  
  // Note: we might want a more comprehensive error payload if necessary, 
  // but this fulfills the basic need to see which rolls failed validation in a batch.
  return {
    validation_failures: result.rows
  };
};

// ==========================================
// OVERALL PERFORMANCE REPORT — comparison helper
// ==========================================

// Weighted MAT/SAT average diff between a node and its parent scope
// (district vs state, block vs district) — replaces what used to be a
// method on ReportAggregator, which built the whole state+district+block
// tree in one pass. Each report request now computes at most two scopes
// (the node being viewed, and its parent for this comparison), so the
// class-based accumulator is gone; this is the one piece of it still needed.
function computePerformanceComparison(targetPerf, basePerf) {
  const getOverallAvg = (perfArr) => {
    let sumMat = 0, sumSat = 0, count = 0;
    for (const item of perfArr || []) {
      sumMat += item.avg_mat_score * item.total_students;
      sumSat += item.avg_sat_score * item.total_students;
      count += item.total_students;
    }
    return {
      avg_mat_score: count > 0 ? Number((sumMat / count).toFixed(2)) : 0,
      avg_sat_score: count > 0 ? Number((sumSat / count).toFixed(2)) : 0,
    };
  };

  const targetOverall = getOverallAvg(targetPerf?.gender);
  const baseOverall = getOverallAvg(basePerf?.gender);

  return {
    target_avg_mat_score: targetOverall.avg_mat_score,
    base_avg_mat_score: baseOverall.avg_mat_score,
    target_avg_sat_score: targetOverall.avg_sat_score,
    base_avg_sat_score: baseOverall.avg_sat_score,
    diff_mat: Number((targetOverall.avg_mat_score - baseOverall.avg_mat_score).toFixed(2)),
    diff_sat: Number((targetOverall.avg_sat_score - baseOverall.avg_sat_score).toFixed(2)),
  };
}


// ==========================================
// OVERALL PERFORMANCE REPORT
// ==========================================
//
// Computes exactly one node of the State -> District -> Block hierarchy
// (whichever the report page is currently showing), plus its immediate
// parent for the comparison card. Previously this ran nine queries grouped
// by every (district, block) pair in the state — computing and returning
// all ~99 pages on every single request, no matter which one page was
// being looked at. Scoping each query to the requested district/block via
// WHERE (indexed by idx_result_students_scope_location) means a district
// or block view now touches a slice of the data instead of the whole
// state, and a state-level view no longer needs GROUP BY at all.

const districtExprMatch = (expr) =>
  `(CASE WHEN UPPER(TRIM(COALESCE(${expr}, ''))) IN ('HARDWAR', 'HARIDWAR') THEN 'HARDWAR' ELSE UPPER(TRIM(COALESCE(${expr}, ''))) END)`;

function normalizeDistrictForMatch(raw) {
  const v = normalizeLookupName(raw);
  return v === "HARIDWAR" ? "HARDWAR" : v;
}

async function computePerfNode({ sessionId, scholarshipId, classStr, districtName = null, blockCode = null }) {
  const distVal = districtName ? normalizeDistrictForMatch(districtName) : null;

  // ---- 1. TOTAL REGISTERED (school_student_strength) ---------------
  const regParams = [classStr];
  let regScope = '';
  if (distVal) { regParams.push(distVal); regScope += ` AND ${districtExprMatch('sp.district_name')} = $${regParams.length}`; }
  if (blockCode) { regParams.push(blockCode); regScope += ` AND sp.block_code = $${regParams.length}`; }
  const qRegistered = `
    SELECT COALESCE(SUM(sss.boys_count + sss.girls_count), 0)::int AS registered_in_class
    FROM scert_db.school_student_strength sss
    JOIN scert_db.school_profiles sp ON sp.user_id = sss.school_user_id
    WHERE sss.class_level = $1${regScope}
  `;

  // ---- 2. REGISTERED IN SCHOLARSHIP --------------------------------
  const appParams = [sessionId, scholarshipId, classStr];
  let appScope = '';
  if (distVal) { appParams.push(distVal); appScope += ` AND ${districtExprMatch('COALESCE(sp_student.district_name, sp_creator.district_name)')} = $${appParams.length}`; }
  if (blockCode) { appParams.push(blockCode); appScope += ` AND COALESCE(sp_student.block_code, sp_creator.block_code) = $${appParams.length}`; }
  const qScholarshipReg = `
    SELECT COUNT(DISTINCT sa.application_id)::int AS registered_in_scholarship
    FROM scert_db.scholarship_applications sa
    LEFT JOIN scert_db.student_profiles st ON st.user_id = sa.student_user_id
    LEFT JOIN scert_db.school_profiles sp_student ON sp_student.udise_code = st.udise_code
    LEFT JOIN scert_db.school_profiles sp_creator ON sp_creator.user_id = sa.created_by_school_user_id
    WHERE sa.session_id = $1
      AND sa.scholarship_id = $2
      AND sa.status = 'APPROVED'
      AND COALESCE(NULLIF(TRIM(sa."class"::text), ''), CASE WHEN sa.scholarship_id = 6 THEN '8' ELSE NULL END) = $3${appScope}
  `;

  // ---- 3. APPEARED (attendance-based) ------------------------------
  const qAppeared = `
    WITH app_base AS (
      SELECT sa.application_id, sa.center_id, sa.session_id, sa.scholarship_id
      FROM scert_db.scholarship_applications sa
      LEFT JOIN scert_db.student_profiles st ON st.user_id = sa.student_user_id
      LEFT JOIN scert_db.school_profiles sp_student ON sp_student.udise_code = st.udise_code
      LEFT JOIN scert_db.school_profiles sp_creator ON sp_creator.user_id = sa.created_by_school_user_id
      WHERE sa.session_id = $1
        AND sa.scholarship_id = $2
        AND sa.status = 'APPROVED'
        AND COALESCE(NULLIF(TRIM(sa."class"::text), ''), CASE WHEN sa.scholarship_id = 6 THEN '8' ELSE NULL END) = $3${appScope}
    )
    SELECT COUNT(DISTINCT ab.application_id)::int AS appeared_students
    FROM app_base ab
    JOIN scert_db.center_exam_attendance_reports ar
      ON ar.session_id = ab.session_id AND ar.scholarship_id = ab.scholarship_id AND ar.center_id = ab.center_id
    JOIN scert_db.center_exam_student_attendance att
      ON att.report_id = ar.report_id AND att.application_id = ab.application_id
    WHERE att.mat_status = 'PRESENT' OR att.sat_status = 'PRESENT'
  `;

  // ---- 4. SELECTED (result_students) -------------------------------
  const selParams = [sessionId, scholarshipId, classStr];
  let selScope = '';
  if (distVal) { selParams.push(distVal); selScope += ` AND ${districtExprMatch('COALESCE(sp_student.district_name, sp_creator.district_name, rs.district_name)')} = $${selParams.length}`; }
  if (blockCode) { selParams.push(blockCode); selScope += ` AND COALESCE(sp_student.block_code, sp_creator.block_code, rs.block_code) = $${selParams.length}`; }
  const qSelected = `
    SELECT COUNT(DISTINCT rs.application_id)::int AS selected_students
    FROM scert_db.result_students rs
    JOIN scert_db.result_uploads ru ON ru.upload_id = rs.upload_id
    LEFT JOIN scert_db.scholarship_applications sa ON sa.application_id = rs.application_id
    LEFT JOIN scert_db.student_profiles st ON st.user_id = COALESCE(rs.student_user_id, sa.student_user_id)
    LEFT JOIN scert_db.school_profiles sp_student ON sp_student.udise_code = st.udise_code
    LEFT JOIN scert_db.school_profiles sp_creator ON sp_creator.user_id = sa.created_by_school_user_id
    WHERE ru.session_id = $1
      AND ru.scholarship_id = $2
      AND ru."class"::text = $3
      AND rs.is_selected = true${selScope}
  `;

  // ---- 5. SCHOOL PARTICIPATION (appeared-student based) -----------
  const schParams = [sessionId, scholarshipId, classStr];
  let schScope = '';
  if (distVal) { schParams.push(distVal); schScope += ` AND ${districtExprMatch('sp.district_name')} = $${schParams.length}`; }
  if (blockCode) { schParams.push(blockCode); schScope += ` AND sp.block_code = $${schParams.length}`; }
  const qSchool = `
    WITH appeared_apps AS (
      SELECT ab.application_id, ab.session_id, ab.scholarship_id, ab.center_id
      FROM (
        SELECT sa.application_id, sa.center_id, sa.session_id, sa.scholarship_id
        FROM scert_db.scholarship_applications sa
        WHERE sa.session_id = $1
          AND sa.scholarship_id = $2
          AND sa.status = 'APPROVED'
          AND COALESCE(NULLIF(TRIM(sa."class"::text), ''), CASE WHEN sa.scholarship_id = 6 THEN '8' ELSE NULL END) = $3
      ) ab
      JOIN scert_db.center_exam_attendance_reports ar
        ON ar.session_id = ab.session_id AND ar.scholarship_id = ab.scholarship_id AND ar.center_id = ab.center_id
      JOIN scert_db.center_exam_student_attendance att
        ON att.report_id = ar.report_id AND att.application_id = ab.application_id
      WHERE att.mat_status = 'PRESENT' OR att.sat_status = 'PRESENT'
    ),
    participated_schools AS (
      SELECT DISTINCT sp.udise_code, sp.school_category, sp.school_type, sp.school_location
      FROM appeared_apps aa
      JOIN scert_db.scholarship_applications sa ON sa.application_id = aa.application_id
      JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
      WHERE 1=1${schScope}
    )
    SELECT
      COUNT(DISTINCT udise_code)::int AS total_schools_participated,
      COUNT(DISTINCT CASE WHEN school_category ILIKE '%Hsec%' THEN udise_code END)::int AS gic_schools,
      COUNT(DISTINCT CASE WHEN school_category ILIKE '%Sec%' AND school_category NOT ILIKE '%Hsec%' THEN udise_code END)::int AS ghs_schools,
      COUNT(DISTINCT CASE WHEN school_category ILIKE '%UPS%' THEN udise_code END)::int AS gups_schools,
      COUNT(DISTINCT CASE WHEN school_category ILIKE '%Aided%' OR school_type ILIKE '%Aided%' THEN udise_code END)::int AS govt_aided,
      COUNT(DISTINCT CASE WHEN school_category ILIKE '%Local%' OR school_type ILIKE '%Local%' THEN udise_code END)::int AS local_body,
      COUNT(DISTINCT CASE WHEN school_category ILIKE '%Dept%' OR school_type ILIKE '%Dept%' THEN udise_code END)::int AS dept_of_edu,
      COUNT(DISTINCT CASE WHEN school_location ILIKE 'Rural' THEN udise_code END)::int AS rural,
      COUNT(DISTINCT CASE WHEN school_location ILIKE 'Urban' THEN udise_code END)::int AS urban
    FROM participated_schools
  `;

  // ---- 6-9. PERFORMANCE QUERIES (reuse the existing filter builder) ----
  const perfFilter = buildExamAnalyticsFilterClause({
    sessionId, scholarshipId, classValue: classStr,
    filters: { district: districtName || undefined, block: blockCode || undefined },
  });
  const buildPerfQuery = (groupExpr) => `
    SELECT
      ${groupExpr} AS label,
      COALESCE(AVG(e.mat_score), 0) AS avg_mat_score,
      COALESCE(MAX(e.mat_score), 0) AS highest_mat_score,
      COALESCE(AVG(e.sat_score), 0) AS avg_sat_score,
      COALESCE(MAX(e.sat_score), 0) AS highest_sat_score,
      COUNT(*)::int AS total_students
    FROM ${ANALYTICS_BASE_FROM_CLAUSE}
    WHERE ${perfFilter.whereClause}
    GROUP BY 1
  `;

  const [
    regRes, schRegRes, appearedRes, selectedRes, schoolRes,
    perfGenderRes, perfCategoryRes, perfTypeRes, perfLocRes,
  ] = await runWithConcurrencyLimit([
    () => pool.query(qRegistered, regParams),
    () => pool.query(qScholarshipReg, appParams),
    () => pool.query(qAppeared, appParams),
    () => pool.query(qSelected, selParams),
    () => pool.query(qSchool, schParams),
    () => pool.query(buildPerfQuery("gender_info.normalized_gender"), perfFilter.values),
    () => pool.query(buildPerfQuery("COALESCE(NULLIF(rs.category, ''), 'Not Specified')"), perfFilter.values),
    () => pool.query(buildPerfQuery("stype.derived_school_type"), perfFilter.values),
    () => pool.query(buildPerfQuery("COALESCE(NULLIF(sp.school_location, ''), 'Not Specified')"), perfFilter.values),
  ], 3);

  const registeredInClass = regRes.rows[0]?.registered_in_class || 0;
  const appearedStudents = appearedRes.rows[0]?.appeared_students || 0;
  const sp0 = schoolRes.rows[0] || {};

  const overview = {
    total_students: registeredInClass,
    total_schools: sp0.total_schools_participated || 0,
    evaluated_students: appearedStudents,
  };
  const participation = {
    total_registered_students: registeredInClass,
    registered_in_scholarship: schRegRes.rows[0]?.registered_in_scholarship || 0,
    appeared_students: appearedStudents,
    selected_students: selectedRes.rows[0]?.selected_students || 0,
  };
  const school_participation = {
    total_schools_participated: sp0.total_schools_participated || 0,
    gic_schools: sp0.gic_schools || 0,
    ghs_schools: sp0.ghs_schools || 0,
    gups_schools: sp0.gups_schools || 0,
    govt_aided: sp0.govt_aided || 0,
    local_body: sp0.local_body || 0,
    dept_of_edu: sp0.dept_of_edu || 0,
    rural: sp0.rural || 0,
    urban: sp0.urban || 0,
  };

  // GROUP BY 1 (label only) can still return the same normalized gender
  // under several raw spellings ('MALE' / '1' / 'M') — merge those the
  // same way the old ReportAggregator did.
  const mergeGenderRows = (rows) => {
    const merged = {};
    rows.forEach(row => {
      const raw = String(row.label || '').trim().toUpperCase();
      let label = 'Other';
      if (raw === '1' || raw === 'MALE' || raw === 'M') label = 'Male';
      else if (raw === '2' || raw === 'FEMALE' || raw === 'F') label = 'Female';
      if (!merged[label]) merged[label] = { count: 0, sum_mat: 0, highest_mat: 0, sum_sat: 0, highest_sat: 0 };
      const count = row.total_students || 0;
      merged[label].count += count;
      merged[label].sum_mat += (row.avg_mat_score || 0) * count;
      merged[label].sum_sat += (row.avg_sat_score || 0) * count;
      merged[label].highest_mat = Math.max(merged[label].highest_mat, row.highest_mat_score || 0);
      merged[label].highest_sat = Math.max(merged[label].highest_sat, row.highest_sat_score || 0);
    });
    return Object.entries(merged)
      .map(([label, s]) => ({
        label,
        avg_mat_score: s.count > 0 ? Number((s.sum_mat / s.count).toFixed(2)) : 0,
        highest_mat_score: s.highest_mat,
        avg_sat_score: s.count > 0 ? Number((s.sum_sat / s.count).toFixed(2)) : 0,
        highest_sat_score: s.highest_sat,
        total_students: s.count,
      }))
      .sort((a, b) => b.total_students - a.total_students);
  };

  const formatPerf = (rows) => rows
    .map(row => ({
      label: row.label,
      avg_mat_score: Number(Number(row.avg_mat_score || 0).toFixed(2)),
      highest_mat_score: Number(row.highest_mat_score || 0),
      avg_sat_score: Number(Number(row.avg_sat_score || 0).toFixed(2)),
      highest_sat_score: Number(row.highest_sat_score || 0),
      total_students: row.total_students || 0,
    }))
    .sort((a, b) => b.total_students - a.total_students);

  const performance = {
    gender: mergeGenderRows(perfGenderRes.rows),
    category: formatPerf(perfCategoryRes.rows),
    school_type: formatPerf(perfTypeRes.rows),
    school_location: formatPerf(perfLocRes.rows),
  };

  return { overview, participation, school_participation, performance };
}

const emptySubjectWiseAnalytics = () => ({
  gender_analysis: [], category_analysis: [], school_type_analysis: [], school_location_analysis: [],
});

// Cached per exact scope (state / one district / one block), independent of
// which page triggered the computation. This is what makes drilling into
// districts and blocks fast in practice: every district view needs the
// state totals again for its comparison card, and every block view needs
// its district's totals — without this, each click would recompute a
// scope that was very likely just computed a moment ago for a sibling
// page. Subject-wise state totals alone touch ~4M response rows for a
// full class, so reusing that instead of recomputing it per click matters.
async function computeNodeCached({ sessionId, scholarshipId, classStr, districtName = null, blockCode = null }) {
  const cacheKey = analyticsCacheKey("result_overall_perf_node", {
    sessionId, scholarshipId, classValue: classStr,
    filters: { district: districtName || "", block: blockCode || "" },
  });
  const cached = await readAnalyticsCache(cacheKey);
  if (cached) return cached;

  const [perf, sw] = await Promise.all([
    computePerfNode({ sessionId, scholarshipId, classStr, districtName, blockCode }),
    computeSubjectWiseScoped({ sessionId, scholarshipId, classValue: classStr, districtName, blockCode }),
  ]);
  const node = { ...perf, subject_wise_analytics: sw || emptySubjectWiseAnalytics() };
  await writeAnalyticsCache(cacheKey, node);
  return node;
}

exports.getOverallPerformanceAggregates = async ({ sessionId, scholarshipId, classValue, district = null, block = null }) => {
  const classStr = String(classValue);

  // Resolve the requested district to its canonical display name, and the
  // requested block (a numeric code, unambiguous state-wide) to its name
  // within that district — same master data the nav list is built from,
  // so a request can never silently fall through to state scope on a
  // typo'd district name.
  let districtName = null;
  let blockName = null;
  let blockCode = null;
  if (district) {
    const target = normalizeDistrictForMatch(district);
    const match = getCanonicalDistricts().find((d) => d.normalized === target);
    if (!match) {
      const err = new Error(`Unknown district: ${district}`);
      err.status = 400;
      throw err;
    }
    districtName = match.name;
  }
  if (districtName && block) {
    const blockMatch = getCanonicalBlocksForDistrict(districtName).find((b) => b.code === String(block));
    if (!blockMatch) {
      const err = new Error(`Unknown block "${block}" in district ${districtName}`);
      err.status = 400;
      throw err;
    }
    blockName = blockMatch.name;
    blockCode = blockMatch.code;
  }

  const level = blockCode ? 'block' : districtName ? 'district' : 'state';

  const target = await computeNodeCached({ sessionId, scholarshipId, classStr, districtName, blockCode });

  let parent = null;
  if (level === 'district') {
    parent = await computeNodeCached({ sessionId, scholarshipId, classStr });
  } else if (level === 'block') {
    parent = await computeNodeCached({ sessionId, scholarshipId, classStr, districtName });
  }

  return {
    level,
    district_name: districtName,
    block_name: blockName,
    target,
    parent,
    comparison: parent ? computePerformanceComparison(target.performance, parent.performance) : null,
  };
};

module.exports = exports;

