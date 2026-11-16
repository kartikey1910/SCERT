const bcrypt = require("bcrypt");
const pool = require("../config/db");

async function reactivateUser(client, userId, passwordHash) {
  await client.query(
    `UPDATE scert_db.users
     SET password_hash = $2,
         is_active = true,
         is_first_login = true,
         profile_completed = false,
         failed_attempts = 0,
         lock_until = NULL,
         token_version = COALESCE(token_version, 0) + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1`,
    [userId, passwordHash]
  );
}

exports.createSchool = async (req, res) => {
  const {
    school_name,
    udise_code,
    block_code,
    block_name,
    district_code,
    district_name,
    school_type,
    school_category,
    school_location,
  } = req.body;

  if (
    !school_name ||
    !udise_code ||
    !block_code ||
    !block_name ||
    !district_code ||
    !district_name ||
    !school_type ||
    !school_category ||
    !school_location
  ) {
    return res.status(400).json({
      message:
        "school_name, udise_code, block_code, block_name, district_code, district_name, school_type, school_category, school_location are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const defaultPassword = `scertPass`;
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // 1️⃣ Check if login_id already exists
    const existingUser = await client.query(
      `SELECT user_id, role_id, is_active
       FROM scert_db.users
       WHERE login_id = $1
       FOR UPDATE`,
      [udise_code]
    );

    const existingUserRow = existingUser.rows[0] || null;

    // 2️⃣ Check if school profile exists
    const existingSchool = await client.query(
      "SELECT user_id FROM scert_db.school_profiles WHERE udise_code = $1",
      [udise_code]
    );

    const existingSchoolRow = existingSchool.rows[0] || null;

    if (existingUserRow?.is_active) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(409).json({
        message: "School login already exists",
      });
    }

    if (existingSchoolRow && (!existingUserRow || existingUserRow.user_id !== existingSchoolRow.user_id)) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(409).json({
        message: "School profile already exists",
      });
    }

    if (existingUserRow) {
      if (Number(existingUserRow.role_id) !== 2) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        return res.status(409).json({
          message: "School login already exists",
        });
      }

      await reactivateUser(client, existingUserRow.user_id, passwordHash);
      await client.query(
        `UPDATE scert_db.school_profiles
         SET school_name = $2,
             udise_code = $3,
             block_code = $4,
             block_name = $5,
             district_code = $6,
             district_name = $7,
             school_type = $8,
             school_category = $9,
             school_location = $10
         WHERE user_id = $1`,
        [
          existingUserRow.user_id,
          school_name,
          udise_code,
          block_code,
          block_name,
          district_code,
          district_name,
          school_type,
          school_category,
          school_location,
        ]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "School created successfully",
        login_id: udise_code,
        default_password: defaultPassword,
      });
    }

    const userResult = await client.query(
      `INSERT INTO scert_db.users (role_id, login_id, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [2, udise_code, passwordHash]
    );

    const userId = userResult.rows[0].user_id;

    // 4️⃣ Create minimal school profile
    await client.query(
      `INSERT INTO scert_db.school_profiles (
        user_id,
        school_name,
        udise_code,
        block_code,
        block_name,
        district_code,
        district_name,
        school_type,
        school_category,
        school_location
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        school_name,
        udise_code,
        block_code,
        block_name,
        district_code,
        district_name,
        school_type,
        school_category,
        school_location,
      ] 
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "School created successfully",
      login_id: udise_code,
      default_password: defaultPassword,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("createSchool error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * SCERT creates a BEO (MINIMAL DATA)
 */
exports.createBeo = async (req, res) => {
  const { unit_id, block_code, block_name, district_code, district_name } =
    req.body;

  if (!unit_id || !block_code || !block_name || !district_code || !district_name) {
    return res.status(400).json({
      message:
        "unit_id, block_code, block_name, district_code, district_name are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ login_id = unit_id
    const loginId = String(unit_id);
    const defaultPassword = `scertPass`;
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // check duplicate user
    const existingUser = await client.query(
      `SELECT user_id, role_id, is_active
       FROM scert_db.users
       WHERE login_id = $1
       FOR UPDATE`,
      [loginId]
    );

    const existingUserRow = existingUser.rows[0] || null;

    // check duplicate BEO profile
    const existingBeo = await client.query(
      "SELECT user_id FROM scert_db.beo_profiles WHERE unit_id = $1",
      [unit_id]
    );

    const existingBeoRow = existingBeo.rows[0] || null;

    if (existingUserRow?.is_active) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(409).json({ message: "BEO already exists" });
    }

    if (existingBeoRow && (!existingUserRow || existingUserRow.user_id !== existingBeoRow.user_id)) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(409).json({ message: "BEO profile already exists" });
    }

    if (existingUserRow) {
      if (Number(existingUserRow.role_id) !== 3) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        return res.status(409).json({ message: "BEO already exists" });
      }

      await reactivateUser(client, existingUserRow.user_id, passwordHash);
      await client.query(
        `UPDATE scert_db.beo_profiles
         SET unit_id = $2,
             block_code = $3,
             block_name = $4,
             district_code = $5,
             district_name = $6
         WHERE user_id = $1`,
        [existingUserRow.user_id, unit_id, block_code, block_name, district_code, district_name]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "BEO created successfully",
        login_id: loginId,
        default_password: defaultPassword,
      });
    }

    // 3️⃣ create user (role_id = 3 → BEO)
    const userResult = await client.query(
      `INSERT INTO scert_db.users (role_id, login_id, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [3, loginId, passwordHash]
    );

    const userId = userResult.rows[0].user_id;

    // 4️⃣ create minimal BEO profile
    await client.query(
      `INSERT INTO scert_db.beo_profiles (
        user_id,
        unit_id,
        block_code,
        block_name,
        district_code,
        district_name
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, unit_id, block_code, block_name, district_code, district_name]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "BEO created successfully",
      login_id: loginId,
      default_password: defaultPassword,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("createBeo error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * SCERT creates a District (MINIMAL DATA)
 */
exports.createDistrict = async (req, res) => {
  const { unit_id, district_code, district_name } = req.body;

  if (!unit_id || !district_code || !district_name) {
    return res.status(400).json({
      message: "unit_id, district_code, district_name are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const loginId = String(unit_id);
    const defaultPassword = `scertPass`;
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // 1️⃣ check duplicate user
    const existingUser = await client.query(
      `SELECT user_id, role_id, is_active
       FROM scert_db.users
       WHERE login_id = $1
       FOR UPDATE`,
      [loginId]
    );

    const existingUserRow = existingUser.rows[0] || null;

    // 2️⃣ check duplicate district profile
    const existingDistrict = await client.query(
      "SELECT user_id FROM scert_db.district_profiles WHERE district_code = $1",
      [district_code]
    );

    const existingDistrictRow = existingDistrict.rows[0] || null;

    if (existingUserRow?.is_active) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(409).json({
        message: "District user already exists",
      });
    }

    if (existingDistrictRow && (!existingUserRow || existingUserRow.user_id !== existingDistrictRow.user_id)) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(409).json({
        message: "District profile already exists",
      });
    }

    if (existingUserRow) {
      if (Number(existingUserRow.role_id) !== 4) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        return res.status(409).json({
          message: "District user already exists",
        });
      }

      await reactivateUser(client, existingUserRow.user_id, passwordHash);
      await client.query(
        `UPDATE scert_db.district_profiles
         SET unit_id = $2,
             district_code = $3,
             district_name = $4
         WHERE user_id = $1`,
        [existingUserRow.user_id, unit_id, district_code, district_name]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "District created successfully",
        login_id: loginId,
        default_password: defaultPassword,
      });
    }

    // 4️⃣ create user (role_id = 4 → DISTRICT)
    const userResult = await client.query(
      `INSERT INTO scert_db.users (role_id, login_id, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [4, loginId, passwordHash]
    );

    const userId = userResult.rows[0].user_id;

    // 5️⃣ create minimal district profile
    await client.query(
      `INSERT INTO scert_db.district_profiles (
        user_id,
        unit_id,
        district_code,
        district_name
      ) VALUES ($1, $2, $3, $4)`,
      [userId, unit_id, district_code, district_name]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "District created successfully",
      login_id: loginId,
      default_password: defaultPassword,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("createDistrict error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * GET ALL SCHOOLS
 */
exports.getAllSchools = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const searchQuery = String(req.query.q || "").trim();
    const hasSearch = searchQuery.length > 0;
    const searchValue = `%${searchQuery}%`;

    const filterClause = hasSearch
      ? `
        AND (
          CAST(u.user_id AS TEXT) ILIKE $1
          OR u.login_id ILIKE $1
          OR sp.school_name ILIKE $1
          OR sp.udise_code ILIKE $1
          OR sp.district_name ILIKE $1
          OR sp.block_name ILIKE $1
        )`
      : "";

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM scert_db.users u
       JOIN scert_db.school_profiles sp ON u.user_id = sp.user_id
       WHERE u.role_id = 2
         AND COALESCE(u.is_active, true) = true
         ${filterClause}`,
      hasSearch ? [searchValue] : []
    );
    const total = parseInt(countResult.rows[0].total);

    // Get paginated data
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
        u.created_at
      FROM scert_db.users u
      JOIN scert_db.school_profiles sp ON u.user_id = sp.user_id
      WHERE u.role_id = 2
        AND COALESCE(u.is_active, true) = true
        ${filterClause}
      ORDER BY u.created_at DESC
      LIMIT $${hasSearch ? 2 : 1} OFFSET $${hasSearch ? 3 : 2}`,
      hasSearch ? [searchValue, limit, offset] : [limit, offset]
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("getAllSchools error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET ALL BEOs
 */
exports.getAllBeos = async (req, res) => {
  try {
    const { session_id } = req.session;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const scholarshipId = req.query.scholarship_id ? String(req.query.scholarship_id).trim() : null;
    const searchQuery = String(req.query.q || "").trim();
    const hasSearch = searchQuery.length > 0;

    // Get total count
    const countValues = [];
    let countSearchClause = "";
    if (hasSearch) {
      countValues.push(`%${searchQuery}%`);
      countSearchClause = `
        AND (
          CAST(u.user_id AS TEXT) ILIKE $1
          OR u.login_id ILIKE $1
          OR bp.unit_id::text ILIKE $1
          OR bp.district_name ILIKE $1
          OR bp.block_name ILIKE $1
        )`;
    }
    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM scert_db.users u
       JOIN scert_db.beo_profiles bp ON u.user_id = bp.user_id
       WHERE u.role_id = 3
         AND COALESCE(u.is_active, true) = true`
       + countSearchClause,
      countValues
    );
    const total = parseInt(countResult.rows[0].total);

    // Get paginated data
    const values = [session_id];
    let idx = 2;
    let scholarshipFilter = "";
    if (scholarshipId) {
      scholarshipFilter = ` AND sa.scholarship_id = $${idx++} `;
      values.push(scholarshipId);
    }
    let searchFilter = "";
    if (hasSearch) {
      searchFilter = `
        AND (
          CAST(u.user_id AS TEXT) ILIKE $${idx}
          OR u.login_id ILIKE $${idx}
          OR bp.unit_id::text ILIKE $${idx}
          OR bp.district_name ILIKE $${idx}
          OR bp.block_name ILIKE $${idx}
        )`;
      values.push(`%${searchQuery}%`);
      idx += 1;
    }
    values.push(limit, offset);

    const result = await pool.query(
       `WITH app_base AS (
         SELECT
           sa.application_id,
           sa.center_id,
           sa.session_id,
           sa.scholarship_id,
           COALESCE(sa.block_code, sp_student.block_code, sp_creator.block_code) AS resolved_block_code
         FROM scert_db.scholarship_applications sa
         LEFT JOIN scert_db.student_profiles st
           ON st.user_id = sa.student_user_id
         LEFT JOIN scert_db.school_profiles sp_student
           ON sp_student.udise_code = st.udise_code
         LEFT JOIN scert_db.school_profiles sp_creator
           ON sp_creator.user_id = sa.created_by_school_user_id
         WHERE sa.status = 'APPROVED'
           AND sa.session_id = $1
           ${scholarshipFilter}
       ),
       registered_by_block AS (
         SELECT
           ab.resolved_block_code AS block_code,
           COUNT(DISTINCT ab.application_id)::int AS registered_students
         FROM app_base ab
         GROUP BY ab.resolved_block_code
       ),
       appeared_by_block AS (
         SELECT
           cls.resolved_block_code AS block_code,
           COALESCE(SUM(GREATEST(cls.mat_present, cls.sat_present)), 0)::int AS appeared_students
         FROM (
           SELECT
             ab.resolved_block_code,
             ab.center_id,
             COALESCE(NULLIF(TRIM(sa.class::text), ''), CASE WHEN ab.scholarship_id = 6 THEN '8' ELSE NULL END) AS exam_class,
             COALESCE(SUM(CASE WHEN att.mat_status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS mat_present,
             COALESCE(SUM(CASE WHEN att.sat_status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS sat_present
           FROM app_base ab
           JOIN scert_db.scholarship_applications sa
             ON sa.application_id = ab.application_id
           LEFT JOIN scert_db.center_exam_attendance_reports ar
             ON ar.session_id = ab.session_id
            AND ar.scholarship_id = ab.scholarship_id
            AND ar.center_id = ab.center_id
           LEFT JOIN scert_db.center_exam_student_attendance att
             ON att.report_id = ar.report_id
            AND att.application_id = ab.application_id
           WHERE ab.center_id IS NOT NULL
           GROUP BY
             ab.resolved_block_code,
             ab.center_id,
             COALESCE(NULLIF(TRIM(sa.class::text), ''), CASE WHEN ab.scholarship_id = 6 THEN '8' ELSE NULL END)
         ) cls
         GROUP BY cls.resolved_block_code
       )
       SELECT 
        u.user_id,
        u.login_id,
        bp.unit_id,
        bp.block_code,
        bp.block_name,
        bp.district_code,
        bp.district_name,
        bp.distance_from_district_hq_km AS distance_from_ceo_office,
        bp.beo_name,
        bp.beo_account_no,
        bp.beo_ifsc_code,
        bp.beo_bank_name,
        bp.email,
        bp.contact_number,
        bp.beo_mobile,
        bp.dealing_person_name,
        bp.dealing_person_mobile,
        COALESCE(rbb.registered_students, 0) AS registered_students,
        COALESCE(abb.appeared_students, 0) AS appeared_students,
        u.created_at
      FROM scert_db.users u
      JOIN scert_db.beo_profiles bp ON u.user_id = bp.user_id
      LEFT JOIN registered_by_block rbb ON rbb.block_code = bp.block_code
      LEFT JOIN appeared_by_block abb ON abb.block_code = bp.block_code
      WHERE u.role_id = 3
        AND COALESCE(u.is_active, true) = true
        ${searchFilter}
      ORDER BY u.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("getAllBeos error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET ALL DISTRICTS
 */
exports.getAllDistricts = async (req, res) => {
  try {
    const sessionIdFromReq = req.query.session_id
      ? Number(req.query.session_id)
      : req.session?.session_id || null;
    const scholarshipId = req.query.scholarship_id
      ? String(req.query.scholarship_id).trim()
      : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const searchQuery = String(req.query.q || "").trim();
    const hasSearch = searchQuery.length > 0;

    // Get total count
    const countValues = [];
    let countSearchClause = "";
    if (hasSearch) {
      countValues.push(`%${searchQuery}%`);
      countSearchClause = `
        AND (
          CAST(u.user_id AS TEXT) ILIKE $1
          OR u.login_id ILIKE $1
          OR dp.unit_id::text ILIKE $1
          OR dp.district_name ILIKE $1
          OR dp.district_code::text ILIKE $1
        )`;
    }
    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM scert_db.users u
       JOIN scert_db.district_profiles dp
         ON dp.user_id = u.user_id
       WHERE u.role_id = 4
         AND COALESCE(u.is_active, true) = true`
       + countSearchClause,
      countValues
    );
    const total = parseInt(countResult.rows[0].total);

    // Get paginated data
    const params = [sessionIdFromReq, scholarshipId ? Number(scholarshipId) : null, limit, offset];
    let searchFilter = "";
    if (hasSearch) {
      params.push(`%${searchQuery}%`);
      searchFilter = `
        AND (
          CAST(u.user_id AS TEXT) ILIKE $5
          OR u.login_id ILIKE $5
          OR dp.unit_id::text ILIKE $5
          OR dp.district_name ILIKE $5
          OR dp.district_code::text ILIKE $5
        )`;
    }
    const result = await pool.query(
       `WITH app_base AS (
         SELECT
           sa.application_id,
           sa.center_id,
           sa.session_id,
           sa.scholarship_id,
           COALESCE(sa.block_code, sp_student.block_code, sp_creator.block_code) AS resolved_block_code,
           COALESCE(sp_student.district_code, sp_creator.district_code, bp_map.district_code) AS resolved_district_code
         FROM scert_db.scholarship_applications sa
         LEFT JOIN scert_db.student_profiles st
           ON st.user_id = sa.student_user_id
         LEFT JOIN scert_db.school_profiles sp_student
           ON sp_student.udise_code = st.udise_code
         LEFT JOIN scert_db.school_profiles sp_creator
           ON sp_creator.user_id = sa.created_by_school_user_id
         LEFT JOIN scert_db.beo_profiles bp_map
           ON bp_map.block_code = sa.block_code
         WHERE sa.status = 'APPROVED'
           AND ($1::bigint IS NULL OR sa.session_id = $1::bigint)
           AND ($2::bigint IS NULL OR sa.scholarship_id = $2::bigint)
       ),
       registered_by_district AS (
         SELECT
           ab.resolved_district_code AS district_code,
           COUNT(DISTINCT ab.application_id)::int AS registered_students
         FROM app_base ab
         GROUP BY ab.resolved_district_code
       ),
       appeared_by_district AS (
         SELECT
           cls.resolved_district_code AS district_code,
           COALESCE(SUM(GREATEST(cls.mat_present, cls.sat_present)), 0)::int AS appeared_students
         FROM (
           SELECT
             ab.resolved_district_code,
             ab.center_id,
             COALESCE(NULLIF(TRIM(sa.class::text), ''), CASE WHEN ab.scholarship_id = 6 THEN '8' ELSE NULL END) AS exam_class,
             COALESCE(SUM(CASE WHEN att.mat_status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS mat_present,
             COALESCE(SUM(CASE WHEN att.sat_status = 'PRESENT' THEN 1 ELSE 0 END), 0)::int AS sat_present
           FROM app_base ab
           JOIN scert_db.scholarship_applications sa
             ON sa.application_id = ab.application_id
           LEFT JOIN scert_db.center_exam_attendance_reports ar
             ON ar.session_id = ab.session_id
            AND ar.scholarship_id = ab.scholarship_id
            AND ar.center_id = ab.center_id
           LEFT JOIN scert_db.center_exam_student_attendance att
             ON att.report_id = ar.report_id
            AND att.application_id = ab.application_id
           WHERE ab.center_id IS NOT NULL
           GROUP BY
             ab.resolved_district_code,
             ab.center_id,
             COALESCE(NULLIF(TRIM(sa.class::text), ''), CASE WHEN ab.scholarship_id = 6 THEN '8' ELSE NULL END)
         ) cls
         GROUP BY cls.resolved_district_code
       )
       SELECT 
        u.user_id,
        u.login_id,
        dp.unit_id,
        dp.district_code,
        dp.district_name,
        dp.ceo_name,
        dp.account_no as ceo_account_no,
        dp.ifsc_code as ceo_ifsc_code,
        dp.bank_name as ceo_bank_name,
        dp.email,
        dp.contact_number,
        dp.ceo_mobile,
        dp.dealing_person_name,
        dp.dealing_person_mobile,
        dp.distance_from_paper_distribution_center_km,
        COALESCE(rbd.registered_students, 0)::int as registered_students,
        COALESCE(abd.appeared_students, 0)::int as appeared_students,
        u.created_at
      FROM scert_db.users u
      JOIN scert_db.district_profiles dp ON u.user_id = dp.user_id
      LEFT JOIN registered_by_district rbd ON rbd.district_code = dp.district_code
      LEFT JOIN appeared_by_district abd ON abd.district_code = dp.district_code
      WHERE u.role_id = 4
        AND COALESCE(u.is_active, true) = true
        ${searchFilter}
      ORDER BY u.created_at DESC
      LIMIT $3 OFFSET $4`,
      params
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("getAllDistricts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.resetUserPassword = async (req, res) => {
  const { user_id: userIdParam } = req.params;
  const userId = Number(userIdParam);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Valid user_id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT user_id, role_id, login_id
       FROM scert_db.users
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];

    if (![2, 3, 4].includes(Number(user.role_id))) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(400).json({
        message:
          "Password reset is only allowed for School, BEO, and District users",
      });
    }

    const defaultPassword = "scertPass";
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    await client.query(
      `UPDATE scert_db.users
       SET password_hash = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [user.user_id, passwordHash]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Password reset successfully",
      user_id: user.user_id,
      login_id: user.login_id,
      default_password: defaultPassword,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("resetUserPassword error:", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

exports.deleteUser = async (req, res) => {
  const { user_id: userIdParam } = req.params;
  const userId = Number(userIdParam);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Valid user_id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT user_id, role_id, login_id, is_active
       FROM scert_db.users
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];

    if (![2, 3, 4].includes(Number(user.role_id))) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(400).json({
        message: "Delete is only allowed for School, BEO, and District users",
      });
    }

    if (!user.is_active) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "User not found" });
    }

    await client.query(
      `UPDATE scert_db.users
       SET is_active = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [user.user_id]
    );

    await client.query("COMMIT");

    return res.json({
      message: "User deleted successfully",
      user_id: user.user_id,
      login_id: user.login_id,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("deleteUser error:", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};
