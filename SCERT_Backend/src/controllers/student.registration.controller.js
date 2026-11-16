const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { validateNameField } = require("../utils/nameValidation");
const { isStudentAccessEnabled, closedResponseBody } = require("../services/studentAccess.service");

/**
 * STUDENT REGISTRATION (TRANSACTION SAFE)
 * POST /student/register
 */
exports.registerStudent = async (req, res) => {
  // Student Access switched off by SCERT: no new student accounts either.
  if (!(await isStudentAccessEnabled())) {
    return res.status(403).json(closedResponseBody());
  }

  const { email, password, full_name, age, gender, udise_code, father_name, mother_name, date_of_birth, aadhaar_number, mobile_number } = req.body;
  const genericSuccessResponse = {
    message: "If this email is new, a verification email has been sent.",
  };

  if (!email || !password || !full_name || !udise_code) {
    return res.status(400).json({
      message: "email, password, full_name and udise_code are required",
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

    // 1️⃣ check duplicate student
    const existingUser = await client.query(
      "SELECT user_id FROM scert_db.users WHERE login_id = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      await bcrypt.hash(password, 10);
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(200).json(genericSuccessResponse);
    }

    // 2️⃣ validate UDISE
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

    // 3️⃣ hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 4️⃣ create user (role_id = 1 → STUDENT)
    const userResult = await client.query(
      `INSERT INTO scert_db.users (role_id, login_id, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [1, email, passwordHash]
    );

    const userId = userResult.rows[0].user_id;

    // 5️⃣ create student profile
    await client.query(
      `INSERT INTO scert_db.student_profiles
       (user_id, full_name, age, gender, udise_code, father_name, mother_name, date_of_birth, aadhaar_number, mobile_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, validatedFullName, age || null, normalizedGender || null, udise_code, validatedFatherName, validatedMotherName, date_of_birth || null, aadhaar_number || null, mobile_number || null]
    );

    await client.query("COMMIT");

    return res.status(200).json(genericSuccessResponse);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("registerStudent error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};
