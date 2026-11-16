const pool = require("../config/db");

function normalizeUnitId(value) {
  const trimmed = String(value || "").trim();
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
}

/** Returns an error message when a provided phone value is not exactly 10 digits. */
function invalidPhoneMessage({ contact_number, head_of_institution_mobile }) {
  const isBad = (v) => v !== undefined && v !== null && String(v).trim() !== "" && !/^\d{10}$/.test(String(v).trim());
  if (isBad(contact_number)) return "Contact Number of School must be exactly 10 digits";
  if (isBad(head_of_institution_mobile)) return "Head of Institution Mobile must be exactly 10 digits";
  return null;
}

function isLegacyIntegerOverflowError(err) {
  const message = String(err?.message || "").toLowerCase();
  return err?.code === "22003" || message.includes("out of range for type integer");
}

/**
 * SCHOOL PROFILE COMPLETION
 * PUT /school/profile/complete
 */
exports.completeProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    unit_id,
    school_type,
    school_location,
    school_category,
    address,
    contact_number,
    email,
    head_of_institution_name,
    head_of_institution_mobile,
    class_strengths,
  } = req.body;

  if (
    !unit_id ||
    !school_type ||
    !school_location ||
    !school_category
  ) {
    return res.status(400).json({
      message:
        "unit_id, school_type, school_location, school_category are required",
    });
  }

  const normalizedUnitId = normalizeUnitId(unit_id);
  if (!normalizedUnitId) {
    return res.status(400).json({
      message: "Unit ID must contain letters and numbers only",
    });
  }

  const phoneError = invalidPhoneMessage({ contact_number, head_of_institution_mobile });
  if (phoneError) {
    return res.status(400).json({ message: phoneError });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Update school profile
    const result = await client.query(
      `UPDATE scert_db.school_profiles
       SET
        unit_id = $1,
         school_type = $2,
         school_location = $3,
         school_category = $4,
         address = $5,
         contact_number = $6,
         email = $7,
         head_of_institution_name = $8,
         head_of_institution_mobile = $9
       WHERE user_id = $10`,
      [
        normalizedUnitId,
        school_type,
        school_location,
        school_category,
        address,
        contact_number || null,
        email || null,
        head_of_institution_name || null,
        head_of_institution_mobile || null,
        userId,
      ]
    );

    if (result.rowCount === 0) {
      throw new Error("School profile not found");
    }

    // 2️⃣ Handle class strength ONLY if provided
    if (Array.isArray(class_strengths) && class_strengths.length > 0) {
      // remove old strength (safe for re-submit)
      await client.query(
        `DELETE FROM scert_db.school_student_strength WHERE school_user_id = $1`,
        [userId]
      );

      // ✅ Bulk insert in Postgres (build dynamic placeholders)
      const values = [];
      const placeholders = class_strengths
        .map((row, index) => {
          const baseIndex = index * 5;
          values.push(
            userId,
            row.class_level,
            row.category,
            row.boys_count || 0,
            row.girls_count || 0
          );
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`;
        })
        .join(", ");

      await client.query(
        `INSERT INTO scert_db.school_student_strength
         (school_user_id, class_level, category, boys_count, girls_count)
         VALUES ${placeholders}`,
        values
      );
    }

    // 3️⃣ Mark profile completed
    await client.query(
      `UPDATE scert_db.users SET profile_completed = true WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");
    schoolProfileCache.delete(userId);

    res.json({
      message: "School profile completed successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School profile completion error:", err);
    if (isLegacyIntegerOverflowError(err)) {
      return res.status(400).json({
        message: "Unit ID is too large for the current database column. Please contact the administrator.",
      });
    }
    res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
};


// optional cache
const schoolProfileCache = new Map();
// userId -> { data, expiresAt }

exports.getProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const now = Date.now();
    const cached = schoolProfileCache.get(userId);

    // 🟢 HTTP cache headers (CRITICAL FIX)
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Vary", "Authorization");

    if (cached && cached.expiresAt > now) {
      return res.json(cached.data);
    }

    /* ----------------------------------------------------
       RUN ALL READ QUERIES IN PARALLEL
    ---------------------------------------------------- */
    const [userRes, profileRes, strengthRes] = await Promise.all([
      pool.query(
        `
        SELECT user_id, login_id, is_first_login, profile_completed
        FROM scert_db.users
        WHERE user_id = $1
        `,
        [userId]
      ),
      pool.query(
        `
        SELECT
          school_name,
          udise_code,
          unit_id,
          block_code,
          block_name,
          district_code,
          district_name,
          school_type,
          school_location,
          school_category,
          address,
          contact_number,
          email,
          head_of_institution_name,
          head_of_institution_mobile
        FROM scert_db.school_profiles
        WHERE user_id = $1
        `,
        [userId]
      ),
      pool.query(
        `
        SELECT
          class_level,
          category,
          boys_count,
          girls_count
        FROM scert_db.school_student_strength
        WHERE school_user_id = $1
        ORDER BY class_level, category
        `,
        [userId]
      ),
    ]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ message: "School profile not found" });
    }

    const response = {
      user: userRes.rows[0],
      profile: profileRes.rows[0],
      class_strengths: strengthRes.rows,
    };

    // cache for 60 seconds (backend)
    schoolProfileCache.set(userId, {
      data: response,
      expiresAt: now + 60 * 1000,
    });

    res.json(response);

  } catch (err) {
    console.error("Get school profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



exports.updateProfile = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    unit_id,
    school_type,
    school_location,
    school_category,
    address,
    contact_number,
    email,
    head_of_institution_name,
    head_of_institution_mobile,
    class_strengths,
  } = req.body;

  // Nothing to update check
  if (
    unit_id === undefined &&
    school_type === undefined &&
    school_location === undefined &&
    school_category === undefined &&
    address === undefined &&
    contact_number === undefined &&
    email === undefined &&
    head_of_institution_name === undefined &&
    head_of_institution_mobile === undefined &&
    class_strengths === undefined
  ) {
    return res.status(400).json({
      message: "At least one field is required to update",
    });
  }

  const normalizedUnitId =
    unit_id !== undefined ? normalizeUnitId(unit_id) : undefined;

  if (unit_id !== undefined && !normalizedUnitId) {
    return res.status(400).json({
      message: "Unit ID must contain letters and numbers only",
    });
  }

  const phoneError = invalidPhoneMessage({ contact_number, head_of_institution_mobile });
  if (phoneError) {
    return res.status(400).json({ message: phoneError });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Dynamic profile update */
    const fields = [];
    const values = [];
    let idx = 1;

    if (unit_id !== undefined) {
      fields.push(`unit_id = $${idx++}`);
      values.push(normalizedUnitId);
    }

    if (school_type !== undefined) {
      fields.push(`school_type = $${idx++}`);
      values.push(school_type);
    }

    if (school_location !== undefined) {
      fields.push(`school_location = $${idx++}`);
      values.push(school_location);
    }

    if (school_category !== undefined) {
      fields.push(`school_category = $${idx++}`);
      values.push(school_category);
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

    if (head_of_institution_name !== undefined) {
      fields.push(`head_of_institution_name = $${idx++}`);
      values.push(head_of_institution_name);
    }

    if (head_of_institution_mobile !== undefined) {
      fields.push(`head_of_institution_mobile = $${idx++}`);
      values.push(head_of_institution_mobile);
    }

    if (fields.length > 0) {
      values.push(userId);

      const updateRes = await client.query(
        `
        UPDATE scert_db.school_profiles
        SET ${fields.join(", ")},
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $${idx}
        `,
        values
      );

      if (updateRes.rowCount === 0) {
        throw new Error("School profile not found");
      }
    }

    /* 2️⃣ Update class strength (replace only if provided) */
    if (Array.isArray(class_strengths)) {
      // Remove existing strengths
      await client.query(
        `DELETE FROM scert_db.school_student_strength
         WHERE school_user_id = $1`,
        [userId]
      );

      if (class_strengths.length > 0) {
        const strengthValues = [];
        const placeholders = class_strengths
          .map((row, index) => {
            const base = index * 5;
            strengthValues.push(
              userId,
              row.class_level,
              row.category,
              row.boys_count || 0,
              row.girls_count || 0
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
          })
          .join(", ");

        await client.query(
          `
          INSERT INTO scert_db.school_student_strength
          (school_user_id, class_level, category, boys_count, girls_count)
          VALUES ${placeholders}
          `,
          strengthValues
        );
      }
    }

    /* 3️⃣ Ensure profile remains completed */
    await client.query(
      `UPDATE scert_db.users
       SET profile_completed = true
       WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");
    schoolProfileCache.delete(userId);

    res.json({
      message: "School profile updated successfully",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School profile update error:", err);
    if (isLegacyIntegerOverflowError(err)) {
      return res.status(400).json({
        message: "Unit ID is too large for the current database column. Please contact the administrator.",
      });
    }
    res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
};
