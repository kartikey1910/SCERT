const pool = require("../config/db");

/**
 * GET SCHOOLS FOR CURRENT BEO BLOCK
 * GET /api/beo/schools
 *
 * Returns ONLY schools in the logged-in BEO's block.
 * Kept paginated to avoid sending thousands of rows at once.
 */
exports.getAllSchools = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, pending_only, school_type } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    // Determine the BEO's block (source of truth)
    const beoRes = await pool.query(
      `SELECT block_code, district_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [userId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code, district_code } = beoRes.rows[0];

    const usePendingFilter =
      String(pending_only).trim() === "1" ||
      String(pending_only).trim().toLowerCase() === "true";

    const applyScholarshipFilter = Boolean(scholarship_id) && usePendingFilter;

    const countParams = [block_code, district_code];
    let countIdx = 3;
    let schoolTypeCountClause = "";
    if (school_type && String(school_type).trim()) {
      schoolTypeCountClause = ` AND LOWER(TRIM(sp.school_type)) = LOWER(TRIM($${countIdx++})) `;
      countParams.push(String(school_type).trim());
    }
    let pendingCountClause = "";
    if (applyScholarshipFilter) {
      pendingCountClause = `
        AND EXISTS (
          SELECT 1
          FROM scert_db.scholarship_applications a
          LEFT JOIN scert_db.student_profiles st
            ON st.user_id = a.student_user_id
          LEFT JOIN scert_db.school_profiles sp_student
            ON sp_student.udise_code = st.udise_code
          WHERE a.session_id = $${countIdx++}
            AND a.scholarship_id = $${countIdx++}
            AND a.current_stage = 'BEO'
            AND a.status IN ('SUBMITTED', 'RETURNED')
            AND COALESCE(sp_student.user_id, a.created_by_school_user_id) = sp.user_id
        )
      `;
      countParams.push(session_id, scholarship_id);
    }

    // Count schools in BEO block (optionally only those having pending BEO applications for scholarship)
    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM scert_db.users u
       JOIN scert_db.school_profiles sp ON u.user_id = sp.user_id
       WHERE u.role_id = 2
         AND sp.block_code = $1
         AND sp.district_code = $2
         ${schoolTypeCountClause}
         ${pendingCountClause}`,
      countParams
    );

    const total = parseInt(countResult.rows?.[0]?.total || "0", 10);

    const resultParams = [block_code, district_code];
    let resultIdx = 3;
    let schoolTypeResultClause = "";
    if (school_type && String(school_type).trim()) {
      schoolTypeResultClause = ` AND LOWER(TRIM(sp.school_type)) = LOWER(TRIM($${resultIdx++})) `;
      resultParams.push(String(school_type).trim());
    }
    let pendingResultClause = "";
    if (applyScholarshipFilter) {
      pendingResultClause = `
        AND EXISTS (
          SELECT 1
          FROM scert_db.scholarship_applications a
          LEFT JOIN scert_db.student_profiles st
            ON st.user_id = a.student_user_id
          LEFT JOIN scert_db.school_profiles sp_student
            ON sp_student.udise_code = st.udise_code
          WHERE a.session_id = $${resultIdx++}
            AND a.scholarship_id = $${resultIdx++}
            AND a.current_stage = 'BEO'
            AND a.status IN ('SUBMITTED', 'RETURNED')
            AND COALESCE(sp_student.user_id, a.created_by_school_user_id) = sp.user_id
        )
      `;
      resultParams.push(session_id, scholarship_id);
    }
    const limitParam = resultIdx++;
    const offsetParam = resultIdx++;
    resultParams.push(limit, offset);

    // Fetch paginated schools in BEO block
    const result = await pool.query(
      `SELECT
        u.user_id,
        u.login_id,
        sp.school_name,
        sp.udise_code,
        sp.block_code,
        sp.block_name,
        sp.district_code,
        sp.district_name,
        sp.school_type,
        sp.head_of_institution_name,
        sp.head_of_institution_mobile,
        u.created_at
      FROM scert_db.users u
      JOIN scert_db.school_profiles sp ON u.user_id = sp.user_id
      WHERE u.role_id = 2
        AND sp.block_code = $1
        AND sp.district_code = $2
        ${schoolTypeResultClause}
        ${pendingResultClause}
      ORDER BY sp.school_name ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
      resultParams
    );

    return res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("beo.getAllSchools error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
