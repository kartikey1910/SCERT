const pool = require("../config/db");
const { resolveFileUrl } = require("../utils/fileUrl.util");

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
  row.sr_no ||
  null;

const isDisabilityYes = (value) => {
  const normalized = toDisplayValue(value).toLowerCase();
  if (!normalized) return false;
  return normalized
    .split(",")
    .map((v) => v.trim())
    .some((v) => ["yes", "y", "1", "true", "divyang", "pwbd", "disabled"].includes(v));
};

const splitMultiValues = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitMultiValues(item))
      .filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === "null" || raw.toLowerCase() === "undefined") {
    return [];
  }

  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
        }
      } catch {
        // Fallback to plain tokenization for malformed JSON.
      }
    }

    return raw
      .slice(1, -1)
      .split(",")
      .map((part) => part.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
      .filter((part) => part && part.toLowerCase() !== "null" && part.toLowerCase() !== "undefined");
  }

  return [raw];
};

const toDisplayValue = (value) => {
  const parts = splitMultiValues(value);
  if (!parts.length) return "";
  return Array.from(new Set(parts)).join(", ");
};

const mergeDisplayValues = (...values) => {
  const merged = values.flatMap((value) => splitMultiValues(value));
  if (!merged.length) return null;
  return Array.from(new Set(merged)).join(", ");
};

const normalizeToken = (value) => String(value || "").trim().toLowerCase();

const cleanToken = (value) => {
  let token = String(value ?? "").trim();
  if (!token) return "";

  for (let i = 0; i < 3; i += 1) {
    token = token.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
    token = token.replace(/\\+/g, "").trim();
  }

  token = token.replace(/^[,;:|]+|[,;:|]+$/g, "").trim();
  return token;
};

const isMeaningfulToken = (value) => {
  const token = cleanToken(value);
  if (!token) return false;
  if (/^[^A-Za-z0-9\u0900-\u097F]+$/.test(token)) return false;
  return true;
};

const resolveAnswerValueWithOptions = (rawValue, options = []) => {
  const tokens = splitMultiValues(rawValue).map(cleanToken).filter(Boolean);
  if (!tokens.length) return null;
  if (!Array.isArray(options) || options.length === 0) {
    const filtered = tokens.filter(isMeaningfulToken);
    return filtered.length ? Array.from(new Set(filtered)).join(", ") : null;
  }

  const resolved = tokens
    .map((token) => {
      const t = normalizeToken(token);
      const match = options.find((opt) => {
        const optionId = normalizeToken(opt.option_id);
        const optionValue = normalizeToken(opt.option_value);
        const optionLabel = normalizeToken(opt.option_label);
        return t === optionId || t === optionValue || t === optionLabel;
      });
      return match ? String(match.option_value).trim() : null;
    })
    .filter(Boolean);

  if (resolved.length > 0) {
    const uniqueMapped = Array.from(new Set(resolved.filter(isMeaningfulToken)));
    return uniqueMapped.length ? uniqueMapped.join(", ") : null;
  }

  const fallback = Array.from(new Set(tokens.filter(isMeaningfulToken)));
  return fallback.length ? fallback.join(", ") : null;
};

const isDisabilityStatusLabel = (label) => {
  const l = String(label || "").toLowerCase().trim();
  if (!l) return false;
  const hasKeyword = l.includes("disability") || l.includes("divyang");
  if (!hasKeyword) return false;
  return !l.includes("type");
};

const isDisabilityTypeLabel = (label) => {
  const l = String(label || "").toLowerCase().trim();
  if (!l) return false;
  const hasKeyword = l.includes("disability") || l.includes("divyang");
  if (!hasKeyword) return false;
  return l.includes("type") || l.includes("code");
};

const resolveDivyangtaCode = (answers = {}, row = {}) => {
  const statusValue =
    answers.disability_status ||
    answers.divyangta_status ||
    answers.is_divyang ||
    answers.is_disabled ||
    answers.disability ||
    answers.__disability_status_label_value ||
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
    answers.__disability_type_label_value ||
    null;

  return isDisabilityYes(statusValue) ? toDisplayValue(codeValue) || null : "NO";
};

/**
 * GET APPROVED APPLICATIONS FOR BEO
 * GET /beo/applications/approved
 * Returns approved applications from schools in BEO's block
 */
exports.getApprovedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;

  const { scholarship_id, class_filter, page, limit, school_user_id, roll_number } = req.query;

  // 🔐 Role check - only BEO
  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({
      message: "scholarship_id is required",
    });
  }

  try {
    // Get BEO's block code
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [userId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(403).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    let conditions = [];
    let values = [];
    let idx = 1;

    conditions.push(`sa.status = 'APPROVED'`);
    
    conditions.push(`sa.scholarship_id = $${idx++}`);
    values.push(scholarship_id);

    conditions.push(`sp.block_code = $${idx++}`);
    values.push(blockCode);

    if (class_filter) {
      conditions.push(`sa.class::text = $${idx++}`);
      values.push(String(class_filter));
    }

    // Optional filters. The school must be in this BEO's block (the block
    // condition above already guarantees it), and the roll number matches any
    // part of the roll, digits only - so a wildcard typed by a user is inert.
    const schoolFilter = Number(school_user_id);
    if (school_user_id !== undefined && String(school_user_id).trim() !== "") {
      if (!Number.isInteger(schoolFilter) || schoolFilter <= 0) {
        return res.status(400).json({ message: "Invalid school filter" });
      }
      conditions.push(`sa.created_by_school_user_id = $${idx++}`);
      values.push(schoolFilter);
    }

    const rollDigits = String(roll_number ?? "").replace(/\D/g, "");
    if (rollDigits) {
      conditions.push(`sa.roll_number LIKE $${idx++}`);
      values.push(`%${rollDigits}%`);
    }

    const countTotalQuery = `
      SELECT COUNT(*)::int AS count
      FROM scert_db.scholarship_applications sa
      JOIN scert_db.school_profiles sp
        ON sp.user_id = sa.created_by_school_user_id
      WHERE ${conditions.join(" AND ")}
    `;
    const { rows: countTotalRes } = await pool.query(countTotalQuery, values);
    const totalCount = countTotalRes[0].count;

    let query = `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.roll_number,
        sa.app_serial_no,
        sa.exam_code,
        sa.center_id,
        sa.class,
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

        -- Student info
        stp.full_name AS candidate_name,
        stp.full_name AS student_name,

        -- School info
        sp.school_name,
        sp.udise_code,
        sp.block_code,
        sp.district_code,
        sp.block_name,
        sp.district_name,
        sp.school_type,
        sp.school_location AS school_category,

        -- Center info
        ec.center_order,
        ec.school_name AS center_name

      FROM scert_db.scholarship_applications sa

      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = sa.student_user_id

      JOIN scert_db.school_profiles sp
        ON sp.user_id = sa.created_by_school_user_id

      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = sa.center_id

      LEFT JOIN scert_db.center_exam_attendance_reports ar
        ON ar.session_id = sa.session_id
       AND ar.scholarship_id = sa.scholarship_id
       AND ar.center_id = sa.center_id

      LEFT JOIN scert_db.center_exam_student_attendance att
        ON att.report_id = ar.report_id
       AND att.application_id = sa.application_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY
        ec.center_order ASC,
        sa.app_serial_no ASC
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
          scholarship_id,
          block_code: blockCode,
        },
        applications: [],
      });
    }

    // Batch-fetch form answers including nominal roll fields
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
      'student_registrations',
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
              LOWER(REGEXP_REPLACE(COALESCE(ff.field_key, ''), '[[:space:]]+', '', 'g')) AS field_key,
              ff.field_label,
              COALESCE(
                aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path
              ) AS raw_value
       FROM scert_db.scholarship_application_answers aa
       JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
       WHERE aa.application_id = ANY($1::int[])
         AND (
           ff.field_key = ANY($2)
           OR LOWER(REGEXP_REPLACE(COALESCE(ff.field_key, ''), '[[:space:]]+', '', 'g')) = ANY($3)
           OR ff.field_label ILIKE '%student%registration%'
           OR ff.field_label ILIKE '%registration%number%'
           OR ff.field_label ILIKE 'sr no%'
           OR ff.field_label ILIKE '%disability%'
           OR ff.field_label ILIKE '%divyang%'
         )`,
      [appIds, desiredKeys, normalizedDesiredKeys]
    );

    const optionFieldIds = Array.from(
      new Set(
        answersRes.rows
          .map((ans) => Number(ans.field_id))
          .filter((v) => Number.isFinite(v))
      )
    );
    const optionsByFieldId = {};
    if (optionFieldIds.length) {
      const optionsRes = await pool.query(
        `SELECT field_id, option_id::text AS option_id, option_label, option_value
         FROM scert_db.scholarship_form_field_options
         WHERE is_active = true
           AND field_id = ANY($1::int[])`,
        [optionFieldIds]
      );
      optionsRes.rows.forEach((opt) => {
        if (!optionsByFieldId[opt.field_id]) {
          optionsByFieldId[opt.field_id] = [];
        }
        optionsByFieldId[opt.field_id].push(opt);
      });
    }

    // Group answers by application_id
    const answersByApp = {};
    answersRes.rows.forEach((ans) => {
      if (!answersByApp[ans.application_id]) {
        answersByApp[ans.application_id] = {};
      }
      const resolvedValue = resolveAnswerValueWithOptions(ans.raw_value, optionsByFieldId[ans.field_id] || []);
      const currentValue = answersByApp[ans.application_id][ans.field_key];
      answersByApp[ans.application_id][ans.field_key] = mergeDisplayValues(currentValue, resolvedValue);

      const label = String(ans.field_label || "").toLowerCase();
      if (isDisabilityStatusLabel(label)) {
        answersByApp[ans.application_id].__disability_status_label_value = mergeDisplayValues(
          answersByApp[ans.application_id].__disability_status_label_value,
          resolvedValue
        );
      }
      if (isDisabilityTypeLabel(label)) {
        answersByApp[ans.application_id].__disability_type_label_value = mergeDisplayValues(
          answersByApp[ans.application_id].__disability_type_label_value,
          resolvedValue
        );
      }
    });

    // Resolve previous primary school details by UDISE (from applicant response)
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
        `SELECT udise_code, school_name, school_management_code
         FROM scert_db.primary_schools_master
         WHERE udise_code = ANY($1)`,
        [preschoolUdiseCodes]
      );
      preschoolRes.rows.forEach((r) => {
        preschoolByUdise[String(r.udise_code).trim()] = r;
      });
    }

    let enrichedRows = rows.map((row) => {
      const answers = answersByApp[row.application_id] || {};
      const candidateName =
        row.candidate_name ||
        answers.student_name ||
        answers.candidate_name ||
        null;
      const previousSchoolUdise = String(answers.previous_school_udise || '').trim() || null;
      const previousSchool = previousSchoolUdise ? preschoolByUdise[previousSchoolUdise] : null;
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
        class: answers.class || null,
        caste_category: answers.caste_category || null,
        type_of_divyangta:
          resolveDivyangtaCode(answers, row),
        aadhaar_number: answers.aadhaar_number || answers.aadhaar_no || answers.aadhar_number || answers.aadhar_no || answers.aadhaar || null,
        contact_no: answers.contact_no || answers.contact_number || answers.mobile_number || answers.phone || null,
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

    res.json({
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      filters: {
        scholarship_id,
        class_filter: class_filter || null,
        block_code: blockCode,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO approved applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * SCHOOLS THAT HAVE APPROVED APPLICATIONS (BEO)
 * GET /beo/applications/approved/schools
 *
 * The options for the School filter on Approved Applications: the schools of
 * the BEO's own block that have at least one approved application for the
 * scholarship (and class, when given), with how many.
 */
exports.getApprovedApplicationSchools = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }
  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [userId]
    );
    if (beoRes.rows.length === 0) {
      return res.status(403).json({ message: "BEO profile not found" });
    }

    const values = [scholarship_id, beoRes.rows[0].block_code];
    let classClause = "";
    if (class_filter) {
      classClause = ` AND sa.class::text = $3`;
      values.push(String(class_filter));
    }

    const { rows } = await pool.query(
      `
      SELECT sp.user_id AS school_user_id,
             sp.school_name,
             sp.udise_code,
             COUNT(*)::int AS approved_count
        FROM scert_db.scholarship_applications sa
        JOIN scert_db.school_profiles sp ON sp.user_id = sa.created_by_school_user_id
       WHERE sa.status = 'APPROVED'
         AND sa.scholarship_id = $1
         AND sp.block_code = $2
         ${classClause}
       GROUP BY sp.user_id, sp.school_name, sp.udise_code
       ORDER BY sp.school_name ASC, sp.user_id ASC
      `,
      values
    );

    res.json({ schools: rows });
  } catch (err) {
    console.error("BEO approved-application schools error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET NOMINAL ROLL FOR BEO
 * GET /beo/nominal-roll
 * Returns nominal roll data for schools in BEO's block
 */
exports.getNominalRoll = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;

  const { scholarship_id, class_filter, center_id } = req.query;

  // 🔐 Role check - only BEO
  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({
      message: "scholarship_id is required",
    });
  }

  try {
    // Get BEO's block code
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [userId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(403).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    let conditions = [];
    let values = [];
    let idx = 1;

    // Base conditions
    conditions.push(`sa.scholarship_id = $${idx++}`);
    values.push(scholarship_id);

    conditions.push(`sa.status = 'APPROVED'`);

    conditions.push(`sp.block_code = $${idx++}`);
    values.push(blockCode);

    // Optional center filter
    if (center_id) {
      conditions.push(`sa.center_id = $${idx++}`);
      values.push(center_id);
    }

    const query = `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.roll_number,
        sa.app_serial_no,
        sa.center_id,
        
        -- Student info
        stp.full_name AS candidate_name,
        
        -- School info
        sp.school_name,
        sp.udise_code,
        sp.block_code,
        sp.district_code,
        sp.block_name,
        sp.district_name,
        sp.school_type,
        sp.school_location AS school_category,
        
        -- Center info
        ec.center_order,
        ec.school_name AS center_name

      FROM scert_db.scholarship_applications sa
      
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = sa.student_user_id
      
      LEFT JOIN scert_db.school_profiles sp
        ON sp.user_id = sa.created_by_school_user_id
        
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = sa.center_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY
        ec.center_order ASC,
        sa.app_serial_no ASC
    `;

    const { rows } = await pool.query(query, values);

    // Fetch form field mappings for this scholarship (include inactive fields)
    const fieldsRes = await pool.query(
      `SELECT field_id, field_key, field_label, field_type
       FROM scert_db.scholarship_form_fields
       WHERE scholarship_id = $1`,
      [scholarship_id]
    );
    
    const fieldMap = {};
    const fieldMetaById = {};
    fieldsRes.rows.forEach(f => {
      const key = String(f.field_key || '').trim().toLowerCase();
      if (!key) return;
      if (!fieldMap[key]) fieldMap[key] = f.field_id;
      fieldMetaById[String(f.field_id)] = {
        key,
        label: String(f.field_label || '').trim().toLowerCase(),
        type: String(f.field_type || '').trim().toUpperCase(),
      };
    });

    const optionFieldIds = Array.from(
      new Set(
        fieldsRes.rows
          .map((f) => Number(f.field_id))
          .filter((v) => Number.isFinite(v))
      )
    );
    const optionsByFieldId = {};
    if (optionFieldIds.length) {
      const optionsRes = await pool.query(
        `SELECT field_id, option_id::text AS option_id, option_label, option_value
         FROM scert_db.scholarship_form_field_options
         WHERE is_active = true
           AND field_id = ANY($1::int[])`,
        [optionFieldIds]
      );
      optionsRes.rows.forEach((opt) => {
        if (!optionsByFieldId[opt.field_id]) optionsByFieldId[opt.field_id] = [];
        optionsByFieldId[opt.field_id].push(opt);
      });
    }
    
    // Debug: log all available field keys if aadhaar not found
    if (!fieldMap['aadhaar_number'] && !fieldMap['aadhaar_no'] && !fieldMap['aadhar_no']) {
      console.log('Available field keys:', Object.keys(fieldMap));
    }

    const normalizeCheckboxLikeValue = (value) => {
      if (typeof value !== 'string') return value;
      const v = value.trim();
      if (/^\d+\.0+$/.test(v)) {
        return v.replace(/\.0+$/, '');
      }
      if (v.startsWith('{') && v.endsWith('}')) {
        const inner = v.slice(1, -1).trim();
        if (inner.startsWith('"') && inner.endsWith('"')) {
          return inner.slice(1, -1);
        }
        return inner;
      }
      return v;
    };

    const getAnswer = (answers, key) => {
      const id = fieldMap[String(key || '').trim().toLowerCase()];
      if (!id) return null;
      const val = answers[id] ?? null;
      const mapped = resolveAnswerValueWithOptions(val, optionsByFieldId[id] || []);
      return normalizeCheckboxLikeValue(mapped);
    };

    const getFilePathByPattern = (answers, { include = [], exclude = [] }) => {
      for (const [fieldId, rawValue] of Object.entries(answers || {})) {
        if (!rawValue) continue;
        const meta = fieldMetaById[String(fieldId)];
        if (!meta) continue;
        if (meta.type !== 'FILE') continue;
        const haystack = `${meta.key} ${meta.label}`;
        const includeHit = include.some((p) => haystack.includes(String(p).toLowerCase()));
        if (!includeHit) continue;
        const excludeHit = exclude.some((p) => haystack.includes(String(p).toLowerCase()));
        if (excludeHit) continue;
        return normalizeCheckboxLikeValue(rawValue);
      }
      return null;
    };

    // Fetch all answers for these applications
    const appIds = rows.map(r => r.application_id);
    const answersRes = await pool.query(
      `SELECT application_id, field_id, value_text, value_number, value_date, value_file_path FROM scert_db.scholarship_application_answers WHERE application_id = ANY($1)`,
      [appIds]
    );

    // Group answers by application_id
    const answersByApp = {};
    answersRes.rows.forEach(ans => {
      if (!answersByApp[ans.application_id]) {
        answersByApp[ans.application_id] = {};
      }
      answersByApp[ans.application_id][ans.field_id] = ans.value_text ?? ans.value_number ?? ans.value_date ?? ans.value_file_path ?? null;
    });

    // Enrich rows with form data
    let enrichedRows = rows.map(row => {
      const answers = answersByApp[row.application_id] || {};
      const studentName = row.candidate_name || getAnswer(answers, 'student_name') || getAnswer(answers, 'candidate_name') || null;
      
      // Get photo from multiple possible field keys
      const photoPath = getAnswer(answers, 'candidate_photograph') || 
                       getAnswer(answers, 'candidate_photo') || 
                       getAnswer(answers, 'photo') || 
                       getAnswer(answers, 'student_photo') ||
                       getFilePathByPattern(answers, {
                         include: ['photo', 'photograph', 'image'],
                         exclude: ['signature', 'sign'],
                       }) ||
                       null;
      const signaturePath = getAnswer(answers, 'candidate_signature') ||
                           getAnswer(answers, 'student_signature') ||
                           getAnswer(answers, 'signature') ||
                           getAnswer(answers, 'sign') ||
                           getFilePathByPattern(answers, {
                             include: ['signature', 'sign'],
                             exclude: ['invigilator', 'observer', 'superintendent'],
                           }) ||
                           null;
      
      return {
        ...row,
        candidate_name: studentName,
        father_name: getAnswer(answers, 'father_name'),
        mother_name: getAnswer(answers, 'mother_name'),
        date_of_birth: getAnswer(answers, 'date_of_birth'),
        sex: getAnswer(answers, 'sex') || getAnswer(answers, 'gender'),
        caste_category: getAnswer(answers, 'caste_category') || getAnswer(answers, 'caste'),
        type_of_divyangta: resolveDivyangtaCode(
          {
            disability_status:
              getAnswer(answers, 'disability_status') ||
              getAnswer(answers, 'divyangta_status') ||
              getAnswer(answers, 'disability') ||
              getAnswer(answers, 'divyangta'),
            type_of_divyangta: getAnswer(answers, 'type_of_divyangta'),
            type_of_disability: getAnswer(answers, 'type_of_disability'),
            type_of_divyangta_code: getAnswer(answers, 'type_of_divyangta_code'),
            type_of_disability_code: getAnswer(answers, 'type_of_disability_code'),
            divyangta_code: getAnswer(answers, 'divyangta_code'),
            disability_code: getAnswer(answers, 'disability_code'),
          },
          row
        ),
        aadhaar_number: getAnswer(answers, 'aadhaar_number') || getAnswer(answers, 'aadhaar_no') || getAnswer(answers, 'aadhar_no'),
        contact_no: getAnswer(answers, 'mobile_number') || getAnswer(answers, 'contact_no'),
        student_registration_no:
          getAnswer(answers, 'student_registration') ||
          getAnswer(answers, 'student_registrations') ||
          getAnswer(answers, 'student_registration_no') ||
          getAnswer(answers, 'student_registration_number') ||
          getAnswer(answers, 'student_registration_id') ||
          getAnswer(answers, 'sr_no'),
        sr_no:
          getAnswer(answers, 'student_registration') ||
          getAnswer(answers, 'student_registrations') ||
          getAnswer(answers, 'student_registration_no') ||
          getAnswer(answers, 'student_registration_number') ||
          getAnswer(answers, 'student_registration_id') ||
          getAnswer(answers, 'sr_no'),
        class: getAnswer(answers, 'class') || getAnswer(answers, 'class_level'),
        photo_url: photoPath ? resolveFileUrl(photoPath) : null,
        signature_url: signaturePath ? resolveFileUrl(signaturePath) : null,
      };
    });

    // Apply class filter if specified
    if (class_filter) {
      enrichedRows = enrichedRows.filter(row => row.class === class_filter);
    }

    res.json({
      total: enrichedRows.length,
      filters: {
        scholarship_id,
        class_filter: class_filter || null,
        center_id: center_id || null,
        block_code: blockCode,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO nominal roll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
