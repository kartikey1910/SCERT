const pool = require("../config/db");
const districtBlockMaster = require("../master-data/district-block.master.json");
const { sendTablePdf } = require("../utils/pdfTable.util");
const { createClient } = require("redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const reportCacheClient = createClient({ url: redisUrl });

reportCacheClient.on("error", (err) =>
  console.error("scert progress report redis error:", err)
);

reportCacheClient.connect().catch((err) =>
  console.error("scert progress report redis connect error:", err)
);

/**
 * Drops the cached district / block progress tables of one scholarship so the
 * next SCERT view recomputes them. Called on every status change (submit,
 * return, approve, reject - not just rejection) so the numbers show up
 * straight away instead of after the 5 minute cache. Also drops the SCERT
 * centers-summary counts cache (scert.centersSummary.controller.js), which
 * caches the same APPROVED-application counts under its own keys - a status
 * change that invalidates one has to invalidate the other too, or that
 * screen would still show stale counts for up to 5 minutes. Never throws: a
 * cache problem must not fail the action that triggered it.
 */
async function invalidateProgressReportCache({ session_id, scholarship_id }) {
  try {
    if (!reportCacheClient.isReady) return;
    const keys = [`scert_progress_districts:${session_id}:${scholarship_id}`];
    for await (const key of reportCacheClient.scanIterator({
      MATCH: `scert_progress_blocks:${session_id}:${scholarship_id}:*`,
      COUNT: 200,
    })) {
      keys.push(...(Array.isArray(key) ? key : [key]));
    }
    await reportCacheClient.del(keys);
  } catch (err) {
    console.error("progress report cache invalidation error:", err.message);
  }

  await require("./scert.centersSummary.controller").invalidateCentersSummaryCache({
    session_id,
    scholarship_id,
  });
}
exports.invalidateProgressReportCache = invalidateProgressReportCache;

/**
 * Same, for the application(s) whose status just changed: looks up which
 * session / scholarship they belong to. Call after the change is committed.
 */
exports.invalidateProgressReportCacheForApplications = async (applicationIds) => {
  try {
    const ids = (Array.isArray(applicationIds) ? applicationIds : [applicationIds])
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return;
    const { rows } = await pool.query(
      `SELECT DISTINCT session_id, scholarship_id
         FROM scert_db.scholarship_applications
        WHERE application_id = ANY($1::bigint[])`,
      [ids]
    );
    await Promise.all(rows.map((r) => invalidateProgressReportCache(r)));
  } catch (err) {
    console.error("progress report cache invalidation error:", err.message);
  }
};

function getAllDistrictsFromMaster() {
  const districts = Object.values(districtBlockMaster || {})
    .map((d) => ({
      district_code: String(d.district_code),
      district_name: d.district_name,
    }))
    .filter((d) => d.district_code && d.district_name);

  // Sort by code (keeps official ordering like 01..13)
  districts.sort((a, b) => String(a.district_code).localeCompare(String(b.district_code)));
  return districts;
}

function getBlocksForDistrictFromMaster(district_code) {
  const dc = String(district_code);
  const entry = Object.values(districtBlockMaster || {}).find(
    (d) => String(d.district_code) === dc
  );

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

function getDistrictNameFromMaster(district_code) {
  const dc = String(district_code);
  const entry = Object.values(districtBlockMaster || {}).find(
    (d) => String(d.district_code) === dc
  );
  return entry?.district_name || null;
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

async function computeDistrictWiseRegistrationProgress({ session_id, scholarship_id }) {
  const classFieldId = await getClassFieldId(scholarship_id);
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);
  
  // If no class field exists, we'll show total registrations without class breakdown
  const hasClassField = Boolean(classFieldId);

  // Strength (district x class)
  const strengthRes = await pool.query(
    `SELECT
       sp.district_code,
       sp.district_name,
       sss.class_level,
       SUM(sss.boys_count + sss.girls_count)::int AS total_strength
     FROM scert_db.school_student_strength sss
     JOIN scert_db.school_profiles sp
       ON sp.user_id = sss.school_user_id
     WHERE sss.class_level = ANY($1::int[])
     GROUP BY sp.district_code, sp.district_name, sss.class_level`,
    [targetClasses]
  );

  const strengthByDistrict = new Map();
  for (const r of strengthRes.rows) {
    const key = String(r.district_code);
    if (!strengthByDistrict.has(key)) {
      strengthByDistrict.set(key, { district_name: r.district_name, byClass: {} });
    }
    const entry = strengthByDistrict.get(key);
    entry.district_name = entry.district_name || r.district_name;
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.total_strength || 0);
  }

  // Registrations (district x class)
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
        AND aa.field_id = $3
       WHERE a.session_id = $1
         AND a.scholarship_id = $2
         AND a.status NOT IN ('DRAFT', 'REJECTED')
         AND (aa.value_number IS NOT NULL OR aa.value_text IS NOT NULL)
         AND (
           CASE
           WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
           ELSE aa.value_text::int
         END
       ) = ANY($4::int[])
     GROUP BY 1, 2, 3`,
    [session_id, scholarship_id, classFieldId, targetClasses]
  );
  } else {
    // No class field (e.g., class-fixed exams): attribute all registrations to the primary target class
    // so the UI can still show non-zero registration counts.
    const targetClass = Array.isArray(targetClasses) && targetClasses.length ? Number(targetClasses[0]) : 0;

    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
         COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
         $3::int AS class_level,
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
       GROUP BY 1, 2`,
      [session_id, scholarship_id, targetClass]
    );
  }

  const regsByDistrict = new Map();
  for (const r of regRes.rows) {
    const key = String(r.district_code);
    if (!regsByDistrict.has(key)) {
      regsByDistrict.set(key, { district_name: r.district_name, byClass: {}, appeared: 0 });
    }
    const entry = regsByDistrict.get(key);
    entry.district_name = entry.district_name || r.district_name;
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.registrations || 0);
    entry.appeared = (entry.appeared || 0) + Number(r.appeared || 0);
  }

  const baseDistricts = getAllDistrictsFromMaster();

  // Include any district codes that appear in DB aggregates but are missing in master
  const extraDistrictCodes = new Set([
    ...Array.from(strengthByDistrict.keys()),
    ...Array.from(regsByDistrict.keys()),
  ]);

  const extraDistricts = Array.from(extraDistrictCodes)
    .filter((code) => code && !baseDistricts.some((d) => d.district_code === String(code)))
    .map((district_code) => {
      const s = strengthByDistrict.get(String(district_code)) || { district_name: null, byClass: {} };
      const r = regsByDistrict.get(String(district_code)) || { district_name: null, byClass: {} };
      return {
        district_code: String(district_code),
        district_name: s.district_name || r.district_name || String(district_code),
      };
    });

  const allDistricts = [...baseDistricts, ...extraDistricts];

  const rows = allDistricts.map((d) => {
    const code = String(d.district_code);
    const s = strengthByDistrict.get(code) || { byClass: {} };
    const r = regsByDistrict.get(code) || { byClass: {} };

    const class6_strength = Number(s.byClass?.["6"] || 0);
    const class8_strength = Number(s.byClass?.["8"] || 0);
    const class9_strength = Number(s.byClass?.["9"] || 0);
    const class6_registered = Number(r.byClass?.["6"] || 0);
    const class8_registered = Number(r.byClass?.["8"] || 0);
    const class9_registered = Number(r.byClass?.["9"] || 0);

    return {
      district_code: code,
      district_name: d.district_name,
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

async function computeBlockWiseRegistrationProgress({ session_id, scholarship_id, district_code }) {
  const classFieldId = await getClassFieldId(scholarship_id);
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);
  
  // If no class field exists, we'll show total registrations without class breakdown
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
     WHERE sp.district_code::text = $1::text
       AND sss.class_level = ANY($2::int[])
     GROUP BY sp.block_code, sp.block_name, sss.class_level`,
    [district_code, targetClasses]
  );

  const strengthByBlock = new Map();
  for (const r of strengthRes.rows) {
    const key = String(r.block_code);
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::text = $3::text
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
    // No class field (e.g., class-fixed exams): attribute all registrations to the primary target class
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
         AND COALESCE(sp_student.district_code, sp_creator.district_code)::text = $3::text
       GROUP BY 1, 2`,
      [session_id, scholarship_id, district_code, targetClass]
    );
  }

  const regsByBlock = new Map();
  for (const r of regRes.rows) {
    const key = String(r.block_code);
    if (!regsByBlock.has(key)) {
      regsByBlock.set(key, { block_name: r.block_name, byClass: {}, appeared: 0 });
    }
    const entry = regsByBlock.get(key);
    entry.block_name = entry.block_name || r.block_name;
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.registrations || 0);
    entry.appeared = (entry.appeared || 0) + Number(r.appeared || 0);
  }

  const baseBlocks = getBlocksForDistrictFromMaster(district_code);

  // Include any block codes that appear in DB aggregates but are missing in master
  const extraBlockCodes = new Set([
    ...Array.from(strengthByBlock.keys()),
    ...Array.from(regsByBlock.keys()),
  ]);

  const extraBlocks = Array.from(extraBlockCodes)
    .filter((code) => code && !baseBlocks.some((b) => b.block_code === String(code)))
    .map((block_code) => {
      const s = strengthByBlock.get(String(block_code)) || { block_name: null, byClass: {} };
      const r = regsByBlock.get(String(block_code)) || { block_name: null, byClass: {} };
      return {
        block_code: String(block_code),
        block_name: s.block_name || r.block_name || String(block_code),
      };
    });

  const allBlocks = [...baseBlocks, ...extraBlocks];

  const rows = allBlocks.map((b) => {
    const code = String(b.block_code);
    const s = strengthByBlock.get(code) || { byClass: {} };
    const r = regsByBlock.get(code) || { byClass: {} };

    const class6_strength = Number(s.byClass?.["6"] || 0);
    const class8_strength = Number(s.byClass?.["8"] || 0);
    const class9_strength = Number(s.byClass?.["9"] || 0);
    const class6_registered = Number(r.byClass?.["6"] || 0);
    const class8_registered = Number(r.byClass?.["8"] || 0);
    const class9_registered = Number(r.byClass?.["9"] || 0);

    return {
      block_code: code,
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

function getBlockNameFromMaster(district_code, block_code) {
  const dc = String(district_code);
  const bc = String(block_code);
  const districtEntry = Object.values(districtBlockMaster || {}).find(
    (d) => String(d.district_code) === dc
  );
  if (!districtEntry || !districtEntry.blocks) return null;
  
  const blockEntry = Object.values(districtEntry.blocks).find(
    (b) => String(b.block_code) === bc
  );
  return blockEntry?.block_name || null;
}

async function computeSchoolWiseRegistrationProgress({ session_id, scholarship_id, block_code, district_code = null }) {
  const classFieldId = await getClassFieldId(scholarship_id);
  const targetClasses = await getTargetClassesForScholarship(scholarship_id);
  
  // If no class field exists, we'll show total registrations without class breakdown
  const hasClassField = Boolean(classFieldId);

  const hasDistrictFilter = Boolean(
    district_code !== null &&
    district_code !== undefined &&
    String(district_code).trim() !== ""
  );

  const districtConditionProfiles = hasDistrictFilter ? "AND sp.district_code::text = $2::text" : "";
  const districtConditionSchoolProfiles = hasDistrictFilter
    ? "AND COALESCE(sp_student.district_code, sp_creator.district_code)::text = $4::text"
    : "";

  // Schools in this block (optionally scoped by district)
  const schoolsRes = await pool.query(
    `SELECT user_id AS school_user_id, school_name, udise_code, block_name
     FROM scert_db.school_profiles sp
     WHERE sp.block_code::text = $1::text
       ${districtConditionProfiles}
     ORDER BY school_name ASC`,
    hasDistrictFilter ? [block_code, district_code] : [block_code]
  );

  // Strength (school x class)
  const strengthRes = await pool.query(
    `SELECT
       sp.user_id AS school_user_id,
       sss.class_level,
       SUM(sss.boys_count + sss.girls_count)::int AS total_strength
     FROM scert_db.school_student_strength sss
     JOIN scert_db.school_profiles sp
       ON sp.user_id = sss.school_user_id
     WHERE sp.block_code::text = $1::text
       ${districtConditionProfiles}
       AND sss.class_level = ANY($${hasDistrictFilter ? 3 : 2}::int[])
     GROUP BY sp.user_id, sss.class_level`,
    hasDistrictFilter ? [block_code, district_code, targetClasses] : [block_code, targetClasses]
  );

  const strengthBySchool = new Map();
  for (const r of strengthRes.rows) {
    const key = String(r.school_user_id);
    if (!strengthBySchool.has(key)) {
      strengthBySchool.set(key, { byClass: {} });
    }
    const entry = strengthBySchool.get(key);
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.total_strength || 0);
  }

  // Registrations (school x class)
  let regRes;
  if (hasClassField) {
    if (hasDistrictFilter) {
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
           AND COALESCE(sp_student.block_code, sp_creator.block_code)::text = $3::text
           AND COALESCE(sp_student.district_code, sp_creator.district_code)::text = $4::text
           AND (aa.value_number IS NOT NULL OR aa.value_text IS NOT NULL)
           AND (
             CASE
               WHEN aa.value_number IS NOT NULL THEN aa.value_number::int
               ELSE aa.value_text::int
             END
           ) = ANY($6::int[])
         GROUP BY 1, 2`,
        [session_id, scholarship_id, block_code, district_code, classFieldId, targetClasses]
      );
    } else {
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
         GROUP BY 1, 2`,
        [session_id, scholarship_id, block_code, classFieldId, targetClasses]
      );
    }
  } else {
    // No class field (e.g., class-fixed exams): attribute all registrations to the primary target class
    const targetClass = Array.isArray(targetClasses) && targetClasses.length ? Number(targetClasses[0]) : 0;

    regRes = await pool.query(
      `SELECT
         COALESCE(sp_student.user_id, sp_creator.user_id) AS school_user_id,
         $${hasDistrictFilter ? 5 : 4}::int AS class_level,
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
         ${districtConditionSchoolProfiles}
       GROUP BY 1, 2`,
      hasDistrictFilter
        ? [session_id, scholarship_id, block_code, district_code, targetClass]
        : [session_id, scholarship_id, block_code, targetClass]
    );
  }

  const regsBySchool = new Map();
  for (const r of regRes.rows) {
    const key = String(r.school_user_id);
    if (!regsBySchool.has(key)) {
      regsBySchool.set(key, { byClass: {}, appeared: 0 });
    }
    const entry = regsBySchool.get(key);
    entry.byClass[String(r.class_level)] = (entry.byClass[String(r.class_level)] || 0) + Number(r.registrations || 0);
    entry.appeared = (entry.appeared || 0) + Number(r.appeared || 0);
  }

  // Build rows from school master list so all schools in block are shown (including zero counts)
  const rows = schoolsRes.rows
    .map((school) => {
      const schoolKey = String(school.school_user_id);
      const s = strengthBySchool.get(schoolKey) || { byClass: {} };
      const r = regsBySchool.get(schoolKey) || { byClass: {} };

      const class6_strength = Number(s.byClass?.["6"] || 0);
      const class8_strength = Number(s.byClass?.["8"] || 0);
      const class9_strength = Number(s.byClass?.["9"] || 0);
      const class6_registered = Number(r.byClass?.["6"] || 0);
      const class8_registered = Number(r.byClass?.["8"] || 0);
      const class9_registered = Number(r.byClass?.["9"] || 0);

      return {
        school_user_id: school.school_user_id,
        school_udise_code: school.udise_code,
        school_name: school.school_name || school.udise_code || "—",
        class6_strength,
        class6_registered,
        class8_strength,
        class8_registered,
        class9_strength,
        class9_registered,
        total_registration: class6_registered + class8_registered + class9_registered,
        appeared: Number(r.appeared || 0),
      };
    })
    .sort((a, b) => String(a.school_name || "").localeCompare(String(b.school_name || "")));

  return { rows, targetClasses };
}

/**
 * SCERT PROGRESS REPORT (DISTRICT-WISE)
 * GET /api/scert/progress-reports/registration/districts?scholarship_id=
 */
exports.getDistrictWiseRegistrationProgress = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  const cacheKey = `scert_progress_districts:${session_id}:${scholarship_id}`;

  try {
    if (reportCacheClient.isReady) {
      const cached = await reportCacheClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }
  } catch (err) {
    console.error("Redis get error for progress report:", err.message);
  }

  try {
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const report = await computeDistrictWiseRegistrationProgress({
      session_id,
      scholarship_id,
    });

    const responseData = {
      session_id,
      scholarship_id: Number(scholarship_id),
      total_districts: report.rows.length,
      targetClasses: report.targetClasses,
      rows: report.rows,
    };

    try {
      if (reportCacheClient.isReady) {
        await reportCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins cache
      }
    } catch (err) {
      console.error("Redis set error for progress report:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("SCERT district progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * SCERT PROGRESS REPORT (BLOCK-WISE within a district)
 * GET /api/scert/progress-reports/registration/blocks?scholarship_id=&district_code=
 */
exports.getBlockWiseRegistrationProgress = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id || !district_code) {
    return res.status(400).json({ message: "scholarship_id and district_code are required" });
  }

  const cacheKey = `scert_progress_blocks:${session_id}:${scholarship_id}:${district_code}`;

  try {
    if (reportCacheClient.isReady) {
      const cached = await reportCacheClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }
  } catch (err) {
    console.error("Redis get error for block progress report:", err.message);
  }

  try {
    const report = await computeBlockWiseRegistrationProgress({
      session_id,
      scholarship_id,
      district_code,
    });

    const responseData = {
      session_id,
      scholarship_id: Number(scholarship_id),
      district_code,
      total_blocks: report.rows.length,
      targetClasses: report.targetClasses,
      rows: report.rows,
    };

    try {
      if (reportCacheClient.isReady) {
        await reportCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins
      }
    } catch (err) {
      console.error("Redis set error for block progress report:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("SCERT block progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * SCERT PROGRESS REPORT (DISTRICT-WISE) PDF
 * GET /api/scert/progress-reports/registration/districts.pdf?scholarship_id=
 */
exports.downloadDistrictWiseRegistrationProgressPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 5) {
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

    const report = await computeDistrictWiseRegistrationProgress({
      session_id,
      scholarship_id,
    });

    const pdfRows = report.rows.map((r, idx) => ({
      sno: idx + 1,
      name: r.district_name || r.district_code || "—",
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

    const columns = [
      { key: "sno", label: "S.No", width: 40, align: "right" },
      { key: "name", label: "Name of the District", width: 250, align: "left" },
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
      filename: `scert_progress_report_districts_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (District-wise)",
      layout: "portrait",
      metaLines: [`Session: ${session_name}   Scholarship: ${scholarship_name}`],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("SCERT district progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * SCERT PROGRESS REPORT (BLOCK-WISE) PDF
 * GET /api/scert/progress-reports/registration/blocks.pdf?scholarship_id=&district_code=
 */
exports.downloadBlockWiseRegistrationProgressPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id || !district_code) {
    return res.status(400).json({ message: "scholarship_id and district_code are required" });
  }

  try {
    const { session_name, scholarship_name } = await getReportMetaNames({
      session_id,
      scholarship_id,
    });

    const report = await computeBlockWiseRegistrationProgress({
      session_id,
      scholarship_id,
      district_code,
    });

    const districtName = getDistrictNameFromMaster(district_code);

    const pdfRows = report.rows.map((r, idx) => ({
      sno: idx + 1,
      name: r.block_name || r.block_code || "—",
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

    const columns = [
      { key: "sno", label: "S.No", width: 40, align: "right" },
      { key: "name", label: "Name of the Block", width: 250, align: "left" },
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
      filename: `scert_progress_report_blocks_${district_code}_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (Block-wise)",
      layout: "portrait",
      metaLines: [
        `Session: ${session_name}   Scholarship: ${scholarship_name}`,
        `District: ${districtName || district_code}`,
      ],
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("SCERT block progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * SCERT PROGRESS REPORT (SCHOOL-WISE within a block)
 * GET /api/scert/progress-reports/registration/schools?scholarship_id=&block_code=
 */
exports.getSchoolWiseRegistrationProgress = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, block_code, district_code } = req.query;

  if (roleId !== 5) {
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

    const report = await computeSchoolWiseRegistrationProgress({
      session_id,
      scholarship_id,
      block_code,
      district_code: district_code || null,
    });

    res.json({
      session_id,
      scholarship_id: Number(scholarship_id),
      block_code,
      district_code: district_code || null,
      total_schools: report.rows.length,
      targetClasses: report.targetClasses,
      rows: report.rows,
    });
  } catch (err) {
    console.error("SCERT school progress report error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};

/**
 * SCERT PROGRESS REPORT (SCHOOL-WISE) PDF
 * GET /api/scert/progress-reports/registration/schools.pdf?scholarship_id=&block_code=
 */
exports.downloadSchoolWiseRegistrationProgressPdf = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, block_code, district_code } = req.query;

  if (roleId !== 5) {
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

    const report = await computeSchoolWiseRegistrationProgress({
      session_id,
      scholarship_id,
      block_code,
      district_code: district_code || null,
    });

    const blockName = district_code
      ? getBlockNameFromMaster(district_code, block_code)
      : null;

    const pdfRows = report.rows.map((r, idx) => ({
      sno: idx + 1,
      name: r.school_name || r.school_udise_code || "—",
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

    const metaLines = [`Session: ${session_name}   Scholarship: ${scholarship_name}`];
    if (blockName) {
      metaLines.push(`Block: ${blockName} (${block_code})`);
    } else {
      metaLines.push(`Block Code: ${block_code}`);
    }

    await sendTablePdf(res, {
      filename: `scert_progress_report_schools_${block_code}_${session_id}_${scholarship_id}.pdf`,
      title: "Progress Report (School-wise)",
      layout: "portrait",
      metaLines,
      columns,
      rows: pdfRows,
      totalsRow,
    });
  } catch (err) {
    console.error("SCERT school progress report PDF error:", err);
    const status = err.status || 500;
    res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  }
};
