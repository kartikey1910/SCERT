/**
 * NMMSS summary for the SCERT dashboard: the BEO dashboard's table, one level
 * up. The same columns are shown at three levels that the user drills into:
 *
 *   district  -> one row per district (whole state)
 *   block     -> one row per block of a district
 *   school    -> one row per school of a block
 *
 * Every figure has the definition used on the BEO's dashboard (see
 * beoNmmssSummary.service.js), so a BEO's school rows add up to the block row
 * SCERT sees, and the block rows to the district row:
 *
 *   Enrolled             school_student_strength for class 8
 *   Registered           every application the school has submitted (any status
 *                        except DRAFT and REJECTED), split by exam code
 *                        (1 = NMMSS, 2 = SNSS and SSSS)
 *   Appeared             registered students marked PRESENT in either paper;
 *                        0 until the BEO uploads Absentee After Exam
 *   Qualified, Selected  not available until NMMSS results exist
 *
 * The rows are built per school and then grouped, so the three levels cannot
 * drift apart.
 */

const { assertNmmss } = require("./schoolNmmssSummary.service");

// Registered = every application that has been submitted: anything that is not
// still a draft and has not been rejected (the Progress Report's rule).
const NOT_REGISTERED_STATUSES = ["DRAFT", "REJECTED"];
const NMMSS_CLASS = 8;
const EXAM_CODE_NMMSS = 1;
const EXAM_CODE_SNSS_SSSS = 2;

const LEVELS = {
  district: {
    keys: ["district_code", "district_name"],
    // Grouped by code alone: the same district is spelled two ways in the
    // school data ("Hardwar" / "HARDWAR"), which must not split its row.
    select: "s.district_code, MODE() WITHIN GROUP (ORDER BY s.district_name) AS district_name",
    group: "s.district_code",
    order: "district_name ASC, s.district_code ASC",
  },
  block: {
    keys: ["block_code", "block_name"],
    select: "s.block_code, MODE() WITHIN GROUP (ORDER BY s.block_name) AS block_name",
    group: "s.block_code",
    order: "block_name ASC, s.block_code ASC",
  },
  school: {
    keys: ["school_user_id", "school_name", "udise_code"],
    select: "s.user_id AS school_user_id, s.school_name, s.udise_code",
    group: "s.user_id, s.school_name, s.udise_code",
    order: "s.school_name ASC, s.user_id ASC",
  },
};

const TOTAL_KEYS = [
  "enrolled",
  "registered_nmmss",
  "registered_snss_ssss",
  "registered_total",
  "registered_other",
  "appeared",
];

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

async function loadStatusCounts(db, { sessionId, scholarshipId, districtCode }) {
  // A district sees only its own blocks' applications.
  const params = [sessionId, scholarshipId];
  let districtSql = "";
  if (districtCode) {
    params.push(districtCode);
    districtSql = `AND block_code::text IN (
        SELECT block_code::text FROM scert_db.school_profiles WHERE district_code = $3
      )`;
  }
  const res = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE current_stage = 'SCERT' AND status = 'SUBMITTED')::int AS pending,
       COUNT(*) FILTER (WHERE status = 'APPROVED')::int                              AS approved,
       COUNT(*) FILTER (WHERE current_stage = 'BEO'   AND status = 'RETURNED')::int  AS returned_to_beo,
       COUNT(*) FILTER (WHERE current_stage = 'BEO'   AND status = 'SUBMITTED')::int AS pending_at_beo
       FROM scert_db.scholarship_applications
      WHERE session_id = $1
        AND scholarship_id = $2
        ${districtSql}`,
    params
  );
  return res.rows[0];
}

async function loadRows(db, { level, districtCode, blockCode, sessionId, scholarshipId }) {
  const def = LEVELS[level];

  // Scope: the schools that belong under the row that was opened.
  const scope = [];
  const params = [
    sessionId,
    scholarshipId,
    NMMSS_CLASS,
    EXAM_CODE_NMMSS,
    EXAM_CODE_SNSS_SSSS,
    NOT_REGISTERED_STATUSES,
  ];
  if (level === "block") {
    params.push(districtCode);
    scope.push(`s.district_code = $${params.length}`);
  } else if (level === "school") {
    params.push(blockCode);
    scope.push(`s.block_code = $${params.length}`);
    if (districtCode) {
      params.push(districtCode);
      scope.push(`s.district_code = $${params.length}`);
    }
  }
  const where = scope.length ? `WHERE ${scope.join(" AND ")}` : "";

  const res = await db.query(
    `WITH registered AS (
       SELECT COALESCE(sc.user_id, sp.user_id) AS school_user_id,
              COUNT(*) FILTER (WHERE a.exam_code = $4)::int AS code1,
              COUNT(*) FILTER (WHERE a.exam_code = $5)::int AS code2,
              COUNT(*) FILTER (WHERE a.exam_code IS DISTINCT FROM $4
                                 AND a.exam_code IS DISTINCT FROM $5)::int AS other,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1
                  FROM scert_db.center_exam_student_attendance x
                 WHERE x.application_id = a.application_id
                   AND (x.mat_status = 'PRESENT' OR x.sat_status = 'PRESENT')
              ))::int AS appeared
         FROM scert_db.scholarship_applications a
         LEFT JOIN scert_db.school_profiles sc ON sc.user_id = a.created_by_school_user_id
         LEFT JOIN scert_db.student_profiles st ON st.user_id = a.student_user_id
         LEFT JOIN scert_db.school_profiles sp ON sp.udise_code = st.udise_code
        WHERE a.session_id = $1
          AND a.scholarship_id = $2
          AND a.status::text <> ALL($6::text[])
        GROUP BY COALESCE(sc.user_id, sp.user_id)
     ),
     enrolled AS (
       SELECT sss.school_user_id,
              COALESCE(SUM(sss.boys_count + sss.girls_count), 0)::int AS enrolled
         FROM scert_db.school_student_strength sss
        WHERE sss.class_level = $3
        GROUP BY sss.school_user_id
     )
     SELECT ${def.select},
            COALESCE(SUM(e.enrolled), 0)::int   AS enrolled,
            COALESCE(SUM(r.code1), 0)::int      AS registered_nmmss,
            COALESCE(SUM(r.code2), 0)::int      AS registered_snss_ssss,
            COALESCE(SUM(r.other), 0)::int      AS registered_other,
            COALESCE(SUM(r.appeared), 0)::int   AS appeared
       FROM scert_db.school_profiles s
       LEFT JOIN enrolled e   ON e.school_user_id = s.user_id
       LEFT JOIN registered r ON r.school_user_id = s.user_id
       ${where}
      GROUP BY ${def.group}
      ORDER BY ${def.order}`,
    params
  );

  return res.rows.map((r) => {
    const row = {};
    for (const k of def.keys) row[k] = r[k];
    row.enrolled = Number(r.enrolled);
    row.registered_nmmss = Number(r.registered_nmmss);
    row.registered_snss_ssss = Number(r.registered_snss_ssss);
    row.registered_total = row.registered_nmmss + row.registered_snss_ssss;
    row.registered_other = Number(r.registered_other);
    row.appeared = Number(r.appeared);
    return row;
  });
}

function sumRows(rows) {
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
  for (const r of rows) for (const k of TOTAL_KEYS) totals[k] += r[k];
  return totals;
}

/**
 * @param db  anything with .query(text, params)
 * @param level  'district' | 'block' | 'school'
 */
async function getScertNmmssSummary(db, { level = "district", districtCode, blockCode, sessionId, scholarshipId }) {
  if (!LEVELS[level]) throw badRequest("level must be district, block or school");
  if (level === "block" && !districtCode) throw badRequest("district_code is required");
  if (level === "school" && !blockCode) throw badRequest("block_code is required");

  await assertNmmss(db, scholarshipId);

  const [counts, rows] = await Promise.all([
    loadStatusCounts(db, { sessionId, scholarshipId }),
    loadRows(db, { level, districtCode, blockCode, sessionId, scholarshipId }),
  ]);

  return {
    class_level: NMMSS_CLASS,
    level,
    counts,
    rows,
    totals: sumRows(rows),
    results_available: false,
  };
}

/**
 * The same table for a District user: it starts at the district's blocks
 * (level 'block') and opens a block's schools (level 'school'). The district
 * always comes from the caller's own profile, so no request can widen it.
 */
async function getDistrictNmmssSummary(db, { districtCode, level = "block", blockCode, sessionId, scholarshipId }) {
  if (level !== "block" && level !== "school") throw badRequest("level must be block or school");
  if (level === "school" && !blockCode) throw badRequest("block_code is required");

  await assertNmmss(db, scholarshipId);

  const [counts, rows] = await Promise.all([
    loadStatusCounts(db, { sessionId, scholarshipId, districtCode }),
    loadRows(db, { level, districtCode, blockCode, sessionId, scholarshipId }),
  ]);

  return {
    class_level: NMMSS_CLASS,
    level,
    counts,
    rows,
    totals: sumRows(rows),
    results_available: false,
  };
}

module.exports = { getScertNmmssSummary, getDistrictNmmssSummary };
