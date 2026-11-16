const pool = require("../config/db");

/**
 * GET SCERT PROFILE
 * GET /scert/profile
 */
exports.getProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 5) {
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
         institute_name,
         address,
         contact_number,
         email,
         additional_director_name,
         additional_director_mobile,
         dealing_person_name,
         dealing_person_mobile
       FROM scert_db.scert_profiles
       WHERE user_id = $1`,
      [userId]
    );

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ message: "SCERT profile not found" });
    }

    res.json({
      user: userRes.rows[0],
      profile: profileRes.rows[0],
    });
  } catch (err) {
    console.error("Get SCERT profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * EDIT SCERT PROFILE
 * PUT /scert/profile/edit
 */
exports.editProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    institute_name,
    address,
    contact_number,
    email,
    additional_director_name,
    additional_director_mobile,
    dealing_person_name,
    dealing_person_mobile,
  } = req.body || {};

  if (!institute_name || !address || !additional_director_name) {
    return res.status(400).json({
      message:
        "institute_name, address and additional_director_name are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE scert_db.scert_profiles
       SET
         institute_name = $1,
         address = $2,
         contact_number = $3,
         email = $4,
         additional_director_name = $5,
         additional_director_mobile = $6,
         dealing_person_name = $7,
         dealing_person_mobile = $8,
         updated_at = NOW()
       WHERE user_id = $9`,
      [
        institute_name,
        address,
        contact_number || null,
        email || null,
        additional_director_name,
        additional_director_mobile || null,
        dealing_person_name || null,
        dealing_person_mobile || null,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "SCERT profile not found" });
    }

    await client.query("COMMIT");
    return res.json({ message: "SCERT profile updated successfully" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Edit SCERT profile error:", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};
