const srNumber = require("../services/srNumber.service");
const { assertValidNumberAnswer } = require("../utils/numberAnswer.util");
const pool = require("../config/db");
const {
  maxCentersForScholarshipName,
  REGISTRATION_COUNT_COLUMNS,
  registrationCountsLateral,
} = require("../services/centerCounts.service");

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

const calculateExamCodeIfApplicable = ({
  scholarship_id,
  caste_category,
  parental_annual_income,
  percentage,
}) => {
  if (Number(scholarship_id) !== 6) return null;

  const pctRaw = String(percentage ?? "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) return null;

  const casteRaw = String(caste_category ?? "").toUpperCase().trim();
  let isScSt = false;
  let isGeneralGroup = false;

  if (
    casteRaw === "SC" ||
    casteRaw === "ST" ||
    casteRaw.includes("SCHEDULED CASTE") ||
    casteRaw.includes("SCHEDULED TRIBE")
  ) {
    isScSt = true;
  } else if (
    casteRaw === "GENERAL" ||
    casteRaw === "GEN" ||
    casteRaw === "OBC" ||
    casteRaw === "EWS"
  ) {
    isGeneralGroup = true;
  } else {
    return null;
  }

  const parseIncomeUnderLimit = (rawIncome) => {
    const incomeRaw = String(rawIncome ?? "").trim();
    if (!incomeRaw) return null;
    const incomeNorm = incomeRaw.toLowerCase();
    const incomeCompact = incomeNorm.replace(/\s+/g, "");

    if (
      incomeCompact === "1" ||
      incomeNorm.includes("up to") ||
      incomeNorm.includes("upto") ||
      incomeNorm.includes("<=")
    ) {
      return true;
    }
    if (
      incomeCompact === "2" ||
      incomeNorm.includes("more than") ||
      incomeNorm.includes(">=") ||
      incomeNorm.includes(">")
    ) {
      return false;
    }

    const numericChunks = incomeNorm.replace(/,/g, "").match(/\d+/g);
    const preferredChunk =
      numericChunks?.find((chunk) => chunk.length > 2) ||
      numericChunks?.[0] ||
      null;
    const numericIncome = preferredChunk ? Number(preferredChunk) : NaN;
    if (!Number.isFinite(numericIncome)) return null;
    return numericIncome <= 350000;
  };

  const incomeUnderLimit = parseIncomeUnderLimit(parental_annual_income);

  if (isGeneralGroup) {
    if (pct >= 55) {
      if (incomeUnderLimit === null) return null;
      return incomeUnderLimit ? 1 : 2;
    }
    if (pct >= 50) return 2;
    return null;
  }

  if (isScSt) {
    if (pct >= 50) {
      if (incomeUnderLimit === null) return null;
      return incomeUnderLimit ? 1 : 2;
    }
    if (pct >= 40) return 2;
    return null;
  }

  return null;
};

const buildApplicationDisplayId = ({
  scholarshipId,
  scholarshipName,
  classValue,
  examCode,
  sessionYear,
  serial,
}) => {
  const scholarshipNameLower = String(scholarshipName || "").toLowerCase();
  const isCmScheme =
    Number(scholarshipId) === 3 ||
    /\bcm\b/i.test(scholarshipName) ||
    /chief\s*minister/i.test(scholarshipName);
  const isNmmssScheme =
    Number(scholarshipId) === 6 ||
    /\bnmmss\b/i.test(scholarshipName) ||
    /\bnmms\b/i.test(scholarshipName) ||
    /snss/i.test(scholarshipNameLower) ||
    /ssss/i.test(scholarshipNameLower);

  const serialPart = String(serial).padStart(5, "0");
  const year2 = String(sessionYear).slice(-2);
  if (isCmScheme) {
    return `CM${classValue}${year2}${serialPart}`;
  }
  if (isNmmssScheme) {
    return `${String(examCode)}${String(sessionYear)}${serialPart}`;
  }
  return null;
};

const generateApplicationDisplayIdIfNeeded = async ({ client, app, sessionId }) => {
  if (app.application_display_id) return app.application_display_id;

  const scholarshipId = Number(app.scholarship_id);
  const scholarshipMetaRes = await client.query(
    `
    SELECT scholarship_name
    FROM scert_db.scholarships
    WHERE scholarship_id = $1
    LIMIT 1
    `,
    [scholarshipId]
  );
  const scholarshipName = scholarshipMetaRes.rows[0]?.scholarship_name || "";
  const scholarshipNameLower = String(scholarshipName || "").toLowerCase();
  const isCmScheme =
    scholarshipId === 3 ||
    /\bcm\b/i.test(scholarshipName) ||
    /chief\s*minister/i.test(scholarshipName);
  const isNmmssScheme =
    scholarshipId === 6 ||
    /\bnmmss\b/i.test(scholarshipName) ||
    /\bnmms\b/i.test(scholarshipName) ||
    /snss/i.test(scholarshipNameLower) ||
    /ssss/i.test(scholarshipNameLower);

  if (!isCmScheme && !isNmmssScheme) return null;

  const sessionRes = await client.query(
    `
    SELECT EXTRACT(YEAR FROM start_date)::int AS start_year
    FROM scert_db.academic_sessions
    WHERE session_id = $1
    LIMIT 1
    `,
    [sessionId]
  );
  if (sessionRes.rows.length === 0) {
    throw new Error("Academic session not found");
  }

  const sessionYear = Number(sessionRes.rows[0].start_year);

  let lockQuery = `
    SELECT application_id
    FROM scert_db.scholarship_applications
    WHERE session_id = $1
      AND scholarship_id = $2
      AND application_display_id IS NOT NULL
  `;
  let maxQuery = `
    SELECT COALESCE(
      MAX(
        CASE
          WHEN RIGHT(application_display_id, 5) ~ '^[0-9]{5}$'
          THEN RIGHT(application_display_id, 5)::int
          ELSE NULL
        END
      ),
      0
    ) AS max_serial
    FROM scert_db.scholarship_applications
    WHERE session_id = $1
      AND scholarship_id = $2
      AND application_display_id IS NOT NULL
  `;
  const params = [sessionId, scholarshipId];

  let classValue = null;
  let examCode = null;

  if (isCmScheme) {
    classValue = Number(app.class);
    if (![6, 9].includes(classValue)) {
      const classRes = await client.query(
        `
        SELECT COALESCE(NULLIF(aa.value_text, ''), aa.value_number::text) AS class_value
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields ff
          ON ff.field_id = aa.field_id
        WHERE aa.application_id = $1
          AND ff.scholarship_id = $2
          AND LOWER(TRIM(ff.field_key)) IN ('class', 'class_level')
        ORDER BY ff.sort_order ASC
        LIMIT 1
        `,
        [app.application_id, scholarshipId]
      );
      const parsedClass = Number(classRes.rows[0]?.class_value);
      if ([6, 9].includes(parsedClass)) {
        classValue = parsedClass;
      }
    }
    if (![6, 9].includes(classValue)) {
      throw new Error("For CM scheme, class must be 6 or 9 before submit");
    }
    lockQuery += ` AND class = $3`;
    maxQuery += ` AND class = $3`;
    params.push(classValue);
  } else if (isNmmssScheme) {
    examCode = app.exam_code;
    if (examCode === null || examCode === undefined || String(examCode).trim() === "") {
      const eligibilityRes = await client.query(
        `
        SELECT
          MAX(CASE WHEN LOWER(TRIM(f.field_key)) = 'caste_category'
            THEN COALESCE(aa.value_text, aa.value_number::text) END) AS caste_category,
          MAX(CASE WHEN LOWER(TRIM(f.field_key)) = 'parental_annual_income'
            THEN COALESCE(aa.value_text, aa.value_number::text) END) AS parental_annual_income,
          MAX(CASE WHEN LOWER(TRIM(f.field_key)) = 'percentage_of_class_vii'
            THEN COALESCE(aa.value_text, aa.value_number::text) END) AS percentage
        FROM scert_db.scholarship_application_answers aa
        JOIN scert_db.scholarship_form_fields f
          ON f.field_id = aa.field_id
        WHERE aa.application_id = $1
        `,
        [app.application_id]
      );
      const derivedExamCode = calculateExamCodeIfApplicable({
        scholarship_id: 6,
        caste_category: eligibilityRes.rows[0]?.caste_category,
        parental_annual_income: eligibilityRes.rows[0]?.parental_annual_income,
        percentage: eligibilityRes.rows[0]?.percentage,
      });
      if (derivedExamCode !== null && derivedExamCode !== undefined) {
        examCode = derivedExamCode;
        await client.query(
          `
          UPDATE scert_db.scholarship_applications
          SET exam_code = $1
          WHERE application_id = $2
          `,
          [examCode, app.application_id]
        );
      }
    }
    if (examCode === null || examCode === undefined || String(examCode).trim() === "") {
      throw new Error("For NMMSS scheme, exam_code is required before submit");
    }
    // Scholarship 6: keep one common serial stream across exam codes
    // (scope = session_id + scholarship_id). exam_code is only a prefix component.
  }

  // Serialize ID generation per effective scope to prevent duplicate serials under concurrency.
  const lockScope = isCmScheme
    ? `app_display_id:cm:${sessionId}:${classValue}`
    : `app_display_id:nmmss:${sessionId}`;
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
    [lockScope]
  );

  await client.query(`${lockQuery} FOR UPDATE`, params);
  const maxRes = await client.query(maxQuery, params);
  let nextSerial = Number(maxRes.rows[0].max_serial) + 1;
  let generatedDisplayId = null;

  while (true) {
    generatedDisplayId = buildApplicationDisplayId({
      scholarshipId,
      scholarshipName,
      classValue,
      examCode,
      sessionYear,
      serial: nextSerial,
    });

    const existsRes = await client.query(
      `
      SELECT 1
      FROM scert_db.scholarship_applications
      WHERE session_id = $1
        AND application_display_id = $2
      LIMIT 1
      `,
      [sessionId, generatedDisplayId]
    );
    if (existsRes.rows.length === 0) break;
    nextSerial += 1;
  }

  return generatedDisplayId;
};

const STUDENT_NAME_FIELD_KEYS = [
  "student_name",
  "candidate_name",
  "applicant_name",
  "full_name",
  "student_full_name",
  "candidate_full_name",
];

const resolveStudentNameFromAnswers = async (applicationId) => {
  const normalizedStudentNameKeys = STUDENT_NAME_FIELD_KEYS.map(normalizeFieldKey);
  const { rows } = await pool.query(
    `SELECT
      LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) AS field_key,
      ff.field_label,
      COALESCE(
        NULLIF(aa.value_text, ''),
        aa.value_date::TEXT,
        aa.value_number::TEXT,
        NULLIF(aa.value_file_path, '')
      ) AS value
    FROM scert_db.scholarship_application_answers aa
    JOIN scert_db.scholarship_form_fields ff
      ON ff.field_id = aa.field_id
    WHERE aa.application_id = $1
      AND (
        ff.field_key = ANY($2)
        OR LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) = ANY($3)
        OR (
          ff.field_label ILIKE 'name'
          OR (ff.field_label ILIKE '%full%' AND ff.field_label ILIKE '%name%')
          OR (ff.field_label ILIKE '%candidate%' AND ff.field_label ILIKE '%name%')
          OR (ff.field_label ILIKE '%student%' AND ff.field_label ILIKE '%name%')
          OR (ff.field_label ILIKE '%applicant%' AND ff.field_label ILIKE '%name%')
        )
      )`,
    [applicationId, STUDENT_NAME_FIELD_KEYS, normalizedStudentNameKeys]
  );

  if (!rows.length) return null;

  // Prefer known field keys (in order)
  for (const key of STUDENT_NAME_FIELD_KEYS) {
    const hit = rows.find(
      (r) => String(r.field_key || "").toLowerCase() === String(key).toLowerCase()
    );
    if (hit?.value) return hit.value;
  }

  // Otherwise, just return first non-empty value
  return rows.find((r) => r.value)?.value || null;
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

const enrichApplicationsWithAnswerData = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const appIds = rows.map((r) => r.application_id).filter(Boolean);

  const answersRes = await pool.query(
    `SELECT aa.application_id,
            aa.field_id,
            LOWER(REGEXP_REPLACE(COALESCE(ff.field_key, ''), '[[:space:]]+', '', 'g')) AS field_key,
            ff.field_label,
            COALESCE(aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path) AS raw_value
     FROM scert_db.scholarship_application_answers aa
     JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
     WHERE aa.application_id = ANY($1::bigint[])
       AND (
         ff.field_key = ANY($2)
         OR LOWER(REGEXP_REPLACE(COALESCE(ff.field_key, ''), '[[:space:]]+', '', 'g')) = ANY($3)
         OR ff.field_label ILIKE '%student%registration%'
         OR ff.field_label ILIKE '%registration%number%'
         OR ff.field_label ILIKE 'sr no%'
         OR ff.field_label ILIKE '%disability%'
         OR ff.field_label ILIKE '%divyang%'
       )`,
    [appIds, APPLICATION_ENRICH_FIELD_KEYS, APPLICATION_ENRICH_FIELD_KEYS.map(normalizeFieldKey)]
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
      if (!optionsByFieldId[opt.field_id]) optionsByFieldId[opt.field_id] = [];
      optionsByFieldId[opt.field_id].push(opt);
    });
  }

  const answersByApp = {};
  answersRes.rows.forEach((ans) => {
    if (!answersByApp[ans.application_id]) answersByApp[ans.application_id] = {};
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

  const preschoolUdiseCodes = Array.from(
    new Set(
      Object.values(answersByApp)
        .map((answers) => String(answers.previous_school_udise || "").trim())
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

  return rows.map((row) => {
    const answers = answersByApp[row.application_id] || {};
    const candidateName =
      row.candidate_name ||
      row.student_name ||
      answers.student_name ||
      answers.candidate_name ||
      null;
    const scholarshipName = String(row.scholarship_name || "");
    const classValue = String(
      row.class ||
      answers.class ||
      ((/\bNMMSS\b/i.test(scholarshipName) || /\bNMMS\b/i.test(scholarshipName)) ? "8" : "")
    ).trim();

    const previousSchoolUdise = String(answers.previous_school_udise || "").trim() || null;
    const previousSchool = previousSchoolUdise ? preschoolByUdise[previousSchoolUdise] : null;

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

    const explicitIncomeRaw =
      row.parental_income_code ||
      answers.parental_income_code ||
      answers.income_code ||
      null;
    let normalizedExplicitIncomeCode = null;
    if (explicitIncomeRaw !== null && explicitIncomeRaw !== undefined) {
      const normalized = String(explicitIncomeRaw).trim().toLowerCase();
      const compact = normalized.replace(/\s+/g, "");
      if (
        compact === "1" ||
        normalized.includes("up to") ||
        normalized.includes("upto") ||
        normalized.includes("<=")
      ) {
        normalizedExplicitIncomeCode = "1";
      } else if (
        compact === "2" ||
        normalized.includes("more than") ||
        normalized.includes(">=") ||
        normalized.includes(">")
      ) {
        normalizedExplicitIncomeCode = "2";
      }
    }

    return {
      ...row,
      candidate_name: candidateName,
      student_name: candidateName,
      father_name: row.father_name || answers.father_name || null,
      mother_name: row.mother_name || answers.mother_name || null,
      date_of_birth: row.date_of_birth || answers.date_of_birth || null,
      sex: row.sex || answers.sex || null,
      class: classValue || null,
      caste_category: row.caste_category || answers.caste_category || null,
      type_of_divyangta:
        resolveDivyangtaCode(answers, row),
      aadhaar_number:
        row.aadhaar_number ||
        answers.aadhaar_number ||
        answers.aadhaar_no ||
        answers.aadhar_number ||
        answers.aadhar_no ||
        answers.aadhaar ||
        null,
      // The candidate's own mobile number (the form's "Mobile Number" field)
      // comes first, so no other contact-style answer can displace it.
      contact_no:
        answers.mobile_number ||
        row.contact_no ||
        answers.contact_no ||
        answers.contact_number ||
        answers.phone ||
        null,
      previous_school_udise: previousSchoolUdise,
      previous_school_name: previousSchool?.school_name || row.previous_school_name || null,
      previous_school_type: previousSchool?.school_management_code || row.previous_school_type || null,
      marks_class_7:
        row.marks_class_7 ||
        answers.marks_class_7 ||
        answers.percentage_marks_class_7 ||
        answers.percentage_of_class_vii ||
        null,
      parental_income_code:
        normalizedExplicitIncomeCode ||
        derivedParentalIncomeCode ||
        null,
      student_registration_no: getStudentRegistration(answers, row),
      sr_no: getStudentRegistration(answers, row),
    };
  });
};


/**
 * GET BEO INBOX
 * GET /beo/applications/inbox
 *
 * Optional query params:
 * - scholarship_id
 * - class_filter
 */
exports.getInbox = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;

  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    // 1️⃣ Get BEO block info
    const beoRes = await pool.query(
      `SELECT block_code, block_name
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch applications from schools in this block
    const appsRes = await pool.query(
      `SELECT
  a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
  a.roll_number,
  a.app_serial_no,
  a.exam_code,
  COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code) AS block_code,
  a.scholarship_id,
  s.scholarship_name,
  a.student_user_id,
  st.full_name AS student_name,
  a.submitted_at,
  a.status,
  a.current_stage,
  a.center_id,
  ec.center_order,
  ec.school_name AS center_name,

  -- class (from form answers)
  COALESCE(a.class::TEXT, cls.class_value) AS class,

  -- school resolution (student OR creator)
  COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
  COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code,
  COALESCE(sp_student.block_name, sp_creator.block_name) AS block_name,
  COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
  COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
  COALESCE(sp_student.school_type, sp_creator.school_type) AS school_type,
  COALESCE(sp_student.school_location, sp_creator.school_location) AS school_category

FROM scert_db.scholarship_applications a

-- student may or may not exist
LEFT JOIN scert_db.student_profiles st
  ON a.student_user_id = st.user_id

-- school via student
LEFT JOIN scert_db.school_profiles sp_student
  ON st.udise_code = sp_student.udise_code

-- school via creator (fallback)
LEFT JOIN scert_db.school_profiles sp_creator
  ON a.created_by_school_user_id = sp_creator.user_id

LEFT JOIN scert_db.exam_centers ec
  ON ec.center_id = a.center_id

-- class field (best-effort)
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      NULLIF(aa.value_text, ''),
      aa.value_number::TEXT,
      aa.value_date::TEXT
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

JOIN scert_db.scholarships s
  ON a.scholarship_id = s.scholarship_id

WHERE a.current_stage = 'BEO'
  AND a.status = 'SUBMITTED'
  AND a.session_id = $2
  AND COALESCE(
        sp_student.block_code,
        sp_creator.block_code
      )::TEXT = $1::TEXT
  AND (
    $3::bigint IS NULL
    OR a.scholarship_id = $3::bigint
  )

ORDER BY a.submitted_at DESC;
`,
      [block_code, session_id, scholarship_id || null]
    );

    let enrichedRows = await enrichApplicationsWithAnswerData(appsRes.rows);
    enrichedRows = enrichedRows.map((row) => ({
      ...row,
      block_code: row.block_code || block_code || null,
    }));

    if (class_filter) {
      enrichedRows = enrichedRows.filter(
        (row) => String(row.class ?? '') === String(class_filter)
      );
    }

    res.json({
      block_code,
      total: enrichedRows.length,
      filters: {
        scholarship_id: scholarship_id || null,
        class_filter: class_filter || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO inbox error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};



/**
 * VIEW APPLICATION (BEO)
 * GET /beo/applications/:application_id
 */
exports.viewApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;


  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    // 1️⃣ Get BEO block
    const beoRes = await pool.query(
      `SELECT block_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch application + school + scholarship (block check)
    const appRes = await pool.query(
      `SELECT
         a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
         a.current_stage,
         a.status,
         a.submitted_at,
         a.created_at,
         a.student_user_id,
         a.created_by_school_user_id,
         a.exam_code,
         s.scholarship_id,
         s.scholarship_name,
         s.scholarship_details,
         COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
         COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code,
         COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code,
         sp_student.block_code AS student_block_code,
         sp_creator.block_code AS creator_block_code
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles st
         ON a.student_user_id = st.user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON st.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       JOIN scert_db.scholarships s
         ON a.scholarship_id = s.scholarship_id
       WHERE a.application_id = $1
        AND (
          (a.current_stage = 'BEO' AND a.status IN ('SUBMITTED', 'RETURNED'))
          OR
          (a.current_stage = 'SCERT' AND a.status IN ('SUBMITTED', 'APPROVED'))
        )
        AND a.session_id = $2`,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      return res.status(404).json({
        message: "Application not found or not accessible",
      });
    }

    const application = appRes.rows[0];

    // Log for debugging
    console.log(`[BEO viewApplication] app_id=${applicationId}, student_user_id=${application.student_user_id}, created_by_school_user_id=${application.created_by_school_user_id}`);
    console.log(`[BEO viewApplication] student_block=${application.student_block_code}, creator_block=${application.creator_block_code}, final_block=${application.block_code}`);

    // Additional validation: ensure we have school info
    if (!application.block_code) {
      console.error(`Application ${applicationId} has no school info - both student and creator school profiles missing`);
      return res.status(404).json({
        message: "Application not found or not accessible - no school information",
      });
    }

    // Validate BEO has access to this block
    if (application.block_code !== block_code) {
      console.error(`Application ${applicationId} block mismatch - app_block=${application.block_code}, beo_block=${block_code}`);
      return res.status(404).json({
        message: "Application not found or not accessible",
      });
    }

    // 3️⃣ Fetch fields (ordered)
    const fieldsRes = await pool.query(
      `SELECT
         field_id,
         field_label,
         field_key,
         field_type,
         is_required,
         sort_order
       FROM scert_db.scholarship_form_fields
       WHERE scholarship_id = $1
         AND is_active = true
       ORDER BY sort_order ASC`,
      [application.scholarship_id]
    );

    const fields = fieldsRes.rows;

    // 4️⃣ Fetch options (grouped by field)
    const fieldIds = fields.map(f => f.field_id);
    let optionsByField = {};

    if (fieldIds.length > 0) {
      const optionsRes = await pool.query(
        `SELECT
           option_id,
           field_id,
           option_label,
           option_value,
           sort_order
         FROM scert_db.scholarship_form_field_options
         WHERE field_id = ANY($1)
           AND is_active = true
         ORDER BY sort_order ASC`,
        [fieldIds]
      );

      for (const opt of optionsRes.rows) {
        if (!optionsByField[opt.field_id]) {
          optionsByField[opt.field_id] = [];
        }
        optionsByField[opt.field_id].push(opt);
      }
    }

    // 5️⃣ Fetch answers
    const answersRes = await pool.query(
      `SELECT
         field_id,
         value_text,
         value_number,
         value_date,
         value_file_path
       FROM scert_db.scholarship_application_answers
       WHERE application_id = $1`,
      [applicationId]
    );

    const answersMap = {};
    for (const a of answersRes.rows) {
      answersMap[a.field_id] =
        a.value_text ??
        a.value_number ??
        a.value_date ??
        a.value_file_path ??
        null;
    }

    // 6️⃣ Assemble form
    const form = fields.map(f => ({
      field_id: f.field_id,
      field_label: f.field_label,
      field_key: f.field_key,
      field_type: f.field_type,
      is_required: f.is_required,
      sort_order: f.sort_order,
      options: ["DROPDOWN", "RADIO", "CHECKBOX"].includes(f.field_type)
        ? (optionsByField[f.field_id] || [])
        : [],
      answer: answersMap[f.field_id] ?? null,
    }));

    // 7️⃣ Fetch remarks
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

    res.json({
      application: {
        application_id: application.application_id,
        current_stage: application.current_stage,
        status: application.status,
        submitted_at: application.submitted_at,
        created_at: application.created_at,
        exam_code: application.exam_code,
      },
      scholarship: {
        scholarship_id: application.scholarship_id,
        scholarship_name: application.scholarship_name,
        scholarship_details: application.scholarship_details,
      },
      school: {
        school_name: application.school_name,
        udise_code: application.udise_code,
      },
      form,
      remarks: remarksRes.rows,
    });
  } catch (err) {
    console.error("BEO view application error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * EDIT APPLICATION ANSWERS (BEO)
 * PUT /beo/applications/:application_id/answers
 */
exports.editAnswers = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;

  const { answers } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ message: "answers array is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get BEO block
    const beoRes = await client.query(
      `SELECT block_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch application + block validation
    const appRes = await client.query(
      `SELECT
         a.application_id,
         a.application_display_id AS application_display_id,
        a.submitted_by_role,
         a.scholarship_id,
         s.scholarship_name,
         a.class,
         a.exam_code,
         a.current_stage,
         a.status,
         a.is_locked,
         COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code
       FROM scert_db.scholarship_applications a
       JOIN scert_db.scholarships s
         ON s.scholarship_id = a.scholarship_id
       LEFT JOIN scert_db.student_profiles st
         ON a.student_user_id = st.user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON st.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       WHERE a.application_id = $1
         AND a.session_id = $2
       FOR UPDATE OF a`,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];
    const scholarshipName = String(app.scholarship_name || "");
    const scholarshipNameLower = scholarshipName.toLowerCase();
    const isCmScheme =
      Number(app.scholarship_id) === 3 ||
      /\bcm\b/i.test(scholarshipName) ||
      /chief\s*minister/i.test(scholarshipName);
    const isNmmssScheme =
      Number(app.scholarship_id) === 6 ||
      /\bnmmss\b/i.test(scholarshipName) ||
      /\bnmms\b/i.test(scholarshipName) ||
      /snss/i.test(scholarshipNameLower) ||
      /ssss/i.test(scholarshipNameLower);
    const previousClass = app.class;
    const previousExamCode = app.exam_code;
    const previousDisplayId = app.application_display_id;

    if (!app.block_code) {
      throw new Error("Application has no school information");
    }

    if (app.block_code !== block_code) {
      throw new Error("Unauthorized access");
    }

    // Check if EDIT_APPROVED_APPLICATIONS is unlocked
    const flRes = await client.query(
      `SELECT is_locked FROM scert_db.session_feature_locks
       WHERE session_id = $1 AND feature_name = 'EDIT_APPROVED_APPLICATIONS'`,
      [session_id]
    );
    const allowEditApproved = flRes.rows.length > 0 ? !flRes.rows[0].is_locked : false;
    const isApprovedAndUnlocked = allowEditApproved && app.status === 'APPROVED';

    if (!isApprovedAndUnlocked) {
      if (app.is_locked) {
        throw new Error("Application is locked");
      }

      if (app.current_stage !== "BEO" || (app.status !== "SUBMITTED" && app.status !== "RETURNED" && app.status !== "RETURNED_TO_BEO")) {
        throw new Error("Application not editable at this stage");
      }
    }

    let selectedClass = null;

    // 3️⃣ Save answers (Optimized)
    if (!req.session.is_active) {
      throw new Error("Past session data is read-only");
    }

    const requestedFieldIds = answers.map((ans) => Number(ans.field_id)).filter(Boolean);
    if (requestedFieldIds.length > 0) {
      const fieldRes = await client.query(
        `SELECT field_id, field_type, field_key
         FROM scert_db.scholarship_form_fields
         WHERE field_id = ANY($1::bigint[])`,
        [requestedFieldIds]
      );

      const fieldMap = new Map();
      fieldRes.rows.forEach(f => fieldMap.set(Number(f.field_id), f));

      /* A BEO correcting the SR Number must not create a duplicate within
         the application's school. See services/srNumber.service.js. */
      const srAnswer = srNumber.findSrAnswer(answers, fieldMap);
      if (srAnswer) {
        await srNumber.assertSrNumberAvailable(client, {
          applicationId,
          value: srAnswer.value,
          fieldType: srAnswer.fieldType,
          audience: "office",
          onlyIfChanged: true,
        });
      }

      const answerRows = [];

      for (const ans of answers) {
        const { field_id, value } = ans;
        if (!field_id) continue;

        const field = fieldMap.get(Number(field_id));
        if (!field) {
          throw new Error(`Invalid field_id ${field_id}`);
        }

        const { field_type: fieldType, field_key: fieldKey } = field;
        const normalizedFieldKey = String(fieldKey || "").trim().toLowerCase();

        if (isCmScheme && ["class", "class_level"].includes(normalizedFieldKey)) {
          const parsedClass = Number(value);
          if (![6, 9].includes(parsedClass)) {
            throw new Error("For scholarship 3, class must be 6 or 9");
          }
          selectedClass = parsedClass;
        }

        let valueText = null,
          valueNumber = null,
          valueDate = null,
          valueFile = null;

        switch (fieldType) {
          case "NUMBER":
            assertValidNumberAnswer(field, value);
            valueNumber = value;
            break;
          case "DATE":
            valueDate = value;
            break;
          case "FILE":
            valueFile = value;
            break;
          default:
            valueText = value;
        }

        answerRows.push({
          application_id: Number(applicationId),
          field_id: Number(field_id),
          value_text: valueText,
          value_number: valueNumber,
          value_date: valueDate,
          value_file_path: valueFile,
        });
      }

      if (answerRows.length > 0) {
        await client.query(
          `INSERT INTO scert_db.scholarship_application_answers
           (application_id, field_id, value_text, value_number, value_date, value_file_path)
           SELECT *
           FROM UNNEST(
             $1::bigint[],
             $2::bigint[],
             $3::text[],
             $4::numeric[],
             $5::date[],
             $6::varchar[]
           )
           ON CONFLICT (application_id, field_id)
           DO UPDATE SET
             value_text = EXCLUDED.value_text,
             value_number = EXCLUDED.value_number,
             value_date = EXCLUDED.value_date,
             value_file_path = EXCLUDED.value_file_path,
             updated_at = CURRENT_TIMESTAMP`,
          [
            answerRows.map((row) => row.application_id),
            answerRows.map((row) => row.field_id),
            answerRows.map((row) => row.value_text ?? null),
            answerRows.map((row) => row.value_number ?? null),
            answerRows.map((row) => row.value_date ?? null),
            answerRows.map((row) => row.value_file_path ?? null),
          ]
        );
      }
    }

    if (isCmScheme && selectedClass !== null) {
      await client.query(
        `
        UPDATE scert_db.scholarship_applications
        SET class = $1
        WHERE application_id = $2
        `,
        [selectedClass, applicationId]
      );
    }

    const eligibilityRes = await client.query(
      `
      SELECT
        MAX(CASE WHEN LOWER(TRIM(f.field_key)) = 'caste_category'
          THEN COALESCE(aa.value_text, aa.value_number::text) END) AS caste_category,
        MAX(CASE WHEN LOWER(TRIM(f.field_key)) = 'parental_annual_income'
          THEN COALESCE(aa.value_text, aa.value_number::text) END) AS parental_annual_income,
        MAX(CASE WHEN LOWER(TRIM(f.field_key)) = 'percentage_of_class_vii'
          THEN COALESCE(aa.value_text, aa.value_number::text) END) AS percentage
      FROM scert_db.scholarship_application_answers aa
      JOIN scert_db.scholarship_form_fields f
        ON f.field_id = aa.field_id
      WHERE aa.application_id = $1
      `,
      [applicationId]
    );

    const examCode =
      isNmmssScheme
        ? calculateExamCodeIfApplicable({
            scholarship_id: 6,
            caste_category: eligibilityRes.rows[0].caste_category,
            parental_annual_income: eligibilityRes.rows[0].parental_annual_income,
            percentage: eligibilityRes.rows[0].percentage,
          })
        : null;

    if (isNmmssScheme && !examCode) {
      const eligibilityError = new Error(
        "You are not eligible for this scholarship based on the entered details. Please review eligibility criteria."
      );
      eligibilityError.statusCode = 400;
      throw eligibilityError;
    }

    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET exam_code = $1
      WHERE application_id = $2
      `,
      [examCode, applicationId]
    );

    const refreshedRes = await client.query(
      `
      SELECT class, exam_code
      FROM scert_db.scholarship_applications
      WHERE application_id = $1
      `,
      [applicationId]
    );

    const newClass = refreshedRes.rows[0]?.class ?? null;
    const newExamCode = refreshedRes.rows[0]?.exam_code ?? null;

    if (isCmScheme) {
      const prevClassNum =
        previousClass === null || previousClass === undefined
          ? null
          : Number(previousClass);
      const newClassNum =
        newClass === null || newClass === undefined ? null : Number(newClass);

      if (prevClassNum !== newClassNum) {
        await client.query(
          `
          UPDATE scert_db.scholarship_applications
          SET application_display_id = NULL
          WHERE application_id = $1
          `,
          [applicationId]
        );

        const regeneratedDisplayId = await generateApplicationDisplayIdIfNeeded({
          client,
          app: {
            scholarship_id: app.scholarship_id,
            class: newClass,
            exam_code: newExamCode,
            application_display_id: null,
          },
          sessionId: session_id,
        });

        if (regeneratedDisplayId) {
          await client.query(
            `
            UPDATE scert_db.scholarship_applications
            SET application_display_id = $1
            WHERE application_id = $2
            `,
            [regeneratedDisplayId, applicationId]
          );
        }
      }
    }

    if (isNmmssScheme) {
      const prevExamNum =
        previousExamCode === null || previousExamCode === undefined
          ? null
          : Number(previousExamCode);
      const newExamNum =
        newExamCode === null || newExamCode === undefined
          ? null
          : Number(newExamCode);

      if (prevExamNum !== newExamNum) {
        const serialMatch = String(previousDisplayId || "").match(/(\d{5})$/);

        if (serialMatch && Number.isFinite(newExamNum)) {
          const sessionRes = await client.query(
            `
            SELECT EXTRACT(YEAR FROM start_date)::int AS start_year
            FROM scert_db.academic_sessions
            WHERE session_id = $1
            LIMIT 1
            `,
            [session_id]
          );

          if (sessionRes.rows.length === 0) {
            throw new Error("Academic session not found");
          }

          const rebuiltDisplayId = buildApplicationDisplayId({
            scholarshipId: app.scholarship_id,
            scholarshipName,
            classValue: null,
            examCode: newExamNum,
            sessionYear: Number(sessionRes.rows[0].start_year),
            serial: Number(serialMatch[1]),
          });

          await client.query(
            `
            UPDATE scert_db.scholarship_applications
            SET application_display_id = $1
            WHERE application_id = $2
            `,
            [rebuiltDisplayId, applicationId]
          );
        }
      }
    }

    // Ensure display ID is generated if still missing (new session/new records case).
    if (isCmScheme || isNmmssScheme) {
      const displayIdRes = await client.query(
        `
        SELECT application_display_id
        FROM scert_db.scholarship_applications
        WHERE application_id = $1
        `,
        [applicationId]
      );

      const currentDisplayId = displayIdRes.rows[0]?.application_display_id ?? null;
      if (!currentDisplayId) {
        const generatedDisplayId = await generateApplicationDisplayIdIfNeeded({
          client,
          app: {
            scholarship_id: app.scholarship_id,
            class: newClass,
            exam_code: newExamCode,
            application_display_id: null,
          },
          sessionId: session_id,
        });

        if (generatedDisplayId) {
          await client.query(
            `
            UPDATE scert_db.scholarship_applications
            SET application_display_id = $1
            WHERE application_id = $2
            `,
            [generatedDisplayId, applicationId]
          );
        }
      }
    }

    await client.query("COMMIT");

    res.json({
      message: "Application answers updated successfully",
      exam_code: examCode,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("BEO edit answers error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


/**
 * GET BEO RETURNED BY SCERT APPLICATIONS
 * GET /beo/applications/returned-by-scert
 *
 * Optional query params:
 * - scholarship_id
 * - class_filter
 */
exports.getReturnedBySCERTApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;

  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    // 1️⃣ Get BEO block info
    const beoRes = await pool.query(
      `SELECT block_code, block_name
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch returned applications from SCERT
    const appsRes = await pool.query(
      `SELECT
  a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
  a.roll_number,
  a.exam_code,
  COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code) AS block_code,
  a.scholarship_id,
  s.scholarship_name,
  a.student_user_id,
  st.full_name AS student_name,
  a.submitted_at,
  a.status,
  a.current_stage,

  -- class (from form answers)
  cls.class_value AS class,

  COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
  COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code
FROM scert_db.scholarship_applications a
LEFT JOIN scert_db.student_profiles st
  ON a.student_user_id = st.user_id
LEFT JOIN scert_db.school_profiles sp_student
  ON st.udise_code = sp_student.udise_code
LEFT JOIN scert_db.school_profiles sp_creator
  ON a.created_by_school_user_id = sp_creator.user_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      NULLIF(aa.value_text, ''),
      aa.value_number::TEXT,
      aa.value_date::TEXT
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
JOIN scert_db.scholarships s
  ON a.scholarship_id = s.scholarship_id
WHERE a.current_stage = 'BEO'
  AND a.status = 'RETURNED'
  AND a.session_id = $2
  AND COALESCE(
        sp_student.block_code,
        sp_creator.block_code
      )::TEXT = $1::TEXT
  AND (
    $3::bigint IS NULL
    OR a.scholarship_id = $3::bigint
  )
ORDER BY a.submitted_at DESC;`,
      [block_code, session_id, scholarship_id || null]
    );

    // Enrich rows with student_name fallback from form answers and apply class defaults.
    let enrichedRows = await Promise.all(
      appsRes.rows.map(async (row) => {
        const next = { ...row };

        if (!next.student_name) {
          const resolvedName = await resolveStudentNameFromAnswers(next.application_id);
          if (resolvedName) {
            next.student_name = resolvedName;
          }
        }

        const classValue = next.class != null ? String(next.class).trim() : '';
        const scholarshipName = String(next.scholarship_name || '');

        if (classValue) {
          next.class = classValue;
        } else if (/\bNMMSS\b/i.test(scholarshipName) || /\bNMMS\b/i.test(scholarshipName)) {
          next.class = '8';
        } else {
          next.class = null;
        }

        return next;
      })
    );

    if (class_filter) {
      enrichedRows = enrichedRows.filter(
        (row) => String(row.class ?? '') === String(class_filter)
      );
    }

    res.json({
      block_code,
      total: enrichedRows.length,
      filters: {
        scholarship_id: scholarship_id || null,
        class_filter: class_filter || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO returned by SCERT error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET BEO RETURNED TO SCHOOL APPLICATIONS
 * GET /beo/applications/returned-to-school
 *
 * Optional query params:
 * - scholarship_id
 * - class_filter
 */
exports.getReturnedToSchoolApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;

  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    // 1️⃣ Get BEO block info
    const beoRes = await pool.query(
      `SELECT block_code, block_name
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch returned applications
    const appsRes = await pool.query(
      `SELECT
  a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
  a.scholarship_id,
  s.scholarship_name,
  a.student_user_id,
  st.full_name AS student_name,
  a.submitted_at,
  a.status,
  a.current_stage,

  -- class (from form answers)
  cls.class_value AS class,

  COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
  COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code
FROM scert_db.scholarship_applications a
LEFT JOIN scert_db.student_profiles st
  ON a.student_user_id = st.user_id
LEFT JOIN scert_db.school_profiles sp_student
  ON st.udise_code = sp_student.udise_code
LEFT JOIN scert_db.school_profiles sp_creator
  ON a.created_by_school_user_id = sp_creator.user_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      NULLIF(aa.value_text, ''),
      aa.value_number::TEXT,
      aa.value_date::TEXT
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
JOIN scert_db.scholarships s
  ON a.scholarship_id = s.scholarship_id
WHERE a.current_stage = 'SCHOOL'
  AND a.status = 'RETURNED'
  AND a.session_id = $2
  AND COALESCE(sp_student.block_code, sp_creator.block_code)::TEXT = $1::TEXT
  AND (
    $3::bigint IS NULL
    OR a.scholarship_id = $3::bigint
  )
ORDER BY a.submitted_at DESC;`,
      [block_code, session_id, scholarship_id || null]
    );

    // Enrich rows with student_name fallback from form answers and apply class defaults.
    let enrichedRows = await Promise.all(
      appsRes.rows.map(async (row) => {
        const next = { ...row };

        if (!next.student_name) {
          const resolvedName = await resolveStudentNameFromAnswers(next.application_id);
          if (resolvedName) {
            next.student_name = resolvedName;
          }
        }

        const classValue = next.class != null ? String(next.class).trim() : '';
        const scholarshipName = String(next.scholarship_name || '');

        if (classValue) {
          next.class = classValue;
        } else if (/\bNMMSS\b/i.test(scholarshipName) || /\bNMMS\b/i.test(scholarshipName)) {
          next.class = '8';
        } else {
          next.class = null;
        }

        return next;
      })
    );

    if (class_filter) {
      enrichedRows = enrichedRows.filter(
        (row) => String(row.class ?? '') === String(class_filter)
      );
    }

    res.json({
      block_code,
      total: enrichedRows.length,
      filters: {
        scholarship_id: scholarship_id || null,
        class_filter: class_filter || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO returned to school error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET BEO SUBMITTED TO SCERT APPLICATIONS
 * GET /beo/applications/submitted-to-scert
 *
 * Optional query params:
 * - scholarship_id
 * - class_filter
 * - center_id
 */
exports.getSubmittedToScertApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;

  const { scholarship_id, class_filter, center_id } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const beoRes = await pool.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code } = beoRes.rows[0];

    const appsRes = await pool.query(
      `SELECT
  a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
  a.scholarship_id,
  s.scholarship_name,
  a.student_user_id,
  st.full_name AS student_name,
  a.submitted_at,
  a.status,
  a.current_stage,
  a.center_id,
  a.app_serial_no,
  a.exam_code,

  -- class (from form answers)
  COALESCE(a.class::TEXT, cls.class_value) AS class,

  -- school resolution (student OR creator)
  COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
  COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code,
  COALESCE(sp_student.block_name, sp_creator.block_name) AS block_name,
  COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
  COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
  COALESCE(sp_student.school_type, sp_creator.school_type) AS school_type,
  COALESCE(sp_student.school_location, sp_creator.school_location) AS school_category,

  -- center info
  ec.center_order,
  ec.school_name AS center_name

FROM scert_db.scholarship_applications a
LEFT JOIN scert_db.student_profiles st
  ON a.student_user_id = st.user_id
LEFT JOIN scert_db.school_profiles sp_student
  ON st.udise_code = sp_student.udise_code
LEFT JOIN scert_db.school_profiles sp_creator
  ON a.created_by_school_user_id = sp_creator.user_id
LEFT JOIN scert_db.exam_centers ec
  ON ec.center_id = a.center_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      NULLIF(aa.value_text, ''),
      aa.value_number::TEXT,
      aa.value_date::TEXT
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
JOIN scert_db.scholarships s
  ON a.scholarship_id = s.scholarship_id
WHERE a.current_stage = 'SCERT'
  AND a.status = 'SUBMITTED'
  AND a.session_id = $2
  AND COALESCE(a.block_code, sp_student.block_code, sp_creator.block_code)::TEXT = $1::TEXT
  AND (
    $3::bigint IS NULL
    OR a.scholarship_id = $3::bigint
  )
  AND (
    $4::bigint IS NULL
    OR a.center_id = $4::bigint
  )
ORDER BY
  ec.center_order ASC NULLS LAST,
  a.application_display_id ASC NULLS LAST,
  a.application_id ASC;
`,
      [block_code, session_id, scholarship_id || null, center_id || null]
    );

    let enrichedRows = await enrichApplicationsWithAnswerData(appsRes.rows);
    enrichedRows = enrichedRows.map((row) => ({
      ...row,
      block_code: row.block_code || block_code || null,
    }));

    if (class_filter) {
      enrichedRows = enrichedRows.filter(
        (row) => String(row.class ?? '') === String(class_filter)
      );
    }

    res.json({
      block_code,
      total: enrichedRows.length,
      filters: {
        scholarship_id: scholarship_id || null,
        class_filter: class_filter || null,
        center_id: center_id || null,
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO submitted to SCERT error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * RETURN APPLICATION TO SCHOOL (BEO)
 * POST /beo/applications/:application_id/return
 */
exports.returnApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;
  const { remark_text } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!remark_text || remark_text.trim().length === 0) {
    return res.status(400).json({ message: "remark_text is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get BEO block
    const beoRes = await client.query(
      `SELECT block_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch application + validate ownership
    const appRes = await client.query(
      `SELECT
         a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
         a.current_stage,
         a.status,
         a.is_locked,
         COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles st
         ON a.student_user_id = st.user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON st.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       WHERE a.application_id = $1
         AND a.session_id = $2`,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    if (!app.block_code || app.block_code !== block_code) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

   if (
  app.current_stage !== "BEO" ||
  !["SUBMITTED", "RETURNED", "RETURNED_TO_BEO"].includes(app.status)
) {
  throw new Error("Application cannot be returned at this stage");
}

    // 3️⃣ Insert remark
    await client.query(
      `INSERT INTO scert_db.application_remarks
       (application_id, action, from_stage, to_stage, remark_text, created_by)
       VALUES ($1, 'RETURN', 'BEO', 'SCHOOL', $2, $3)`,
      [applicationId, remark_text.trim(), beoUserId]
    );

    // 4️⃣ Update application stage
    await client.query(
      `UPDATE scert_db.scholarship_applications
SET
  status = 'RETURNED',
  current_stage = 'SCHOOL'
WHERE application_id = $1
AND session_id = $2`,
      [applicationId, session_id]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application returned to school successfully",
      current_stage: "SCHOOL",
      status: "RETURNED",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("BEO return error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


/**
 * SUBMIT APPLICATION TO SCERT (BEO)
 * POST /beo/applications/:application_id/submit-to-scert
 */
exports.submitToSCERT = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Get BEO block
    const beoRes = await client.query(
      `SELECT block_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Fetch application + validate ownership
    const appRes = await client.query(
      `SELECT
         a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
         a.current_stage,
         a.status,
         a.is_locked,
         COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles st
         ON a.student_user_id = st.user_id
       LEFT JOIN scert_db.school_profiles sp_student
         ON st.udise_code = sp_student.udise_code
       LEFT JOIN scert_db.school_profiles sp_creator
         ON a.created_by_school_user_id = sp_creator.user_id
       WHERE a.application_id = $1
         AND a.session_id = $2`,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    if (!app.block_code || app.block_code !== block_code) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

if (
  app.current_stage !== "BEO" ||
  !["SUBMITTED", "RETURNED"].includes(app.status)
) {
  throw new Error("Application is not eligible for submission to SCERT");
}

if (!app.center_id) {
  throw new Error("Center must be assigned before submitting to SCERT");
}

    // 3️⃣ Update application without inserting remark (no new remark for resubmission)

    // 4️⃣ Update application stage
    await client.query(
      `UPDATE scert_db.scholarship_applications
        SET
          status = 'SUBMITTED',
          current_stage = 'SCERT',
          updated_at = CURRENT_TIMESTAMP
        WHERE application_id = $1
          AND session_id = $2`,
      [applicationId, session_id]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application submitted to SCERT successfully",
      current_stage: "SCERT",
      status: "SUBMITTED",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("BEO submit to SCERT error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};


/**
 * GET APPLICATIONS FOR CENTER ASSIGNMENT (BEO)
 * GET /beo/applications?scholarship_id=&school_user_id=
 */
exports.getApplicationsForCenterAssignment = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, school_user_id, class_filter } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const beoRes = await pool.query(
      `SELECT block_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    const { rows } = await pool.query(
      `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.submitted_by_role,
        a.scholarship_id,
        a.created_at,
        a.student_user_id,

        (
          SELECT
            COALESCE(
              NULLIF(aa.value_text, ''),
              aa.value_date::text,
              aa.value_number::text
            )
          FROM scert_db.scholarship_application_answers aa
          JOIN scert_db.scholarship_form_fields ff
            ON ff.field_id = aa.field_id
          WHERE aa.application_id = a.application_id
            AND ff.scholarship_id = a.scholarship_id
            AND (
              ff.field_key ILIKE ANY (ARRAY[
                '%name%',
                '%student_name%',
                '%candidate_name%',
                '%applicant_name%',
                '%full_name%'
              ])
              OR ff.field_label ILIKE '%name%'
            )
          ORDER BY ff.sort_order ASC
          LIMIT 1
        ) AS student_name,

        cls.class_value AS class,

        COALESCE(sp_student.user_id, sp_creator.user_id) AS school_user_id,
        COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
        COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code

      FROM scert_db.scholarship_applications a

      LEFT JOIN scert_db.student_profiles st
        ON a.student_user_id = st.user_id

      LEFT JOIN scert_db.school_profiles sp_student
        ON st.udise_code = sp_student.udise_code

      LEFT JOIN scert_db.school_profiles sp_creator
        ON a.created_by_school_user_id = sp_creator.user_id

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            NULLIF(aa.value_text, ''),
            aa.value_number::TEXT,
            aa.value_date::TEXT
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

      WHERE a.scholarship_id = $1
        AND a.session_id = $2
        AND a.current_stage = 'BEO'
        AND a.status IN ('SUBMITTED', 'RETURNED')
        AND COALESCE(sp_student.block_code, sp_creator.block_code) = $3
        AND (
          $4::bigint IS NULL
          OR COALESCE(sp_student.user_id, sp_creator.user_id) = $4
        )
        AND (
          $5::text IS NULL
          OR COALESCE(NULLIF(TRIM(cls.class_value), ''), '') = $5::text
        )

      ORDER BY a.created_at ASC
      `,
      [
        scholarship_id,
        session_id,
        blockCode,
        school_user_id || null,
        class_filter || null,
      ]
    );

    res.json({
      total: rows.length,
      applications: rows,
    });
  } catch (err) {
    console.error("Fetch BEO applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};




/**
 * GET APPROVED APPLICATIONS (BEO)
 * GET /beo/applications/approved
 */
exports.getApprovedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id } = req.session;
  const { scholarship_id, center_id } = req.query;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    // 1️⃣ Get BEO block info
    const beoRes = await pool.query(
      `SELECT block_code, block_name
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const { block_code } = beoRes.rows[0];

    // 2️⃣ Build dynamic query
    let conditions = [];
    let values = [];
    let idx = 1;

    conditions.push(`a.status = 'APPROVED'`);
    conditions.push(`a.session_id = $${idx++}`);
    values.push(session_id);
    conditions.push(`sp.block_code = $${idx++}`);
    values.push(block_code);

    if (scholarship_id) {
      conditions.push(`a.scholarship_id = $${idx++}`);
      values.push(scholarship_id);
    }

    if (center_id) {
      conditions.push(`a.center_id = $${idx++}`);
      values.push(center_id);
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
        a.is_locked,
        a.final_approved_at,
        a.submitted_at,

        s.scholarship_id,
        s.scholarship_name,

        sp.school_name,
        sp.udise_code,

        stp.full_name AS student_name,

        ec.school_name AS center_name,
        ec.center_order,
        ec.superintendent_name,
        ec.superintendent_mobile

      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      LEFT JOIN scert_db.school_profiles sp
        ON sp.udise_code = stp.udise_code
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = a.center_id

      WHERE ${conditions.join(" AND ")}

      ORDER BY
        ec.center_order ASC NULLS LAST,
        NULLIF(regexp_replace(COALESCE(a.roll_number::text, ''), '[^0-9]', '', 'g'), '')::bigint ASC NULLS LAST,
        a.app_serial_no ASC NULLS LAST
    `;

    const { rows } = await pool.query(query, values);

    // Enrich rows with student_name fallback from form answers
    const enrichedRows = await Promise.all(
      rows.map(async (row) => {
        if (row.student_name) {
          return row;
        }

        const resolvedName = await resolveStudentNameFromAnswers(row.application_id);
        if (resolvedName) {
          row.student_name = resolvedName;
        }

        return row;
      })
    );

    res.json({
      block_code,
      total: enrichedRows.length,
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("BEO get approved applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET EXAM CENTERS FOR SCHOLARSHIP (BEO)
 * GET /beo/centers?scholarship_id=
 */
exports.getCentersForScholarship = async (req, res) => {
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
    // 1️⃣ Get BEO block
    const beoRes = await pool.query(
      `SELECT block_code
       FROM scert_db.beo_profiles
       WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      return res.status(404).json({ message: "BEO profile not found" });
    }

    const blockCode = beoRes.rows[0].block_code;

    // 2️⃣ Fetch centers
    const { rows } = await pool.query(
      `
      SELECT
        ec.center_id,
        ec.center_order,
        ec.center_order AS center_code,
        ec.center_order AS centre_code,
        ec.school_name,
        ec.udise_code,
        ec.block_code,
        COALESCE(
          NULLIF(TRIM(bp_self.block_name), ''),
          NULLIF(TRIM(bp_meta.block_name), '')
        ) AS block_name,
        COALESCE(
          NULLIF(TRIM(bp_self.district_code::text), ''),
          NULLIF(TRIM(bp_meta.district_code::text), '')
        ) AS district_code,
        COALESCE(
          NULLIF(TRIM(bp_self.district_name), ''),
          NULLIF(TRIM(bp_meta.district_name), '')
        ) AS district_name,
        ec.superintendent_name,
        ec.superintendent_mobile,
        ${REGISTRATION_COUNT_COLUMNS}
      FROM scert_db.exam_centers ec
      JOIN scert_db.scholarships sch
        ON sch.scholarship_id = ec.scholarship_id
      LEFT JOIN scert_db.beo_profiles bp_self
        ON bp_self.user_id = $4
      LEFT JOIN LATERAL (
        SELECT
          bp.block_name,
          bp.district_code,
          bp.district_name
        FROM scert_db.beo_profiles bp
        WHERE bp.block_code = ec.block_code
        ORDER BY bp.updated_at DESC NULLS LAST, bp.user_id DESC
        LIMIT 1
      ) bp_meta ON true
      ${registrationCountsLateral("ec", "sch")}
      WHERE ec.session_id = $1
        AND ec.scholarship_id = $2
        AND ec.block_code = $3
        AND ec.is_active = true
      ORDER BY ec.center_order ASC
      `,
      [session_id, scholarship_id, blockCode, beoUserId]
    );

    // The most centres this BEO may create for the scholarship (null: no
    // limit); the Create Centers page shows and enforces it from this.
    const nameRes = await pool.query(
      `SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $1`,
      [scholarship_id]
    );

    res.json({
      total: rows.length,
      max_centers: maxCentersForScholarshipName(nameRes.rows[0]?.scholarship_name),
      centers: rows,
    });
  } catch (err) {
    console.error("Fetch centers error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
