const pool = require("../config/db");

const normalizeFieldKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

const getStudentRegistration = (answers = {}, row = {}) =>
  answers.student_registrations ||
  answers.student_registration ||
  answers.student_registration_id ||
  answers.student_registration_no ||
  answers.student_registration_number ||
  answers.student_reg_no ||
  answers.registration_no ||
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

async function getDistrictFromProfile(districtUserId) {
  const res = await pool.query(
    `SELECT district_code, district_name
     FROM scert_db.district_profiles
     WHERE user_id = $1`,
    [districtUserId]
  );

  if (res.rows.length === 0) return null;
  return {
    district_code: res.rows[0].district_code,
    district_name: res.rows[0].district_name || null,
  };
}

/**
 * 📋 GET APPROVED APPLICATIONS (DISTRICT)
 * GET /api/district/applications/approved?scholarship_id=&block_code=&class_filter=
 */
exports.getApprovedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const { session_id } = req.session;

  const { scholarship_id, block_code, class_filter, roll_number } = req.query;

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

    // For dropdown filters: list all blocks in this district
    const blocksRes = await pool.query(
      `SELECT block_code, block_name
       FROM (
         SELECT DISTINCT
           sp.block_code::text AS block_code,
           sp.block_name,
           sp.block_code::int AS block_code_int
         FROM scert_db.school_profiles sp
         WHERE sp.district_code::int = $1::int
           AND sp.block_code IS NOT NULL
       ) t
       ORDER BY t.block_name NULLS LAST, t.block_code_int ASC`,
      [district.district_code]
    );

    let conditions = [];
    let values = [];
    let idx = 1;

    // mandatory conditions
    conditions.push(`a.status = 'APPROVED'`);
    conditions.push(`a.session_id = $${idx++}`);
    values.push(session_id);

    // district scope (school may come from student profile mapping OR creator school)
    conditions.push(
      `COALESCE(sp_student.district_code, sp_creator.district_code)::int = $${idx++}::int`
    );
    values.push(district.district_code);

    // scholarship
    conditions.push(`a.scholarship_id = $${idx++}`);
    values.push(scholarship_id);

    // optional block filter
    if (block_code) {
      conditions.push(
        `COALESCE(sp_student.block_code, sp_creator.block_code)::int = $${idx++}::int`
      );
      values.push(block_code);
    }

    // optional roll-number filter: matches any part of the roll, digits only,
    // so a wildcard typed by a user is inert
    const rollDigits = String(roll_number ?? "").replace(/\D/g, "");
    if (rollDigits) {
      conditions.push(`a.roll_number LIKE $${idx++}`);
      values.push(`%${rollDigits}%`);
    }

    const query = `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
        a.status,
        a.current_stage,
        a.center_id,
        a.app_serial_no,
        a.roll_number,
        a.class AS application_class,
        a.exam_code,
        a.is_locked,
        a.final_approved_at,
        a.submitted_at,

        s.scholarship_id,
        s.scholarship_name,

        COALESCE(sp_student.school_name, sp_creator.school_name) AS origin_school,
        COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
        COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code,

        COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code,
        COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
        COALESCE(sp_student.block_name, sp_creator.block_name) AS block_name,
        COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
        COALESCE(sp_student.school_type, sp_creator.school_type) AS school_type,
        COALESCE(sp_student.school_location, sp_creator.school_location) AS school_category,

        stp.full_name AS student_name,

        ec.school_name AS center_name,
        ec.center_order,
        ec.superintendent_name,
        ec.superintendent_mobile,
        csa.mat_status AS mat_status,
        csa.sat_status AS sat_status

      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.school_profiles sp_student
        ON stp.udise_code = sp_student.udise_code
      LEFT JOIN scert_db.school_profiles sp_creator
        ON a.created_by_school_user_id = sp_creator.user_id
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = a.center_id
      LEFT JOIN scert_db.center_exam_student_attendance csa
        ON csa.application_id = a.application_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY
        ec.center_order ASC NULLS LAST,
        NULLIF(regexp_replace(COALESCE(sp_student.block_code, sp_creator.block_code, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
        NULLIF(regexp_replace(COALESCE(a.roll_number::text, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
        a.app_serial_no ASC NULLS LAST,
        a.application_id ASC
    `;

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      return res.json({
        total: 0,
        filters: {
          scholarship_id: scholarship_id || null,
          block_code: block_code || null,
          class_filter: class_filter || null,
        },
        blocks: blocksRes.rows,
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
      'student_registration',
      'student_registrations',
      'student_registration_id',
      'student_registration_no',
      'student_registration_number',
      'student_reg_no',
      'registration_no',
      'registration_number',
      'sr_no',
      'sr_number',
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
      let ansConditions = [`a.status = 'APPROVED'`, `a.session_id = $1`, `aa.field_id = ANY($2)`];
      let ansValues = [session_id, validFieldIds];
      let aIdx = 3;

      ansConditions.push(`COALESCE(sp_student.district_code, sp_creator.district_code)::int = $${aIdx++}::int`);
      ansValues.push(district.district_code);
      
      ansConditions.push(`a.scholarship_id = $${aIdx++}`);
      ansValues.push(scholarship_id);

      if (block_code) {
        ansConditions.push(`COALESCE(sp_student.block_code, sp_creator.block_code)::int = $${aIdx++}::int`);
        ansValues.push(block_code);
      }

      const answersRes = await pool.query(`
        SELECT aa.application_id, aa.field_id, aa.value_text, aa.value_date, aa.value_number, aa.value_file_path
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_applications a ON a.application_id = aa.application_id
        LEFT JOIN scert_db.student_profiles stp ON stp.user_id = a.student_user_id
        LEFT JOIN scert_db.school_profiles sp_student ON stp.udise_code = sp_student.udise_code
        LEFT JOIN scert_db.school_profiles sp_creator ON a.created_by_school_user_id = sp_creator.user_id
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
      
      const label = String(f.field_label || '').toLowerCase();
      if (
        !answersByApp[ans.application_id].student_registration &&
        (label.includes('student') && label.includes('registration'))
      ) {
        answersByApp[ans.application_id].student_registration = finalVal ?? null;
      }
    });

    const previousSchoolUdises = Array.from(
      new Set(
        Object.values(answersByApp)
          .map((answers) => String(answers.previous_school_udise || '').trim())
          .filter(Boolean)
      )
    );

    const previousSchoolByUdise = {};
    if (previousSchoolUdises.length > 0) {
      const previousSchoolRes = await pool.query(
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
        [previousSchoolUdises]
      );

      previousSchoolRes.rows.forEach((school) => {
        previousSchoolByUdise[String(school.udise_code).trim()] = school;
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
      const previousSchool = previousSchoolUdise ? previousSchoolByUdise[previousSchoolUdise] : null;

      const parentalIncomeRaw = String(answers.parental_annual_income || '').trim();
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
        class: answers.class || row.application_class || (Number(row.scholarship_id) === 6 ? '8' : null),
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

    if (class_filter) {
      enrichedRows = enrichedRows.filter(
        (row) => String(row.class ?? "") === String(class_filter)
      );
    }

    if (res.headersSent) return;
    res.json({
      total: enrichedRows.length,
      filters: {
        scholarship_id: scholarship_id || null,
        block_code: block_code || null,
        class_filter: class_filter || null,
      },
      blocks: blocksRes.rows,
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("District get approved applications error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
    }
  }
};

/**
 * GET DISTRICT APPLICATION DETAILS (VIEW ONLY)
 * GET /api/district/applications/:application_id
 */
exports.getApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const districtUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const district = await getDistrictFromProfile(districtUserId);
    if (!district) {
      return res.status(404).json({ message: "District profile not found" });
    }

    const appRes = await pool.query(
      `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.status,
        sa.current_stage,
        sa.submitted_by_role,
        sa.submitted_at,
        sa.is_locked,
        sa.student_user_id,
        sa.exam_code,
        s.scholarship_id,
        s.scholarship_name,
        s.last_date,
        sp.full_name AS student_name,
        sp.gender,
        sp.age
      FROM scert_db.scholarship_applications sa
      JOIN scert_db.scholarships s
        ON s.scholarship_id = sa.scholarship_id
      LEFT JOIN scert_db.student_profiles sp
        ON sa.student_user_id = sp.user_id
      LEFT JOIN scert_db.school_profiles sp_student
        ON sp.udise_code = sp_student.udise_code
      LEFT JOIN scert_db.school_profiles sp_creator
        ON sa.created_by_school_user_id = sp_creator.user_id
      WHERE sa.application_id = $1
        AND sa.session_id = $2
        AND COALESCE(sp_student.district_code, sp_creator.district_code)::int = $3::int
      `,
      [applicationId, session_id, district.district_code]
    );

    if (appRes.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    const application = appRes.rows[0];

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
        if (!optionsByField[opt.field_id]) optionsByField[opt.field_id] = [];
        optionsByField[opt.field_id].push(opt);
      }
    }

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

    const answers = {};
    for (const ans of answersRes.rows) {
      answers[ans.field_id] =
        ans.value_text ??
        ans.value_number ??
        ans.value_date ??
        ans.value_file_path ??
        null;
    }

    if (!application.student_name) {
      const nameField = fields.find((f) => {
        const k = normalizeFieldKey(f.field_key);
        return k === "student_name" || k === "candidate_name";
      });
      if (nameField && answers[nameField.field_id]) {
        application.student_name = answers[nameField.field_id];
      }
    }

    const form = fields.map((f) => ({
      ...f,
      options: ["DROPDOWN", "RADIO", "CHECKBOX"].includes(f.field_type)
        ? optionsByField[f.field_id] || []
        : [],
      value: answers[f.field_id] ?? null,
    }));

    const remarksRes = await pool.query(
      `SELECT
         action,
         from_stage,
         to_stage,
         remark_text,
         created_at
       FROM scert_db.application_remarks
       WHERE application_id = $1
       ORDER BY created_at ASC`,
      [applicationId]
    );

    return res.json({
      application: {
        application_id: application.application_id,
        status: application.status,
        current_stage: application.current_stage,
        submitted_by_role: application.submitted_by_role,
        submitted_at: application.submitted_at,
        is_locked: application.is_locked,
        application_display_id: application.application_display_id || null,
        exam_code: application.exam_code,
      },
      scholarship: {
        scholarship_id: application.scholarship_id,
        scholarship_name: application.scholarship_name,
        last_date: application.last_date,
      },
      student: {
        student_name: application.student_name,
        gender: application.gender,
        age: application.age,
      },
      form,
      remarks: remarksRes.rows,
    });
  } catch (err) {
    console.error("Get district application error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
