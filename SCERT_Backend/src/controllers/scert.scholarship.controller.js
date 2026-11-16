const pool = require("../config/db");
const scholarshipCache = new Map();


async function cloneScholarshipTemplateToSession(client, sourceSessionId, targetSessionId) {
  const scholarshipsRes = await client.query(
    `
    SELECT
      scholarship_id,
      scholarship_name,
      scholarship_details,
      eligibility,
      last_date,
      exam_date,
      exam_instructions,
      mat_start_time,
      mat_end_time,
      sat_start_time,
      sat_end_time,
      circular_file_path,
      circular_original_name,
      created_by,
      status
    FROM scert_db.scholarships
    WHERE session_id = $1
    ORDER BY scholarship_id ASC
    `,
    [sourceSessionId]
  );

  let clonedCount = 0;

  for (const oldScholarship of scholarshipsRes.rows) {
    const newScholarshipRes = await client.query(
      `
      INSERT INTO scert_db.scholarships (
        scholarship_name,
        scholarship_details,
        eligibility,
        last_date,
        exam_date,
        exam_instructions,
        mat_start_time,
        mat_end_time,
        sat_start_time,
        sat_end_time,
        circular_file_path,
        circular_original_name,
        created_by,
        status,
        session_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING scholarship_id
      `,
      [
        oldScholarship.scholarship_name,
        oldScholarship.scholarship_details,
        oldScholarship.eligibility,
        oldScholarship.last_date,
        oldScholarship.exam_date,
        oldScholarship.exam_instructions,
        oldScholarship.mat_start_time,
        oldScholarship.mat_end_time,
        oldScholarship.sat_start_time,
        oldScholarship.sat_end_time,
        oldScholarship.circular_file_path,
        oldScholarship.circular_original_name,
        oldScholarship.created_by,
        oldScholarship.status,
        targetSessionId,
      ]
    );

    const newScholarshipId = newScholarshipRes.rows[0].scholarship_id;

    const fieldsRes = await client.query(
      `
      SELECT
        field_id,
        field_label,
        field_key,
        field_type,
        is_required,
        sort_order,
        is_active
      FROM scert_db.scholarship_form_fields
      WHERE scholarship_id = $1
      ORDER BY sort_order ASC, field_id ASC
      `,
      [oldScholarship.scholarship_id]
    );

    const newFieldIdByOldFieldId = new Map();

    for (const field of fieldsRes.rows) {
      const newFieldRes = await client.query(
        `
        INSERT INTO scert_db.scholarship_form_fields (
          scholarship_id,
          field_label,
          field_key,
          field_type,
          is_required,
          sort_order,
          is_active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING field_id
        `,
        [
          newScholarshipId,
          field.field_label,
          field.field_key,
          field.field_type,
          field.is_required,
          field.sort_order,
          field.is_active,
        ]
      );
      newFieldIdByOldFieldId.set(String(field.field_id), newFieldRes.rows[0].field_id);
    }

    if (fieldsRes.rows.length > 0) {
      const oldFieldIds = fieldsRes.rows.map((f) => f.field_id);
      const optionsRes = await client.query(
        `
        SELECT
          field_id,
          option_label,
          option_value,
          sort_order,
          is_active
        FROM scert_db.scholarship_form_field_options
        WHERE field_id = ANY($1::bigint[])
        ORDER BY field_id ASC, sort_order ASC, option_id ASC
        `,
        [oldFieldIds]
      );

      for (const option of optionsRes.rows) {
        const mappedFieldId = newFieldIdByOldFieldId.get(String(option.field_id));
        if (!mappedFieldId) continue;

        await client.query(
          `
          INSERT INTO scert_db.scholarship_form_field_options (
            field_id,
            option_label,
            option_value,
            sort_order,
            is_active
          )
          VALUES ($1,$2,$3,$4,$5)
          `,
          [
            mappedFieldId,
            option.option_label,
            option.option_value,
            option.sort_order,
            option.is_active,
          ]
        );
      }
    }

    clonedCount += 1;
  }

  return clonedCount;
}

/**
 * CREATE SCHOLARSHIP
 * POST /scert/scholarships
 */
exports.createScholarship = async (req, res) => {
  const userId = req.user.user_id;
  const roleId = req.user.role_id;
  const { session_id } = req.session;


  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const {
    scholarship_name,
    scholarship_details,
    eligibility,
    last_date,
    exam_date,
    exam_instructions,
    mat_start_time,
    mat_end_time,
    sat_start_time,
    sat_end_time,
    circular_file_path,
    circular_original_name,
  } = req.body;

  if (!scholarship_name || !scholarship_details || !eligibility || !last_date) {
    return res.status(400).json({
      message:
        "scholarship_name, scholarship_details, eligibility, last_date are required",
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO scert_db.scholarships (
        scholarship_name,
        scholarship_details,
        eligibility,
        last_date,
        exam_date,
        exam_instructions,
        mat_start_time,
        mat_end_time,
        sat_start_time,
        sat_end_time,
        circular_file_path,
        circular_original_name,
        created_by,
        session_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING scholarship_id
      `,
      [
        scholarship_name,
        scholarship_details,
        eligibility,
        last_date,
        exam_date || null,
        exam_instructions || null,
        mat_start_time || null,
        mat_end_time || null,
        sat_start_time || null,
        sat_end_time || null,
        circular_file_path || null,
        circular_original_name || null,
        userId,
        session_id,
      ]
    );

    res.status(201).json({
      message: "Scholarship created successfully",
      scholarship_id: result.rows[0].scholarship_id,
      status: "DRAFT",
    });
  } catch (err) {
    console.error("Create scholarship error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * UPDATE SCHOLARSHIP
 * PUT /scert/scholarships/:id
 */
/**
 * UPDATE SCHOLARSHIP
 * PUT /scert/scholarships/:id
 */
exports.updateScholarship = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const scholarshipId = req.params.id;

  const {
    scholarship_name,
    scholarship_details,
    eligibility,
    last_date,
    exam_date,
    exam_instructions,
    mat_start_time,
    mat_end_time,
    sat_start_time,
    sat_end_time,
    circular_file_path,
    circular_original_name,
    status,
  } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE scert_db.scholarships
      SET
        scholarship_name = COALESCE($1, scholarship_name),
        scholarship_details = COALESCE($2, scholarship_details),
        eligibility = COALESCE($3, eligibility),
        last_date = COALESCE($4, last_date),
        exam_date = COALESCE($5, exam_date),
        exam_instructions = COALESCE($6, exam_instructions),
        mat_start_time = COALESCE($7, mat_start_time),
        mat_end_time = COALESCE($8, mat_end_time),
        sat_start_time = COALESCE($9, sat_start_time),
        sat_end_time = COALESCE($10, sat_end_time),
        circular_file_path = COALESCE($11, circular_file_path),
        circular_original_name = COALESCE($12, circular_original_name),
        status = COALESCE($13, status)
      WHERE scholarship_id = $14
        AND session_id = $15
      `,
      [
        scholarship_name,
        scholarship_details,
        eligibility,
        last_date,
        exam_date,
        exam_instructions,
        mat_start_time,
        mat_end_time,
        sat_start_time,
        sat_end_time,
        circular_file_path,
        circular_original_name,
        status,
        scholarshipId,
        session_id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.json({ message: "Scholarship updated successfully" });
  } catch (err) {
    console.error("Update scholarship error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET ALL SCHOLARSHIPS (SCERT)
 * GET /scert/scholarships
 */
exports.getAllScholarships = async (req, res) => {
  const { session_id } = req.session;

  try {
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Vary", "Authorization, x-session-id");

    const now = Date.now();
    const cached = scholarshipCache.get(session_id);

    if (cached && cached.expiresAt > now) {
      return res.json(cached.data);
    }

    const fetchForSession = async () => {
      const result = await pool.query(
        `
        SELECT
          scholarship_id,
          scholarship_name,
          status,
          last_date,
          exam_date,
          created_at
        FROM scert_db.scholarships
        WHERE session_id = $1
        ORDER BY created_at DESC, scholarship_id DESC
        `,
        [session_id]
      );
      return result.rows;
    };

    let rows = await fetchForSession();

    if (rows.length === 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `
          SELECT session_id
          FROM scert_db.academic_sessions
          WHERE session_id = $1
          FOR UPDATE
          `,
          [session_id]
        );

        const existingInTargetRes = await client.query(
          `
          SELECT COUNT(*)::int AS cnt
          FROM scert_db.scholarships
          WHERE session_id = $1
          `,
          [session_id]
        );

        if (existingInTargetRes.rows[0].cnt === 0) {
          const sourceSessionRes = await client.query(
            `
            SELECT s.session_id
            FROM scert_db.scholarships s
            WHERE s.session_id <> $1
            GROUP BY s.session_id
            ORDER BY s.session_id DESC
            LIMIT 1
            `,
            [session_id]
          );

          if (sourceSessionRes.rows.length > 0) {
            const sourceSessionId = sourceSessionRes.rows[0].session_id;
            const clonedCount = await cloneScholarshipTemplateToSession(
              client,
              sourceSessionId,
              session_id
            );
            console.log(
              `Auto-seeded ${clonedCount} scholarship(s) into session ${session_id} from session ${sourceSessionId}`
            );
          }
        }

        await client.query('COMMIT');
      } catch (seedErr) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw seedErr;
      } finally {
        client.release();
      }

      rows = await fetchForSession();
    }

    scholarshipCache.set(session_id, {
      data: rows,
      expiresAt: now + 5 * 60 * 1000
    });

    res.json(rows);
  } catch (err) {
    console.error("Fetch scholarships error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



/**
 * GET SINGLE SCHOLARSHIP
 * GET /scert/scholarships/:id
 */
exports.getScholarshipById = async (req, res) => {
  const scholarshipId = req.params.id;
  const { session_id } = req.session;


  try {
    const result = await pool.query(
      `SELECT *
       FROM scert_db.scholarships
       WHERE scholarship_id = $1
AND session_id = $2`,
      [scholarshipId, session_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Scholarship not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch scholarship error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * ACTIVATE SCHOLARSHIP
 * PATCH /scert/scholarships/:id/activate
 */
exports.updateScholarshipStatus = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const scholarshipId = req.params.id;
  const { status } = req.body;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!["ACTIVE", "INACTIVE"].includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Allowed values: ACTIVE, INACTIVE",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch scholarship
    const schRes = await client.query(
      `
      SELECT status, last_date
      FROM scert_db.scholarships
      WHERE scholarship_id = $1
        AND session_id = $2
      FOR UPDATE
      `,
      [scholarshipId, session_id]
    );

    if (schRes.rows.length === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(404).json({ message: "Scholarship not found" });
    }

    const currentStatus = schRes.rows[0].status;

    // 2️⃣ No-op check
    if (currentStatus === status) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.json({
        message: `Scholarship already ${status}`,
        scholarship_id: scholarshipId,
        status,
      });
    }

    // 3️⃣ Validations ONLY when activating
    if (status === "ACTIVE") {
      if (currentStatus !== "DRAFT" && currentStatus !== "INACTIVE") {
        throw new Error("Only DRAFT or INACTIVE scholarships can be activated");
      }

      // last_date check
      if (new Date(schRes.rows[0].last_date) < new Date()) {
        throw new Error("Cannot activate scholarship with past last_date");
      }

      // at least one active form field
      const fieldsRes = await client.query(
        `
        SELECT 1
        FROM scert_db.scholarship_form_fields
        WHERE scholarship_id = $1
          AND is_active = true
        LIMIT 1
        `,
        [scholarshipId]
      );

      if (fieldsRes.rows.length === 0) {
        throw new Error(
          "Add at least one active form field before activation"
        );
      }
    }

    // 4️⃣ Update status
    await client.query(
      `
      UPDATE scert_db.scholarships
      SET status = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE scholarship_id = $2
        AND session_id = $3
      `,
      [status, scholarshipId, session_id]
    );

    await client.query("COMMIT");

    res.json({
      message: `Scholarship ${status === "ACTIVE" ? "activated" : "inactivated"} successfully`,
      scholarship_id: scholarshipId,
      status,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Update scholarship status error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

