const pool = require("../config/db");
const { sendTablePdf } = require("../utils/pdfTable.util");
const { getBeoNmmssSummary } = require("../services/beoNmmssSummary.service");

async function getTargetClassesForScholarship(scholarship_id) {
  const sid = Number(scholarship_id);
  if (!Number.isFinite(sid)) return [6, 9];

  const scholarshipMetaRes = await pool.query(
    `SELECT scholarship_name
     FROM scert_db.scholarships
     WHERE scholarship_id = $1
     LIMIT 1`,
    [sid]
  );

  const scholarshipName = String(scholarshipMetaRes.rows[0]?.scholarship_name || "");
  const isNmmssByName =
    /\bNMMSS\b/i.test(scholarshipName) ||
    /\bNMMS\b/i.test(scholarshipName) ||
    /\bSNSS\b/i.test(scholarshipName) ||
    /\bSSSS\b/i.test(scholarshipName) ||
    /\bCLASS\s*8\b/i.test(scholarshipName);
  if (isNmmssByName) return [8];

  const isCmByName =
    /\bCM\b/i.test(scholarshipName) || /CHIEF\s*MINISTER/i.test(scholarshipName);
  if (isCmByName) return [6, 9];

  // Fallback by form design:
  // - CM-style forms have class field (6/9)
  // - NMMSS-style forms do not have class selector (fixed class 8)
  const classFieldRes = await pool.query(
    `SELECT 1
     FROM scert_db.scholarship_form_fields
     WHERE scholarship_id = $1
       AND LOWER(TRIM(field_key)) IN ('class', 'class_level')
     LIMIT 1`,
    [sid]
  );

  return classFieldRes.rows.length > 0 ? [6, 9] : [8];
}

async function getClassFieldId(scholarship_id) {
  const res = await pool.query(
    `SELECT field_id
     FROM scert_db.scholarship_form_fields
     WHERE scholarship_id = $1
       AND LOWER(TRIM(field_key)) IN ('class', 'class_level')
     ORDER BY field_id ASC
     LIMIT 1`,
    [scholarship_id]
  );

  return res.rows[0]?.field_id || null;
}

async function getReportMetaNames({ session_id, scholarship_id }) {
  const metaRes = await pool.query(
    `SELECT s.session_name, sch.scholarship_name
     FROM scert_db.academic_sessions s
     LEFT JOIN scert_db.scholarships sch
       ON sch.scholarship_id = $2
     WHERE s.session_id = $1
     LIMIT 1`,
    [session_id, scholarship_id]
  );

  return {
    session_name: metaRes.rows[0]?.session_name || String(session_id),
    scholarship_name: metaRes.rows[0]?.scholarship_name || String(scholarship_id),
  };
}

async function computeBeoRegistrationProgress({ beoUserId, session_id, scholarship_id }) {
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);

  // 1) BEO block
  const beoRes = await pool.query(
    `SELECT block_code, block_name
     FROM scert_db.beo_profiles
     WHERE user_id = $1`,
    [beoUserId]
  );

  if (beoRes.rows.length === 0) {
    const err = new Error("BEO profile not found");
    err.status = 404;
    throw err;
  }

  const { block_code, block_name } = beoRes.rows[0];

  // 2) Schools in block
  const schoolsRes = await pool.query(
    `SELECT user_id AS school_user_id, school_name, udise_code
     FROM scert_db.school_profiles
     WHERE block_code = $1
     ORDER BY school_name ASC`,
    [block_code]
  );

  // 3) Strength totals for target classes (6/9 for CM, 8 for NMMMS)
  const strengthRes = await pool.query(
    `SELECT
       sss.school_user_id,
       sss.class_level,
       SUM(sss.boys_count + sss.girls_count)::int AS total_strength
     FROM scert_db.school_student_strength sss
     JOIN scert_db.school_profiles sp
       ON sp.user_id = sss.school_user_id
     WHERE sp.block_code = $1
       AND sss.class_level = ANY($2::int[])
     GROUP BY sss.school_user_id, sss.class_level`,
    [block_code, targetClasses]
  );

  const strengthBySchool = new Map();
  for (const r of strengthRes.rows) {
    const key = String(r.school_user_id);
    if (!strengthBySchool.has(key)) strengthBySchool.set(key, {});
    strengthBySchool.get(key)[String(r.class_level)] = (strengthBySchool.get(key)[String(r.class_level)] || 0) + Number(r.total_strength || 0);
  }

  // 4) class field is optional (NMMMS-style scholarships do not have it)
  const classFieldId = await getClassFieldId(scholarship_id);
  const hasClassField = Boolean(classFieldId);

  // 5) Registrations by school and class (target classes)
  let registrationsRes;
  if (hasClassField) {
    registrationsRes = await pool.query(
      `SELECT
         COALESCE(sp_student.user_id, sp_creator.user_id) AS school_user_id,
         (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) AS class_level,
         COUNT(*)::int AS registrations,
         -- Appeared: present in either paper. Rows only exist here once the
         -- BEO has uploaded Absentee After Exam for the center, so this is 0
         -- (not just missing) until then.
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM scert_db.center_exam_student_attendance x
           WHERE x.application_id = a.application_id
             AND (x.mat_status = 'PRESENT' OR x.sat_status = 'PRESENT')
         ))::int AS appeared
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles stp
         ON a.student_user_id = stp.user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON stp.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       LEFT JOIN scert_db.scholarship_application_answers aa
         ON aa.application_id = a.application_id
        AND aa.field_id = $4
       WHERE a.session_id = $1
         AND a.scholarship_id = $2
         AND a.status NOT IN ('DRAFT', 'REJECTED')
         AND COALESCE(sp_student.block_code, sp_creator.block_code)::text = $3::text
         AND (aa.value_number IS NOT NULL OR aa.value_text IS NOT NULL)
         AND (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) = ANY($5::int[])
       GROUP BY COALESCE(sp_student.user_id, sp_creator.user_id), class_level`,
      [session_id, scholarship_id, block_code, classFieldId, targetClasses]
    );
  } else {
    // No class field (class-fixed exams): attribute all registrations to the primary target class
    const targetClass = Array.isArray(targetClasses) && targetClasses.length ? Number(targetClasses[0]) : 0;

    registrationsRes = await pool.query(
      `SELECT
         COALESCE(sp_student.user_id, sp_creator.user_id) AS school_user_id,
         $4::int AS class_level,
         COUNT(*)::int AS registrations,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM scert_db.center_exam_student_attendance x
           WHERE x.application_id = a.application_id
             AND (x.mat_status = 'PRESENT' OR x.sat_status = 'PRESENT')
         ))::int AS appeared
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles stp
         ON a.student_user_id = stp.user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON stp.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       WHERE a.session_id = $1
         AND a.scholarship_id = $2
         AND a.status NOT IN ('DRAFT', 'REJECTED')
         AND COALESCE(sp_student.block_code, sp_creator.block_code)::text = $3::text
       GROUP BY COALESCE(sp_student.user_id, sp_creator.user_id)`,
      [session_id, scholarship_id, block_code, targetClass]
    );
  }

  const registrationsBySchool = new Map();
  const appearedBySchool = new Map();
  for (const r of registrationsRes.rows) {
    const key = String(r.school_user_id);
    if (!registrationsBySchool.has(key)) registrationsBySchool.set(key, {});
    registrationsBySchool.get(key)[String(r.class_level)] = (registrationsBySchool.get(key)[String(r.class_level)] || 0) + Number(r.registrations || 0);
    if (!appearedBySchool.has(key)) appearedBySchool.set(key, 0);
    appearedBySchool.set(key, appearedBySchool.get(key) + Number(r.appeared || 0));
  }

  // 6) Assemble rows (always return class6/class8/class9 columns for UI compatibility)
  const rows = schoolsRes.rows.map((s) => {
    const schoolKey = String(s.school_user_id);
    const strength = strengthBySchool.get(schoolKey) || {};
    const regs = registrationsBySchool.get(schoolKey) || {};

    const class6_strength = Number(strength["6"] || 0);
    const class8_strength = Number(strength["8"] || 0);
    const class9_strength = Number(strength["9"] || 0);
    const class6_registered = Number(regs["6"] || 0);
    const class8_registered = Number(regs["8"] || 0);
    const class9_registered = Number(regs["9"] || 0);

    return {
      school_user_id: s.school_user_id,
      school_name: s.school_name,
      udise_code: s.udise_code,
      class6_strength,
      class6_registered,
      class8_strength,
      class8_registered,
      class9_strength,
      class9_registered,
      total_registration: class6_registered + class8_registered + class9_registered,
      appeared: Number(appearedBySchool.get(schoolKey) || 0),
    };
  });

  return {
    block_code,
    block_name,
    targetClasses,
    rows,
  };
}

/**
 * BEO PROGRESS REPORT: school-wise strength vs scholarship registrations
 * GET /api/beo/progress-reports/registration?scholarship_id=
 */
exports.getRegistrationProgressReport = async (req, res) => {
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
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const report = await computeBeoRegistrationProgress({
      beoUserId,
      session_id,
      scholarship_id,
    });

    res.json({
      session_id,
      scholarship_id: Number(scholarship_id),
      block_code: report.block_code,
      block_name: report.block_name,
      total_schools: report.rows.length,
      targetClasses: report.targetClasses,
      rows: report.rows,
    });
  } catch (err) {
    console.error("BEO progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * BEO PROGRESS REPORT (PDF)
 * GET /api/beo/progress-reports/registration.pdf?scholarship_id=
 */
exports.downloadRegistrationProgressReportPdf = async (req, res) => {
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
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const report = await computeBeoRegistrationProgress({
      beoUserId,
      session_id,
      scholarship_id,
    });

    const pdfRows = report.rows.map((r, idx) => ({
      sno: idx + 1,
      name: r.school_name || "—",
      class6_strength: r.class6_strength ?? 0,
      class6_registered: r.class6_registered ?? 0,
      class8_strength: r.class8_strength ?? 0,
      class8_registered: r.class8_registered ?? 0,
      class9_strength: r.class9_strength ?? 0,
      class9_registered: r.class9_registered ?? 0,
      total_registration: r.total_registration ?? 0,
    }));

    const totals = report.rows.reduce(
      (acc, r) => {
        acc.class6_strength += Number(r.class6_strength || 0);
        acc.class6_registered += Number(r.class6_registered || 0);
        acc.class8_strength += Number(r.class8_strength || 0);
        acc.class8_registered += Number(r.class8_registered || 0);
        acc.class9_strength += Number(r.class9_strength || 0);
        acc.class9_registered += Number(r.class9_registered || 0);
        acc.total_registration += Number(r.total_registration || 0);
        return acc;
      },
      {
        class6_strength: 0,
        class6_registered: 0,
        class8_strength: 0,
        class8_registered: 0,
        class9_strength: 0,
        class9_registered: 0,
        total_registration: 0,
      }
    );

    // Widths are auto-normalized by sendTablePdf when needed (e.g. portrait layout).
    const columns = [
      { key: "sno", label: "S.No", width: 40, align: "right" },
      { key: "name", label: "Name of the School", width: 250, align: "left" },
      ...(report.targetClasses?.includes(6)
        ? [
            { key: "class6_strength", label: "Class 6 Strength", width: 90, align: "right" },
            { key: "class6_registered", label: "Class 6 Registered", width: 110, align: "right" },
          ]
        : []),
      ...(report.targetClasses?.includes(8)
        ? [
            { key: "class8_strength", label: "Class 8 Strength", width: 90, align: "right" },
            { key: "class8_registered", label: "Class 8 Registered", width: 110, align: "right" },
          ]
        : []),
      ...(report.targetClasses?.includes(9)
        ? [
            { key: "class9_strength", label: "Class 9 Strength", width: 90, align: "right" },
            { key: "class9_registered", label: "Class 9 Registered", width: 110, align: "right" },
          ]
        : []),
      { key: "total_registration", label: "Total", width: 80, align: "right" },
    ];

    const totalsRow = {
      sno: "",
      name: "Total",
      ...totals,
    };

    await sendTablePdf(res, {
      filename: `beo_progress_report_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (School-wise)",
      layout: "portrait",
      metaLines: [
        `Session: ${session_name}   Scholarship: ${scholarship_name}   Block: ${report.block_name || report.block_code}`,
      ],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("BEO progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * BEO PROGRESS REPORT FOR NMMSS/SNSS/SSSS (PDF)
 * GET /api/beo/progress-reports/nmmss-summary.pdf?scholarship_id=
 *
 * Same school-wise table as BeoNmmssSummary.jsx (and the BEO dashboard's
 * NMMSS card), so the PDF a BEO downloads from Reports > Progress Report
 * matches what is on screen. Qualified/Selected stay blank: the result
 * module does not hold NMMSS results yet.
 */
exports.downloadNmmssProgressReportPdf = async (req, res) => {
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
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const summary = await getBeoNmmssSummary(pool, {
      beoUserId,
      sessionId: session_id,
      scholarshipId: Number(scholarship_id),
    });

    const pdfRows = (summary.rows || []).map((r, idx) => ({
      sno: idx + 1,
      name: r.school_name || "—",
      enrolled: r.enrolled ?? 0,
      registered_nmmss: r.registered_nmmss ?? 0,
      registered_snss_ssss: r.registered_snss_ssss ?? 0,
      registered_total: r.registered_total ?? 0,
      appeared: r.appeared ?? 0,
      qualified: "—",
      selected: "—",
    }));

    const totals = summary.totals || {};
    const totalsRow = {
      sno: "",
      name: "Total",
      enrolled: totals.enrolled ?? 0,
      registered_nmmss: totals.registered_nmmss ?? 0,
      registered_snss_ssss: totals.registered_snss_ssss ?? 0,
      registered_total: totals.registered_total ?? 0,
      appeared: totals.appeared ?? 0,
      qualified: "—",
      selected: "—",
    };

    const columns = [
      { key: "sno", label: "S.No", width: 40, align: "right" },
      { key: "name", label: "Name of the School", width: 220, align: "left" },
      { key: "enrolled", label: "Enrolled in Class 8", width: 90, align: "right" },
      { key: "registered_nmmss", label: "Registered NMMSS (Code 1)", width: 110, align: "right" },
      { key: "registered_snss_ssss", label: "Registered SNSS/SSSS (Code 2)", width: 120, align: "right" },
      { key: "registered_total", label: "Registered Total", width: 100, align: "right" },
      { key: "appeared", label: "Appeared in Exam", width: 90, align: "right" },
      { key: "qualified", label: "Qualified", width: 70, align: "right" },
      { key: "selected", label: "Selected", width: 70, align: "right" },
    ];

    await sendTablePdf(res, {
      filename: `beo_progress_report_nmmss_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (School-wise)",
      layout: "landscape",
      metaLines: [
        `Session: ${session_name}   Scholarship: ${scholarship_name}   Block: ${summary.profile?.block_name || summary.block_code}`,
        "Qualified and Selected figures will appear once the NMMSS results are declared.",
      ],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("BEO NMMSS progress report PDF error:", err);
    const status = err.statusCode || err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};
