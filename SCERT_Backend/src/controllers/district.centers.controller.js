const pool = require("../config/db");
const {
  REGISTRATION_COUNT_COLUMNS,
  registrationCountsLateral,
} = require("../services/centerCounts.service");

async function getDistrictFromProfile(districtUserId) {
  const res = await pool.query(
    `SELECT district_code, district_name
     FROM scert_db.district_profiles
     WHERE user_id = $1`,
    [districtUserId]
  );

  if (res.rows.length === 0) return null;
  return {
    district_code: res.rows[0].district_code,
    district_name: res.rows[0].district_name || null,
  };
}

/**
 * 📋 DISTRICT: LIST OF CENTERS (block summary + centers list)
 * GET /api/district/centers?scholarship_id=&block_code=
 */
exports.getCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, block_code } = req.query;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    // Block summary (for drill-down list)
    const blocksRes = await pool.query(
      `SELECT block_code, block_name, total_centers
       FROM (
         SELECT
           ec.block_code::text AS block_code,
           COALESCE(sp.block_name, '') AS block_name,
           COUNT(*)::int AS total_centers,
           ec.block_code::int AS block_code_int
         FROM scert_db.exam_centers ec
         LEFT JOIN scert_db.school_profiles sp
           ON sp.udise_code = ec.udise_code
         WHERE ec.session_id = $1
           AND ec.scholarship_id = $2
           AND ec.is_active = true
           AND sp.district_code::int = $3::int
         GROUP BY ec.block_code, COALESCE(sp.block_name, ''), ec.block_code::int
       ) t
       ORDER BY t.block_name NULLS LAST, t.block_code_int ASC`,
      [session_id, scholarship_id, district.district_code]
    );

    let conditions = [];
    let values = [session_id, scholarship_id, district.district_code];

    conditions.push(`ec.session_id = $1`);
    conditions.push(`ec.scholarship_id = $2`);
    conditions.push(`ec.is_active = true`);
    conditions.push(`sp.district_code::int = $3::int`);

    if (block_code) {
      conditions.push(`ec.block_code::int = $4::int`);
      values.push(block_code);
    }

    const centersQuery = `
      SELECT
        ec.center_id,
        ec.center_order,
        ec.school_name AS center_name,
        ec.school_name,
        ec.udise_code,
        ec.block_code::text AS block_code,
        sp.district_code::text AS district_code,
        sp.block_name,
        sp.district_name,
        ec.superintendent_name,
        ec.superintendent_mobile,
        ${REGISTRATION_COUNT_COLUMNS}
      FROM scert_db.exam_centers ec
      JOIN scert_db.scholarships sch
        ON sch.scholarship_id = ec.scholarship_id
      LEFT JOIN scert_db.school_profiles sp
        ON sp.udise_code = ec.udise_code
      ${registrationCountsLateral("ec", "sch")}
      WHERE ${conditions.join(" AND ")}
      ORDER BY ec.block_code::int ASC, ec.center_order ASC
    `;

    const centersRes = await pool.query(centersQuery, values);

    res.json({
      session_id,
      scholarship_id: Number(scholarship_id),
      district_code: String(district.district_code),
      district_name: district.district_name,
      block_code: block_code ? String(block_code) : null,
      blocks: blocksRes.rows,
      total_centers: centersRes.rows.length,
      centers: centersRes.rows,
    });
  } catch (err) {
    console.error("District get centers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
