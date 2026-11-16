const pool = require("../config/db");
const {
  maxCentersForScholarshipName,
  REGISTRATION_COUNT_COLUMNS,
  registrationCountsLateral,
} = require("../services/centerCounts.service");

const isCmScheme = (scholarshipId, scholarshipName) => {
  const scholarshipNameLower = String(scholarshipName || "").toLowerCase();
  return (
    Number(scholarshipId) === 3 ||
    /\bcm\b/i.test(scholarshipNameLower) ||
    /chief\s*minister/i.test(scholarshipNameLower)
  );
};

/**
 * GET ELIGIBLE SCHOOLS FOR CENTER CREATION
 * GET /beo/centers/eligible-schools
 */
exports.getEligibleSchoolsForCenters = async (req, res) => {
  console.log("QUERY:", req.query);
  console.log("BODY:", req.body);

  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;

const scholarship_id =
  req.query?.scholarship_id ||
  req.body?.scholarship_id;

if (!scholarship_id) {
  return res.status(400).json({
    message: "scholarship_id is required",
  });
}


  // 🔐 Role check
  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  // 🔐 Session check
  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  if (!scholarship_id) {
    return res.status(400).json({
      message: "scholarship_id is required",
    });
  }

  try {
    /* 1️⃣ Get BEO block */
    const beoRes = await pool.query(
      `
      SELECT block_code
      FROM scert_db.beo_profiles
      WHERE user_id = $1
      `,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({
        message: "BEO profile not found",
      });
    }

    const blockCode = beoRes.rows[0].block_code;

    /* 2️⃣ Fetch eligible schools (SCHOLARSHIP SCOPED) */
    const { rows } = await pool.query(
      `
      SELECT
        sp.user_id AS school_user_id,
        sp.school_name,
        sp.udise_code,
        sp.school_category
      FROM scert_db.school_profiles sp
      LEFT JOIN scert_db.exam_centers ec
        ON ec.school_user_id = sp.user_id
       AND ec.session_id = $2
       AND ec.scholarship_id = $3
       AND ec.is_active = true
      WHERE sp.block_code = $1
        AND (
          sp.school_category ILIKE '%Sec%'
          OR sp.school_category ILIKE '%HSec%'
        )
        AND ec.center_id IS NULL
      ORDER BY sp.school_name ASC
      `,
      [blockCode, session_id, scholarship_id]
    );

    res.json({
      count: rows.length,
      schools: rows,
    });
  } catch (err) {
    console.error("Fetch eligible schools error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
  console.log("QUERY:", req.query);
console.log("BODY:", req.body);
console.log("HEADERS:", req.headers);
};



/**
 * CREATE EXAM CENTER
 * POST /beo/centers
 */
exports.createCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { scholarship_id, centers } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  if (!Array.isArray(centers) || centers.length === 0) {
    return res.status(400).json({ message: "centers array is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Get BEO block */
    const beoRes = await client.query(
      `
      SELECT block_code
      FROM scert_db.beo_profiles
      WHERE user_id = $1
      `,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const blockCode = beoRes.rows[0].block_code;

    /* 2️⃣ Validate scholarship */
    const scholarshipRes = await client.query(
      `
      SELECT scholarship_id, scholarship_name
      FROM scert_db.scholarships
      WHERE scholarship_id = $1
        AND session_id = $2
        AND status = 'ACTIVE'
      `,
      [scholarship_id, session_id]
    );

    if (scholarshipRes.rows.length === 0) {
      throw new Error("Invalid or inactive scholarship for current session");
    }

    const maxCenters = maxCentersForScholarshipName(
      scholarshipRes.rows[0].scholarship_name
    );

    /* 3️⃣ Block creation if centers already confirmed */
    const confirmedRes = await client.query(
      `
      SELECT 1
      FROM scert_db.exam_centers
      WHERE session_id = $1
        AND scholarship_id = $2
        AND block_code = $3
        AND is_confirmed = true
        AND is_active = true
      LIMIT 1
      `,
      [session_id, scholarship_id, blockCode]
    );

    if (confirmedRes.rows.length > 0) {
      throw new Error(
        "Centers are already confirmed. Cannot create new centers."
      );
    }

    /* 4️⃣ Get current max center_order (SESSION + SCHOLARSHIP + BLOCK) */
    const maxOrderRes = await client.query(
      `
      SELECT COALESCE(MAX(center_order), 0) AS max_order
      FROM scert_db.exam_centers
      WHERE session_id = $1
        AND scholarship_id = $2
        AND block_code = $3
        AND is_active = true
      `,
      [session_id, scholarship_id, blockCode]
    );

    let nextCenterOrder = Number(maxOrderRes.rows[0].max_order) + 1;

    /* 5️⃣ Lock existing centers in SAME scope */
    await client.query(
      `
      SELECT center_id
      FROM scert_db.exam_centers
      WHERE session_id = $1
        AND scholarship_id = $2
        AND block_code = $3
        AND is_active = true
      FOR UPDATE
      `,
      [session_id, scholarship_id, blockCode]
    );

    /* Centre limit (NMMSS): counted after the lock above, so two requests
       cannot both pass the check and together exceed it. */
    if (maxCenters !== null) {
      const existingRes = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM scert_db.exam_centers
        WHERE session_id = $1
          AND scholarship_id = $2
          AND block_code = $3
          AND is_active = true
        `,
        [session_id, scholarship_id, blockCode]
      );
      const existing = existingRes.rows[0].total;

      if (existing + centers.length > maxCenters) {
        const remaining = Math.max(0, maxCenters - existing);
        throw new Error(
          `NMMSS allows at most ${maxCenters} exam centers per block. ` +
            `${existing} already created, so ${remaining} more can be added.`
        );
      }
    }

    /* 6️⃣ Insert centers sequentially */
    for (const center of centers) {
      const {
        school_user_id,
        superintendent_name,
        superintendent_mobile,
      } = center;

      if (!school_user_id || !superintendent_name || !superintendent_mobile) {
        throw new Error("Incomplete center details");
      }

      /* Validate school */
      const schoolRes = await client.query(
        `
        SELECT udise_code, school_name
        FROM scert_db.school_profiles
        WHERE user_id = $1
          AND block_code = $2
          AND (
            school_category ILIKE '%Sec%'
            OR school_category ILIKE '%HSec%'
          )
        `,
        [school_user_id, blockCode]
      );

      if (schoolRes.rows.length === 0) {
        throw new Error(
          `Invalid or ineligible school selected: ${school_user_id}`
        );
      }

      /* Prevent duplicate center for same school (same scholarship) */
      const exists = await client.query(
        `
        SELECT 1
        FROM scert_db.exam_centers
        WHERE session_id = $1
          AND scholarship_id = $2
          AND school_user_id = $3
          AND is_active = true
        `,
        [session_id, scholarship_id, school_user_id]
      );

      if (exists.rows.length > 0) {
        throw new Error(
          `Center already exists for school_user_id ${school_user_id}`
        );
      }

      const { udise_code, school_name } = schoolRes.rows[0];

      await client.query(
        `
        INSERT INTO scert_db.exam_centers
        (
          session_id,
          scholarship_id,
          block_code,
          school_user_id,
          udise_code,
          school_name,
          center_order,
          superintendent_name,
          superintendent_mobile,
          created_by_beo
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          session_id,
          scholarship_id,
          blockCode,
          school_user_id,
          udise_code,
          school_name,
          nextCenterOrder,
          superintendent_name,
          superintendent_mobile,
          beoUserId,
        ]
      );

      nextCenterOrder++;
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Exam centers created successfully",
      total_centers: centers.length,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Create centers error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};




/**
 * LIST EXAM CENTERS (BEO)
 * GET /beo/centers
 */
exports.getCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    // 1️⃣ Get BEO block
    const beoRes = await pool.query(
      `
      SELECT block_code
      FROM scert_db.beo_profiles
      WHERE user_id = $1
      `,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Fetch centers
    let query = `
      SELECT
        c.center_id,
        c.center_order,
        c.school_user_id,
        sp.school_name,
        sp.udise_code,
        c.block_code,
        COALESCE(
          NULLIF(TRIM(sp.block_name), ''),
          NULLIF(TRIM(bp_self.block_name), ''),
          NULLIF(TRIM(bp_meta.block_name), '')
        ) AS block_name,
        COALESCE(
          NULLIF(TRIM(sp.district_code::text), ''),
          NULLIF(TRIM(bp_self.district_code::text), ''),
          NULLIF(TRIM(bp_meta.district_code::text), '')
        ) AS district_code,
        COALESCE(
          NULLIF(TRIM(sp.district_name), ''),
          NULLIF(TRIM(bp_self.district_name), ''),
          NULLIF(TRIM(bp_meta.district_name), '')
        ) AS district_name,
        c.superintendent_name,
        c.superintendent_mobile,
        ${REGISTRATION_COUNT_COLUMNS},
        c.created_at,
        c.is_confirmed
      FROM scert_db.exam_centers c
      JOIN scert_db.school_profiles sp
        ON sp.user_id = c.school_user_id
      LEFT JOIN scert_db.beo_profiles bp_self
        ON bp_self.user_id = $3
      LEFT JOIN LATERAL (
        SELECT
          bp.block_name,
          bp.district_code,
          bp.district_name
        FROM scert_db.beo_profiles bp
        WHERE bp.block_code = c.block_code
        ORDER BY bp.updated_at DESC NULLS LAST, bp.user_id DESC
        LIMIT 1
      ) bp_meta ON true
      JOIN scert_db.scholarships sch
        ON sch.scholarship_id = c.scholarship_id
      ${registrationCountsLateral("c", "sch")}
      WHERE c.block_code = $1
        AND c.session_id = $2
        AND c.is_active = true
    `;

    const params = [blockCode, session_id, beoUserId];

    if (scholarship_id) {
      query += ` AND c.scholarship_id = $4`;
      params.push(scholarship_id);
    }

    query += ` ORDER BY c.center_order ASC`;

    const centersRes = await pool.query(query, params);

    // The most centres this BEO may create for the scholarship (null: no
    // limit), so the page can show and enforce it without its own copy.
    let maxCenters = null;
    if (scholarship_id) {
      const nameRes = await pool.query(
        `SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $1`,
        [scholarship_id]
      );
      maxCenters = maxCentersForScholarshipName(nameRes.rows[0]?.scholarship_name);
    }

    res.json({
      total: centersRes.rows.length,
      max_centers: maxCenters,
      centers: centersRes.rows,
    });
  } catch (err) {
    console.error("Get centers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



/**
 * EDIT A CENTRE'S SUPERINTENDENT (BEO)
 * PUT /beo/centers/:center_id   body: { superintendent_name, superintendent_mobile }
 *
 * Changes only the two superintendent fields of a centre in the caller's own
 * block. The centre's school, order and applications are untouched. Everything
 * that shows the superintendent (centre lists, nominal roll, admit cards) reads
 * exam_centers, so the correction appears everywhere at once.
 */
exports.updateCenterSuperintendent = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const centerId = Number(req.params.center_id);

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!Number.isInteger(centerId) || centerId <= 0) {
    return res.status(400).json({ message: "Invalid center id" });
  }

  const name = String(req.body?.superintendent_name ?? "").trim().replace(/\s+/g, " ");
  const mobile = String(req.body?.superintendent_mobile ?? "").trim();

  if (!name) {
    return res.status(400).json({ message: "Superintendent name is required" });
  }
  if (name.length > 150) {
    return res.status(400).json({ message: "Superintendent name is too long" });
  }
  if (!/^\d{10}$/.test(mobile)) {
    return res
      .status(400)
      .json({ message: "Superintendent mobile must be a valid 10-digit phone number." });
  }

  try {
    const result = await pool.query(
      `
      UPDATE scert_db.exam_centers c
         SET superintendent_name = $1,
             superintendent_mobile = $2
        FROM scert_db.beo_profiles b
       WHERE c.center_id = $3
         AND c.is_active = true
         AND b.user_id = $4
         AND b.block_code = c.block_code
      RETURNING c.center_id, c.center_order, c.school_name,
                c.superintendent_name, c.superintendent_mobile
      `,
      [name, mobile, centerId, beoUserId]
    );

    // No row: the centre does not exist, is inactive, or is in another block.
    // The three are not told apart, so ids of other blocks' centres are not probed.
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Center not found" });
    }

    res.json({
      message: "Superintendent details updated",
      center: result.rows[0],
    });
  } catch (err) {
    console.error("Update center superintendent error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


exports.getAllCentersForScert = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code, block_code } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const districtCodeExpr = `
      COALESCE(
        NULLIF(TRIM(sp.district_code::text), ''),
        NULLIF(TRIM(bp_meta.district_code::text), '')
      )
    `;

    let query = `
      SELECT
        c.center_id,
        c.center_order,
        c.school_user_id,
        sp.school_name,
        sp.udise_code,
        c.superintendent_name,
        c.superintendent_mobile,
        c.block_code,
        c.is_confirmed,
        COALESCE(
          NULLIF(TRIM(sp.block_name), ''),
          NULLIF(TRIM(bp_meta.block_name), '')
        ) AS block_name,
        ${districtCodeExpr} AS district_code,
        COALESCE(
          NULLIF(TRIM(sp.district_name), ''),
          NULLIF(TRIM(bp_meta.district_name), '')
        ) AS district_name,
        ${REGISTRATION_COUNT_COLUMNS},
        c.created_at
      FROM scert_db.exam_centers c
      JOIN scert_db.school_profiles sp
        ON sp.user_id = c.school_user_id
      JOIN scert_db.scholarships sch
        ON sch.scholarship_id = c.scholarship_id
      LEFT JOIN LATERAL (
        SELECT
          bp.block_name,
          bp.district_code,
          bp.district_name
        FROM scert_db.beo_profiles bp
        WHERE bp.block_code = c.block_code
        ORDER BY bp.updated_at DESC NULLS LAST, bp.user_id DESC
        LIMIT 1
      ) bp_meta ON true
      ${registrationCountsLateral("c", "sch")}
      WHERE c.session_id = $1
        AND c.is_active = true
    `;

    const params = [session_id];
    let idx = 2;

    if (scholarship_id) {
      query += ` AND c.scholarship_id = $${idx++}`;
      params.push(scholarship_id);
    }

    if (district_code) {
      query += ` AND ${districtCodeExpr} = $${idx++}`;
      params.push(district_code);
    }

    if (block_code) {
      query += ` AND c.block_code = $${idx++}`;
      params.push(block_code);
    }

    query += `
      ORDER BY
        district_code,
        c.block_code,
        c.center_order
    `;

    const centersRes = await pool.query(query, params);

    res.json({
      total: centersRes.rows.length,
      centers: centersRes.rows,
    });
  } catch (err) {
    console.error("Get all centers for SCERT error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};




/**
 * GET APPLICATIONS PENDING CENTER ASSIGNMENT (BEO)
 * GET /beo/applications/pending-center/:scholarship_id
 */
exports.getPendingCenterApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { scholarship_id } = req.params;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  try {
    // 1️⃣ Get BEO block
    const beoRes = await pool.query(
      `
      SELECT block_code
      FROM scert_db.beo_profiles
      WHERE user_id = $1
      `,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Fetch applications
    const { rows } = await pool.query(
      `
      SELECT
  a.application_id,
        a.application_display_id AS application_display_id,
  a.student_user_id,
  sp.full_name AS student_name,
  sc.school_name,
  sc.udise_code,
  a.center_id,
  a.created_at
      FROM scert_db.scholarship_applications a
      LEFT JOIN scert_db.student_profiles sp
        ON sp.user_id = a.student_user_id
      JOIN scert_db.school_profiles sc
        ON (sp.udise_code = sc.udise_code OR a.created_by_school_user_id = sc.user_id)
      WHERE a.current_stage = 'BEO'
  AND a.status = 'SUBMITTED'
  AND a.session_id = $1
  AND a.scholarship_id = $2
  AND sc.block_code = $3
      ORDER BY a.created_at ASC
      `,
      [session_id, scholarship_id, blockCode]
    );

    // Enrich rows with student_name fallback from form answers
    const enrichedRows = await Promise.all(
      rows.map(async (row) => {
        if (row.student_name) {
          return row;
        }

        const answersRes = await pool.query(
          `SELECT ff.field_key, 
                  COALESCE(aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path) AS value
           FROM scert_db.scholarship_application_answers aa
           JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
           WHERE aa.application_id = $1 AND ff.field_key = 'student_name'`,
          [row.application_id]
        );

        if (answersRes.rows.length > 0) {
          row.student_name = answersRes.rows[0].value || null;
        }

        return row;
      })
    );

    res.json({
      total: enrichedRows.length,
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("Fetch pending center applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



/**
 * ASSIGN CENTER TO APPLICATION (BEO)
 * POST /beo/applications/:application_id/assign-center
 */
exports.assignCenterToApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { application_id } = req.params;
  const { center_id } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  if (!center_id) {
    return res.status(400).json({ message: "center_id is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Get BEO block */
    const beoRes = await client.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const blockCode = beoRes.rows[0].block_code;

    /* 2️⃣ Fetch application (LOCK ROW) */
    const appRes = await client.query(
      `
      SELECT
        application_id,
        scholarship_id,
        class,
        current_stage,
        status,
        center_id,
        app_serial_no,
        block_code
      FROM scert_db.scholarship_applications
      WHERE application_id = $1
        AND session_id = $2
      FOR UPDATE
      `,
      [application_id, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    if (app.current_stage !== "BEO" || app.status !== "SUBMITTED") {
      throw new Error("Application not eligible for center assignment");
    }

    /* 3️⃣ Validate center (CONFIRMED + SAME BLOCK) */
    const centerRes = await client.query(
      `
      SELECT center_id
      FROM scert_db.exam_centers
      WHERE center_id = $1
        AND session_id = $2
        AND scholarship_id = $3
        AND block_code = $4
        AND is_confirmed = true
        AND is_active = true
      `,
      [center_id, session_id, app.scholarship_id, blockCode]
    );

    if (centerRes.rows.length === 0) {
      throw new Error("Invalid or unconfirmed center for this application");
    }

    /* 4️⃣ Generate SERIAL
          - Scholarship 3 → class-wise
          - Scholarship 6 (and others) → existing non-class scope
    */
    const scholarshipMetaRes = await client.query(
      `
      SELECT scholarship_name
      FROM scert_db.scholarships
      WHERE scholarship_id = $1
      LIMIT 1
      `,
      [app.scholarship_id]
    );
    const scholarshipName = scholarshipMetaRes.rows[0]?.scholarship_name || "";

    let appSerialNo = app.app_serial_no;
    const isClassScopedSerial = isCmScheme(app.scholarship_id, scholarshipName);
    let classScopedValue = null;

    if (isClassScopedSerial) {
      classScopedValue = Number(app.class);
      if (![6, 9].includes(classScopedValue)) {
        throw new Error("Application class must be 6 or 9 for scholarship 3");
      }
    }

    if (appSerialNo === null) {
      let lockQuery = `
        SELECT application_id
        FROM scert_db.scholarship_applications
        WHERE session_id = $1
          AND scholarship_id = $2
          AND block_code = $3
          AND app_serial_no IS NOT NULL
      `;
      const lockParams = [session_id, app.scholarship_id, blockCode];

      let serialQuery = `
        SELECT COALESCE(MAX(app_serial_no), 0) + 1 AS next_serial
        FROM scert_db.scholarship_applications
        WHERE session_id = $1
          AND scholarship_id = $2
          AND block_code = $3
          AND app_serial_no IS NOT NULL
      `;

      const params = [session_id, app.scholarship_id, blockCode];

      // ✅ CORRECT: class split ONLY for scholarship_id = 3
      if (isClassScopedSerial) {
        lockQuery += ` AND class = $4`;
        lockParams.push(classScopedValue);
        serialQuery += ` AND class = $4`;
        params.push(classScopedValue);
      }

      // Lock current serial scope rows before MAX() read for transaction-safe generation.
      await client.query(`${lockQuery} FOR UPDATE`, lockParams);

      const serialRes = await client.query(serialQuery, params);
      appSerialNo = serialRes.rows[0].next_serial;
    }

    /* 5️⃣ Assign / Reassign center (SERIAL LOCKED) */
    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET center_id = $1,
          block_code = COALESCE(block_code, $2),
          app_serial_no = COALESCE(app_serial_no, $3),
          updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $4
      `,
      [center_id, blockCode, appSerialNo, application_id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Center assigned successfully",
      application_id,
      center_id,
      block_code: blockCode,
      app_serial_no: appSerialNo,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Assign center error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};








exports.confirmCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { scholarship_id } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  if (!scholarship_id) {
    return res.status(400).json({
      message: "scholarship_id is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get BEO block
    const beoRes = await client.query(
      `
      SELECT block_code
      FROM scert_db.beo_profiles
      WHERE user_id = $1
      `,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Validate scholarship
    const scholarshipRes = await client.query(
      `
      SELECT scholarship_id
      FROM scert_db.scholarships
      WHERE scholarship_id = $1
        AND session_id = $2
        AND status = 'ACTIVE'
      `,
      [scholarship_id, session_id]
    );

    if (scholarshipRes.rows.length === 0) {
      throw new Error("Invalid or inactive scholarship for current session");
    }

    // 3️⃣ Lock unconfirmed centers (ONLY these)
    const centersRes = await client.query(
      `
      SELECT center_id
      FROM scert_db.exam_centers
      WHERE session_id = $1
        AND scholarship_id = $2
        AND block_code = $3
        AND is_confirmed = false
        AND is_active = true
      FOR UPDATE
      `,
      [session_id, scholarship_id, blockCode]
    );

    if (centersRes.rows.length === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.json({
        message: "No new centers to confirm",
        confirmed_count: 0,
      });
    }

    // 4️⃣ Confirm only unconfirmed centers
    const updateRes = await client.query(
      `
      UPDATE scert_db.exam_centers
      SET is_confirmed = true,
          updated_at = CURRENT_TIMESTAMP
      WHERE session_id = $1
        AND scholarship_id = $2
        AND block_code = $3
        AND is_confirmed = false
        AND is_active = true
      `,
      [session_id, scholarship_id, blockCode]
    );

    await client.query("COMMIT");

    res.json({
      message: "Centers confirmed successfully",
      confirmed_count: updateRes.rowCount,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Confirm centers error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

exports.getDraftCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    // 1️⃣ Get BEO block
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Fetch only DRAFT centers
    const { rows } = await pool.query(
      `
      SELECT
        c.center_id,
        c.center_order,
        c.school_user_id,
        sp.school_name,
        sp.udise_code,
        c.superintendent_name,
        c.superintendent_mobile,
        c.created_at
      FROM scert_db.exam_centers c
      JOIN scert_db.school_profiles sp
        ON sp.user_id = c.school_user_id
      WHERE c.session_id = $1
        AND c.scholarship_id = $2
        AND c.block_code = $3
        AND c.is_confirmed = false
        AND c.is_active = true
      ORDER BY c.center_order ASC
      `,
      [session_id, scholarship_id, blockCode]
    );

    res.json({
      total: rows.length,
      centers: rows,
    });
  } catch (err) {
    console.error("Get draft centers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


exports.reorderDraftCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { scholarship_id, center_orders } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  if (!scholarship_id || !Array.isArray(center_orders)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get BEO block
    const beoRes = await client.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Validate centers (draft only)
    const ids = center_orders.map(c => c.center_id);

    const checkRes = await client.query(
      `
      SELECT center_id
      FROM scert_db.exam_centers
      WHERE center_id = ANY($1)
        AND session_id = $2
        AND scholarship_id = $3
        AND block_code = $4
        AND is_confirmed = false
        AND is_active = true
      FOR UPDATE
      `,
      [ids, session_id, scholarship_id, blockCode]
    );

    if (checkRes.rows.length !== ids.length) {
      throw new Error("One or more centers are not editable");
    }

    // 3️⃣ Update orders
    for (const { center_id, center_order } of center_orders) {
      await client.query(
        `
        UPDATE scert_db.exam_centers
        SET center_order = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE center_id = $2
        `,
        [center_order, center_id]
      );
    }

    await client.query("COMMIT");

    res.json({ message: "Draft centers reordered successfully" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Reorder centers error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


exports.deleteDraftCenter = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { center_id } = req.params;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get BEO block
    const beoRes = await client.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Validate center (draft only)
    const centerRes = await client.query(
      `
      SELECT scholarship_id
      FROM scert_db.exam_centers
      WHERE center_id = $1
        AND session_id = $2
        AND block_code = $3
        AND is_confirmed = false
        AND is_active = true
      FOR UPDATE
      `,
      [center_id, session_id, blockCode]
    );

    if (centerRes.rows.length === 0) {
      throw new Error("Center not found or cannot be deleted");
    }

    // 3️⃣ Ensure no applications assigned
    const appRes = await client.query(
      `
      SELECT 1
      FROM scert_db.scholarship_applications
      WHERE center_id = $1
      LIMIT 1
      `,
      [center_id]
    );

    if (appRes.rows.length > 0) {
      throw new Error("Center already assigned to applications");
    }

    // 4️⃣ Soft delete
    await client.query(
      `
      UPDATE scert_db.exam_centers
      SET is_active = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE center_id = $1
      `,
      [center_id]
    );

    await client.query("COMMIT");

    res.json({ message: "Draft center deleted successfully" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Delete draft center error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};
