const pool = require("../config/db");

/**
 * BEO PROFILE COMPLETION
 * PUT /beo/profile/complete
 */
exports.completeProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  // role check
  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    beo_name,
    beo_account_no,
    beo_ifsc_code,
    beo_bank_name,
    distance_from_district_hq_km,
    address,
    contact_number,
    email,
    beo_mobile,
    dealing_person_name,
    dealing_person_mobile,
  } = req.body;

  if (!beo_name) {
    return res.status(400).json({
      message: "beo_name is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // update BEO profile
    const result = await client.query(
      `UPDATE scert_db.beo_profiles
       SET
         beo_name = $1,
         beo_account_no = $2,
         beo_ifsc_code = $3,
         beo_bank_name = $4,
         distance_from_district_hq_km = $5,
         address = $6,
         contact_number = $7,
         email = $8,
         beo_mobile = $9,
         dealing_person_name = $10,
         dealing_person_mobile = $11
       WHERE user_id = $12`,
      [
        beo_name,
        beo_account_no || null,
        beo_ifsc_code || null,
        beo_bank_name || null,
        distance_from_district_hq_km || null,
        address,
        contact_number || null,
        email || null,
        beo_mobile || null,
        dealing_person_name || null,
        dealing_person_mobile || null,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "BEO profile not found" });
    }

    // mark profile completed
    await client.query(
      `UPDATE scert_db.users SET profile_completed = true WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    res.json({
      message: "BEO profile completed successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("BEO profile completion error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * GET BEO PROFILE
 * GET /beo/profile
 */
exports.getProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const client = await pool.connect();

  try {
    // user meta
    const userRes = await client.query(
      `SELECT user_id, login_id, is_first_login, profile_completed
       FROM scert_db.users
       WHERE user_id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // beo profile
    const profileRes = await client.query(
      `SELECT
         block_name,
         block_code,
         unit_id,
         beo_account_no,
         beo_ifsc_code,
         beo_bank_name,
         district_code,
         district_name,
         distance_from_district_hq_km,
         block_location,
         address,
         contact_number,
         email,
         beo_name,
         beo_mobile,
         dealing_person_name,
         dealing_person_mobile
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [userId]
    );

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    res.json({
      user: userRes.rows[0],
      profile: profileRes.rows[0],
    });
  } catch (err) {
    console.error("Get BEO profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};


exports.updateProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    beo_name,
    beo_account_no,
    beo_ifsc_code,
    beo_bank_name,
    distance_from_district_hq_km,
    address,
    contact_number,
    email,
    beo_mobile,
    dealing_person_name,
    dealing_person_mobile,
  } = req.body;

  // nothing to update check
  if (
    beo_name === undefined &&
    beo_account_no === undefined &&
    beo_ifsc_code === undefined &&
    beo_bank_name === undefined &&
    distance_from_district_hq_km === undefined &&
    address === undefined &&
    contact_number === undefined &&
    email === undefined &&
    beo_mobile === undefined &&
    dealing_person_name === undefined &&
    dealing_person_mobile === undefined
  ) {
    return res.status(400).json({
      message: "At least one field is required to update",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Dynamic update build */
    const fields = [];
    const values = [];
    let idx = 1;

    if (beo_name !== undefined) {
      fields.push(`beo_name = $${idx++}`);
      values.push(beo_name);
    }

    if (beo_account_no !== undefined) {
      fields.push(`beo_account_no = $${idx++}`);
      values.push(beo_account_no);
    }

    if (beo_ifsc_code !== undefined) {
      fields.push(`beo_ifsc_code = $${idx++}`);
      values.push(beo_ifsc_code);
    }

    if (beo_bank_name !== undefined) {
      fields.push(`beo_bank_name = $${idx++}`);
      values.push(beo_bank_name);
    }

    if (distance_from_district_hq_km !== undefined) {
      fields.push(`distance_from_district_hq_km = $${idx++}`);
      values.push(distance_from_district_hq_km);
    }

    if (address !== undefined) {
      fields.push(`address = $${idx++}`);
      values.push(address);
    }

    if (contact_number !== undefined) {
      fields.push(`contact_number = $${idx++}`);
      values.push(contact_number);
    }

    if (email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(email);
    }

    if (beo_mobile !== undefined) {
      fields.push(`beo_mobile = $${idx++}`);
      values.push(beo_mobile);
    }

    if (dealing_person_name !== undefined) {
      fields.push(`dealing_person_name = $${idx++}`);
      values.push(dealing_person_name);
    }

    if (dealing_person_mobile !== undefined) {
      fields.push(`dealing_person_mobile = $${idx++}`);
      values.push(dealing_person_mobile);
    }

    values.push(userId);

    const updateRes = await client.query(
      `
      UPDATE scert_db.beo_profiles
      SET ${fields.join(", ")},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $${idx}
      `,
      values
    );

    if (updateRes.rowCount === 0) {
      throw new Error("BEO profile not found");
    }

    /* 2️⃣ Keep profile completed true */
    await client.query(
      `UPDATE scert_db.users
       SET profile_completed = true
       WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    res.json({
      message: "BEO profile updated successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("BEO profile update error:", err);
    res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
};
