const pool = require("../config/db");
const districtBlockMaster = require("../master-data/district-block.master.json");
const { sendTablePdf } = require("../utils/pdfTable.util");

function getDistrictNameFromMaster(district_code) {
  const dc = String(district_code);
  const dcNum = Number(dc);
  const entry = Object.values(districtBlockMaster || {}).find((d) => {
    const dNum = Number(String(d.district_code));
    if (!Number.isNaN(dcNum) && !Number.isNaN(dNum)) return dNum === dcNum;
    return String(d.district_code) === dc;
  });
  return entry?.district_name || null;
}

function normalizeNumericCode(code) {
  const s = String(code);
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n);
  return s;
}

function getBlocksForDistrictFromMaster(district_code) {
  const dc = String(district_code);
  const dcNum = Number(dc);
  const entry = Object.values(districtBlockMaster || {}).find((d) => {
    const dNum = Number(String(d.district_code));
    if (!Number.isNaN(dcNum) && !Number.isNaN(dNum)) return dNum === dcNum;
    return String(d.district_code) === dc;
  });

  if (!entry || !entry.blocks) return [];

  const blocks = Object.values(entry.blocks)
    .map((b) => ({
      block_code: String(b.block_code),
      block_name: b.block_name,
    }))
    .filter((b) => b.block_code && b.block_name);

  blocks.sort((a, b) => String(a.block_code).localeCompare(String(b.block_code)));
  return blocks;
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

function buildProgressTotals(rows, targetClasses) {
  const totals = { total_registration: 0 };
  for (const c of targetClasses || []) {
    totals[`class${c}_strength`] = 0;
    totals[`class${c}_registered`] = 0;
  }

  for (const r of rows || []) {
    for (const c of targetClasses || []) {
      totals[`class${c}_strength`] += Number(r?.[`class${c}_strength`] || 0);
      totals[`class${c}_registered`] += Number(r?.[`class${c}_registered`] || 0);
    }
    totals.total_registration += Number(r?.total_registration || 0);
  }

  return totals;
}

function buildProgressPdfColumns(nameLabel, targetClasses) {
  const cols = [
    { key: "sno", label: "S.No", width: 40, align: "right" },
    { key: "name", label: nameLabel, width: 250, align: "left" },
  ];

  for (const c of targetClasses || []) {
    cols.push({ key: `class${c}_strength`, label: `Class ${c} Strength`, width: 90, align: "right" });
    cols.push({ key: `class${c}_registered`, label: `Class ${c} Registered`, width: 110, align: "right" });
  }

  cols.push({ key: "total_registration", label: "Total", width: 80, align: "right" });
  return cols;
}

async function getDistrictFromProfile(districtUserId) {
  const res = await pool.query(
    `SELECT district_code, district_name
     FROM scert_db.district_profiles
     WHERE user_id = $1`,
    [districtUserId]
  );

  if (res.rows.length === 0) return null;
  return {
    district_code: String(res.rows[0].district_code),
    district_name: res.rows[0].district_name || null,
  };
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

async function computeDistrictOnlyRegistrationProgress({ session_id, scholarship_id, district_code }) {
  const classFieldId = await getClassFieldId(scholarship_id);
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);
  const hasClassField = Boolean(classFieldId);

  // Strength totals for this district
  const strengthRes = await pool.query(
    `SELECT
       sp.district_code,
       sp.district_name,
       sss.class_level,
       SUM(sss.boys_count + sss.girls_count)::int AS total_strength
     FROM scert_db.school_student_strength sss
     JOIN scert_db.school_profiles sp
       ON sp.user_id = sss.school_user_id
     WHERE sp.district_code::int = $1::int
       AND sss.class_level = ANY($2::int[])
     GROUP BY sp.district_code, sp.district_name, sss.class_level`,
    [district_code, targetClasses]
  );

  let districtNameFromDb = null;
  const strengthByClass = {};
  for (const r of strengthRes.rows) {
    districtNameFromDb = districtNameFromDb || r.district_name;
    strengthByClass[String(r.class_level)] = (strengthByClass[String(r.class_level)] || 0) + Number(r.total_strength || 0);
  }

  // Registration totals for this district
  let regRes;
  if (hasClassField) {
    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
         COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
         (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) AS class_level,
         COUNT(*)::int AS registrations
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
         AND (aa.value_number IS NOT NULL OR aa.value_text IS NOT NULL)
         AND (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) = ANY($5::int[])
       GROUP BY 1, 2, 3`,
      [session_id, scholarship_id, district_code, classFieldId, targetClasses]
    );
  } else {
    const targetClass = Array.isArray(targetClasses) && targetClasses.length ? Number(targetClasses[0]) : 0;

    // No class field (class-fixed exams): attribute all registrations to the primary target class.
    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
         COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
         $4::int AS class_level,
         COUNT(*)::int AS registrations
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
       GROUP BY 1, 2`,
      [session_id, scholarship_id, district_code, targetClass]
    );
  }

  let districtNameFromRegs = null;
  const regsByClass = {};
  for (const r of regRes.rows) {
    districtNameFromRegs = districtNameFromRegs || r.district_name;
    regsByClass[String(r.class_level)] = (regsByClass[String(r.class_level)] || 0) + Number(r.registrations || 0);
  }

  const class6_strength = Number(strengthByClass["6"] || 0);
  const class8_strength = Number(strengthByClass["8"] || 0);
  const class9_strength = Number(strengthByClass["9"] || 0);
  const class6_registered = Number(regsByClass["6"] || 0);
  const class8_registered = Number(regsByClass["8"] || 0);
  const class9_registered = Number(regsByClass["9"] || 0);

  return {
    rows: [
      {
        district_code: String(district_code),
        district_name:
          districtNameFromDb ||
          districtNameFromRegs ||
          getDistrictNameFromMaster(district_code) ||
          String(district_code),
        class6_strength,
        class6_registered,
        class8_strength,
        class8_registered,
        class9_strength,
        class9_registered,
        total_registration: class6_registered + class8_registered + class9_registered,
      },
    ],
    targetClasses,
  };
}

async function computeBlockWiseRegistrationProgress({ session_id, scholarship_id, district_code }) {
  const classFieldId = await getClassFieldId(scholarship_id);
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);
  const hasClassField = Boolean(classFieldId);

  // Strength (block x class)
  const strengthRes = await pool.query(
    `SELECT
       sp.block_code,
       sp.block_name,
       sss.class_level,
       SUM(sss.boys_count + sss.girls_count)::int AS total_strength
     FROM scert_db.school_student_strength sss
     JOIN scert_db.school_profiles sp
       ON sp.user_id = sss.school_user_id
     WHERE sp.district_code::int = $1::int
       AND sss.class_level = ANY($2::int[])
     GROUP BY sp.block_code, sp.block_name, sss.class_level`,
    [district_code, targetClasses]
  );

  const strengthByBlock = new Map();
  for (const r of strengthRes.rows) {
    const key = normalizeNumericCode(r.block_code);
    if (!strengthByBlock.has(key)) {
      strengthByBlock.set(key, { block_name: r.block_name, byClass: {} });
    }
    const entry = strengthByBlock.get(key);
    entry.block_name = entry.block_name || r.block_name;
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.total_strength || 0);
  }

  // Registrations (block x class)
  let regRes;
  if (hasClassField) {
    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code,
         COALESCE(sp_student.block_name, sp_creator.block_name) AS block_name,
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
         AND (aa.value_number IS NOT NULL OR aa.value_text IS NOT NULL)
         AND (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) = ANY($5::int[])
       GROUP BY 1, 2, 3`,
      [session_id, scholarship_id, district_code, classFieldId, targetClasses]
    );
  } else {
    const targetClass = Array.isArray(targetClasses) && targetClasses.length ? Number(targetClasses[0]) : 0;

    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code,
         COALESCE(sp_student.block_name, sp_creator.block_name) AS block_name,
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
       GROUP BY 1, 2`,
      [session_id, scholarship_id, district_code, targetClass]
    );
  }

  const regsByBlock = new Map();
  for (const r of regRes.rows) {
    const key = normalizeNumericCode(r.block_code);
    if (!regsByBlock.has(key)) {
      regsByBlock.set(key, { block_name: r.block_name, byClass: {}, appeared: 0 });
    }
    const entry = regsByBlock.get(key);
    entry.block_name = entry.block_name || r.block_name;
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.registrations || 0);
    entry.appeared = (entry.appeared || 0) + Number(r.appeared || 0);
  }

  const baseBlocks = getBlocksForDistrictFromMaster(district_code).map((b) => ({
    ...b,
    __norm: normalizeNumericCode(b.block_code),
  }));

  // Include any block codes that appear in DB aggregates but are missing in master
  const extraBlockCodes = new Set([
    ...Array.from(strengthByBlock.keys()),
    ...Array.from(regsByBlock.keys()),
  ]);

  const extraBlocks = Array.from(extraBlockCodes)
    .filter((code) => code && !baseBlocks.some((b) => b.__norm === normalizeNumericCode(code)))
    .map((block_code) => {
      const key = normalizeNumericCode(block_code);
      const s = strengthByBlock.get(key) || { block_name: null, byClass: {} };
      const r = regsByBlock.get(key) || { block_name: null, byClass: {} };
      return {
        block_code: String(block_code),
        block_name: s.block_name || r.block_name || String(block_code),
        __norm: key,
      };
    });

  const allBlocks = [...baseBlocks, ...extraBlocks];

  const rows = allBlocks.map((b) => {
    const key = b.__norm || normalizeNumericCode(b.block_code);
    const s = strengthByBlock.get(key) || { byClass: {} };
    const r = regsByBlock.get(key) || { byClass: {} };

    const class6_strength = Number(s.byClass?.["6"] || 0);
    const class8_strength = Number(s.byClass?.["8"] || 0);
    const class9_strength = Number(s.byClass?.["9"] || 0);
    const class6_registered = Number(r.byClass?.["6"] || 0);
    const class8_registered = Number(r.byClass?.["8"] || 0);
    const class9_registered = Number(r.byClass?.["9"] || 0);

    return {
      block_code: String(b.block_code),
      block_name: b.block_name,
      class6_strength,
      class6_registered,
      class8_strength,
      class8_registered,
      class9_strength,
      class9_registered,
      total_registration: class6_registered + class8_registered + class9_registered,
      appeared: Number(r.appeared || 0),
    };
  });

  return { rows, targetClasses };
}

async function computeSchoolWiseRegistrationProgress({ session_id, scholarship_id, district_code, block_code }) {
  const classFieldId = await getClassFieldId(scholarship_id);
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);
  const hasClassField = Boolean(classFieldId);

  // Schools in this district + block
  const schoolsRes = await pool.query(
    `SELECT
       user_id AS school_user_id,
       school_name,
       udise_code,
       block_name,
       school_type,
       head_of_institution_name,
       head_of_institution_mobile
     FROM scert_db.school_profiles
     WHERE district_code::int = $1::int
       AND block_code::int = $2::int
     ORDER BY school_name ASC`,
    [district_code, block_code]
  );

  // Strength totals for target classes
  const strengthRes = await pool.query(
    `SELECT
       sss.school_user_id,
       sss.class_level,
       SUM(sss.boys_count + sss.girls_count)::int AS total_strength
     FROM scert_db.school_student_strength sss
     JOIN scert_db.school_profiles sp
       ON sp.user_id = sss.school_user_id
     WHERE sp.district_code::int = $1::int
       AND sp.block_code::int = $2::int
       AND sss.class_level = ANY($3::int[])
     GROUP BY sss.school_user_id, sss.class_level`,
    [district_code, block_code, targetClasses]
  );

  const strengthBySchool = new Map();
  for (const r of strengthRes.rows) {
    const key = String(r.school_user_id);
    if (!strengthBySchool.has(key)) strengthBySchool.set(key, {});
    strengthBySchool.get(key)[String(r.class_level)] = (strengthBySchool.get(key)[String(r.class_level)] || 0) + Number(r.total_strength || 0);
  }

  // Registrations by school and class (target classes)
  let regRes;
  if (hasClassField) {
    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.user_id, sp_creator.user_id) AS school_user_id,
         (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) AS class_level,
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
       LEFT JOIN scert_db.scholarship_application_answers aa
         ON aa.application_id = a.application_id
        AND aa.field_id = $5
       WHERE a.session_id = $1
         AND a.scholarship_id = $2
         AND a.status NOT IN ('DRAFT', 'REJECTED')
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
         AND COALESCE(sp_student.block_code, sp_creator.block_code)::int = $4::int
         AND (aa.value_number IS NOT NULL OR aa.value_text IS NOT NULL)
         AND (
           CASE
             WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
             ELSE aa.value_text::int
           END
         ) = ANY($6::int[])
       GROUP BY COALESCE(sp_student.user_id, sp_creator.user_id), class_level`,
      [session_id, scholarship_id, district_code, block_code, classFieldId, targetClasses]
    );
  } else {
    const targetClass = Array.isArray(targetClasses) && targetClasses.length ? Number(targetClasses[0]) : 0;

    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.user_id, sp_creator.user_id) AS school_user_id,
         $5::int AS class_level,
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
         AND COALESCE(sp_student.block_code, sp_creator.block_code)::int = $4::int
       GROUP BY COALESCE(sp_student.user_id, sp_creator.user_id)`,
      [session_id, scholarship_id, district_code, block_code, targetClass]
    );
  }

  const registrationsBySchool = new Map();
  const appearedBySchool = new Map();
  for (const r of regRes.rows) {
    const key = String(r.school_user_id);
    if (!registrationsBySchool.has(key)) registrationsBySchool.set(key, {});
    registrationsBySchool.get(key)[String(r.class_level)] = (registrationsBySchool.get(key)[String(r.class_level)] || 0) + Number(r.registrations || 0);
    appearedBySchool.set(key, (appearedBySchool.get(key) || 0) + Number(r.appeared || 0));
  }

  // Assemble rows
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
      block_name: s.block_name,
      school_type: s.school_type,
      head_of_institution_name: s.head_of_institution_name,
      head_of_institution_mobile: s.head_of_institution_mobile,
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

  const block_name = schoolsRes.rows[0]?.block_name || null;

  return { block_code: String(block_code), block_name, rows, targetClasses };
}

/**
 * DISTRICT PROGRESS REPORT (DISTRICT-WISE)
 * GET /api/district/progress-reports/registration/districts?scholarship_id=
 */
exports.getDistrictWiseRegistrationProgress = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 4) {
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

    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const report = await computeDistrictOnlyRegistrationProgress({
      session_id,
      scholarship_id,
      district_code: district.district_code,
    });

    res.json({
      session_id,
      scholarship_id: Number(scholarship_id),
      targetClasses: report.targetClasses,
      total_districts: report.rows.length,
      rows: report.rows,
    });
  } catch (err) {
    console.error("District district-wise progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * DISTRICT PROGRESS REPORT (BLOCK-WISE within the district)
 * GET /api/district/progress-reports/registration/blocks?scholarship_id=&district_code=
 */
exports.getBlockWiseRegistrationProgress = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code } = req.query;

  if (roleId !== 4) {
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

    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const targetDistrictCode = district_code ? String(district_code) : district.district_code;

    // Prevent a district user from accessing another district's report.
    if (String(targetDistrictCode) !== String(district.district_code)) {
      return res.status(403).json({ message: "Unauthorized district" });
    }

    const report = await computeBlockWiseRegistrationProgress({
      session_id,
      scholarship_id,
      district_code: targetDistrictCode,
    });

    res.json({
      session_id,
      scholarship_id: Number(scholarship_id),
      targetClasses: report.targetClasses,
      district_code: targetDistrictCode,
      total_blocks: report.rows.length,
      rows: report.rows,
    });
  } catch (err) {
    console.error("District block-wise progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * DISTRICT PROGRESS REPORT (DISTRICT-WISE) PDF
 * GET /api/district/progress-reports/registration/districts.pdf?scholarship_id=
 */
exports.downloadDistrictWiseRegistrationProgressPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const report = await computeDistrictOnlyRegistrationProgress({
      session_id,
      scholarship_id,
      district_code: district.district_code,
    });

    const targetClasses =
      report.targetClasses || (await getTargetClassesForScholarship(scholarship_id));

    const pdfRows = report.rows.map((r, idx) => {
      const row = {
        sno: idx + 1,
        name: r.district_name || r.district_code || "—",
        total_registration: r.total_registration ?? 0,
      };

      for (const c of targetClasses || []) {
        row[`class${c}_strength`] = r?.[`class${c}_strength`] ?? 0;
        row[`class${c}_registered`] = r?.[`class${c}_registered`] ?? 0;
      }

      return row;
    });

    const totals = buildProgressTotals(report.rows, targetClasses);
    const columns = buildProgressPdfColumns("Name of the District", targetClasses);

    const totalsRow = {
      sno: "",
      name: "Total",
      ...totals,
    };

    await sendTablePdf(res, {
      filename: `district_progress_report_districts_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (District-wise)",
      layout: "portrait",
      metaLines: [`Session: ${session_name}   Scholarship: ${scholarship_name}`],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("District district progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * DISTRICT PROGRESS REPORT (BLOCK-WISE) PDF
 * GET /api/district/progress-reports/registration/blocks.pdf?scholarship_id=&district_code=
 */
exports.downloadBlockWiseRegistrationProgressPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code } = req.query;

  if (roleId !== 4) {
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

    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const targetDistrictCode = district_code ? String(district_code) : district.district_code;

    if (String(targetDistrictCode) !== String(district.district_code)) {
      return res.status(403).json({ message: "Unauthorized district" });
    }

    const report = await computeBlockWiseRegistrationProgress({
      session_id,
      scholarship_id,
      district_code: targetDistrictCode,
    });

    const districtName = getDistrictNameFromMaster(targetDistrictCode) || district.district_name;

    const targetClasses =
      report.targetClasses || (await getTargetClassesForScholarship(scholarship_id));

    const pdfRows = report.rows.map((r, idx) => {
      const row = {
        sno: idx + 1,
        name: r.block_name || r.block_code || "—",
        total_registration: r.total_registration ?? 0,
      };

      for (const c of targetClasses || []) {
        row[`class${c}_strength`] = r?.[`class${c}_strength`] ?? 0;
        row[`class${c}_registered`] = r?.[`class${c}_registered`] ?? 0;
      }

      return row;
    });

    const totals = buildProgressTotals(report.rows, targetClasses);
    const columns = buildProgressPdfColumns("Name of the Block", targetClasses);

    const totalsRow = {
      sno: "",
      name: "Total",
      ...totals,
    };

    await sendTablePdf(res, {
      filename: `district_progress_report_blocks_${targetDistrictCode}_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (Block-wise)",
      layout: "portrait",
      metaLines: [
        `Session: ${session_name}   Scholarship: ${scholarship_name}`,
        `District: ${districtName || targetDistrictCode}`,
      ],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("District block progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * DISTRICT PROGRESS REPORT (SCHOOL-WISE within a block)
 * GET /api/district/progress-reports/registration/schools?scholarship_id=&block_code=
 */
exports.getSchoolWiseRegistrationProgress = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, block_code } = req.query;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id || !block_code) {
    return res.status(400).json({ message: "scholarship_id and block_code are required" });
  }

  try {
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const report = await computeSchoolWiseRegistrationProgress({
      session_id,
      scholarship_id,
      district_code: district.district_code,
      block_code,
    });

    res.json({
      session_id,
      scholarship_id: Number(scholarship_id),
      targetClasses: report.targetClasses,
      district_code: district.district_code,
      block_code: String(block_code),
      block_name: report.block_name,
      total_schools: report.rows.length,
      rows: report.rows,
    });
  } catch (err) {
    console.error("District school-wise progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * DISTRICT PROGRESS REPORT (SCHOOL-WISE) PDF
 * GET /api/district/progress-reports/registration/schools.pdf?scholarship_id=&block_code=
 */
exports.downloadSchoolWiseRegistrationProgressPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, block_code } = req.query;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id || !block_code) {
    return res.status(400).json({ message: "scholarship_id and block_code are required" });
  }

  try {
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const report = await computeSchoolWiseRegistrationProgress({
      session_id,
      scholarship_id,
      district_code: district.district_code,
      block_code,
    });

    const districtName = getDistrictNameFromMaster(district.district_code) || district.district_name;

    const targetClasses =
      report.targetClasses || (await getTargetClassesForScholarship(scholarship_id));

    const pdfRows = report.rows.map((r, idx) => {
      const row = {
        sno: idx + 1,
        name: r.school_name || "—",
        total_registration: r.total_registration ?? 0,
      };

      for (const c of targetClasses || []) {
        row[`class${c}_strength`] = r?.[`class${c}_strength`] ?? 0;
        row[`class${c}_registered`] = r?.[`class${c}_registered`] ?? 0;
      }

      return row;
    });

    const totals = buildProgressTotals(report.rows, targetClasses);
    const columns = buildProgressPdfColumns("Name of the School", targetClasses);

    const totalsRow = {
      sno: "",
      name: "Total",
      ...totals,
    };

    await sendTablePdf(res, {
      filename: `district_progress_report_schools_${block_code}_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (School-wise)",
      layout: "portrait",
      metaLines: [
        `Session: ${session_name}   Scholarship: ${scholarship_name}`,
        `District: ${districtName || district.district_code}`,
        `Block: ${report.block_name || block_code}`,
      ],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("District school progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};
