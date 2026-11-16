const pool = require("../config/db");
const { generateRollNumber } = require("../utils/rollNumber");

const normalizeFieldKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

const getStudentRegistration = (answers = {}, row = {}) =>
  answers.student_registration ||
  answers.student_registration_id ||
  answers.student_registration_no ||
  answers.student_registration_number ||
  answers.student_reg_no ||
  answers.registration_no ||
  answers.registration_number ||
  answers.sr_no ||
  answers.sr_number ||
  row.student_registration_no ||
  row.sr_no ||
  null;

const isDisabilityYes = (value) => {
  const v = String(value ?? "").trim().toLowerCase();
  return ["yes", "y", "1", "true", "divyang", "pwbd", "disabled"].includes(v);
};

const resolveDivyangtaCode = (answers = {}, row = {}) => {
  const statusValue =
    answers.disability_status ||
    answers.divyangta_status ||
    answers.is_divyang ||
    answers.is_disabled ||
    answers.disability ||
    null;

  const codeValue =
    row.type_of_divyangta ||
    answers.disability_code ||
    answers.divyangta_code ||
    answers.type_of_disability_code ||
    answers.type_of_divyangta_code ||
    answers.type_of_divyangta ||
    answers.type_of_disability ||
    answers.divyangta ||
    null;

  const normalizedStatus = String(statusValue ?? "").trim().toLowerCase();
  const hasExplicitNoStatus = ["no", "n", "0", "false"].includes(normalizedStatus);
  const normalizedCode = String(codeValue ?? "").trim();
  const hasCode =
    !!normalizedCode &&
    !["no", "none", "null", "na", "n/a", "-"].includes(normalizedCode.toLowerCase());

  if (hasExplicitNoStatus) return "NO";
  if (isDisabilityYes(statusValue)) return hasCode ? normalizedCode : null;

  // When disability status key is missing/misaligned but code exists, preserve code.
  return hasCode ? normalizedCode : "NO";
};



/**
 * 📥 SCERT INBOX (FILTERABLE)
 * GET /scert/applications/inbox
 */
exports.getInbox = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id, is_active } = req.session;

  const {
    scholarship_id,
    center_id,
    status,
    current_stage,
    class_filter,
  } = req.query;

  const normalizedStage = current_stage
    ? String(current_stage).toUpperCase()
    : "SCERT";
  const normalizedStatus = status ? String(status).toUpperCase() : null;

  // 🔐 Role check
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  // 🔐 Session check
  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  try {
    let conditions = [];
    let values = [];
    let idx = 1;

    // mandatory conditions
    conditions.push(`a.current_stage = $${idx++}`);
    values.push(normalizedStage);

    conditions.push(`a.session_id = $${idx++}`);
    values.push(session_id);

    // optional filters
    if (scholarship_id) {
      conditions.push(`a.scholarship_id = $${idx++}`);
      values.push(scholarship_id);
    }

    if (center_id) {
      conditions.push(`a.center_id = $${idx++}`);
      values.push(center_id);
    }

    if (normalizedStatus) {
      conditions.push(`a.status = $${idx++}`);
      values.push(normalizedStatus);
    }

    if (class_filter) {
      conditions.push(`a.class::text = $${idx++}`);
      values.push(String(class_filter));
    }

    const countsOnly = req.query.counts_only === 'true';

    if (countsOnly) {
      const countOnlyQuery = `
        SELECT a.application_id, a.center_id
        FROM scert_db.scholarship_applications a
        WHERE ${conditions.join(" AND ")}
      `;
      const { rows: countRows } = await pool.query(countOnlyQuery, values);
      if (res.headersSent) return;
      return res.json({
        total: countRows.length,
        applications: countRows
      });
    }

    const countTotalQuery = `
      SELECT COUNT(*)::int AS count
      FROM scert_db.scholarship_applications a
      WHERE ${conditions.join(" AND ")}
    `;
    const { rows: countTotalRes } = await pool.query(countTotalQuery, values);
    const totalCount = countTotalRes[0].count;

    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.max(1, parseInt(req.query.limit) || 20);
    const offset = (pageNum - 1) * limitNum;
    const isExport = req.query.export === 'true';

    let query = `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
        a.status,
        a.current_stage,
        a.center_id,
        a.class,
        a.app_serial_no,
        a.submitted_at,

        s.scholarship_id,
        s.scholarship_name,

        sp.school_name,
        sp.udise_code,

        stp.full_name AS student_name,

        ec.center_order

      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.school_profiles sp
        ON sp.user_id = a.created_by_school_user_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = a.center_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY
        ec.center_order NULLS LAST,
        a.app_serial_no NULLS LAST,
        a.submitted_at ASC
    `;

    if (!isExport) {
      query += ` LIMIT $${idx++} OFFSET $${idx++}`;
      values.push(limitNum, offset);
    }

    const { rows } = await pool.query(query, values);

    const appIds = rows.map((r) => r.application_id).filter(Boolean);
    const desiredKeys = [
      "student_name",
      "candidate_name",
      "previous_school_udise",
      "student_registration",
      "student_registration_id",
      "student_registration_no",
      "student_registration_number",
      "student_reg_no",
      "registration_no",
      "registration_number",
      "sr_no",
      "sr_number",
    ];

    const normalizedDesiredKeys = desiredKeys.map(normalizeFieldKey);
    const answersRes = appIds.length
      ? await pool.query(
          `SELECT aa.application_id,
                  LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) AS field_key,
                  COALESCE(
                    opt.option_value,
                    COALESCE(aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path)
                  ) AS value
           FROM scert_db.scholarship_application_answers aa
           JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
           LEFT JOIN scert_db.scholarship_form_field_options opt
             ON opt.field_id = aa.field_id
            AND opt.is_active = true
            AND (
              LOWER(TRIM(opt.option_value)) = LOWER(TRIM(COALESCE(aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path)))
              OR LOWER(TRIM(opt.option_label)) = LOWER(TRIM(COALESCE(aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path)))
            )
           WHERE aa.application_id = ANY($1)
             AND (
               ff.field_key = ANY($2)
               OR LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) = ANY($3)
             )`,
          [appIds, desiredKeys, normalizedDesiredKeys]
        )
      : { rows: [] };

    const answersByApp = {};
    answersRes.rows.forEach((ans) => {
      if (!answersByApp[ans.application_id]) answersByApp[ans.application_id] = {};
      answersByApp[ans.application_id][ans.field_key] = ans.value ?? null;
    });

    const preschoolUdiseCodes = Array.from(
      new Set(
        Object.values(answersByApp)
          .map((answers) => String(answers.previous_school_udise || "").trim())
          .filter(Boolean)
      )
    );

    const preschoolByUdise = {};
    if (preschoolUdiseCodes.length) {
      const preschoolRes = await pool.query(
        `SELECT DISTINCT ON (udise_code) udise_code, school_name
         FROM (
           SELECT
             p.udise_code,
             p.school_name,
             1 AS src_order
           FROM scert_db.primary_schools_master p
           WHERE p.udise_code = ANY($1)
           UNION ALL
           SELECT
             s.udise_code,
             s.school_name,
             2 AS src_order
           FROM scert_db.school_profiles s
           WHERE s.udise_code = ANY($1)
         ) t
         ORDER BY udise_code, src_order`,
        [preschoolUdiseCodes]
      );
      preschoolRes.rows.forEach((r) => {
        preschoolByUdise[String(r.udise_code).trim()] = r;
      });
    }

    const enrichedRows = rows.map((row) => {
      const answers = answersByApp[row.application_id] || {};
      const previousSchoolUdise = String(answers.previous_school_udise || "").trim() || null;
      const previousSchool = previousSchoolUdise ? preschoolByUdise[previousSchoolUdise] : null;

      const studentRegistrationNo = getStudentRegistration(answers, row);

      return {
        ...row,
        student_name: row.student_name || answers.student_name || answers.candidate_name || null,
        previous_school_udise: previousSchoolUdise,
        previous_school_name: previousSchool?.school_name || null,
        student_registration_no: studentRegistrationNo,
        sr_no: studentRegistrationNo,
      };
    });

    res.json({
      total: totalCount,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      filters: {
        scholarship_id: scholarship_id || null,
        center_id: center_id || null,
        status: status || null,
        class_filter: class_filter || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("SCERT inbox error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



exports.viewApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;

  // 🔐 SCERT role only
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    /* 1️⃣ Fetch application core */
    const appRes = await pool.query(
      `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
        a.status,
        a.current_stage,
        a.submitted_at,
        a.is_locked,
        a.app_serial_no,
        a.exam_code,
        sch.scholarship_id,
        sch.scholarship_name,
        stp.full_name AS student_name,
        COALESCE(sc_student.school_name, sc_creator.school_name) AS origin_school,
        COALESCE(sc_student.block_code, sc_creator.block_code) AS school_block_code,
        COALESCE(sc_student.udise_code, sc_creator.udise_code) AS school_udise_code,
        ec.center_id,
        ec.school_name AS center_name,
        ec.superintendent_name,
        ec.superintendent_mobile
      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships sch
        ON sch.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.school_profiles sc_student
        ON stp.udise_code = sc_student.udise_code
      LEFT JOIN scert_db.school_profiles sc_creator
        ON sc_creator.user_id = a.created_by_school_user_id
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = a.center_id
      WHERE a.application_id = $1
        AND a.session_id = $2
      `,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    const application = appRes.rows[0];

    /* 2️⃣ Fetch form fields */
    const fieldsRes = await pool.query(
      `
      SELECT
        field_id,
        field_label,
        field_key,
        field_type,
        is_required,
        sort_order
      FROM scert_db.scholarship_form_fields
      WHERE scholarship_id = $1
        AND is_active = true
      ORDER BY sort_order ASC
      `,
      [application.scholarship_id]
    );

    const fields = fieldsRes.rows;

    /* 3️⃣ Fetch options */
    const fieldIds = fields.map((f) => f.field_id);
    let optionsByField = {};

    if (fieldIds.length > 0) {
      const optionsRes = await pool.query(
        `
        SELECT
          option_id,
          field_id,
          option_label,
          option_value,
          sort_order
        FROM scert_db.scholarship_form_field_options
        WHERE field_id = ANY($1)
          AND is_active = true
        ORDER BY sort_order ASC
        `,
        [fieldIds]
      );

      for (const opt of optionsRes.rows) {
        if (!optionsByField[opt.field_id]) {
          optionsByField[opt.field_id] = [];
        }
        optionsByField[opt.field_id].push(opt);
      }
    }

    /* 4️⃣ Fetch saved answers */
    const answersRes = await pool.query(
      `
      SELECT
        field_id,
        value_text,
        value_number,
        value_date,
        value_file_path
      FROM scert_db.scholarship_application_answers
      WHERE application_id = $1
      `,
      [applicationId]
    );

    const answersMap = {};
    for (const ans of answersRes.rows) {
      answersMap[ans.field_id] =
        ans.value_text ??
        ans.value_number ??
        ans.value_date ??
        ans.value_file_path ??
        null;
    }

    // Fallback: use student_name from form if profile name is null
    if (!application.student_name) {
      const studentNameField = fields.find(f => f.field_key === 'student_name');
      if (studentNameField && answersMap[studentNameField.field_id]) {
        application.student_name = answersMap[studentNameField.field_id];
      }
    }

    const form = fields.map((f) => ({
      ...f,
      options: ["DROPDOWN", "RADIO", "CHECKBOX"].includes(f.field_type)
        ? optionsByField[f.field_id] || []
        : [],
      value: answersMap[f.field_id] ?? null,
    }));

    /* 5️⃣ Fetch remarks history */
    const remarksRes = await pool.query(
      `
      SELECT
        action,
        from_stage,
        to_stage,
        remark_text,
        created_at
      FROM scert_db.application_remarks
      WHERE application_id = $1
      ORDER BY created_at ASC
      `,
      [applicationId]
    );

    /* 6️⃣ Final response */
    res.json({
      application: {
        application_id: application.application_id,
        status: application.status,
        current_stage: application.current_stage,
        submitted_at: application.submitted_at,
        is_locked: application.is_locked,
        app_serial_no: application.app_serial_no,
        exam_code: application.exam_code,
      },
      scholarship: {
        scholarship_id: application.scholarship_id,
        scholarship_name: application.scholarship_name,
      },
      student: {
        name: application.student_name,
      },
      school: {
        name: application.origin_school,
        block_code: application.school_block_code,
        udise_code: application.school_udise_code,
      },
      center: application.center_id
        ? {
            center_id: application.center_id,
            center_name: application.center_name,
            superintendent_name: application.superintendent_name,
            superintendent_mobile: application.superintendent_mobile,
          }
        : null,
      form,
      remarks: remarksRes.rows,
    });
  } catch (err) {
    console.error("SCERT view application error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * 🔁 SCERT RETURN APPLICATION TO BEO
 * POST /scert/applications/:application_id/return
 */
exports.returnApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const scertUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id, is_active } = req.session;
  const { remark_text } = req.body;

  // 🔐 Role check
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  // 🔐 Session check
  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  if (!remark_text || remark_text.trim() === "") {
    return res.status(400).json({
      message: "remark_text is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Fetch application */
    const appRes = await client.query(
      `
      SELECT
        application_id,
        current_stage,
        status,
        is_locked
      FROM scert_db.scholarship_applications
      WHERE application_id = $1
        AND session_id = $2
      FOR UPDATE
      `,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    /* 2️⃣ Validations */
    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (app.current_stage !== "SCERT") {
      throw new Error("Application is not at SCERT stage");
    }

    if (app.status !== "SUBMITTED") {
      throw new Error("Only submitted applications can be returned");
    }

    /* 3️⃣ Insert remark */
    await client.query(
      `
      INSERT INTO scert_db.application_remarks
      (
        application_id,
        action,
        from_stage,
        to_stage,
        remark_text,
        created_by
      )
      VALUES ($1, 'RETURN', 'SCERT', 'BEO', $2, $3)
      `,
      [applicationId, remark_text.trim(), scertUserId]
    );

    /* 4️⃣ Update application */
    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET
        status = 'RETURNED',
        current_stage = 'BEO',
        is_locked = false,
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $1
        AND session_id = $2
      `,
      [applicationId, session_id]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application returned to BEO successfully",
      current_stage: "BEO",
      status: "RETURNED",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SCERT return application error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


/**
 * 🔁 SCERT CHANGE APPLICATION CENTER
 * PUT /scert/applications/:application_id/change-center
 */
exports.changeCenter = async (req, res) => {
  const roleId = req.user.role_id;
  const scertUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id, is_active } = req.session;
  const { new_center_id } = req.body;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  if (!new_center_id) {
    return res.status(400).json({
      message: "new_center_id is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Lock application */
    const appRes = await client.query(
      `
      SELECT
        application_id,
        scholarship_id,
        center_id,
        current_stage,
        status,
        is_locked,
        app_serial_no,
        block_code
      FROM scert_db.scholarship_applications
      WHERE application_id = $1
        AND session_id = $2
      FOR UPDATE
      `,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    /* 2️⃣ Validations */
    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (app.current_stage !== "SCERT") {
      throw new Error("Application is not at SCERT stage");
    }

    if (app.status !== "SUBMITTED") {
      throw new Error("Only submitted applications can change center");
    }

    /* 3️⃣ Validate new center (same scholarship + session) */
/* 3️⃣ Validate new center (SCERT override allowed) */
const centerRes = await client.query(
  `
  SELECT center_id
  FROM scert_db.exam_centers
  WHERE center_id = $1
    AND session_id = $2
    AND scholarship_id = $3
    AND is_active = true
  `,
  [new_center_id, session_id, app.scholarship_id]
);

if (centerRes.rows.length === 0) {
  throw new Error("Invalid center for this scholarship/session");
}

    /* 4️⃣ Change ONLY the center (IDENTITY PRESERVED) */
    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET
        center_id = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $2
        AND session_id = $3
      `,
      [new_center_id, applicationId, session_id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Center changed successfully",
      application_id: applicationId,
      new_center_id,
      app_serial_no: app.app_serial_no,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SCERT change center error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};




/**
 * ✅ SCERT APPROVE APPLICATION (FINAL)
 * POST /scert/applications/:application_id/approve
 */
exports.approveApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const applicationId = req.params.application_id;
  const { session_id, is_active } = req.session;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Fetch application ONLY (NO JOIN) */
    const appRes = await client.query(
      `
      SELECT
        sa.application_id,
        sa.status,
        sa.current_stage,
        sa.center_id,
        sa.exam_code,
        sa.is_locked,
        sa.app_serial_no,
        sa.roll_number,
        sa.created_by_school_user_id,
        sa.scholarship_id,
        s.scholarship_name
      FROM scert_db.scholarship_applications sa
      JOIN scert_db.scholarships s
        ON s.scholarship_id = sa.scholarship_id
      WHERE sa.application_id = $1
        AND sa.session_id = $2
      FOR UPDATE
      `,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    /* 2️⃣ Core validations */
    if (app.is_locked || app.roll_number) {
      throw new Error("Application already approved");
    }

    if (app.current_stage !== "SCERT") {
      throw new Error("Application not at SCERT stage");
    }

    if (app.status !== "SUBMITTED") {
      throw new Error("Application not in submitted state");
    }

    if (!app.center_id) {
      throw new Error("Center must be assigned before approval");
    }

    /* 3️⃣ Fetch class (OPTIONAL) */
    const classRes = await client.query(
      `
      SELECT COALESCE(value_text, value_number::TEXT) AS class
      FROM scert_db.scholarship_application_answers aa
      JOIN scert_db.scholarship_form_fields ff
        ON ff.field_id = aa.field_id
      WHERE aa.application_id = $1
        AND ff.field_key = 'class'
      `,
      [applicationId]
    );

    const classValue = classRes.rows[0]?.class || null;

    /* 4️⃣ Required fields for admit card */
    const requiredFields = [
      "student_name",
      "father_name",
      "date_of_birth",
      "caste_category",
      "sex",
      "candidate_photograph",
    ];

const fieldsRes = await client.query(
  `
  SELECT
    LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) AS field_key,
    COALESCE(
      aa.value_text,
      aa.value_number::TEXT,
      aa.value_date::TEXT,
      aa.value_file_path
    ) AS value
  FROM scert_db.scholarship_application_answers aa
  JOIN scert_db.scholarship_form_fields ff
    ON ff.field_id = aa.field_id
  WHERE aa.application_id = $1
    AND (
      ff.field_key = ANY($2)
      OR LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) = ANY($3)
    )
  `,
  [applicationId, requiredFields, requiredFields.map(normalizeFieldKey)]
);

// Build map
const fieldMap = {};
fieldsRes.rows.forEach(r => {
  fieldMap[r.field_key] = r.value;
});

// Validate missing OR empty fields
const missingFields = requiredFields.filter(
  key => !fieldMap[key] || String(fieldMap[key]).trim() === ""
);

if (missingFields.length > 0) {
  throw new Error(
    `Admit card details incomplete. Missing: ${missingFields.join(", ")}`
  );
}


    if (fieldsRes.rows.length !== requiredFields.length) {
      throw new Error("Admit card details incomplete");
    }

    /* 5️⃣ Eligibility fields (used only if scholarship = 6) */
    const eligibilityKeys = [
      "percentage_of_class_vii",
      "parental_annual_income",
      "caste_category",
    ];

    const eligibilityRes = await client.query(
      `
      SELECT
        LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) AS field_key,
        COALESCE(aa.value_number::TEXT, aa.value_text) AS value
      FROM scert_db.scholarship_application_answers aa
      JOIN scert_db.scholarship_form_fields ff
        ON ff.field_id = aa.field_id
      WHERE aa.application_id = $1
        AND (
          ff.field_key = ANY($2)
          OR LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) = ANY($3)
        )
      `,
      [applicationId, eligibilityKeys, eligibilityKeys.map(normalizeFieldKey)]
    );

    const eligibilityData = {};
    eligibilityRes.rows.forEach(r => {
      eligibilityData[r.field_key] = r.value;
    });

    /* 6️⃣ Fetch school + center meta */
    const metaRes = await client.query(
      `
      SELECT
        sp.district_code,
        sp.block_code,
        ec.center_order
      FROM scert_db.school_profiles sp
      JOIN scert_db.exam_centers ec
        ON ec.center_id = $1
      WHERE sp.user_id = $2
      `,
      [app.center_id, app.created_by_school_user_id]
    );

    if (metaRes.rows.length === 0) {
      throw new Error("School or center data missing");
    }

    const { district_code, block_code, center_order } = metaRes.rows[0];

    /* 7️⃣ Global roll number generation (collision-safe) */
    let resolvedSerial = Number(app.app_serial_no);
    if (!Number.isFinite(resolvedSerial) || resolvedSerial <= 0) {
      throw new Error("Application serial is missing. Please reassign center before approval.");
    }

    const rollLockScope = `roll_no:${session_id}:${app.scholarship_id}:${district_code}:${block_code}:${center_order}`;
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      [rollLockScope]
    );

    let rollNumber = null;
    const maxAttempts = 10000;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts += 1;
      rollNumber = generateRollNumber({
        scholarship_id: app.scholarship_id,
        scholarship_name: app.scholarship_name,
        exam_code: app.exam_code,
        classValue,
        caste_category: eligibilityData.caste_category,
        parental_annual_income: eligibilityData.parental_annual_income,
        percentage: eligibilityData.percentage_of_class_vii,
        district_code,
        block_code,
        center_order,
        app_serial_no: resolvedSerial,
      });

      const collisionRes = await client.query(
        `
        SELECT application_id
        FROM scert_db.scholarship_applications
        WHERE roll_number = $1
          AND application_id <> $2
        LIMIT 1
        FOR UPDATE
        `,
        [rollNumber, applicationId]
      );

      if (collisionRes.rows.length === 0) break;
      resolvedSerial += 1;
    }

    if (attempts >= maxAttempts) {
      throw new Error("Unable to generate unique roll number. Please retry approval.");
    }

    if (Number(app.app_serial_no) !== resolvedSerial) {
      await client.query(
        `
        UPDATE scert_db.scholarship_applications
        SET app_serial_no = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE application_id = $2
        `,
        [resolvedSerial, applicationId]
      );
    }

    /* 8️⃣ Final approval */
    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET
        roll_number = $1,
        status = 'APPROVED',
        is_locked = true,
        admit_card_generated_at = CURRENT_TIMESTAMP,
        final_approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $2
      `,
      [rollNumber, applicationId]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application approved successfully",
      application_id: applicationId,
      roll_number: rollNumber,
      admit_card_ready: true,
      status: "APPROVED",
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SCERT approve error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};








/**
 * 📋 GET APPROVED APPLICATIONS
 * GET /scert/applications/approved
 */
exports.getApprovedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;

  const { scholarship_id, center_id, class_filter, page, limit, export: isExport, district_code, block_code, roll_number } = req.query;

  // Allow School to access this report for now
  if (![2, 5].includes(roleId)) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    let conditions = [];
    let values = [];
    let idx = 1;

    // mandatory conditions
    conditions.push(`a.status = 'APPROVED'`);
    conditions.push(`a.session_id = $${idx++}`);
    values.push(session_id);

    // optional filters
    if (scholarship_id) {
      conditions.push(`a.scholarship_id = $${idx++}`);
      values.push(scholarship_id);
    }

    if (center_id) {
      conditions.push(`a.center_id = $${idx++}`);
      values.push(center_id);
    }

    if (class_filter) {
      conditions.push(`a.class::text = $${idx++}`);
      values.push(String(class_filter));
    }

    let countJoins = "";
    if (district_code || block_code) {
      countJoins = "LEFT JOIN scert_db.school_profiles sp ON sp.user_id = a.created_by_school_user_id";
      if (district_code) {
        conditions.push(`sp.district_code = $${idx++}`);
        values.push(district_code);
      }
      if (block_code) {
        conditions.push(`sp.block_code = $${idx++}`);
        values.push(block_code);
      }
    }

    // Roll number: matches any part of the roll, digits only, so a wildcard
    // typed by a user is inert.
    const rollDigits = String(roll_number ?? "").replace(/\D/g, "");
    if (rollDigits) {
      conditions.push(`a.roll_number LIKE $${idx++}`);
      values.push(`%${rollDigits}%`);
    }

    const countTotalQuery = `
      SELECT COUNT(*)::int AS count
      FROM scert_db.scholarship_applications a
      ${countJoins}
      WHERE ${conditions.join(" AND ")}
    `;
    const { rows: countTotalRes } = await pool.query(countTotalQuery, values);
    const totalCount = countTotalRes[0].count;

    let query = `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
        a.status,
        a.current_stage,
        a.center_id,
        a.app_serial_no,
        a.roll_number,
        a.exam_code,
        att.mat_status,
        att.sat_status,
        CASE
          WHEN att.mat_status = 'ABSENT' THEN 'A'
          WHEN att.mat_status = 'PRESENT' THEN 'P'
          ELSE NULL
        END AS mat,
        CASE
          WHEN att.sat_status = 'ABSENT' THEN 'A'
          WHEN att.sat_status = 'PRESENT' THEN 'P'
          ELSE NULL
        END AS sat,
        a.is_locked,
        a.final_approved_at,
        a.submitted_at,

        s.scholarship_id,
        s.scholarship_name,

        sp.school_name AS origin_school,
        sp.udise_code,
        sp.block_code,
        sp.district_code,
        sp.block_name,
        sp.district_name,
        sp.school_type,
        sp.school_location AS school_category,

        stp.full_name AS student_name,

        ec.school_name AS center_name,
        ec.center_order,
        ec.superintendent_name,
        ec.superintendent_mobile

      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.school_profiles sp
        ON sp.user_id = a.created_by_school_user_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = a.center_id
      LEFT JOIN scert_db.center_exam_attendance_reports ar
        ON ar.session_id = a.session_id
       AND ar.scholarship_id = a.scholarship_id
       AND ar.center_id = a.center_id
      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.report_id = ar.report_id
       AND att.application_id = a.application_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY
        ec.center_order ASC NULLS LAST,
        sp.district_code ASC NULLS LAST,
        sp.block_code ASC NULLS LAST,
        a.roll_number ASC NULLS LAST,
        a.app_serial_no ASC NULLS LAST,
        a.application_id ASC
    `;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 20);
    const offset = (pageNum - 1) * limitNum;

    if (isExport !== 'true') {
      query += ` LIMIT $${idx++} OFFSET $${idx++}`;
      values.push(limitNum, offset);
    }

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      if (res.headersSent) return;
      return res.json({
        total: 0,
        filters: {
          scholarship_id: scholarship_id || null,
          center_id: center_id || null,
        },
        applications: [],
      });
    }

    // Batch-fetch a few key form answers so the frontend can show candidate + family info
    const appIds = rows.map((r) => r.application_id);
    const desiredKeys = [
      'student_name',
      'candidate_name',
      'father_name',
      'mother_name',
      'date_of_birth',
      'sex',
      'class',
      'caste_category',
      'type_of_divyangta',
      'type_of_disability',
      'divyangta',
      'disability',
      'disability_status',
      'divyangta_status',
      'is_divyang',
      'is_disabled',
      'disability_code',
      'divyangta_code',
      'type_of_disability_code',
      'type_of_divyangta_code',
      'aadhaar_number',
      'aadhaar_no',
      'aadhar_number',
      'aadhar_no',
      'aadhaar',
      'contact_no',
      'contact_number',
      'mobile_number',
      'phone',
      'previous_school_udise',
      'marks_class_7',
      'percentage_marks_class_7',
      'percentage_of_class_vii',
      'parental_income_code',
      'income_code',
      'parental_annual_income',
      'student_registration',
      'student_registration_id',
      'student_registration_no',
      'student_registration_number',
      'student_reg_no',
      'registration_no',
      'registration_number',
      'sr_no',
      'sr_number',
    ];

    const normalizedDesiredKeys = desiredKeys.map(normalizeFieldKey);

    // 1. Fetch relevant fields
    const fieldsRes = await pool.query(`
      SELECT field_id, field_key, field_label 
      FROM scert_db.scholarship_form_fields 
      WHERE field_key = ANY($1)
         OR LOWER(REGEXP_REPLACE(TRIM(field_key), '\\s+', '', 'g')) = ANY($2)
         OR field_label ILIKE '%student%registration%'
         OR field_label ILIKE '%registration%number%'
         OR field_label ILIKE 'sr no%'
    `, [desiredKeys, normalizedDesiredKeys]);
    
    const fieldMap = {};
    const validFieldIds = [];
    fieldsRes.rows.forEach(f => {
      validFieldIds.push(f.field_id);
      fieldMap[f.field_id] = {
        field_key: String(f.field_key || '').toLowerCase().replace(/\\s+/g, ''),
        field_label: f.field_label
      };
    });

    // 2. Fetch options for these fields
    const optionsRes = await pool.query(`
      SELECT field_id, option_label, option_value 
      FROM scert_db.scholarship_form_field_options 
      WHERE field_id = ANY($1) AND is_active = true
    `, [validFieldIds]);
    
    const optionsMap = {};
    optionsRes.rows.forEach(opt => {
      if (!optionsMap[opt.field_id]) optionsMap[opt.field_id] = [];
      optionsMap[opt.field_id].push({
        label: String(opt.option_label || '').toLowerCase().trim(),
        value: String(opt.option_value || '').toLowerCase().trim(),
        realValue: opt.option_value
      });
    });

    // 3. Fetch raw answers
    let answersResRows = [];
    if (appIds.length > 0 && validFieldIds.length > 0) {
      let ansConditions = [`aa.application_id = ANY($1)`, `aa.field_id = ANY($2)`];
      let ansValues = [appIds, validFieldIds];

      const answersRes = await pool.query(`
        SELECT aa.application_id, aa.field_id, aa.value_text, aa.value_date, aa.value_number, aa.value_file_path
        FROM scert_db.scholarship_application_answers aa
        WHERE ${ansConditions.join(" AND ")}
      `, ansValues);
      answersResRows = answersRes.rows;
    }

    // 4. Map answers in Node.js
    const answersByApp = {};
    answersResRows.forEach((ans) => {
      if (!answersByApp[ans.application_id]) {
        answersByApp[ans.application_id] = {};
      }
      const f = fieldMap[ans.field_id];
      if (!f) return;

      const rawVal = ans.value_text ?? ans.value_date ?? ans.value_number ?? ans.value_file_path;
      let finalVal = rawVal;

      if (rawVal !== null && optionsMap[ans.field_id]) {
        const compareVal = String(rawVal).toLowerCase().trim();
        const matchedOpt = optionsMap[ans.field_id].find(o => o.value === compareVal || o.label === compareVal);
        if (matchedOpt) finalVal = matchedOpt.realValue;
      }

      answersByApp[ans.application_id][f.field_key] = finalVal ?? null;
      
      const label = String(f.field_label || "").toLowerCase();
      if (
        !answersByApp[ans.application_id].student_registration &&
        (label.includes("student") && label.includes("registration"))
      ) {
        answersByApp[ans.application_id].student_registration = finalVal ?? null;
      }
    });

    const preschoolUdiseCodes = Array.from(
      new Set(
        Object.values(answersByApp)
          .map((answers) => String(answers.previous_school_udise || '').trim())
          .filter(Boolean)
      )
    );

    const preschoolByUdise = {};
    if (preschoolUdiseCodes.length) {
      const preschoolRes = await pool.query(
        `SELECT DISTINCT ON (udise_code) udise_code, school_name, school_management_code
         FROM (
           SELECT
             p.udise_code,
             p.school_name,
             p.school_management_code,
             1 AS src_order
           FROM scert_db.primary_schools_master p
           WHERE p.udise_code = ANY($1)
           UNION ALL
           SELECT
             s.udise_code,
             s.school_name,
             COALESCE(s.school_type, s.school_category, '') AS school_management_code,
             2 AS src_order
           FROM scert_db.school_profiles s
           WHERE s.udise_code = ANY($1)
         ) t
         ORDER BY udise_code, src_order`,
        [preschoolUdiseCodes]
      );
      preschoolRes.rows.forEach((r) => {
        preschoolByUdise[String(r.udise_code).trim()] = r;
      });
    }

    let enrichedRows = rows.map((row) => {
      const answers = answersByApp[row.application_id] || {};
      const candidateName =
        row.student_name ||
        answers.student_name ||
        answers.candidate_name ||
        null;
      const previousSchoolUdise = String(answers.previous_school_udise || '').trim() || null;
      const previousSchool = previousSchoolUdise ? preschoolByUdise[previousSchoolUdise] : null;
      const parentalIncomeRaw = String(
        answers.parental_annual_income || ''
      ).trim();
      let derivedParentalIncomeCode = null;
      if (parentalIncomeRaw) {
        const normalizedIncome = parentalIncomeRaw.toLowerCase();
        const compactIncome = normalizedIncome.replace(/\s+/g, '');
        if (
          compactIncome === '1' ||
          normalizedIncome.includes('up to') ||
          normalizedIncome.includes('upto') ||
          normalizedIncome.includes('<=')
        ) {
          derivedParentalIncomeCode = '1';
        } else if (
          compactIncome === '2' ||
          normalizedIncome.includes('more than') ||
          normalizedIncome.includes('>=') ||
          normalizedIncome.includes('>')
        ) {
          derivedParentalIncomeCode = '2';
        } else {
          const numericChunks = normalizedIncome.replace(/,/g, '').match(/\d+/g);
          const preferredChunk =
            numericChunks?.find((chunk) => chunk.length > 2) ||
            numericChunks?.[0] ||
            null;
          const numericIncome = preferredChunk ? Number(preferredChunk) : NaN;
          if (Number.isFinite(numericIncome)) {
            derivedParentalIncomeCode = numericIncome <= 350000 ? '1' : '2';
          }
        }
      }

      return {
        ...row,
        candidate_name: candidateName,
        student_name: candidateName,
        father_name: answers.father_name || null,
        mother_name: answers.mother_name || null,
        date_of_birth: answers.date_of_birth || null,
        sex: answers.sex || null,
        class: answers.class || null,
        caste_category: answers.caste_category || null,
        type_of_divyangta:
          resolveDivyangtaCode(answers, row),
        aadhaar_number:
          answers.aadhaar_number ||
          answers.aadhaar_no ||
          answers.aadhar_number ||
          answers.aadhar_no ||
          answers.aadhaar ||
          null,
        contact_no:
          answers.contact_no ||
          answers.contact_number ||
          answers.mobile_number ||
          answers.phone ||
          null,
        previous_school_udise: previousSchoolUdise,
        previous_school_name: previousSchool?.school_name || null,
        previous_school_type: previousSchool?.school_management_code || null,
        marks_class_7:
          answers.marks_class_7 ||
          answers.percentage_marks_class_7 ||
          answers.percentage_of_class_vii ||
          null,
        parental_income_code:
          answers.parental_income_code ||
          answers.income_code ||
          derivedParentalIncomeCode ||
          null,
        student_registration_no: getStudentRegistration(answers, row),
        sr_no: getStudentRegistration(answers, row),
      };
    });

    if (res.headersSent) return;
    res.json({
      total: totalCount,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      filters: {
        scholarship_id: scholarship_id || null,
        center_id: center_id || null,
        class_filter: class_filter || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("SCERT get approved applications error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
    }
  }
};


/**
 * ✏️ Edit answers (SCERT)
 */
exports.editAnswers = async (req, res) => {
  return res.status(501).json({
    message: "editAnswers not implemented yet",
  });
};

/**
 * 📚 Get scholarships (SCERT filters)
 */
exports.getScholarships = async (req, res) => {
  return res.status(501).json({
    message: "getScholarships not implemented yet",
  });
};

/**
 * 🏫 Get centers (SCERT filters)
 * GET /scert/centers?scholarship_id=&block_code=
 */
exports.getCenters = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, block_code } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    let conditions = [];
    let values = [];
    let idx = 1;

    conditions.push(`ec.scholarship_id = $${idx++}`);
    values.push(scholarship_id);

    conditions.push(`ec.session_id = $${idx++}`);
    values.push(session_id);

    if (block_code) {
      conditions.push(`ec.block_code = $${idx++}`);
      values.push(block_code);
    }

    const query = `
      SELECT
        ec.center_id,
        ec.school_name AS center_name,
        ec.center_order,
        ec.block_code,
        ec.udise_code,
        ec.superintendent_name,
        ec.superintendent_mobile,
        ec.is_active
      FROM scert_db.exam_centers ec
      WHERE ${conditions.join(" AND ")}
        AND ec.is_active = true
      ORDER BY ec.center_order ASC
    `;

    const { rows } = await pool.query(query, values);

    res.json({
      total: rows.length,
      centers: rows,
    });
  } catch (err) {
    console.error("SCERT get centers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
