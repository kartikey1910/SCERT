const pool = require("../config/db");

const normalizeFieldKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const getAnswerValue = (answers = {}, keys = []) => {
  for (const key of keys) {
    const normalized = normalizeFieldKey(key);
    const value = answers[normalized];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
};

const getStudentRegistration = (answers = {}, row = {}) =>
  getAnswerValue(answers, [
    "student_registration",
    "student_registration_id",
    "student_registration_no",
    "student_registration_number",
    "student_reg_no",
    "registration_no",
    "registration_number",
    "sr_no",
    "sr_number",
    "studentregistration",
    "studentregistrationid",
    "studentregistrationno",
    "studentregistrationnumber",
    "studentregno",
    "registrationno",
    "registrationnumber",
    "srno",
    "srnumber",
  ]) ||
  row.student_registration_no ||
  row.sr_no ||
  null;

const isDisabilityYes = (value) => {
  const v = String(value ?? "").trim().toLowerCase();
  return ["yes", "y", "1", "true", "divyang", "pwbd", "disabled"].includes(v);
};

const resolveDivyangtaCode = (answers = {}, row = {}) => {
  const statusValue =
    getAnswerValue(answers, [
      "disability_status",
      "divyangta_status",
      "is_divyang",
      "is_disabled",
      "disability",
      "disabilitystatus",
      "divyangtastatus",
      "isdivyang",
      "isdisabled",
    ]) ||
    null;

  const codeValue =
    row.type_of_divyangta ||
    getAnswerValue(answers, [
      "disability_code",
      "divyangta_code",
      "type_of_disability_code",
      "type_of_divyangta_code",
      "type_of_divyangta",
      "type_of_disability",
      "divyangta",
      "disabilitycode",
      "divyangtacode",
      "typeofdisabilitycode",
      "typeofdivyangtacode",
      "typeofdivyangta",
      "typeofdisability",
    ]) ||
    null;

  if (codeValue !== null && codeValue !== undefined && String(codeValue).trim() !== "") {
    return codeValue;
  }
  return isDisabilityYes(statusValue) ? null : "NO";
};

/**
 * GET APPROVED APPLICATIONS FOR SCHOOL
 * GET /school/applications/approved
 * Returns approved applications from this school only
 */
exports.getApprovedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const { session_id } = req.session;

  const { scholarship_id, class_filter, page, limit } = req.query;

  // 🔐 Role check - only School
  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const values = [];
    let idx = 1;
    const conditions = [];

    conditions.push(`a.status = 'APPROVED'`);
    conditions.push(`a.session_id = $${idx++}`);
    values.push(session_id);

    // Scope strictly to this school (either school-created OR student belongs to this school)
    conditions.push(`(a.created_by_school_user_id = $${idx++} OR sc_student.user_id = $${idx++})`);
    values.push(schoolUserId);
    values.push(schoolUserId);

    if (scholarship_id) {
      conditions.push(`a.scholarship_id = $${idx++}`);
      values.push(scholarship_id);
    }

    if (class_filter) {
      conditions.push(`a.class::text = $${idx++}`);
      values.push(String(class_filter));
    }

    const countTotalQuery = `
      SELECT COUNT(*)::int AS count
      FROM scert_db.scholarship_applications a
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.school_profiles sc_student
        ON stp.udise_code = sc_student.udise_code
      WHERE ${conditions.join(" AND ")}
    `;
    const { rows: countTotalRes } = await pool.query(countTotalQuery, values);
    const totalCount = countTotalRes[0].count;

    let query = `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.status,
        a.current_stage,
        a.app_serial_no,
        a.roll_number,
        a.exam_code,
        a.center_id,
        a.is_locked,
        a.final_approved_at,
        a.submitted_at,

        s.scholarship_id,
        s.scholarship_name,

        COALESCE(sc_student.school_name, sc_creator.school_name) AS origin_school,
        COALESCE(sc_student.udise_code, sc_creator.udise_code) AS udise_code,
        COALESCE(sc_student.block_code, sc_creator.block_code) AS block_code,
        COALESCE(sc_student.block_name, sc_creator.block_name) AS block_name,
        COALESCE(sc_student.district_code, sc_creator.district_code) AS district_code,
        COALESCE(sc_student.district_name, sc_creator.district_name) AS district_name,
        COALESCE(sc_student.school_type, sc_creator.school_type) AS school_type,
        COALESCE(sc_student.school_location, sc_creator.school_location) AS school_category,

        stp.full_name AS student_name,

        ec.center_order,
        ec.school_name AS center_name

      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.school_profiles sc_student
        ON stp.udise_code = sc_student.udise_code
      LEFT JOIN scert_db.school_profiles sc_creator
        ON sc_creator.user_id = a.created_by_school_user_id
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = a.center_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY ec.center_order ASC NULLS LAST, a.roll_number ASC NULLS LAST, a.app_serial_no NULLS LAST
    `;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 20);
    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT $${idx++} OFFSET $${idx++}`;
    values.push(limitNum, offset);

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.json({
        total: 0,
        filters: {
          scholarship_id: scholarship_id || null,
          class_filter: class_filter || null,
        },
        applications: [],
      });
    }

    // Batch-fetch form answers including nominal roll fields
    const appIds = rows.map((r) => Number(r.application_id)).filter((v) => Number.isFinite(v));
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
    const answersRes = await pool.query(
      `SELECT aa.application_id,
              aa.field_id,
              REGEXP_REPLACE(LOWER(TRIM(ff.field_key)), '[^a-z0-9]+', '', 'g') AS field_key,
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
       WHERE aa.application_id = ANY($1::int[])
         AND (
           ff.field_key = ANY($2)
           OR REGEXP_REPLACE(LOWER(TRIM(ff.field_key)), '[^a-z0-9]+', '', 'g') = ANY($3)
           OR (
             ff.field_label ILIKE '%student%registration%'
             OR ff.field_label ILIKE '%registration%number%'
             OR ff.field_label ILIKE 'sr no%'
           )
         )`,
      [appIds, desiredKeys, normalizedDesiredKeys]
    );

    const answersByApp = {};
    answersRes.rows.forEach((ans) => {
      if (!answersByApp[ans.application_id]) {
        answersByApp[ans.application_id] = {};
      }
      const normalizedKey = normalizeFieldKey(ans.field_key);
      answersByApp[ans.application_id][normalizedKey] = ans.value ?? null;
    });

    const preschoolUdiseCodes = Array.from(
      new Set(
        Object.values(answersByApp)
          .map((answers) => String(getAnswerValue(answers, ["previous_school_udise", "previousschooludise"]) || '').trim())
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
        getAnswerValue(answers, ["student_name", "candidate_name", "studentname", "candidatename"]) ||
        null;
      const previousSchoolUdise =
        String(getAnswerValue(answers, ["previous_school_udise", "previousschooludise"]) || '').trim() || null;
      const previousSchool = previousSchoolUdise ? preschoolByUdise[previousSchoolUdise] : null;
      const parentalIncomeRaw = String(getAnswerValue(answers, ["parental_annual_income", "parentalannualincome"]) || '').trim();
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
        father_name: getAnswerValue(answers, ["father_name", "fathername"]) || null,
        mother_name: getAnswerValue(answers, ["mother_name", "mothername"]) || null,
        date_of_birth: getAnswerValue(answers, ["date_of_birth", "dateofbirth", "dob"]) || null,
        sex: getAnswerValue(answers, ["sex", "gender"]) || null,
        class: getAnswerValue(answers, ["class", "standard", "grade"]) || null,
        caste_category: getAnswerValue(answers, ["caste_category", "castecategory"]) || null,
        type_of_divyangta:
          resolveDivyangtaCode(answers, row),
        aadhaar_number: getAnswerValue(answers, ["aadhaar_number", "aadhaar_no", "aadhar_number", "aadhar_no", "aadhaar"]) || null,
        contact_no: getAnswerValue(answers, ["contact_no", "contact_number", "mobile_number", "phone"]) || null,
        previous_school_udise: previousSchoolUdise,
        previous_school_name: previousSchool?.school_name || null,
        previous_school_type: previousSchool?.school_management_code || null,
        marks_class_7:
          getAnswerValue(answers, ["marks_class_7", "percentage_marks_class_7", "percentage_of_class_vii"]) ||
          null,
        parental_income_code:
          getAnswerValue(answers, ["parental_income_code", "income_code"]) ||
          derivedParentalIncomeCode ||
          null,
        student_registration_no: getStudentRegistration(answers, row),
        sr_no: getStudentRegistration(answers, row),
      };
    });

    res.json({
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      filters: {
        scholarship_id: scholarship_id || null,
        class_filter: class_filter || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("School approved applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
