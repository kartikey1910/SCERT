const pool = require("../config/db");
const { createClient } = require("redis");
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const attCacheClient = createClient({ url: redisUrl });

attCacheClient.on("error", (err) => console.error("Attendance redis error:", err));
attCacheClient.connect().catch((err) => console.error("Attendance redis connect error:", err));

async function upsertClassWiseAttendanceSummary({
  client,
  session_id,
  scholarship_id,
  center_id,
  beoUserId,
  classFilterValue,
  total_students,
  mat_present,
  mat_absent,
  sat_present,
  sat_absent,
}) {
  const csrReportRes = await client.query(
    `INSERT INTO scert_db.center_superintendent_reports
       (session_id, scholarship_id, center_id, block_code, block_name, district_code, district_name,
        superintendent_name, superintendent_mobile, is_submitted, created_by_beo)
     SELECT
       $1, $2, ec.center_id, bp.block_code, bp.block_name, bp.district_code, bp.district_name,
       ec.superintendent_name, ec.superintendent_mobile, false, $4
     FROM scert_db.exam_centers ec
     JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
     WHERE ec.center_id = $3
       AND bp.user_id = $4
     ON CONFLICT (session_id, scholarship_id, center_id)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING report_id`,
    [session_id, scholarship_id, center_id, beoUserId]
  );

  if (csrReportRes.rows.length === 0) {
    throw new Error("Unable to resolve parent report for attendance summary");
  }

  const summaryParentReportId = csrReportRes.rows[0].report_id;

  const updateRes = await client.query(
    `UPDATE scert_db.center_exam_attendance_summary
     SET total_enrolled = $1,
         mat_present = $2,
         mat_absent = $3,
         mat_total = ($2::integer + $3::integer),
         sat_present = $4,
         sat_absent = $5,
         sat_total = ($4::integer + $5::integer)
     WHERE report_id = $6
       AND exam_class IS NOT DISTINCT FROM $7
       AND source = 'DURING_EXAM'`,
    [
      total_students,
      mat_present,
      mat_absent,
      sat_present,
      sat_absent,
      summaryParentReportId,
      classFilterValue,
    ]
  );

  if (updateRes.rowCount === 0) {
    await client.query(
      `INSERT INTO scert_db.center_exam_attendance_summary
         (report_id, exam_class, total_enrolled, mat_present, mat_absent, mat_total, sat_present, sat_absent, sat_total, source)
       VALUES ($1,$2,$3,$4,$5,($4::integer + $5::integer),$6,$7,($6::integer + $7::integer),'DURING_EXAM')`,
      [
        summaryParentReportId,
        classFilterValue,
        total_students,
        mat_present,
        mat_absent,
        sat_present,
        sat_absent,
      ]
    );
  }

  // NOTE: During Exam data lives exclusively in center_exam_attendance_summary.
  // We intentionally do NOT sync to center_exam_attendance_reports here because
  // that table is owned by the After Exam upload (uploadCenterAttendance).
  // Mixing both writes to the same row causes data overwrite bugs.
}

/**
 * POST CENTER EXAM ATTENDANCE (UPLOAD ABSENTEE)
 * BEO only
 */
exports.uploadCenterAttendance = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, students, class_filter } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  if (!scholarship_id || !Array.isArray(students)) {
    return res.status(400).json({
      message: "scholarship_id and students[] are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Verify BEO block + center ownership */
    const centerRes = await client.query(
      `
      SELECT ec.center_id, ec.block_code
      FROM scert_db.exam_centers ec
      JOIN scert_db.beo_profiles bp
        ON bp.block_code = ec.block_code
      WHERE ec.center_id = $1
        AND bp.user_id = $2
      `,
      [center_id, beoUserId]
    );

    if (centerRes.rows.length === 0) {
      throw new Error("Unauthorized center access");
    }

    /* 2️⃣ Validate applications belong to this center */
    const appIds = students.map(s => s.application_id);

    const appsRes = await client.query(
      `
      SELECT application_id
      FROM scert_db.scholarship_applications
      WHERE application_id = ANY($1)
        AND center_id = $2
        AND scholarship_id = $3
        AND session_id = $4
        AND status = 'APPROVED'
      `,
      [appIds, center_id, scholarship_id, session_id]
    );

    if (appsRes.rows.length !== students.length) {
      throw new Error("Invalid or non-approved applications found");
    }

    /* 3️⃣ Compute summary (DO NOT TRUST FRONTEND) */
    const total = students.length;

    const matPresent = students.filter(s => s.mat_status !== "ABSENT").length;
    const satPresent = students.filter(s => s.sat_status !== "ABSENT").length;

    const matAbsent = total - matPresent;
    const satAbsent = total - satPresent;

    /* 4️⃣ Upsert attendance report */
    const reportRes = await client.query(
      `
      INSERT INTO scert_db.center_exam_attendance_reports (
        session_id,
        scholarship_id,
        center_id,
        mat_total_students,
        mat_present,
        mat_absent,
        sat_total_students,
        sat_present,
        sat_absent,
        created_by_beo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$4,$7,$8,$9)
      ON CONFLICT (session_id, scholarship_id, center_id)
      DO UPDATE SET
        mat_total_students = EXCLUDED.mat_total_students,
        mat_present = EXCLUDED.mat_present,
        mat_absent = EXCLUDED.mat_absent,
        sat_total_students = EXCLUDED.sat_total_students,
        sat_present = EXCLUDED.sat_present,
        sat_absent = EXCLUDED.sat_absent,
        submitted_at = COALESCE(scert_db.center_exam_attendance_reports.submitted_at, CURRENT_TIMESTAMP)
      RETURNING report_id
      `,
      [
        session_id,
        scholarship_id,
        center_id,
        total,
        matPresent,
        matAbsent,
        satPresent,
        satAbsent,
        beoUserId,
      ]
    );

    const reportId = reportRes.rows[0].report_id;

    /* 5️⃣ Upsert student attendance
       One statement for the whole roster instead of one round trip per
       student. A center can have 1000+ approved applications (the largest
       today has 1129), and awaiting a query per row inside one transaction
       took long enough - especially to the separate database server in
       production - that a BEO would give up and resubmit, or the whole
       transaction would time out and roll back, undoing the upload
       entirely. A single UNNEST-based upsert does the same writes in one
       round trip regardless of roster size. Dedupe by application_id first:
       ON CONFLICT DO UPDATE refuses to touch the same row twice in one
       statement, which the old per-row loop tolerated (last write wins). */
    const dedupedStudents = Array.from(
      new Map(students.map((s) => [String(s.application_id), s])).values()
    );

    if (dedupedStudents.length > 0) {
      await client.query(
        `
        INSERT INTO scert_db.center_exam_student_attendance (
          report_id,
          application_id,
          mat_status,
          sat_status
        )
        SELECT $1,
               ids.application_id,
               ids.mat_status::scert_db.exam_attendance_status,
               ids.sat_status::scert_db.exam_attendance_status
        FROM UNNEST(
          $2::bigint[],
          $3::text[],
          $4::text[]
        ) AS ids(application_id, mat_status, sat_status)
        ON CONFLICT (report_id, application_id)
        DO UPDATE SET
          mat_status = EXCLUDED.mat_status,
          sat_status = EXCLUDED.sat_status
        `,
        [
          reportId,
          dedupedStudents.map((s) => s.application_id),
          dedupedStudents.map((s) => s.mat_status || "PRESENT"),
          dedupedStudents.map((s) => s.sat_status || "PRESENT"),
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      message: "Attendance uploaded successfully",
      summary: {
        total_students: total,
        mat_present: matPresent,
        mat_absent: matAbsent,
        sat_present: satPresent,
        sat_absent: satAbsent,
      },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Upload attendance error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


exports.getCenterAttendanceForBEO = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter, page, limit } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const client = await pool.connect();
  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 1000); // default large limit to preserve UI if not passed
  const offset = (pageNum - 1) * limitNum;
  const cacheKey = `att_beo:${session_id}:${scholarship_id}:${center_id}:${classFilterValue || 'all'}:${pageNum}:${limitNum}`;
  try {
    if (attCacheClient.isReady) {
      const cached = await attCacheClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }
  } catch (err) {
    console.error("Redis get error for beo attendance:", err.message);
  }

  try {
    /* 1️⃣ Verify center ownership */
    const centerRes = await client.query(
      `
      SELECT
        ec.center_id,
        ec.center_order AS center_code,
        ec.center_order AS centre_code,
        ec.school_name AS center_name,
        ec.block_code,
        bp.block_name,
        bp.district_code,
        bp.district_name
      FROM scert_db.exam_centers ec
      JOIN scert_db.beo_profiles bp
        ON bp.block_code = ec.block_code
      WHERE ec.center_id = $1
        AND bp.user_id = $2
      `,
      [center_id, beoUserId]
    );

    if (centerRes.rows.length === 0) {
      throw new Error("Unauthorized center");
    }

    /* 2️⃣ Fetch existing report (if any) */
    const reportRes = await client.query(
      `
      SELECT
        report_id,
        mat_total_students,
        mat_present,
        mat_absent,
        sat_total_students,
        sat_present,
        sat_absent,
        submitted_at
      FROM scert_db.center_exam_attendance_reports
      WHERE session_id = $1
        AND scholarship_id = $2
        AND center_id = $3
      `,
      [session_id, scholarship_id, center_id]
    );

    const report = reportRes.rows[0] || null;
    const reportId = report?.report_id || null;

    /* 3️⃣ Fetch submission status per class */
    const reportIdSql = reportId ? `att.report_id = ${parseInt(reportId)}` : 'FALSE';
    const statusRes = await client.query(`
      SELECT
        COALESCE(NULLIF(TRIM(sa.class::text), ''), NULLIF(TRIM(cls.class_value), ''), '8') AS effective_class,
        COUNT(sa.application_id)::int AS total_students,
        COUNT(att.attendance_id)::int AS saved_students
      FROM scert_db.scholarship_applications sa
      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.application_id = sa.application_id
       AND ${reportIdSql}
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
      GROUP BY effective_class
    `, [center_id, scholarship_id, session_id]);

    const classSubmissionStatus = {};
    statusRes.rows.forEach(r => {
      const cls = String(r.effective_class).trim();
      classSubmissionStatus[cls] = {
        total_students: r.total_students,
        saved_students: r.saved_students,
        submitted_for_class: r.total_students > 0 && r.saved_students === r.total_students,
        submitted_at: (r.total_students > 0 && r.saved_students === r.total_students) ? (report?.submitted_at || null) : null
      };
    });

    /* 4️⃣ Fetch paginated students */
    let queryParams = [center_id, scholarship_id, session_id];
    let classFilterSql = "";
    if (classFilterValue) {
      queryParams.push(classFilterValue);
      classFilterSql = `AND COALESCE(NULLIF(TRIM(sa.class::text), ''), NULLIF(TRIM(cls.class_value), ''), '8') = $${queryParams.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM scert_db.scholarship_applications sa
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
        ${classFilterSql}
    `;

    const countRes = await client.query(countQuery, queryParams);
    const totalCount = countRes.rows[0].total;

    queryParams.push(limitNum, offset);
    
    const studentsRes = await client.query(
      `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.roll_number,
        COALESCE(st.full_name, ans_student_name.value_text) AS student_name,
        COALESCE(NULLIF(TRIM(sa.class::text), ''), NULLIF(TRIM(cls.class_value), ''), '8') AS effective_class,
        (att.attendance_id IS NOT NULL) AS has_saved_attendance,
        att.mat_status,
        att.sat_status
      FROM scert_db.scholarship_applications sa
      LEFT JOIN scert_db.student_profiles st ON st.user_id = sa.student_user_id
      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.application_id = sa.application_id AND ${reportIdSql}
      LEFT JOIN scert_db.scholarship_form_fields ff_student_name
        ON ff_student_name.scholarship_id = sa.scholarship_id AND ff_student_name.field_key = 'student_name'
      LEFT JOIN scert_db.scholarship_application_answers ans_student_name
        ON ans_student_name.application_id = sa.application_id AND ans_student_name.field_id = ff_student_name.field_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
        ${classFilterSql}
      ORDER BY sa.roll_number NULLS LAST, student_name
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
      `,
      queryParams
    );

    const responseData = {
      center: centerRes.rows[0],
      report,
      class_submission_status: classSubmissionStatus,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      students: studentsRes.rows.map(s => ({
          application_id: s.application_id,
          roll_number: s.roll_number,
          student_name: s.student_name,
          class: s.effective_class,
          mat_status: s.mat_status || "PRESENT",
          sat_status: s.sat_status || "PRESENT",
        })),
    };

    try {
      if (attCacheClient.isReady) {
        await attCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins
      }
    } catch (err) {
      console.error("Redis set error for beo attendance:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("Get attendance BEO error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


exports.getCenterAttendanceForSCERT = async (req, res) => {
  const roleId = req.user.role_id;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { session_id } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter, page, limit } = req.query;

  const client = await pool.connect();
  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 1000);
  const offset = (pageNum - 1) * limitNum;
  const cacheKey = `att_scert:${session_id}:${scholarship_id}:${center_id}:${classFilterValue || 'all'}:${pageNum}:${limitNum}`;
  try {
    if (attCacheClient.isReady) {
      const cached = await attCacheClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }
  } catch (err) {
    console.error("Redis get error for scert attendance:", err.message);
  }

  try {
    /* 1️⃣ Fetch center details */
    const centerRes = await client.query(
      `
      SELECT center_id, school_name, udise_code, superintendent_name, superintendent_mobile
      FROM scert_db.exam_centers
      WHERE center_id = $1
      `,
      [center_id]
    );

    if (centerRes.rows.length === 0) {
      return res.status(404).json({ message: "Center not found" });
    }

    /* 2️⃣ Fetch attendance report */
    const reportRes = await client.query(
      `
      SELECT *
      FROM scert_db.center_exam_attendance_reports
      WHERE center_id = $1
        AND scholarship_id = $2
        AND session_id = $3
      `,
      [center_id, scholarship_id, session_id]
    );

    if (reportRes.rows.length === 0) {
      return res.status(404).json({ message: "Attendance not uploaded" });
    }

    const report = reportRes.rows[0];
    const reportId = report.report_id;
    const reportIdSql = reportId ? `att.report_id = ${parseInt(reportId)}` : 'FALSE';

    /* 3️⃣ Fetch students with attendance status */
    let queryParams = [center_id, scholarship_id, session_id];
    let classFilterSql = "";
    if (classFilterValue) {
      queryParams.push(classFilterValue);
      classFilterSql = `AND COALESCE(NULLIF(TRIM(sa.class::text), ''), NULLIF(TRIM(cls.class_value), ''), '8') = $${queryParams.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM scert_db.scholarship_applications sa
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
        ${classFilterSql}
    `;

    const countRes = await client.query(countQuery, queryParams);
    const totalCount = countRes.rows[0].total;

    queryParams.push(limitNum, offset);

    const studentsRes = await client.query(
      `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.roll_number,
        COALESCE(st.full_name, ans_student_name.value_text) AS student_name,
        COALESCE(
          NULLIF(TRIM(sa.class::text), ''),
          NULLIF(TRIM(cls.class_value), ''),
          '8'
        ) AS effective_class,
        att.mat_status,
        att.sat_status
      FROM scert_db.scholarship_applications sa
      LEFT JOIN scert_db.student_profiles st
        ON st.user_id = sa.student_user_id
      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.application_id = sa.application_id
       AND ${reportIdSql}
      LEFT JOIN scert_db.scholarship_form_fields ff_student_name
        ON ff_student_name.scholarship_id = sa.scholarship_id
       AND ff_student_name.field_key = 'student_name'
      LEFT JOIN scert_db.scholarship_application_answers ans_student_name
        ON ans_student_name.application_id = sa.application_id
       AND ans_student_name.field_id = ff_student_name.field_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(aa.value_text, ''),
            aa.value_number::TEXT,
            aa.value_date::TEXT
          ) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
        ${classFilterSql}
      ORDER BY sa.roll_number NULLS LAST, student_name
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
      `,
      queryParams
    );

    const responseData = {
      center: centerRes.rows[0],
      report,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      students: studentsRes.rows.map(s => ({
          application_id: s.application_id,
          roll_number: s.roll_number,
          student_name: s.student_name,
          class: s.effective_class,
          mat_status: s.mat_status || "PRESENT",
          sat_status: s.sat_status || "PRESENT",
        })),
    };

    try {
      if (attCacheClient.isReady) {
        await attCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins
      }
    } catch (err) {
      console.error("Redis set error for scert attendance:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("Get attendance SCERT error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

exports.getCenterAttendanceForDistrict = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { session_id } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter, page, limit } = req.query;

  const client = await pool.connect();
  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 1000);
  const offset = (pageNum - 1) * limitNum;
  const cacheKey = `att_dist:${session_id}:${scholarship_id}:${center_id}:${classFilterValue || 'all'}:${pageNum}:${limitNum}`;
  try {
    if (attCacheClient.isReady) {
      const cached = await attCacheClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }
  } catch (err) {
    console.error("Redis get error for district attendance:", err.message);
  }

  try {
    const districtRes = await client.query(
      `SELECT district_code
       FROM scert_db.district_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [districtUserId]
    );

    if (districtRes.rows.length === 0) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const districtCode = districtRes.rows[0].district_code;

    const centerRes = await client.query(
      `
      SELECT
        ec.center_id,
        ec.school_name,
        ec.udise_code,
        ec.superintendent_name,
        ec.superintendent_mobile
      FROM scert_db.exam_centers ec
      JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
      WHERE ec.center_id = $1
        AND bp.district_code = $2
      `,
      [center_id, districtCode]
    );

    if (centerRes.rows.length === 0) {
      return res.status(404).json({ message: "Center not found in this district" });
    }

    const reportRes = await client.query(
      `
      SELECT *
      FROM scert_db.center_exam_attendance_reports
      WHERE center_id = $1
        AND scholarship_id = $2
        AND session_id = $3
      `,
      [center_id, scholarship_id, session_id]
    );

    if (reportRes.rows.length === 0) {
      return res.status(404).json({ message: "Attendance not uploaded" });
    }

    const report = reportRes.rows[0];
    const reportId = report.report_id;
    const reportIdSql = reportId ? `att.report_id = ${parseInt(reportId)}` : 'FALSE';

    /* Fetch students */
    let queryParams = [center_id, scholarship_id, session_id];
    let classFilterSql = "";
    if (classFilterValue) {
      queryParams.push(classFilterValue);
      classFilterSql = `AND COALESCE(NULLIF(TRIM(sa.class::text), ''), NULLIF(TRIM(cls.class_value), ''), '8') = $${queryParams.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM scert_db.scholarship_applications sa
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
        ${classFilterSql}
    `;

    const countRes = await client.query(countQuery, queryParams);
    const totalCount = countRes.rows[0].total;

    queryParams.push(limitNum, offset);

    const studentsRes = await client.query(
      `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.roll_number,
        COALESCE(st.full_name, ans_student_name.value_text) AS student_name,
        COALESCE(
          NULLIF(TRIM(sa.class::text), ''),
          NULLIF(TRIM(cls.class_value), ''),
          '8'
        ) AS effective_class,
        att.mat_status,
        att.sat_status
      FROM scert_db.scholarship_applications sa
      LEFT JOIN scert_db.student_profiles st
        ON st.user_id = sa.student_user_id
      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.application_id = sa.application_id
       AND ${reportIdSql}
      LEFT JOIN scert_db.scholarship_form_fields ff_student_name
        ON ff_student_name.scholarship_id = sa.scholarship_id
       AND ff_student_name.field_key = 'student_name'
      LEFT JOIN scert_db.scholarship_application_answers ans_student_name
        ON ans_student_name.application_id = sa.application_id
       AND ans_student_name.field_id = ff_student_name.field_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(aa.value_text, ''),
            aa.value_number::TEXT,
            aa.value_date::TEXT
          ) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
        ${classFilterSql}
      ORDER BY sa.roll_number NULLS LAST, student_name
      LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
      `,
      queryParams
    );

    const responseData = {
      center: centerRes.rows[0],
      report,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      students: studentsRes.rows.map(s => ({
          application_id: s.application_id,
          roll_number: s.roll_number,
          student_name: s.student_name,
          class: s.effective_class,
          mat_status: s.mat_status || "PRESENT",
          sat_status: s.sat_status || "PRESENT",
        })),
    };

    try {
      if (attCacheClient.isReady) {
        await attCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins
      }
    } catch (err) {
      console.error("Redis set error for dist attendance:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("Get attendance District error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};


/**
 * POST CENTER EXAM ATTENDANCE SUMMARY (UPLOAD ABSENTEE DURING EXAM)
 * Following exact pattern from pending applications - store in application.class field
 */
exports.uploadCenterAttendanceSummary = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter, mat_absent, sat_absent } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  const parsed = {
    mat_absent: Number(mat_absent) || 0,
    sat_absent: Number(sat_absent) || 0,
  };

  if (
    parsed.mat_absent < 0 ||
    parsed.sat_absent < 0
  ) {
    return res.status(400).json({ message: "Attendance values cannot be negative" });
  }

  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify center belongs to logged-in BEO block.
    const centerRes = await client.query(
      `SELECT ec.center_id
       FROM scert_db.exam_centers ec
       JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
       WHERE ec.center_id = $1 AND bp.user_id = $2`,
      [center_id, beoUserId]
    );

    if (centerRes.rows.length === 0) {
      throw new Error("Unauthorized center");
    }

    // Parent row for class-wise summary must be center_superintendent_reports.report_id (FK target).
    const csrReportRes = await client.query(
      `INSERT INTO scert_db.center_superintendent_reports
         (session_id, scholarship_id, center_id, block_code, block_name, district_code, district_name,
          superintendent_name, superintendent_mobile, is_submitted, created_by_beo)
       SELECT
         $1, $2, ec.center_id, bp.block_code, bp.block_name, bp.district_code, bp.district_name,
         ec.superintendent_name, ec.superintendent_mobile, false, $4
       FROM scert_db.exam_centers ec
       JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
       WHERE ec.center_id = $3
         AND bp.user_id = $4
       ON CONFLICT (session_id, scholarship_id, center_id)
       DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING report_id`,
      [
        session_id,
        scholarship_id,
        center_id,
        beoUserId,
      ]
    );

    if (csrReportRes.rows.length === 0) {
      throw new Error("Unable to resolve parent report for attendance summary");
    }

    const summaryParentReportId = csrReportRes.rows[0].report_id;

    // Compute total approved students for this class scope (source of truth).
    const approvedRes = await client.query(
      `SELECT
         sa.application_id,
         sa.class,
         cls.class_value AS class_from_answers
       FROM scert_db.scholarship_applications sa
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(
             NULLIF(aa.value_text, ''),
             aa.value_number::TEXT,
             aa.value_date::TEXT
           ) AS class_value
         FROM scert_db.scholarship_application_answers aa
         JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
         WHERE aa.application_id = sa.application_id
           AND ff.scholarship_id = sa.scholarship_id
           AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
         ORDER BY ff.sort_order ASC
         LIMIT 1
       ) cls ON true
       WHERE sa.center_id = $1
         AND sa.scholarship_id = $2
         AND sa.session_id = $3
         AND sa.status = 'APPROVED'`,
      [center_id, scholarship_id, session_id]
    );

    let approvedStudents = approvedRes.rows.map((row) => {
      let studentClass = row.class || row.class_from_answers;
      if (!studentClass) studentClass = "8";
      return { ...row, class: String(studentClass).trim() };
    });
    if (classFilterValue) {
      approvedStudents = approvedStudents.filter((s) => s.class === classFilterValue);
    }

    const computedTotalStudents = approvedStudents.length;
    const computedMatAbsent = Math.min(parsed.mat_absent, computedTotalStudents);
    const computedSatAbsent = Math.min(parsed.sat_absent, computedTotalStudents);
    const computedMatPresent = Math.max(computedTotalStudents - computedMatAbsent, 0);
    const computedSatPresent = Math.max(computedTotalStudents - computedSatAbsent, 0);

    // Class-wise summary row.
    const updateRes = await client.query(
      `UPDATE scert_db.center_exam_attendance_summary
       SET total_enrolled = $1,
           mat_present = $2,
           mat_absent = $3,
           mat_total = ($2::integer + $3::integer),
           sat_present = $4,
           sat_absent = $5,
           sat_total = ($4::integer + $5::integer)
       WHERE report_id = $6
         AND exam_class IS NOT DISTINCT FROM $7
         AND source = 'DURING_EXAM'`,
      [
        computedTotalStudents,
        computedMatPresent,
        computedMatAbsent,
        computedSatPresent,
        computedSatAbsent,
        summaryParentReportId,
        classFilterValue,
      ]
    );

    if (updateRes.rowCount === 0) {
      await client.query(
        `INSERT INTO scert_db.center_exam_attendance_summary
           (report_id, exam_class, total_enrolled, mat_present, mat_absent, mat_total, sat_present, sat_absent, sat_total, source)
         VALUES ($1,$2,$3,$4,$5,($4::integer + $5::integer),$6,$7,($6::integer + $7::integer),'DURING_EXAM')`,
        [
          summaryParentReportId,
          classFilterValue,
          computedTotalStudents,
          computedMatPresent,
          computedMatAbsent,
          computedSatPresent,
          computedSatAbsent,
        ]
      );
    }

    // NOTE: During Exam data lives exclusively in center_exam_attendance_summary
    // (linked via center_superintendent_reports). We do NOT sync to
    // center_exam_attendance_reports — that table is exclusively owned by
    // uploadCenterAttendance (After Exam). Cross-writing to the same row
    // caused After Exam to overwrite During Exam numbers and vice versa.

    await client.query("COMMIT");

    res.json({
      message: "Attendance summary uploaded successfully",
      summary: {
        total_students: computedTotalStudents,
        mat_present: computedMatPresent,
        mat_absent: computedMatAbsent,
        sat_present: computedSatPresent,
        sat_absent: computedSatAbsent,
      },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Upload attendance summary error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


/**
 * GET CENTER EXAM ATTENDANCE SUMMARY (BEO)
 * Following exact pattern from pending applications - fetch all, filter in memory by class
 */
exports.getCenterAttendanceSummaryForBEO = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  try {
    // Verify center ownership
    const centerRes = await pool.query(
      `SELECT
         ec.center_id,
         ec.center_order AS center_code,
         ec.center_order AS centre_code,
         ec.school_name AS center_name,
         ec.block_code,
         bp.block_name,
         bp.district_code,
         bp.district_name
       FROM scert_db.exam_centers ec
       JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
       WHERE ec.center_id = $1 AND bp.user_id = $2`,
      [center_id, beoUserId]
    );

    if (centerRes.rows.length === 0) {
      return res.status(403).json({ message: "Unauthorized center" });
    }

    // Fetch class-wise uploaded summary by session+scholarship+center+class.
    // This is resilient even if legacy duplicate parent reports exist.
    const examClassSql = classFilterValue
      ? `AND s.exam_class = '${classFilterValue.replace(/'/g, "''")}'`
      : `AND s.exam_class IS NULL`;

    // Read During Exam summary from center_exam_attendance_summary.
    // submitted_at comes from center_superintendent_reports.updated_at —
    // we no longer read from center_exam_attendance_reports here because
    // that table is exclusively owned by the After Exam upload.
    const uploadedSummaryRes = await pool.query(
      `SELECT
         s.total_enrolled,
         s.mat_present,
         s.mat_absent,
         s.sat_present,
         s.sat_absent,
         csr.updated_at AS submitted_at
       FROM scert_db.center_exam_attendance_summary s
       JOIN scert_db.center_superintendent_reports csr
         ON csr.report_id = s.report_id
       WHERE csr.session_id = $1
         AND csr.scholarship_id = $2
         AND csr.center_id = $3
         AND s.source = 'DURING_EXAM'
         ${examClassSql}
       ORDER BY s.id DESC
       LIMIT 1`,
      [session_id, scholarship_id, center_id]
    );

    const uploadedSummary = uploadedSummaryRes.rows[0] || null;

    // Fetch ALL approved students with their class to provide default totals before first submit.
    const studentsRes = await pool.query(
      `SELECT
        sa.application_id,
        sa.class,
        cls.class_value AS class_from_answers
      FROM scert_db.scholarship_applications sa
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(aa.value_text, ''),
            aa.value_number::TEXT,
            aa.value_date::TEXT
          ) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'`,
      [center_id, scholarship_id, session_id]
    );

    // Apply class defaults and filter in memory (exactly like pending applications)
    let students = studentsRes.rows.map(row => {
      let studentClass = row.class || row.class_from_answers;
      if (!studentClass) {
        // Default for NMMSS
        studentClass = '8';
      }
      return { ...row, class: String(studentClass).trim() };
    });

    // Filter by class_filter if provided
    if (classFilterValue) {
      students = students.filter(s => s.class === classFilterValue);
    }

    const totalStudents = students.length;

    // Prefer uploaded class-wise values; fall back to computed counts for first load.
    const matAbsent = Math.min(
      uploadedSummary ? Number(uploadedSummary.mat_absent || 0) : 0,
      totalStudents
    );
    const satAbsent = Math.min(
      uploadedSummary ? Number(uploadedSummary.sat_absent || 0) : 0,
      totalStudents
    );
    const summary = {
      total_students: totalStudents,
      mat_present: Math.max(totalStudents - matAbsent, 0),
      mat_absent: matAbsent,
      sat_present: Math.max(totalStudents - satAbsent, 0),
      sat_absent: satAbsent,
      submitted_for_class: Boolean(uploadedSummary),
      submitted_at: uploadedSummary ? (uploadedSummary.submitted_at || null) : null,
    };

    res.json({
      center: centerRes.rows[0],
      summary,
    });
  } catch (err) {
    console.error("Get attendance summary BEO error:", err);
    res.status(400).json({ message: err.message });
  }
};

/**
 * GET CENTER EXAM ATTENDANCE SUMMARY (DISTRICT)
 */
exports.getCenterAttendanceSummaryForDistrict = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  try {
    const districtRes = await pool.query(
      `SELECT district_code FROM scert_db.district_profiles WHERE user_id = $1 LIMIT 1`,
      [districtUserId]
    );

    if (districtRes.rows.length === 0) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const districtCode = districtRes.rows[0].district_code;

    const centerRes = await pool.query(
      `SELECT ec.center_id, ec.school_name
       FROM scert_db.exam_centers ec
       LEFT JOIN scert_db.school_profiles sp ON sp.udise_code = ec.udise_code
       WHERE ec.center_id = $1 AND sp.district_code::text = $2::text`,
      [center_id, districtCode]
    );

    if (centerRes.rows.length === 0) {
      return res.status(403).json({ message: "Unauthorized center or center not found" });
    }

    const examClassSql = classFilterValue
      ? `AND s.exam_class = '${classFilterValue.replace(/'/g, "''")}'`
      : `AND s.exam_class IS NULL`;

    const uploadedSummaryRes = await pool.query(
      `SELECT
         s.total_enrolled,
         s.mat_present,
         s.mat_absent,
         s.sat_present,
         s.sat_absent,
         csr.updated_at AS submitted_at
       FROM scert_db.center_exam_attendance_summary s
       JOIN scert_db.center_superintendent_reports csr
         ON csr.report_id = s.report_id
       WHERE csr.session_id = $1
         AND csr.scholarship_id = $2
         AND csr.center_id = $3
         AND s.source = 'DURING_EXAM'
         ${examClassSql}
       ORDER BY s.id DESC
       LIMIT 1`,
      [session_id, scholarship_id, center_id]
    );

    const uploadedSummary = uploadedSummaryRes.rows[0] || null;

    const studentsRes = await pool.query(
      `SELECT
        sa.application_id,
        sa.class,
        cls.class_value AS class_from_answers
      FROM scert_db.scholarship_applications sa
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(aa.value_text, ''),
            aa.value_number::TEXT,
            aa.value_date::TEXT
          ) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'`,
      [center_id, scholarship_id, session_id]
    );

    let students = studentsRes.rows.map(row => {
      let studentClass = row.class || row.class_from_answers;
      if (!studentClass) {
        studentClass = '8';
      }
      return { ...row, class: String(studentClass).trim() };
    });

    if (classFilterValue) {
      students = students.filter(s => s.class === classFilterValue);
    }

    const totalStudents = students.length;

    const matAbsent = Math.min(
      uploadedSummary ? Number(uploadedSummary.mat_absent || 0) : 0,
      totalStudents
    );
    const satAbsent = Math.min(
      uploadedSummary ? Number(uploadedSummary.sat_absent || 0) : 0,
      totalStudents
    );
    const summary = {
      total_students: totalStudents,
      mat_present: Math.max(totalStudents - matAbsent, 0),
      mat_absent: matAbsent,
      sat_present: Math.max(totalStudents - satAbsent, 0),
      sat_absent: satAbsent,
      submitted_for_class: Boolean(uploadedSummary),
      submitted_at: uploadedSummary ? (uploadedSummary.submitted_at || null) : null,
    };

    res.json({
      center: centerRes.rows[0],
      summary,
    });
  } catch (err) {
    console.error("Get attendance summary DISTRICT error:", err);
    res.status(400).json({ message: err.message });
  }
};

/**
 * GET CENTER EXAM ATTENDANCE SUMMARY (SCERT)
 */
exports.getCenterAttendanceSummaryForSCERT = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { center_id } = req.params;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const classFilterValue =
    class_filter === undefined || class_filter === null || String(class_filter).trim() === ""
      ? null
      : String(class_filter).trim();

  try {
    const centerRes = await pool.query(
      `SELECT center_id, school_name
       FROM scert_db.exam_centers
       WHERE center_id = $1`,
      [center_id]
    );

    if (centerRes.rows.length === 0) {
      return res.status(404).json({ message: "Center not found" });
    }

    // Read During Exam summary via center_superintendent_reports → center_exam_attendance_summary.
    // submitted_at comes from csr.updated_at — we no longer touch center_exam_attendance_reports
    // from the During Exam path to keep the two data paths fully separate.
    const reportRes = await pool.query(
      `SELECT csr.report_id, csr.updated_at
       FROM scert_db.center_superintendent_reports csr
       WHERE csr.session_id = $1
         AND csr.scholarship_id = $2
         AND csr.center_id = $3`,
      [session_id, scholarship_id, center_id]
    );

    let uploadedSummary = null;
    if (reportRes.rows.length > 0) {
      const classSummaryRes = await pool.query(
        `SELECT
            s.total_enrolled,
            s.mat_present,
            s.mat_absent,
            s.sat_present,
            s.sat_absent,
            $3::timestamptz AS submitted_at
         FROM scert_db.center_exam_attendance_summary s
         WHERE s.report_id = $1
           AND s.exam_class IS NOT DISTINCT FROM $2
           AND s.source = 'DURING_EXAM'
         LIMIT 1`,
        [reportRes.rows[0].report_id, classFilterValue, reportRes.rows[0].updated_at]
      );
      uploadedSummary = classSummaryRes.rows[0] || null;
    }

    const studentsRes = await pool.query(
      `SELECT
        sa.application_id,
        sa.class,
        cls.class_value AS class_from_answers
      FROM scert_db.scholarship_applications sa
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(aa.value_text, ''),
            aa.value_number::TEXT,
            aa.value_date::TEXT
          ) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE aa.application_id = sa.application_id
          AND ff.scholarship_id = sa.scholarship_id
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
      ) cls ON true
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'`,
      [center_id, scholarship_id, session_id]
    );

    let students = studentsRes.rows.map((row) => {
      let studentClass = row.class || row.class_from_answers;
      if (!studentClass) studentClass = "8";
      return { ...row, class: String(studentClass).trim() };
    });

    if (classFilterValue) {
      students = students.filter((s) => s.class === classFilterValue);
    }

    const totalStudents = students.length;

    const matAbsent = Math.min(
      uploadedSummary ? Number(uploadedSummary.mat_absent || 0) : 0,
      totalStudents
    );
    const satAbsent = Math.min(
      uploadedSummary ? Number(uploadedSummary.sat_absent || 0) : 0,
      totalStudents
    );
    const summary = {
      total_students: totalStudents,
      mat_present: Math.max(totalStudents - matAbsent, 0),
      mat_absent: matAbsent,
      sat_present: Math.max(totalStudents - satAbsent, 0),
      sat_absent: satAbsent,
      submitted_at: null,
    };

    res.json({
      center: centerRes.rows[0],
      summary,
    });
  } catch (err) {
    console.error("Get attendance summary SCERT error:", err);
    res.status(400).json({ message: err.message });
  }
};
