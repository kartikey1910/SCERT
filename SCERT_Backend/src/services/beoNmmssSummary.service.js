/**
 * NMMSS summary for the BEO dashboard: the four application-status counts,
 * the block's school-wise table and the BEO's own contact details.
 *
 * THE TABLE (one row per school in the BEO's block, plus a Total row)
 *
 *   Enrolled in Class 8   school_student_strength - what the school entered in
 *                         its profile, summed over categories.
 *   Registered            every application the school has submitted: any status
 *                         other than DRAFT or REJECTED. It counts from the
 *                         moment of submission and does not move again when
 *                         the application is forwarded or approved - the same
 *                         rule as the Progress Report and as the school's own
 *                         NMMSS table, so everyone sees the same figure. Split
 *                         by exam code: 1 = NMMSS, 2 = SNSS and SSSS.
 *   Appeared in Exam      registered students marked PRESENT in either paper.
 *                         0 until the BEO uploads Absentee After Exam.
 *   Qualified, Selected   NOT AVAILABLE YET - they need NMMSS results, which
 *                         the result module does not hold (it is CM-only).
 *                         Reported as unavailable, not zero.
 *
 * THE STATUS COUNTS use the same filters as the BEO's own list tabs, so a card
 * always agrees with the tab it opens. Block membership is read from
 * scholarship_applications.block_code, which matches the school-derived block
 * on every existing application.
 */

const { assertNmmss } = require("./schoolNmmssSummary.service");

// Registered = every application that has been submitted: anything that is not
// still a draft and has not been rejected (the Progress Report's rule).
const NOT_REGISTERED_STATUSES = ["DRAFT", "REJECTED"];
const NMMSS_CLASS = 8;
const EXAM_CODE_NMMSS = 1;
const EXAM_CODE_SNSS_SSSS = 2;

async function loadBeo(db, beoUserId) {
  const res = await db.query(
    `SELECT block_code, block_name, beo_name, beo_mobile, contact_number, email
       FROM scert_db.beo_profiles
      WHERE user_id = $1`,
    [beoUserId]
  );
  if (!res.rows.length) {
    const err = new Error("BEO profile not found");
    err.statusCode = 404;
    throw err;
  }
  const p = res.rows[0];
  const clean = (v) => (v == null ? "" : String(v).trim());
  return {
    block_code: p.block_code,
    profile: {
      block_name: clean(p.block_name),
      beo_name: clean(p.beo_name),
      // The office number is the fallback when no personal mobile is on file.
      mobile: clean(p.beo_mobile) || clean(p.contact_number),
      email: clean(p.email),
    },
  };
}

async function loadStatusCounts(db, { blockCode, sessionId, scholarshipId }) {
  const res = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE current_stage = 'BEO'    AND status = 'SUBMITTED')::int AS pending,
       COUNT(*) FILTER (WHERE current_stage = 'SCHOOL' AND status = 'RETURNED')::int  AS returned_to_school,
       COUNT(*) FILTER (WHERE status = 'APPROVED')::int                               AS approved,
       -- Forwarded to SCERT and awaiting its decision - the same set the
       -- BEO's own Submitted Applications tab shows.
       COUNT(*) FILTER (WHERE current_stage = 'SCERT'  AND status = 'SUBMITTED')::int AS submitted,
       COUNT(*) FILTER (WHERE current_stage = 'BEO'    AND status = 'RETURNED')::int  AS returned_by_scert
       FROM scert_db.scholarship_applications
      WHERE session_id = $1
        AND scholarship_id = $2
        AND block_code = $3`,
    [sessionId, scholarshipId, blockCode]
  );
  return res.rows[0];
}

async function loadSchoolRows(db, { blockCode, sessionId, scholarshipId }) {
  const res = await db.query(
    `WITH schools AS (
       SELECT user_id, school_name, udise_code
         FROM scert_db.school_profiles
        WHERE block_code = $1
     ),
     enrolled AS (
       SELECT sss.school_user_id,
              COALESCE(SUM(sss.boys_count + sss.girls_count), 0)::int AS enrolled
         FROM scert_db.school_student_strength sss
         JOIN schools s ON s.user_id = sss.school_user_id
        WHERE sss.class_level = $4
        GROUP BY sss.school_user_id
     ),
     registered AS (
       SELECT COALESCE(sc.user_id, sp.user_id) AS school_user_id,
              COUNT(*) FILTER (WHERE a.exam_code = $5)::int AS code1,
              COUNT(*) FILTER (WHERE a.exam_code = $6)::int AS code2,
              COUNT(*) FILTER (WHERE a.exam_code IS DISTINCT FROM $5
                                 AND a.exam_code IS DISTINCT FROM $6)::int AS other,
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
        WHERE a.session_id = $2
          AND a.scholarship_id = $3
          AND a.block_code = $1
          AND a.status::text <> ALL($7::text[])
        GROUP BY COALESCE(sc.user_id, sp.user_id)
     )
     SELECT s.user_id AS school_user_id,
            s.school_name,
            s.udise_code,
            COALESCE(e.enrolled, 0)  AS enrolled,
            COALESCE(r.code1, 0)     AS registered_nmmss,
            COALESCE(r.code2, 0)     AS registered_snss_ssss,
            COALESCE(r.other, 0)     AS registered_other,
            COALESCE(r.appeared, 0)  AS appeared
       FROM schools s
       LEFT JOIN enrolled e   ON e.school_user_id = s.user_id
       LEFT JOIN registered r ON r.school_user_id = s.user_id
      ORDER BY s.school_name ASC, s.user_id ASC`,
    [
      blockCode,
      sessionId,
      scholarshipId,
      NMMSS_CLASS,
      EXAM_CODE_NMMSS,
      EXAM_CODE_SNSS_SSSS,
      NOT_REGISTERED_STATUSES,
    ]
  );

  return res.rows.map((r) => ({
    school_user_id: r.school_user_id,
    school_name: r.school_name,
    udise_code: r.udise_code,
    enrolled: Number(r.enrolled),
    registered_nmmss: Number(r.registered_nmmss),
    registered_snss_ssss: Number(r.registered_snss_ssss),
    registered_total: Number(r.registered_nmmss) + Number(r.registered_snss_ssss),
    registered_other: Number(r.registered_other),
    appeared: Number(r.appeared),
  }));
}

const TOTAL_KEYS = [
  "enrolled",
  "registered_nmmss",
  "registered_snss_ssss",
  "registered_total",
  "registered_other",
  "appeared",
];

function sumRows(rows) {
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
  for (const r of rows) for (const k of TOTAL_KEYS) totals[k] += r[k];
  return totals;
}

/**
 * @param db  anything with .query(text, params) - the pool in production, a
 *            transaction client in tests.
 */
async function getBeoNmmssSummary(db, { beoUserId, sessionId, scholarshipId }) {
  await assertNmmss(db, scholarshipId);

  const { block_code: blockCode, profile } = await loadBeo(db, beoUserId);

  const [counts, rows] = await Promise.all([
    loadStatusCounts(db, { blockCode, sessionId, scholarshipId }),
    loadSchoolRows(db, { blockCode, sessionId, scholarshipId }),
  ]);

  return {
    class_level: NMMSS_CLASS,
    block_code: blockCode,
    profile,
    counts,
    rows,
    totals: sumRows(rows),
    // Qualified / Selected columns: no NMMSS result data exists yet.
    results_available: false,
  };
}

module.exports = { getBeoNmmssSummary, NOT_REGISTERED_STATUSES, NMMSS_CLASS };
