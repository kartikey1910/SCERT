const pool = require("../config/db");
const {
  sortStaffRows,
  displayStaffRole,
  isContingenceRole,
  CONTINGENCE_RATE_KEY,
} = require("../services/csStaffRoles.service");
const PDFDocument = require("pdfkit");

/**
 * Supervisors/observers also record the time they left. The column is added
 * on first use so a deployment cannot break by forgetting the SQL
 * (scripts/add_observer_time_of_leaving.sql does the same thing).
 */
let observerLeavingColumnReady = null;
function ensureObserverLeavingColumn() {
  if (!observerLeavingColumnReady) {
    observerLeavingColumnReady = pool
      .query(
        `ALTER TABLE scert_db.center_exam_observers
         ADD COLUMN IF NOT EXISTS time_of_leaving VARCHAR(100)`
      )
      .catch((err) => {
        observerLeavingColumnReady = null;
        throw err;
      });
  }
  return observerLeavingColumnReady;
}
const { createClient } = require("redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const reportCacheClient = createClient({ url: redisUrl });

reportCacheClient.on("error", (err) =>
  console.error("center report redis error:", err)
);

reportCacheClient.connect().catch((err) =>
  console.error("center report redis connect error:", err)
);

const DEFAULT_HONORARIUM_RATE_BY_ROLE = {
  observer: 400,
  supervisor: 400,
};

const getDefaultHonorariumRate = (staffRole = "") => {
  const normalized = String(staffRole).toLowerCase();
  if (normalized.includes("observer")) {
    return DEFAULT_HONORARIUM_RATE_BY_ROLE.observer;
  }
  if (normalized.includes("supervisor")) {
    return DEFAULT_HONORARIUM_RATE_BY_ROLE.supervisor;
  }
  return null;
};

const parseNonNegativeInt = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
};

const getTargetExamClasses = (scholarshipId) => {
  const id = Number(scholarshipId);
  if (id === 3) return ["6", "9"];
  if (id === 6) return ["8"];
  return [];
};

async function getApprovedCountsByClass(client, { session_id, scholarship_id, center_id }) {
  const targetClasses = getTargetExamClasses(scholarship_id);
  const counts = {};
  targetClasses.forEach((c) => {
    counts[c] = 0;
  });

  if (Number(scholarship_id) === 3) {
    const approvedRes = await client.query(
      `
      SELECT 
        COALESCE(
          NULLIF(TRIM(a.class::text), ''),
          (
            SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT)
            FROM scert_db.scholarship_application_answers aa
            JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
            WHERE aa.application_id = a.application_id
              AND ff.scholarship_id = a.scholarship_id
              AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
            ORDER BY ff.sort_order ASC
            LIMIT 1
          ),
          '8'
        ) AS exam_class, 
        COUNT(*)::int AS total
      FROM scert_db.scholarship_applications a
      WHERE a.session_id = $1
        AND a.scholarship_id = $2
        AND a.center_id = $3
        AND a.status = 'APPROVED'
      GROUP BY 
        COALESCE(
          NULLIF(TRIM(a.class::text), ''),
          (
            SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::TEXT, aa.value_date::TEXT)
            FROM scert_db.scholarship_application_answers aa
            JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
            WHERE aa.application_id = a.application_id
              AND ff.scholarship_id = a.scholarship_id
              AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
            ORDER BY ff.sort_order ASC
            LIMIT 1
          ),
          '8'
        )
      `,
      [session_id, scholarship_id, center_id]
    );
    approvedRes.rows.forEach((r) => {
      counts[String(r.exam_class)] = Number(r.total || 0);
    });
  } else if (Number(scholarship_id) === 6) {
    const approvedRes = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM scert_db.scholarship_applications
      WHERE session_id = $1
        AND scholarship_id = $2
        AND center_id = $3
        AND status = 'APPROVED'
      `,
      [session_id, scholarship_id, center_id]
    );
    counts["8"] = Number(approvedRes.rows[0]?.total || 0);
  }

  return counts;
}

async function getAbsenteeUploadSummaryByClass(client, { session_id, scholarship_id, center_id }) {
  const targetClasses = getTargetExamClasses(scholarship_id);
  const summaryByClass = {};
  targetClasses.forEach((c) => {
    summaryByClass[c] = {
      exam_class: c,
      total_enrolled: 0,
      mat_present: 0,
      mat_absent: 0,
      mat_total: 0,
      sat_present: 0,
      sat_absent: 0,
      sat_total: 0,
    };
  });

  const rowsRes = await client.query(
    `
    SELECT
      sa.application_id,
      COALESCE(
        NULLIF(TRIM(sa.class::text), ''),
        NULLIF(TRIM(cls.class_value), ''),
        CASE WHEN $2::bigint = 6 THEN '8' ELSE NULL END
      ) AS exam_class,
      att.mat_status,
      att.sat_status
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
    LEFT JOIN scert_db.center_exam_attendance_reports ar
      ON ar.session_id = $1
     AND ar.scholarship_id = $2
     AND ar.center_id = $3
    LEFT JOIN scert_db.center_exam_student_attendance att
      ON att.report_id = ar.report_id
     AND att.application_id = sa.application_id
    WHERE sa.session_id = $1
      AND sa.scholarship_id = $2
      AND sa.center_id = $3
      AND sa.status = 'APPROVED'
    `,
    [session_id, scholarship_id, center_id]
  );

  rowsRes.rows.forEach((r) => {
    const examClass = String(r.exam_class || "").trim();
    if (!summaryByClass[examClass]) return;
    const row = summaryByClass[examClass];
    row.total_enrolled += 1;
    row.mat_total += 1;
    row.sat_total += 1;
    if (String(r.mat_status || "PRESENT").toUpperCase() === "ABSENT") row.mat_absent += 1;
    else row.mat_present += 1;
    if (String(r.sat_status || "PRESENT").toUpperCase() === "ABSENT") row.sat_absent += 1;
    else row.sat_present += 1;
  });

  return targetClasses.map((c) => summaryByClass[c]);
}

function normalizeAttendanceSummary({
  attendance_summary = [],
  scholarship_id,
  approvedCountsByClass = {},
}) {
  const targetClasses = getTargetExamClasses(scholarship_id);
  const byClass = new Map(
    (Array.isArray(attendance_summary) ? attendance_summary : []).map((r) => [
      String(r?.exam_class ?? "").trim(),
      r,
    ])
  );

  return targetClasses.map((examClass) => {
    const row = byClass.get(examClass) || {};
    const totalEnrolled = parseNonNegativeInt(approvedCountsByClass[examClass] || 0);
    const matAbsent = Math.min(parseNonNegativeInt(row.mat_absent), totalEnrolled);
    const satAbsent = Math.min(parseNonNegativeInt(row.sat_absent), totalEnrolled);
    const matPresent = totalEnrolled - matAbsent;
    const satPresent = totalEnrolled - satAbsent;

    return {
      exam_class: examClass,
      total_enrolled: totalEnrolled,
      mat_present: matPresent,
      mat_absent: matAbsent,
      mat_total: totalEnrolled,
      sat_present: satPresent,
      sat_absent: satAbsent,
      sat_total: totalEnrolled,
    };
  });
}

exports.createCenterSuperintendentReport = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { is_active } = req.session;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  const {
    session_id,
    scholarship_id,
    center_id,

    distance_from_block_km,
    bank_name,
    bank_account_number,
    bank_ifsc_code,
    number_of_exam_rooms,

    attendance_summary = [],
    staff_details = [],

    was_supervisor_present,
    was_observer_present,
    supervisors = [],
    observers = [],

    any_special_incident,
    submit = false,
  } = req.body;

  if (!session_id || !scholarship_id || !center_id) {
    return res.status(400).json({
      message: "session_id, scholarship_id and center_id are required",
    });
  }

  const client = await pool.connect();

  try {
    await ensureObserverLeavingColumn();
    await client.query("BEGIN");

    /* ---------------------------------------------------
       1ï¸âƒ£ Check duplicate / lock
    --------------------------------------------------- */
    const existsRes = await client.query(
      `
      SELECT report_id, is_submitted, submitted_at
      FROM scert_db.center_superintendent_reports
      WHERE session_id = $1
        AND scholarship_id = $2
        AND center_id = $3
      FOR UPDATE
      `,
      [session_id, scholarship_id, center_id]
    );
    const existingReport = existsRes.rows[0] || null;
    const nextIsSubmitted = Boolean(existingReport?.is_submitted || submit);
    const nextSubmittedAt = submit
      ? new Date()
      : existingReport?.is_submitted
        ? existingReport.submitted_at
        : null;

    /* ---------------------------------------------------
       2ï¸âƒ£ Fetch PREFILLED center + block + district + superintendent
    --------------------------------------------------- */
    const metaRes = await client.query(
      `
      SELECT
        ec.center_id,
        ec.center_order,
        ec.school_name AS center_name,
        ec.superintendent_name,
        ec.superintendent_mobile,

        bp.block_code,
        bp.block_name,
        bp.district_code,
        bp.district_name

      FROM scert_db.exam_centers ec
      JOIN scert_db.beo_profiles bp
        ON bp.block_code = ec.block_code
      WHERE ec.center_id = $1
      `,
      [center_id]
    );

    if (metaRes.rows.length === 0) {
      throw new Error("Invalid center");
    }

    const meta = metaRes.rows[0];

    /* ---------------------------------------------------
       3ï¸âƒ£ Upsert MAIN report (reuse existing draft row)
    --------------------------------------------------- */
    let reportId;
    if (existsRes.rows.length > 0) {
      reportId = existsRes.rows[0].report_id;
      await client.query(
        `
        UPDATE scert_db.center_superintendent_reports
        SET
          block_code = $1,
          block_name = $2,
          district_code = $3,
          district_name = $4,
          distance_from_block_km = $5,
          bank_name = $6,
          bank_account_number = $7,
          bank_ifsc_code = $8,
          superintendent_name = $9,
          superintendent_mobile = $10,
          number_of_exam_rooms = $11,
          was_supervisor_present = $12,
          was_observer_present = $13,
          any_special_incident = $14,
          is_submitted = $15,
          submitted_at = $16,
          updated_at = CURRENT_TIMESTAMP
        WHERE report_id = $17
        `,
        [
          meta.block_code,
          meta.block_name,
          meta.district_code,
          meta.district_name,
          distance_from_block_km || null,
          bank_name || null,
          bank_account_number || null,
          bank_ifsc_code || null,
          meta.superintendent_name,
          meta.superintendent_mobile,
          number_of_exam_rooms || null,
          was_supervisor_present ?? null,
          was_observer_present ?? null,
          any_special_incident || null,
          nextIsSubmitted,
          nextSubmittedAt,
          reportId,
        ]
      );
    } else {
      const reportRes = await client.query(
        `
        INSERT INTO scert_db.center_superintendent_reports (
          session_id,
          scholarship_id,
          center_id,
          block_code,
          block_name,
          district_code,
          district_name,
          distance_from_block_km,
          bank_name,
          bank_account_number,
          bank_ifsc_code,
          superintendent_name,
          superintendent_mobile,
          number_of_exam_rooms,
          was_supervisor_present,
          was_observer_present,
          any_special_incident,
          is_submitted,
          submitted_at,
          created_by_beo
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        )
        RETURNING report_id
        `,
        [
          session_id,
          scholarship_id,
          center_id,
          meta.block_code,
          meta.block_name,
          meta.district_code,
          meta.district_name,
          distance_from_block_km || null,
          bank_name || null,
          bank_account_number || null,
          bank_ifsc_code || null,
          meta.superintendent_name,
          meta.superintendent_mobile,
          number_of_exam_rooms || null,
          was_supervisor_present ?? null,
          was_observer_present ?? null,
          any_special_incident || null,
          nextIsSubmitted,
          nextSubmittedAt,
          beoUserId,
        ]
      );
      reportId = reportRes.rows[0].report_id;
    }

    // Replace previous detail rows for idempotent draft re-save.
    // Scoped to source = 'CS_REPORT': this table is also written by the
    // separate "Upload Absentee During Exam" feature (source = 'DURING_EXAM'),
    // and an unscoped DELETE here used to wipe that BEO-entered data out from
    // under it every time the CS Report was saved.
    await client.query(
      `DELETE FROM scert_db.center_exam_attendance_summary WHERE report_id = $1 AND source = 'CS_REPORT'`,
      [reportId]
    );
    await client.query(
      `DELETE FROM scert_db.center_exam_staff_details WHERE report_id = $1`,
      [reportId]
    );
    await client.query(
      `DELETE FROM scert_db.center_exam_observers WHERE report_id = $1`,
      [reportId]
    );

    /* ---------------------------------------------------
       4ï¸âƒ£ Attendance summary
       - classes are scholarship-specific
       - total enrolled is auto-filled from approved applications
       - present is auto-calculated from total - absent
    --------------------------------------------------- */
    const approvedCountsByClass = await getApprovedCountsByClass(client, {
      session_id,
      scholarship_id,
      center_id,
    });
    const absenteeDerivedAttendance = await getAbsenteeUploadSummaryByClass(client, {
      session_id,
      scholarship_id,
      center_id,
    });
    const normalizedAttendance = normalizeAttendanceSummary({
      // Source of truth: Upload Absentee (student-level attendance), not Upload Absentee During Exam.
      attendance_summary: absenteeDerivedAttendance,
      scholarship_id,
      approvedCountsByClass,
    });

    for (const row of normalizedAttendance) {
      await client.query(
        `
        INSERT INTO scert_db.center_exam_attendance_summary (
          report_id,
          exam_class,
          total_enrolled,
          mat_present,
          mat_absent,
          mat_total,
          sat_present,
          sat_absent,
          sat_total,
          source
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CS_REPORT')
        `,
        [
          reportId,
          row.exam_class,
          row.total_enrolled,
          row.mat_present,
          row.mat_absent,
          row.mat_total,
          row.sat_present,
          row.sat_absent,
          row.sat_total,
        ]
      );
    }

    /* ---------------------------------------------------
       5ï¸âƒ£ Honorarium calculation (CRITICAL PART)
    --------------------------------------------------- */
    let grandTotal = 0;

    /* Contingence is a flat amount SCERT sets in Rate Configuration. The BEO
       cannot fill or change it, so whatever the request carries for that line
       is ignored and the current SCERT amount is used. */
    const contingenceRes = await client.query(
      `SELECT honorarium_per_unit FROM scert_db.exam_staff_honorarium_rates WHERE staff_role = $1`,
      [CONTINGENCE_RATE_KEY]
    );
    const contingenceAmount = Number(contingenceRes.rows[0]?.honorarium_per_unit ?? 0);
    let contingenceSaved = false;

    for (const staff of staff_details) {
      let mappedStaffRole = String(staff.staff_role || "");
      if (mappedStaffRole === "Supervisor") mappedStaffRole = "Observer";
      if (mappedStaffRole === "Contingence") mappedStaffRole = CONTINGENCE_RATE_KEY;
      staff.staff_role = mappedStaffRole;

      if (isContingenceRole(staff.staff_role)) {
        if (contingenceSaved) continue; // one Contingence line per report
        contingenceSaved = true;
        grandTotal += contingenceAmount;
        await client.query(
          `
          INSERT INTO scert_db.center_exam_staff_details (
            report_id, staff_role, staff_count, honorarium_per_unit, total_amount
          ) VALUES ($1,$2,$3,$4,$5)
          `,
          [reportId, CONTINGENCE_RATE_KEY, 1, contingenceAmount, contingenceAmount]
        );
        continue;
      }

      const rateRes = await client.query(
        `
        SELECT honorarium_per_unit
        FROM scert_db.exam_staff_honorarium_rates
        WHERE staff_role = $1
        `,
        [staff.staff_role]
      );

      const fallbackRate = getDefaultHonorariumRate(staff.staff_role);

      if (rateRes.rows.length === 0 && fallbackRate === null) {
        throw new Error(`Honorarium rate not defined for ${staff.staff_role}`);
      }
      const rate = Number(
        rateRes.rows[0]?.honorarium_per_unit ?? fallbackRate ?? 0
      );
      const staffCount = Number(staff.staff_count || 0);
      const totalAmount = rate * staffCount;

      grandTotal += totalAmount;

      await client.query(
        `
        INSERT INTO scert_db.center_exam_staff_details (
          report_id,
          staff_role,
          staff_count,
          honorarium_per_unit,
          total_amount
        ) VALUES ($1,$2,$3,$4,$5)
        `,
        [
          reportId,
          staff.staff_role,
          staffCount,
          rate,
          totalAmount,
        ]
      );
    }

    // Every report carries the Contingence line, even if the request omitted it.
    if (!contingenceSaved) {
      grandTotal += contingenceAmount;
      await client.query(
        `
        INSERT INTO scert_db.center_exam_staff_details (
          report_id, staff_role, staff_count, honorarium_per_unit, total_amount
        ) VALUES ($1,$2,$3,$4,$5)
        `,
        [reportId, CONTINGENCE_RATE_KEY, 1, contingenceAmount, contingenceAmount]
      );
    }

    /* ---------------------------------------------------
       6ï¸âƒ£ Save GRAND TOTAL
    --------------------------------------------------- */
    await client.query(
      `
      UPDATE scert_db.center_superintendent_reports
      SET grand_total_amount = $1
      WHERE report_id = $2
      `,
      [grandTotal, reportId]
    );

    /* ---------------------------------------------------
       7ï¸âƒ£ Observers & supervisors
    --------------------------------------------------- */
    const allObservers = [
      ...supervisors.map((o) => ({ ...o, observer_type: "SUPERVISOR" })),
      ...observers.map((o) => ({ ...o, observer_type: "OBSERVER" })),
    ];

    for (const obs of allObservers) {
      await client.query(
        `
        INSERT INTO scert_db.center_exam_observers (
          report_id,
          observer_type,
          official_name,
          designation,
          time_of_visit,
          time_of_leaving,
          other_details
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          reportId,
          obs.observer_type,
          obs.official_name,
          obs.designation,
          obs.time_of_visit,
          obs.time_of_leaving || null,
          obs.other_details,
        ]
      );
    }

    await client.query("COMMIT");

    const wasAlreadySubmitted = Boolean(existingReport?.is_submitted);
    res.status(201).json({
      message: submit
        ? wasAlreadySubmitted
          ? "Center Superintendent Report resubmitted successfully"
          : "Center Superintendent Report submitted successfully"
        : wasAlreadySubmitted
          ? "Center Superintendent Report updated successfully"
          : "Center Superintendent Report saved as draft",
      report_id: reportId,
      grand_total_amount: grandTotal,
      submitted: nextIsSubmitted,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Create CSR error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};




exports.getCenterSuperintendentReport = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;

  const { session_id, scholarship_id, center_id } = req.query;

  if (![3, 5].includes(roleId)) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!session_id || !scholarship_id || !center_id) {
    return res.status(400).json({
      message: "session_id, scholarship_id and center_id are required",
    });
  }

  try {
    await ensureObserverLeavingColumn();
    /* ---------------------------------------------------
       1ï¸âƒ£ Fetch center + block + district + superintendent
    --------------------------------------------------- */
    const centerRes = await pool.query(
      `
      SELECT
        ec.center_id,
        ec.center_order,
        ec.school_name AS center_name,
        ec.superintendent_name,
        ec.superintendent_mobile,

        bp.block_code,
        bp.block_name,
        bp.district_code,
        bp.district_name

      FROM scert_db.exam_centers ec
      JOIN scert_db.beo_profiles bp
        ON bp.block_code = ec.block_code
      WHERE ec.center_id = $1
      `,
      [center_id]
    );

    if (centerRes.rows.length === 0) {
      return res.status(404).json({ message: "Center not found" });
    }

    const center = centerRes.rows[0];

    /* ---------------------------------------------------
       2ï¸âƒ£ BEO BLOCK RESTRICTION
    --------------------------------------------------- */
    if (roleId === 3) {
      const beoRes = await pool.query(
        `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
        [userId]
      );

      if (
        beoRes.rows.length === 0 ||
        beoRes.rows[0].block_code !== center.block_code
      ) {
        return res.status(403).json({
          message: "Access denied for this center",
        });
      }
    }

    /* ---------------------------------------------------
       3ï¸âƒ£ Fetch report (if exists)
    --------------------------------------------------- */
    const reportRes = await pool.query(
      `
      SELECT *
      FROM scert_db.center_superintendent_reports
      WHERE session_id = $1
        AND scholarship_id = $2
        AND center_id = $3
      `,
      [session_id, scholarship_id, center_id]
    );

    const report = reportRes.rows[0] || null;

    /* ---------------------------------------------------
       4ï¸âƒ£ Attendance summary
    --------------------------------------------------- */
    let attendance = [];
    let staff = [];
    let observers = [];

    const approvedCountsByClass = await getApprovedCountsByClass(pool, {
      session_id,
      scholarship_id,
      center_id,
    });

    if (report) {
      if (report.is_submitted) {
        // Freeze on submitted data. Scoped to source = 'CS_REPORT' so this
        // never picks up the separate During Exam rows stored in the same table.
        const attendanceRes = await pool.query(
          `
          SELECT *
          FROM scert_db.center_exam_attendance_summary
          WHERE report_id = $1 AND source = 'CS_REPORT'
          ORDER BY exam_class
          `,
          [report.report_id]
        );

        attendance = normalizeAttendanceSummary({
          attendance_summary: attendanceRes.rows,
          scholarship_id,
          approvedCountsByClass,
        });
      } else {
        // Draft view should reflect Upload Absentee values.
        const absenteeDerivedAttendance = await getAbsenteeUploadSummaryByClass(pool, {
          session_id,
          scholarship_id,
          center_id,
        });
        attendance = normalizeAttendanceSummary({
          attendance_summary: absenteeDerivedAttendance,
          scholarship_id,
          approvedCountsByClass,
        });
      }

      const staffRes = await pool.query(
        `
        SELECT
          staff_role,
          staff_count,
          honorarium_per_unit,
          total_amount
        FROM scert_db.center_exam_staff_details
        WHERE report_id = $1
        `,
        [report.report_id]
      );

      staff = sortStaffRows(
        staffRes.rows.map((row) => ({ ...row, staff_role: displayStaffRole(row.staff_role) }))
      );

      const obsRes = await pool.query(
        `
        SELECT
          observer_type,
          official_name,
          designation,
          time_of_visit,
          time_of_leaving,
          other_details
        FROM scert_db.center_exam_observers
        WHERE report_id = $1
        `,
        [report.report_id]
      );

      observers = obsRes.rows;
    } else {
      attendance = normalizeAttendanceSummary({
        attendance_summary: await getAbsenteeUploadSummaryByClass(pool, {
          session_id,
          scholarship_id,
          center_id,
        }),
        scholarship_id,
        approvedCountsByClass,
      });
    }

    /* ---------------------------------------------------
       5ï¸âƒ£ Honorarium master (for UI display)
    --------------------------------------------------- */
    const ratesRes = await pool.query(
      `
      SELECT staff_role, honorarium_per_unit
      FROM scert_db.exam_staff_honorarium_rates
      ORDER BY staff_role
      `
    );
    const honorariumRates = ratesRes.rows
      .filter((row) => row.staff_role !== 'Clerk' && row.staff_role !== 'Sweeper')
      .map((row) => ({ ...row, staff_role: displayStaffRole(row.staff_role) }));

    const hasSupervisorRate = honorariumRates.some((row) =>
      String(row.staff_role || "").toLowerCase().includes("supervisor")
    );
    if (!hasSupervisorRate) {
      honorariumRates.push({
        staff_role: "Supervisor",
        honorarium_per_unit: DEFAULT_HONORARIUM_RATE_BY_ROLE.supervisor.toFixed(2),
      });
    }

    /* ---------------------------------------------------
       6️⃣ Final response
    --------------------------------------------------- */
    // The Contingence line is always on the form, amount 0 until SCERT sets it.
    if (!honorariumRates.some((row) => isContingenceRole(row.staff_role))) {
      honorariumRates.push({ staff_role: "Contingence", honorarium_per_unit: "0.00" });
    }

    res.json({
      center: {
        center_id: center.center_id,
        center_code: center.center_order,
        center_name: center.center_name,
      },

      block: {
        block_code: center.block_code,
        block_name: center.block_name,
      },

      district: {
        district_code: center.district_code,
        district_name: center.district_name,
      },

      superintendent: {
        name: center.superintendent_name,
        mobile: center.superintendent_mobile,
      },

      report: report
        ? {
            report_id: report.report_id,
            distance_from_block_km: report.distance_from_block_km,
            bank_name: report.bank_name,
            bank_account_number: report.bank_account_number,
            bank_ifsc_code: report.bank_ifsc_code,
            number_of_exam_rooms: report.number_of_exam_rooms,
            was_supervisor_present: report.was_supervisor_present,
            was_observer_present: report.was_observer_present,
            any_special_incident: report.any_special_incident,
            grand_total_amount: report.grand_total_amount,
            is_submitted: report.is_submitted,
            submitted_at: report.submitted_at,
          }
        : null,

      attendance_summary: attendance,
      staff_details: staff,
      observers,

      honorarium_rates: sortStaffRows(honorariumRates),
    });
  } catch (err) {
    console.error("Get CSR error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



exports.getBeoSubmittedReports = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id, scholarship_id } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!session_id || !scholarship_id) {
    return res.status(400).json({
      message: "session_id and scholarship_id are required",
    });
  }

  const cacheKey = `beo_reports:${session_id}:${scholarship_id}:${userId}`;
  try {
    if (reportCacheClient.isReady) {
      const cached = await reportCacheClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }
  } catch (err) {
    console.error("Redis get error for beo reports:", err.message);
  }

  try {
    // Get BEO's block
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [userId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    const reportsRes = await pool.query(
      `
      SELECT
        csr.report_id,
        csr.center_id,
        ec.center_order AS center_code,
        ec.center_order AS centre_code,
        ec.school_name AS center_name,
        COALESCE(csr.block_code, bp.block_code, ec.block_code) AS block_code,
        COALESCE(csr.block_name, bp.block_name) AS block_name,
        COALESCE(csr.district_code, bp.district_code) AS district_code,
        COALESCE(csr.district_name, bp.district_name) AS district_name,
        csr.grand_total_amount,
        csr.submitted_at
      FROM scert_db.center_superintendent_reports csr
      JOIN scert_db.exam_centers ec ON ec.center_id = csr.center_id
      LEFT JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
      WHERE csr.session_id = $1
        AND csr.scholarship_id = $2
        AND csr.block_code = $3
        AND csr.is_submitted = true
      ORDER BY csr.submitted_at DESC
      `,
      [session_id, scholarship_id, blockCode]
    );

    const responseData = {
      total: reportsRes.rows.length,
      reports: reportsRes.rows,
    };

    try {
      if (reportCacheClient.isReady) {
        await reportCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins cache
      }
    } catch (err) {
      console.error("Redis set error for beo reports:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("Get BEO reports error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * DOWNLOAD CENTER SUPERINTENDENT REPORT (BEO) AS PDF
 * GET /api/beo/center-superintendent-reports/download.pdf?session_id=&scholarship_id=&center_id=
 */
exports.downloadCenterSuperintendentReportPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, scholarship_id, center_id } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!session_id || !scholarship_id || !center_id) {
    return res.status(400).json({
      message: "session_id, scholarship_id and center_id are required",
    });
  }

  try {
    await ensureObserverLeavingColumn();
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );
    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }
    const blockCode = beoRes.rows[0].block_code;

    const reportRes = await pool.query(
      `
      SELECT
        csr.report_id,
        csr.center_id,
        csr.block_code,
        csr.block_name,
        csr.district_code,
        csr.district_name,
        csr.distance_from_block_km,
        csr.bank_name,
        csr.bank_account_number,
        csr.bank_ifsc_code,
        csr.superintendent_name,
        csr.superintendent_mobile,
        csr.was_supervisor_present,
        csr.was_observer_present,
        csr.any_special_incident,
        csr.number_of_exam_rooms,
        csr.grand_total_amount,
        csr.submitted_at,
        ec.center_order AS center_code,
        ec.school_name AS center_name,
        sch.scholarship_name,
        sch.exam_date,
        sess.session_name
      FROM scert_db.center_superintendent_reports csr
      JOIN scert_db.exam_centers ec ON ec.center_id = csr.center_id
      JOIN scert_db.scholarships sch ON sch.scholarship_id = csr.scholarship_id
      JOIN scert_db.academic_sessions sess ON sess.session_id = csr.session_id
      WHERE csr.session_id = $1
        AND csr.scholarship_id = $2
        AND csr.center_id = $3
        AND csr.block_code = $4
        AND csr.is_submitted = true
      LIMIT 1
      `,
      [session_id, scholarship_id, center_id, blockCode]
    );

    if (reportRes.rows.length === 0) {
      return res.status(404).json({ message: "Submitted CS report not found" });
    }

    const report = reportRes.rows[0];
    const isNmmssScholarship =
      Number(scholarship_id) === 6 ||
      /\bNMMSS\b/i.test(String(report.scholarship_name || "")) ||
      /\bNMMS\b/i.test(String(report.scholarship_name || ""));
    const displayClasses = isNmmssScholarship ? ["8"] : ["6", "9"];
    const defaultClass = isNmmssScholarship ? "8" : null;

    // Build attendance directly from student-level absentee data (same source as UI attendance view).
    const attendanceStudentsRes = await pool.query(
      `
      SELECT
        COALESCE(
          NULLIF(TRIM(sa.class::text), ''),
          NULLIF(TRIM(cls.class_value), ''),
          $4::text
        ) AS effective_class,
        att.mat_status,
        att.sat_status
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
      LEFT JOIN scert_db.center_exam_attendance_reports ar
        ON ar.session_id = $3
       AND ar.scholarship_id = $2
       AND ar.center_id = $1
      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.application_id = sa.application_id
       AND att.report_id = ar.report_id
      WHERE sa.center_id = $1
        AND sa.scholarship_id = $2
        AND sa.session_id = $3
        AND sa.status = 'APPROVED'
      `,
      [center_id, scholarship_id, session_id, defaultClass]
    );

    const attendanceAccumulator = new Map(
      displayClasses.map((cls) => [
        cls,
        {
          exam_class: cls,
          total_enrolled: 0,
          mat_present: 0,
          mat_absent: 0,
          mat_total: 0,
          sat_present: 0,
          sat_absent: 0,
          sat_total: 0,
        },
      ])
    );

    attendanceStudentsRes.rows.forEach((row) => {
      const examClass = String(row.effective_class || "").trim();
      if (!attendanceAccumulator.has(examClass)) return;

      const target = attendanceAccumulator.get(examClass);
      target.total_enrolled += 1;
      target.mat_total += 1;
      target.sat_total += 1;

      if (String(row.mat_status || "PRESENT").toUpperCase() === "ABSENT") target.mat_absent += 1;
      else target.mat_present += 1;

      if (String(row.sat_status || "PRESENT").toUpperCase() === "ABSENT") target.sat_absent += 1;
      else target.sat_present += 1;
    });

    const attendanceRows = displayClasses.map((cls) => attendanceAccumulator.get(cls));

    const staffRes = await pool.query(
      `
      SELECT staff_role, staff_count, honorarium_per_unit, total_amount
      FROM scert_db.center_exam_staff_details
      WHERE report_id = $1
      ORDER BY staff_role
      `,
      [report.report_id]
    );

    const observerRes = await pool.query(
      `
      SELECT observer_type, official_name, time_of_visit, time_of_leaving, other_details
      FROM scert_db.center_exam_observers
      WHERE report_id = $1
      ORDER BY observer_type, official_name
      `,
      [report.report_id]
    );

    const filename = `beo_cs_report_${session_id}_${scholarship_id}_center_${center_id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);

    const doc = new PDFDocument({ size: "A4", margin: 20 });
    doc.pipe(res);

    const left = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const drawTable = ({ x, y, colWidths, rowHeight, rows, headerBold = true, align = [], fontSize = 8 }) => {
      let cursorY = y;
      rows.forEach((row, rowIndex) => {
        let cursorX = x;
        colWidths.forEach((w, i) => {
          doc.rect(cursorX, cursorY, w, rowHeight).stroke();
          const text = row[i] == null ? "" : String(row[i]);
          const a = align[i] || "left";
          doc
            .font(rowIndex === 0 && headerBold ? "Helvetica-Bold" : "Helvetica")
            .fontSize(fontSize)
            .text(text, cursorX + 2, cursorY + 2, { width: w - 4, align: a, ellipsis: true });
          cursorX += w;
        });
        cursorY += rowHeight;
      });
      return cursorY;
    };
    const fitWidths = (widths, targetWidth = usableWidth) => {
      const base = (Array.isArray(widths) ? widths : []).map((w) => Number(w) || 0);
      const sum = base.reduce((acc, w) => acc + w, 0);
      if (sum <= 0) return base;
      const scaled = base.map((w) => (w * targetWidth) / sum);
      const scaledSum = scaled.reduce((acc, w) => acc + w, 0);
      if (scaled.length > 0) {
        scaled[scaled.length - 1] += targetWidth - scaledSum;
      }
      return scaled;
    };

    const toBlank = (value) => {
      if (value === null || value === undefined) return "";
      return String(value);
    };

    const examDateText = report.exam_date
      ? new Date(report.exam_date).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "";

    doc.font("Helvetica-Bold").fontSize(11).text(`${report.scholarship_name} -${report.session_name}`, {
      align: "center",
    });
    doc.font("Helvetica-Bold").fontSize(10).text(`Examination Date: ${examDateText}`, { align: "center" });
    doc.font("Helvetica-Bold").fontSize(11).text("Center Superintendent Report", { align: "center" });
    doc.moveDown(0.35);

    const labelFont = () => doc.font("Helvetica-Bold").fontSize(8.5);
    const valueFont = () => doc.font("Helvetica").fontSize(8.5);

    const lineY = doc.y;
    labelFont().text("Examination Center Code & Name:", left, lineY, { width: 170 });
    valueFont().text(`${toBlank(report.center_code)} - ${toBlank(report.center_name)}`, left + 170, lineY, { width: 170, ellipsis: true });
    labelFont().text("District Code & Name:", left + 345, lineY, { width: 120 });
    valueFont().text(`${toBlank(report.district_code)} - ${toBlank(report.district_name)}`, left + 465, lineY, { width: 95, ellipsis: true });

    const lineY2 = lineY + 14;
    labelFont().text("Block Code & Name:", left, lineY2, { width: 170 });
    valueFont().text(`${toBlank(report.block_code)} - ${toBlank(report.block_name)}`, left + 170, lineY2, { width: 170, ellipsis: true });

    const lineY3 = lineY2 + 14;
    labelFont().text("Distance of Examination Center from the BEO office:", left, lineY3, { width: 260 });
    valueFont().text(report.distance_from_block_km === null || report.distance_from_block_km === undefined ? "" : `${report.distance_from_block_km} km`, left + 260, lineY3, { width: 80 });

    const lineY4 = lineY3 + 14;
    labelFont().text("Center Superintendent Name:", left, lineY4, { width: 170 });
    valueFont().text(toBlank(report.superintendent_name), left + 170, lineY4, { width: 170, ellipsis: true });

    const lineY5 = lineY4 + 14;
    labelFont().text("Mobile Number:", left, lineY5, { width: 170 });
    valueFont().text(toBlank(report.superintendent_mobile), left + 170, lineY5, { width: 170 });

    doc.y = lineY5 + 12;
    labelFont().text("Bank Detail:", left, doc.y);
    doc.moveDown(0.15);
    const bankEndY = drawTable({
      x: left,
      y: doc.y,
      colWidths: [usableWidth * 0.33, usableWidth * 0.34, usableWidth * 0.33],
      rowHeight: 14,
      rows: [
        ["Name of the Bank", "Account Number", "IFSC Code"],
        [toBlank(report.bank_name), toBlank(report.bank_account_number), toBlank(report.bank_ifsc_code)],
      ],
      align: ["left", "left", "left"],
      fontSize: 8,
    });

    doc.y = bankEndY + 6;
    labelFont().text("Number of Registered and Present Applicants:", left, doc.y);
    doc.moveDown(0.15);

    const attendanceByClass = new Map(attendanceRows.map((r) => [String(r.exam_class), r]));
    const attRows = displayClasses.map((cls) => attendanceByClass.get(cls) || {
      exam_class: cls,
      total_enrolled: 0,
      mat_present: 0,
      mat_absent: 0,
      mat_total: 0,
      sat_present: 0,
      sat_absent: 0,
      sat_total: 0,
    });
    const attTotal = attRows.reduce(
      (acc, r) => ({
        total_enrolled: acc.total_enrolled + Number(r.total_enrolled || 0),
        mat_present: acc.mat_present + Number(r.mat_present || 0),
        mat_absent: acc.mat_absent + Number(r.mat_absent || 0),
        mat_total: acc.mat_total + Number(r.mat_total || 0),
        sat_present: acc.sat_present + Number(r.sat_present || 0),
        sat_absent: acc.sat_absent + Number(r.sat_absent || 0),
        sat_total: acc.sat_total + Number(r.sat_total || 0),
      }),
      { total_enrolled: 0, mat_present: 0, mat_absent: 0, mat_total: 0, sat_present: 0, sat_absent: 0, sat_total: 0 }
    );

    const attendanceEndY = drawTable({
      x: left,
      y: doc.y,
      colWidths: fitWidths([70, 90, 90, 90, 90, 90]),
      rowHeight: 14,
      rows: [
        ["Class", "Total Enrolled", "MAT Present", "MAT Absent", "SAT Present", "SAT Absent"],
        ...attRows.map((r) => [
          `Class ${r.exam_class}`,
          r.total_enrolled,
          r.mat_present,
          r.mat_absent,
          r.sat_present,
          r.sat_absent,
        ]),
        ["Total", attTotal.total_enrolled, attTotal.mat_present, attTotal.mat_absent, attTotal.sat_present, attTotal.sat_absent],
      ],
      align: ["left", "right", "right", "right", "right", "right"],
      fontSize: 8,
    });

    doc.y = attendanceEndY + 6;
    labelFont().text("Details of Staff Engaged for Examination", left, doc.y, { align: "center", width: usableWidth });
    doc.moveDown(0.2);
    labelFont().text(
      report.number_of_exam_rooms === null || report.number_of_exam_rooms === undefined
        ? "Number of Exam Rooms:"
        : `Number of Exam Rooms: ${report.number_of_exam_rooms}`,
      left,
      doc.y
    );
    doc.moveDown(0.15);

    const staffOrder = [
      "Center Superintendent",
      "Supervisor",
      "Examination In charge",
      "Invigilator",
      "Reliever",
      "Office Assistant",
      "Peon",
      "Contingence",
    ];
    const staffMap = new Map(
      staffRes.rows.map((s) => [String(s.staff_role || "").toLowerCase(), s])
    );
    const resolveStaff = (label) => {
      const key = label.toLowerCase();
      const exact = staffMap.get(key);
      if (exact) return exact;
      for (const s of staffRes.rows) {
        const role = String(s.staff_role || "").toLowerCase();
        if (
          (key.includes("examination in charge") && role.includes("exam") && role.includes("incharge")) ||
          (key.includes("office assistant") && (role.includes("office") || role.includes("clerk"))) ||
          (key === "supervisor" && (role.includes("observer") || role.includes("supervisor"))) ||
          (key === "contingence" && isContingenceRole(role))
        ) {
          return s;
        }
      }
      return null;
    };
    const staffBody = staffOrder.map((label) => {
      const s = resolveStaff(label);
      // Contingence is a single flat amount: no head-count or per-unit rate to print.
      const flat = label === "Contingence";
      return [
        label,
        s && !flat ? Number(s.staff_count || 0) : "",
        s && !flat ? Number(s.honorarium_per_unit || 0).toFixed(2) : "",
        s ? Number(s.total_amount || 0).toFixed(2) : "",
      ];
    });
    const staffEndY = drawTable({
      x: left,
      y: doc.y,
      colWidths: fitWidths([195, 65, 130, 130]),
      rowHeight: 14,
      rows: [
        ["Staff Detail", "Number", "Honorarium Per Unit", "Total Amount"],
        ...staffBody,
        ["Grand Total", "", "", Number(report.grand_total_amount || 0).toFixed(2)],
      ],
      align: ["left", "center", "right", "right"],
      fontSize: 8,
    });

    doc.y = staffEndY + 6;
    labelFont().text("Details of Observers and Other Officials Present During Examination-", left, doc.y);
    doc.moveDown(0.1);
    labelFont().text(
      `Was the supervisor present during the examination?  ${
        report.was_supervisor_present == null ? "" : report.was_supervisor_present ? "Yes" : "No"
      }`,
      left,
      doc.y
    );
    doc.moveDown(0.1);
    labelFont().text("If Yes, then fill the following detail-", left, doc.y);

    const supervisors = observerRes.rows.filter((r) => String(r.observer_type || "").toUpperCase() === "SUPERVISOR");
    const supRows = supervisors.length
      ? [supervisors[0]].map((r, i) => [i + 1, r.official_name || "", r.time_of_visit || "", r.time_of_leaving || "", r.other_details || ""])
      : [[1, "", "", "", ""]];
    const supEndY = drawTable({
      x: left,
      y: doc.y + 2,
      colWidths: fitWidths([40, 200, 85, 85, 113]),
      rowHeight: 14,
      rows: [["S. No.", "Supervisor/Officer Name", "Time of Visit", "Time of Leaving", "Other Details"], ...supRows],
      align: ["center", "left", "left", "left", "left"],
      fontSize: 8,
    });

    doc.y = supEndY + 4;
    labelFont().text(
      `Was the observer present during the examination?  ${
        report.was_observer_present == null ? "" : report.was_observer_present ? "Yes" : "No"
      }`,
      left,
      doc.y
    );
    doc.moveDown(0.1);
    labelFont().text("If Yes, then fill the following detail-", left, doc.y);

    const observers = observerRes.rows.filter((r) => String(r.observer_type || "").toUpperCase() === "OBSERVER");
    const obsRows = observers.length
      ? [observers[0]].map((r, i) => [i + 1, r.official_name || "", r.time_of_visit || "", r.time_of_leaving || "", r.other_details || ""])
      : [[1, "", "", "", ""]];
    const obsEndY = drawTable({
      x: left,
      y: doc.y + 2,
      colWidths: fitWidths([40, 200, 85, 85, 113]),
      rowHeight: 14,
      rows: [["Sr. No.", "Observer/Officer Name", "Time of Visit", "Time of Leaving", "Other Details"], ...obsRows],
      align: ["center", "left", "left", "left", "left"],
      fontSize: 8,
    });

    doc.y = obsEndY + 4;
    labelFont().text("Any special incident during examination (must be reported if occurred)", left, doc.y);
    doc.rect(left, doc.y + 2, usableWidth, 22).stroke();
    valueFont().text(toBlank(report.any_special_incident), left + 3, doc.y + 4, { width: usableWidth - 6, height: 18, ellipsis: true });

    doc.end();
  } catch (err) {
    console.error("BEO CS report PDF download error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



exports.getAllCenterSuperintendentReports = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id, scholarship_id, block_code } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!session_id || !scholarship_id) {
    return res.status(400).json({
      message: "session_id and scholarship_id are required",
    });
  }

  if (!block_code) {
    return res.status(400).json({
      message: "block_code is required",
    });
  }

  const cacheKey = `scert_all_center_reports:${session_id}:${scholarship_id}:${block_code}`;
  try {
    if (reportCacheClient.isReady) {
      const cached = await reportCacheClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }
  } catch (err) {
    console.error("Redis get error for all center reports:", err.message);
  }

  try {
    // First, get all centers for the block
    const centersRes = await pool.query(
      `
      SELECT
        ec.center_id,
        ec.center_order AS center_code,
        ec.school_name AS center_name,
        bp.block_code,
        bp.block_name,
        bp.district_code,
        bp.district_name
      FROM scert_db.exam_centers ec
      JOIN scert_db.beo_profiles bp ON bp.block_code = ec.block_code
      WHERE ec.session_id = $1
        AND ec.scholarship_id = $2
        AND ec.block_code = $3
        AND ec.is_active = true
      ORDER BY ec.center_order
      `,
      [session_id, scholarship_id, block_code]
    );

    const centerIds = centersRes.rows.map(c => c.center_id);
    let reportsMap = {};
    let approvedCountMap = {};
    let enrolledMap = {};
    let staffMap = {};

    if (centerIds.length > 0) {
      // Fetch reports
      const reportsQuery = await pool.query(`
        SELECT
          center_id,
          report_id,
          bank_account_number,
          bank_ifsc_code,
          bank_name,
          number_of_exam_rooms,
          grand_total_amount,
          is_submitted,
          submitted_at
        FROM scert_db.center_superintendent_reports
        WHERE center_id = ANY($1)
          AND session_id = $2
          AND scholarship_id = $3
          AND is_submitted = true
      `, [centerIds, session_id, scholarship_id]);
      
      reportsQuery.rows.forEach(r => reportsMap[r.center_id] = r);
      
      const reportIds = reportsQuery.rows.map(r => r.report_id);

      // Fetch approved counts
      const approvedCountQuery = await pool.query(`
        SELECT center_id, COUNT(*)::int AS total_registered
        FROM scert_db.scholarship_applications
        WHERE session_id = $1
          AND scholarship_id = $2
          AND center_id = ANY($3)
          AND status = 'APPROVED'
        GROUP BY center_id
      `, [session_id, scholarship_id, centerIds]);
      
      approvedCountQuery.rows.forEach(r => approvedCountMap[r.center_id] = r.total_registered);

      if (reportIds.length > 0) {
        // Fetch enrolled counts. Scoped to source = 'CS_REPORT' so a center
        // with both a CS Report row and a separate During Exam row for the
        // same report_id doesn't get double-counted.
        const enrolledQuery = await pool.query(`
          SELECT report_id, COALESCE(SUM(total_enrolled), 0) AS total_enrolled
          FROM scert_db.center_exam_attendance_summary
          WHERE report_id = ANY($1) AND source = 'CS_REPORT'
          GROUP BY report_id
        `, [reportIds]);
        
        enrolledQuery.rows.forEach(r => enrolledMap[r.report_id] = r.total_enrolled);

        // Fetch staff aggregates
        const staffQuery = await pool.query(`
          SELECT
            report_id,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%invigilator%' THEN staff_count ELSE 0 END), 0) AS invigilator_count,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%reliever%' THEN staff_count ELSE 0 END), 0) AS reliever_count,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%cent%' AND LOWER(staff_role) LIKE '%sup%' THEN total_amount ELSE 0 END), 0) AS cent_sup_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%exam%' AND (LOWER(staff_role) LIKE '%incharge%' OR LOWER(staff_role) LIKE '%in charge%') THEN total_amount ELSE 0 END), 0) AS exam_incharge_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%invigilator%' THEN total_amount ELSE 0 END), 0) AS invigilator_hon_amount,
            COALESCE(SUM(CASE WHEN (LOWER(staff_role) LIKE '%office%' AND (LOWER(staff_role) LIKE '%asst%' OR LOWER(staff_role) LIKE '%assistant%')) OR LOWER(staff_role) LIKE '%clerk%' THEN total_amount ELSE 0 END), 0) AS office_asst_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%peon%' THEN total_amount ELSE 0 END), 0) AS peon_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%reliever%' THEN total_amount ELSE 0 END), 0) AS reliever_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%observer%' OR LOWER(staff_role) LIKE '%supervisor%' THEN total_amount ELSE 0 END), 0) AS observer_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%conting%' OR LOWER(staff_role) LIKE '%sweeper%' THEN total_amount ELSE 0 END), 0) AS contingency_amount,
            COALESCE(SUM(CASE WHEN LOWER(staff_role) LIKE '%other expens%' OR LOWER(staff_role) LIKE '%other expence%' THEN total_amount ELSE 0 END), 0) AS other_expenses_amount
          FROM scert_db.center_exam_staff_details
          WHERE report_id = ANY($1)
          GROUP BY report_id
        `, [reportIds]);
        
        staffQuery.rows.forEach(r => staffMap[r.report_id] = r);
      }
    }

    const reportsWithCounts = centersRes.rows.map((center) => {
      const report = reportsMap[center.center_id] || null;
      let totalRegisteredStudents = Number(approvedCountMap[center.center_id] || 0);

      if (totalRegisteredStudents === 0 && report) {
        totalRegisteredStudents = Number(enrolledMap[report.report_id] || 0);
      }

      let totalInvigilators = 0;
      let centSupAmount = 0;
      let examInchargeAmount = 0;
      let invigilatorHonAmount = 0;
      let officeAsstAmount = 0;
      let peonAmount = 0;
      let relieverAmount = 0;
      let observerAmount = 0;
      let contingencyAmount = 0;
      let otherExpensesAmount = 0;

      if (report) {
        const staffAgg = staffMap[report.report_id] || {};
        // The "Invigilator + Reliever" amount column combines both roles, so
        // the headcount column above it has to as well - otherwise a center
        // with 8 invigilators and 1 reliever shows a "count of 8" next to an
        // amount that actually covers 9 people.
        totalInvigilators =
          parseInt(staffAgg.invigilator_count || 0, 10) + parseInt(staffAgg.reliever_count || 0, 10);
        centSupAmount = Number(staffAgg.cent_sup_amount || 0);
        examInchargeAmount = Number(staffAgg.exam_incharge_amount || 0);
        invigilatorHonAmount = Number(staffAgg.invigilator_hon_amount || 0);
        officeAsstAmount = Number(staffAgg.office_asst_amount || 0);
        peonAmount = Number(staffAgg.peon_amount || 0);
        relieverAmount = Number(staffAgg.reliever_amount || 0);
        observerAmount = Number(staffAgg.observer_amount || 0);
        contingencyAmount = Number(staffAgg.contingency_amount || 0);
        otherExpensesAmount = Number(staffAgg.other_expenses_amount || 0);
      }

      return {
        center_id: center.center_id,
        center_code: center.center_code,
        center_name: center.center_name,
        block_code: center.block_code,
        block_name: center.block_name,
        district_code: center.district_code,
        district_name: center.district_name,
        bank_account_number: report?.bank_account_number || null,
        bank_ifsc_code: report?.bank_ifsc_code || null,
        bank_name: report?.bank_name || null,
        total_registered_students: totalRegisteredStudents,
        number_of_exam_rooms: report?.number_of_exam_rooms || null,
        total_invigilators: totalInvigilators,
        cent_sup_amount: centSupAmount,
        exam_incharge_amount: examInchargeAmount,
        invigilator_hon_amount: invigilatorHonAmount,
        office_asst_amount: officeAsstAmount,
        peon_amount: peonAmount,
        reliever_amount: relieverAmount,
        observer_amount: observerAmount,
        contingency_amount: contingencyAmount,
        other_expenses_amount: otherExpensesAmount,
        grand_total_amount: report?.grand_total_amount || null,
        is_submitted: report?.is_submitted || false,
        submitted_at: report?.submitted_at || null,
      };
    });

    const responseData = {
      total: reportsWithCounts.length,
      reports: reportsWithCounts,
    };

    try {
      if (reportCacheClient.isReady) {
        await reportCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins cache
      }
    } catch (err) {
      console.error("Redis set error for all center reports:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("Get all center reports error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
