const pool = require("../config/db");

const normalizeFieldKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

const getStudentRegistration = (answers = {}, row = {}) =>
  answers.student_registration ||
  answers.student_registrations ||
  answers.student_registration_id ||
  answers.student_registration_no ||
  answers.student_registration_number ||
  answers.registration_no ||
  answers.student_reg_no ||
  answers.registration_number ||
  answers.sr_no ||
  answers.sr_number ||
  row.student_registrations ||
  row.student_registration ||
  row.student_registration_no ||
  row.student_registration_number ||
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

  return isDisabilityYes(statusValue) ? codeValue || null : "NO";
};

const APPLICATION_ENRICH_FIELD_KEYS = [
  "student_name",
  "candidate_name",
  "father_name",
  "mother_name",
  "date_of_birth",
  "sex",
  "class",
  "caste_category",
  "type_of_divyangta",
  "type_of_disability",
  "divyangta",
  "disability",
  "disability_status",
  "divyangta_status",
  "is_divyang",
  "is_disabled",
  "disability_code",
  "divyangta_code",
  "type_of_disability_code",
  "type_of_divyangta_code",
  "aadhaar_number",
  "aadhaar_no",
  "aadhar_number",
  "aadhar_no",
  "aadhaar",
  "contact_no",
  "contact_number",
  "mobile_number",
  "phone",
  "previous_school_udise",
  "marks_class_7",
  "percentage_marks_class_7",
  "percentage_of_class_vii",
  "parental_income_code",
  "income_code",
  "parental_annual_income",
  "student_registration_no",
  "student_registration_number",
  "student_registrations",
  "registration_no",
  "registration_number",
  "student_reg_no",
  "student_registration",
  "student_registration_id",
  "sr_no",
  "sr_number",
];

async function enrichApplicationsWithAnswerData(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const appIds = rows.map((r) => r.application_id).filter(Boolean);
  const answersRes = await pool.query(
    `SELECT aa.application_id,
            CASE
              WHEN LOWER(TRIM(ff.field_label)) LIKE '%student registration%'
                THEN 'student_registration'
              ELSE LOWER(REPLACE(TRIM(ff.field_key), ' ', ''))
            END AS field_key,
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
     WHERE aa.application_id = ANY($1::bigint[])
       AND (
         ff.field_key = ANY($2)
         OR LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) = ANY($3)
         OR LOWER(TRIM(ff.field_label)) LIKE '%student registration%'
       )`,
    [appIds, APPLICATION_ENRICH_FIELD_KEYS, APPLICATION_ENRICH_FIELD_KEYS.map(normalizeFieldKey)]
  );

  const answersByApp = {};
  answersRes.rows.forEach((ans) => {
    if (!answersByApp[ans.application_id]) answersByApp[ans.application_id] = {};
    answersByApp[ans.application_id][ans.field_key] = ans.value ?? null;
  });

  const udiseCodes = Array.from(
    new Set(
      Object.values(answersByApp)
        .map((a) => String(a.previous_school_udise || "").trim())
        .filter(Boolean)
    )
  );

  const previousSchoolByUdise = {};
  if (udiseCodes.length) {
    const prevSchoolRes = await pool.query(
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
      [udiseCodes]
    );

    prevSchoolRes.rows.forEach((r) => {
      previousSchoolByUdise[String(r.udise_code).trim()] = r;
    });
  }

  return rows.map((row) => {
    const answers = answersByApp[row.application_id] || {};
    const previousSchoolUdise = String(answers.previous_school_udise || "").trim() || null;
    const previousSchool = previousSchoolUdise
      ? previousSchoolByUdise[previousSchoolUdise]
      : null;

    const parentalIncomeRaw = String(answers.parental_annual_income || "").trim();
    let derivedParentalIncomeCode = null;
    if (parentalIncomeRaw) {
      const normalizedIncome = parentalIncomeRaw.toLowerCase();
      const compactIncome = normalizedIncome.replace(/\s+/g, "");
      if (
        compactIncome === "1" ||
        normalizedIncome.includes("up to") ||
        normalizedIncome.includes("upto") ||
        normalizedIncome.includes("<=")
      ) {
        derivedParentalIncomeCode = "1";
      } else if (
        compactIncome === "2" ||
        normalizedIncome.includes("more than") ||
        normalizedIncome.includes(">=") ||
        normalizedIncome.includes(">")
      ) {
        derivedParentalIncomeCode = "2";
      } else {
        const numericChunks = normalizedIncome.replace(/,/g, "").match(/\d+/g);
        const preferredChunk =
          numericChunks?.find((chunk) => chunk.length > 2) ||
          numericChunks?.[0] ||
          null;
        const numericIncome = preferredChunk ? Number(preferredChunk) : NaN;
        if (Number.isFinite(numericIncome)) {
          derivedParentalIncomeCode = numericIncome <= 350000 ? "1" : "2";
        }
      }
    }

    return {
      ...row,
      candidate_name: row.student_name || answers.student_name || answers.candidate_name || null,
      student_name: row.student_name || answers.student_name || answers.candidate_name || null,
      father_name: answers.father_name || null,
      mother_name: answers.mother_name || null,
      date_of_birth: answers.date_of_birth || null,
      sex: answers.sex || null,
      class: row.class || answers.class || null,
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
      student_registration: getStudentRegistration(answers, row),
      student_registration_no: getStudentRegistration(answers, row),
      sr_no: getStudentRegistration(answers, row),
    };
  });
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

/**
 * GET /api/district/applications/submitted-summary?scholarship_id=
 * Block-wise count of applications submitted by BEO to SCERT
 */
exports.getSubmittedSummaryByBlock = async (req, res) => {
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

    const summaryRes = await pool.query(
      `SELECT
         COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code, bp_map.block_code)::text AS block_code,
         COALESCE(sp_student.block_name, sp_creator.block_name, bp_map.block_name) AS block_name,
         COUNT(*)::int AS submitted_count
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles st
         ON st.user_id = a.student_user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON st.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       LEFT JOIN LATERAL (
         SELECT bp.block_code, bp.block_name, bp.district_code, bp.district_name
         FROM scert_db.beo_profiles bp
         WHERE bp.block_code::text =
               COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code)::text
         ORDER BY bp.updated_at DESC NULLS LAST, bp.user_id DESC
         LIMIT 1
       ) bp_map ON true
       WHERE a.current_stage = 'SCERT'
         AND a.status = 'SUBMITTED'
         AND a.session_id = $1
         AND a.scholarship_id = $2
         AND COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code, bp_map.block_code) IS NOT NULL
         AND TRIM(COALESCE(sp_student.district_code, sp_creator.district_code, bp_map.district_code)::text)
             = TRIM($3::text)
       GROUP BY 1, 2
       ORDER BY block_name NULLS LAST, block_code`,
      [session_id, scholarship_id, district.district_code]
    );

    res.json({
      district_code: district.district_code,
      district_name: district.district_name,
      scholarship_id: Number(scholarship_id),
      total_blocks: summaryRes.rows.length,
      blocks: summaryRes.rows.map((r) => ({
        block_code: r.block_code || null,
        block_name: r.block_name || null,
        submitted_count: Number(r.submitted_count || 0),
      })),
    });
  } catch (err) {
    console.error("District submitted-summary error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/district/applications/submitted?scholarship_id=&block_code=
 * Detailed list of applications submitted by BEO to SCERT in selected block
 */
exports.getSubmittedApplicationsByBlock = async (req, res) => {
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
    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const appsRes = await pool.query(
      `SELECT
         a.application_id,
         a.application_display_id AS application_display_id,
         a.submitted_by_role,
         a.roll_number,
         a.exam_code,
         a.submitted_at,
         COALESCE(
           a.class::text,
           cls.class_value,
           CASE
             WHEN LOWER(COALESCE(sch.scholarship_name, '')) ~ '(nmmss|nmms|snss|ssss|class\\s*8)'
               THEN '8'
           END
         ) AS class,
         COALESCE(st.full_name, ans_student_name.student_name) AS student_name,
         ans_student_registration.student_registration_no AS student_registration_no,
         ans_student_registration.student_registration_no AS student_registration,
         COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
         COALESCE(sp_student.school_type, sp_creator.school_type) AS school_type,
         COALESCE(sp_student.school_location, sp_creator.school_location) AS school_category,
         COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code, bp_map.block_code)::text AS block_code,
         COALESCE(sp_student.block_name, sp_creator.block_name, bp_map.block_name) AS block_name,
         COALESCE(sp_student.district_code, sp_creator.district_code, bp_map.district_code)::text AS district_code,
         COALESCE(sp_student.district_name, sp_creator.district_name, bp_map.district_name) AS district_name,
         ec.center_order,
         ec.school_name AS center_name
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.scholarships sch
         ON sch.scholarship_id = a.scholarship_id
       LEFT JOIN scert_db.student_profiles st
         ON st.user_id = a.student_user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON st.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       LEFT JOIN LATERAL (
         SELECT bp.block_code, bp.block_name, bp.district_code, bp.district_name
         FROM scert_db.beo_profiles bp
         WHERE bp.block_code::text =
               COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code)::text
         ORDER BY bp.updated_at DESC NULLS LAST, bp.user_id DESC
         LIMIT 1
       ) bp_map ON true
       LEFT JOIN scert_db.exam_centers ec
         ON ec.center_id = a.center_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(
             NULLIF(aa.value_text, ''),
             aa.value_number::text,
             aa.value_date::text
           ) AS class_value
         FROM scert_db.scholarship_application_answers aa
         JOIN scert_db.scholarship_form_fields ff
           ON ff.field_id = aa.field_id
         WHERE aa.application_id = a.application_id
           AND ff.scholarship_id = a.scholarship_id
           AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
         ORDER BY ff.sort_order ASC
         LIMIT 1
       ) cls ON true
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(
             NULLIF(aa.value_text, ''),
             aa.value_number::text,
             aa.value_date::text
           ) AS student_name
         FROM scert_db.scholarship_application_answers aa
         JOIN scert_db.scholarship_form_fields ff
           ON ff.field_id = aa.field_id
         WHERE aa.application_id = a.application_id
           AND ff.scholarship_id = a.scholarship_id
           AND ff.field_key IN ('student_name', 'candidate_name')
         ORDER BY ff.sort_order ASC
         LIMIT 1
       ) ans_student_name ON true
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(
             NULLIF(aa.value_text, ''),
             aa.value_number::text,
             aa.value_date::text
           ) AS student_registration_no
         FROM scert_db.scholarship_application_answers aa
         JOIN scert_db.scholarship_form_fields ff
           ON ff.field_id = aa.field_id
         WHERE aa.application_id = a.application_id
           AND ff.scholarship_id = a.scholarship_id
           AND (
             LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) IN (
               'student_registration',
               'student_registrations',
               'student_registration_no',
               'student_registration_number',
               'student_registration_id',
               'student_reg_no',
               'registration_no',
               'registration_number',
               'sr_no',
               'sr_number'
             )
             OR LOWER(TRIM(ff.field_label)) LIKE '%student registration%'
           )
         ORDER BY ff.sort_order ASC
         LIMIT 1
       ) ans_student_registration ON true
       WHERE a.current_stage = 'SCERT'
         AND a.status = 'SUBMITTED'
         AND a.session_id = $1
         AND a.scholarship_id = $2
         AND TRIM(COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code, bp_map.block_code)::text)
             = TRIM($3::text)
         AND TRIM(COALESCE(sp_student.district_code, sp_creator.district_code, bp_map.district_code)::text)
             = TRIM($4::text)
       ORDER BY
         ec.center_order ASC NULLS LAST,
         NULLIF(regexp_replace(COALESCE(a.roll_number::text, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
         a.app_serial_no ASC NULLS LAST,
         a.application_id ASC`,
      [session_id, scholarship_id, block_code, district.district_code]
    );

    const enrichedRows = await enrichApplicationsWithAnswerData(appsRes.rows);

    res.json({
      district_code: district.district_code,
      district_name: district.district_name,
      scholarship_id: Number(scholarship_id),
      block_code: String(block_code),
      total: enrichedRows.length,
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("District submitted-by-block error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
