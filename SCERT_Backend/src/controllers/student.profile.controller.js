const pool = require("../config/db");
const { validateNameField } = require("../utils/nameValidation");

/**
 * GET STUDENT PROFILE
 * GET /student/profile
 */
exports.getProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  // role check
  if (roleId !== 1) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const result = await pool.query(
      `SELECT 
        sp.user_id,
        sp.full_name,
        sp.age,
        sp.gender,
        sp.udise_code,
        sp.father_name,
        sp.mother_name,
        sp.date_of_birth,
        sp.aadhaar_number,
        sp.mobile_number,
        COALESCE(sc.school_name, psm.school_name) AS school_name,
        u.login_id,
        u.created_at
      FROM scert_db.student_profiles sp
      JOIN scert_db.users u ON sp.user_id = u.user_id
      LEFT JOIN scert_db.school_profiles sc
        ON sc.udise_code = sp.udise_code
      LEFT JOIN scert_db.primary_schools_master psm
        ON psm.udise_code = sp.udise_code
      WHERE sp.user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Student profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get student profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * STUDENT PROFILE COMPLETION
 * PUT /student/profile/complete
 */
exports.completeProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  // role check
  if (roleId !== 1) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { full_name, age, gender, udise_code, father_name, mother_name, date_of_birth, aadhaar_number, mobile_number } = req.body;

  if (!full_name || !udise_code) {
    return res.status(400).json({
      message: "full_name and udise_code are required",
    });
  }

  const validatedFullName = validateNameField("full_name", full_name, { required: true });
  const validatedFatherName = validateNameField("father_name", father_name);
  const validatedMotherName = validateNameField("mother_name", mother_name);

  // Normalize gender to uppercase to match check constraint
  const normalizedGender = gender && typeof gender === 'string' ? gender.toUpperCase() : gender;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // optional safety check: ensure school exists
    const school = await client.query(
      "SELECT user_id FROM scert_db.school_profiles WHERE udise_code = $1",
      [udise_code]
    );

    if (school.rows.length === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(400).json({
        message: "Invalid UDISE code. School not found.",
      });
    }

    // update student profile
    const result = await client.query(
      `UPDATE scert_db.student_profiles
       SET
         full_name = $1,
         age = $2,
         gender = $3,
         udise_code = $4,
         father_name = $5,
         mother_name = $6,
         date_of_birth = $7,
         aadhaar_number = $8,
         mobile_number = $9
       WHERE user_id = $10`,
      [validatedFullName, age || null, normalizedGender || null, udise_code, validatedFatherName, validatedMotherName, date_of_birth || null, aadhaar_number || null, mobile_number || null, userId]
    );

    if (result.rowCount === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "Student profile not found" });
    }

    // mark profile completed
    await client.query(
      `UPDATE scert_db.users SET profile_completed = true WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    res.json({
      message: "Student profile completed successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Student profile completion error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};



exports.updateProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 1) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { full_name, age, gender, father_name, mother_name, date_of_birth, aadhaar_number, mobile_number } = req.body;

  if (
    full_name === undefined &&
    age === undefined &&
    gender === undefined &&
    father_name === undefined &&
    mother_name === undefined &&
    date_of_birth === undefined &&
    aadhaar_number === undefined &&
    mobile_number === undefined
  ) {
    return res.status(400).json({
      message: "At least one field is required to update",
    });
  }

  // Normalize gender to uppercase to match check constraint
  const normalizedGender = gender && typeof gender === 'string' ? gender.toUpperCase() : gender;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");


    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    if (full_name !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(validateNameField("full_name", full_name, { required: true }));
    }

    if (age !== undefined) {
      fields.push(`age = $${idx++}`);
      values.push(age);
    }

    if (gender !== undefined) {
      fields.push(`gender = $${idx++}`);
      values.push(normalizedGender);
    }

    if (father_name !== undefined) {
      fields.push(`father_name = $${idx++}`);
      values.push(validateNameField("father_name", father_name));
    }

    if (mother_name !== undefined) {
      fields.push(`mother_name = $${idx++}`);
      values.push(validateNameField("mother_name", mother_name));
    }

    if (date_of_birth !== undefined) {
      fields.push(`date_of_birth = $${idx++}`);
      values.push(date_of_birth);
    }

    if (aadhaar_number !== undefined) {
      fields.push(`aadhaar_number = $${idx++}`);
      values.push(aadhaar_number);
    }

    if (mobile_number !== undefined) {
      fields.push(`mobile_number = $${idx++}`);
      values.push(mobile_number);
    }

    values.push(userId);

    const result = await client.query(
      `
      UPDATE scert_db.student_profiles
      SET ${fields.join(", ")},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $${idx}
      `,
      values
    );

    if (result.rowCount === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({
        message: "Student profile not found",
      });
    }

    // Ensure profile remains marked completed
    await client.query(
      `UPDATE scert_db.users
       SET profile_completed = true
       WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    res.json({
      message: "Student profile updated successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Student profile update error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};
