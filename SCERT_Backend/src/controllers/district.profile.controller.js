const pool = require("../config/db");

/**
 * DISTRICT PROFILE COMPLETION
 * PUT /district/profile/complete
 */
exports.completeProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  // role check
  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    ceo_name,
    ceo_mobile,
    district_location,
    address,
    account_no,
    ifsc_code,
    bank_name,
    contact_number,
    email,
    dealing_person_name,
    dealing_person_mobile,
    distance_from_paper_distribution_center_km,
  } = req.body;

  if (!ceo_name || !district_location) {
    return res.status(400).json({
      message: "ceo_name and district_location are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // update district profile
    const result = await client.query(
      `UPDATE scert_db.district_profiles
       SET
         ceo_name = $1,
         ceo_mobile = $2,
         district_location = $3,
         address = $4,
         account_no = $5,
         ifsc_code = $6,
         bank_name = $7,
         contact_number = $8,
         email = $9,
         dealing_person_name = $10,
         dealing_person_mobile = $11,
         distance_from_paper_distribution_center_km = $12
       WHERE user_id = $13`,
      [
        ceo_name,
        ceo_mobile || null,
        district_location,
        address,
        account_no || null,
        ifsc_code || null,
        bank_name || null,
        contact_number || null,
        email || null,
        dealing_person_name || null,
        dealing_person_mobile || null,
        distance_from_paper_distribution_center_km || null,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "District profile not found" });
    }

    // mark profile completed
    await client.query(
      `UPDATE scert_db.users SET profile_completed = true WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    res.json({
      message: "District profile completed successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("District profile completion error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};


/**
 * GET DISTRICT PROFILE
 * GET /district/profile
 */
exports.getProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const client = await pool.connect();

  try {
    const userRes = await client.query(
      `SELECT user_id, login_id, is_first_login, profile_completed
       FROM scert_db.users
       WHERE user_id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const profileRes = await client.query(
      `SELECT
         district_name,
         district_code,
         unit_id,
         account_no,
         ifsc_code,
         bank_name,
         district_location,
         address,
         contact_number,
         email,
         ceo_name,
         ceo_mobile,
         dealing_person_name,
         dealing_person_mobile,
         distance_from_paper_distribution_center_km
       FROM scert_db.district_profiles
       WHERE user_id = $1`,
      [userId]
    );

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ message: "District profile not found" });
    }

    res.json({
      user: userRes.rows[0],
      profile: profileRes.rows[0],
    });
  } catch (err) {
    console.error("Get district profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};


exports.editProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  // role check
  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    ceo_name,
    ceo_mobile,
    district_location,
    address,
    account_no,
    ifsc_code,
    bank_name,
    contact_number,
    email,
    dealing_person_name,
    dealing_person_mobile,
    distance_from_paper_distribution_center_km,
  } = req.body;

  // minimal validation (same fields as completion, but editable)
  if (!ceo_name || !district_location) {
    return res.status(400).json({
      message: "ceo_name and district_location are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE scert_db.district_profiles
       SET
         ceo_name = $1,
         ceo_mobile = $2,
         district_location = $3,
         address = $4,
         account_no = $5,
         ifsc_code = $6,
         bank_name = $7,
         contact_number = $8,
         email = $9,
         dealing_person_name = $10,
         dealing_person_mobile = $11,
         distance_from_paper_distribution_center_km = $12,
         updated_at = NOW()
       WHERE user_id = $13`,
      [
        ceo_name,
        ceo_mobile || null,
        district_location,
        address,
        account_no || null,
        ifsc_code || null,
        bank_name || null,
        contact_number || null,
        email || null,
        dealing_person_name || null,
        dealing_person_mobile || null,
        distance_from_paper_distribution_center_km || null,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "District profile not found" });
    }

    await client.query("COMMIT");

    res.json({
      message: "District profile updated successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("District profile edit error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * GET ALL BEOS IN DISTRICT
 * GET /api/district/beos
 */
exports.getBeos = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const districtRes = await pool.query(
      `SELECT district_code FROM scert_db.district_profiles WHERE user_id = $1`,
      [userId]
    );

    if (districtRes.rows.length === 0) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const { district_code } = districtRes.rows[0];

    const result = await pool.query(
      `SELECT
        bp.user_id,
        bp.beo_name,
        bp.beo_mobile,
        bp.block_name,
        bp.block_code,
        u.login_id
       FROM scert_db.beo_profiles bp
       JOIN scert_db.users u ON bp.user_id = u.user_id
       WHERE bp.district_code::int = $1::int
       ORDER BY bp.block_name ASC`,
      [district_code]
    );

    res.json({ beos: result.rows });
  } catch (err) {
    console.error("Get district beos error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
