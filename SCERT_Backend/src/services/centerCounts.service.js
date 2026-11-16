/**
 * Shared rules for the exam-center lists a BEO sees.
 *
 * Two routes serve GET /api/beo/centers (the application routes are mounted
 * first, so their handler answers; the center routes' handler is behind it).
 * Both build their rows from the pieces here so the counts cannot disagree.
 */

/**
 * NMMSS runs from a small number of exam centres per block, so a BEO may have
 * at most NMMSS_MAX_CENTERS active centres for it. Other scholarships have no
 * limit. NMMSS is recognised by name: scholarship ids change every session.
 */
const NMMSS_MAX_CENTERS = 2;
const NMMSS_NAME_PATTERN = /\bNMMSS\b|\bNMMS\b/i;

const maxCentersForScholarshipName = (name) =>
  NMMSS_NAME_PATTERN.test(String(name || "")) ? NMMSS_MAX_CENTERS : null;

/**
 * The columns a center row carries for its registration counts. Selected from
 * the `reg` lateral below.
 *
 *   *_registered  approved by SCERT (APPROVED / FINAL_APPROVED)  -> List of Centers
 *   *_submitted   forwarded by the BEO and not since returned:
 *                 still with SCERT, or approved                   -> Absentee During Exam
 */
const REGISTRATION_COUNT_COLUMNS = `
        COALESCE(reg.total_registered, 0) AS total_registered,
        COALESCE(reg.first_class_registered, 0) AS first_class_registered,
        COALESCE(reg.second_class_registered, 0) AS second_class_registered,
        COALESCE(reg.total_submitted, 0) AS total_submitted,
        COALESCE(reg.first_class_submitted, 0) AS first_class_submitted,
        COALESCE(reg.second_class_submitted, 0) AS second_class_submitted`;

/**
 * The `reg` lateral join. `centerAlias` is the exam_centers alias in the outer
 * query and `scholarshipAlias` a joined scert_db.scholarships row for it.
 *
 * One row per application assigned to the center, with its class. NMMSS is a
 * class 8 exam only, so all its students fall in the first class group. CM
 * splits into class 6 (first) and class 9 (second); an application whose class
 * is unknown counts in the totals only.
 */
const registrationCountsLateral = (centerAlias = "c", scholarshipAlias = "sch") => `
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE x.approved AND (x.is_nmmss OR x.cls = '6'))::int AS first_class_registered,
          COUNT(*) FILTER (WHERE x.approved AND NOT x.is_nmmss AND x.cls = '9')::int AS second_class_registered,
          COUNT(*) FILTER (WHERE x.approved)::int AS total_registered,
          COUNT(*) FILTER (WHERE x.submitted AND (x.is_nmmss OR x.cls = '6'))::int AS first_class_submitted,
          COUNT(*) FILTER (WHERE x.submitted AND NOT x.is_nmmss AND x.cls = '9')::int AS second_class_submitted,
          COUNT(*) FILTER (WHERE x.submitted)::int AS total_submitted
        FROM (
          SELECT
            (${scholarshipAlias}.scholarship_name ~* '\\y(nmmss|nmms)\\y') AS is_nmmss,
            a.status IN ('APPROVED', 'FINAL_APPROVED') AS approved,
            (
              a.status IN ('APPROVED', 'FINAL_APPROVED')
              OR (a.status = 'SUBMITTED' AND a.current_stage = 'SCERT')
            ) AS submitted,
            COALESCE(
              NULLIF(TRIM(a.class::text), ''),
              cls.class_value,
              '8'
            ) AS cls
          FROM scert_db.scholarship_applications a
          LEFT JOIN LATERAL (
            SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT) AS class_value
            FROM scert_db.scholarship_application_answers aa
            JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
            WHERE aa.application_id = a.application_id
              AND ff.scholarship_id = a.scholarship_id
              AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
            ORDER BY ff.sort_order ASC
            LIMIT 1
          ) cls ON true
          WHERE a.center_id = ${centerAlias}.center_id
            AND a.session_id = ${centerAlias}.session_id
            AND a.scholarship_id = ${centerAlias}.scholarship_id
        ) x
      ) reg ON true`;

module.exports = {
  NMMSS_MAX_CENTERS,
  maxCentersForScholarshipName,
  REGISTRATION_COUNT_COLUMNS,
  registrationCountsLateral,
};
