const srNumber = require("../services/srNumber.service");
const { assertValidNumberAnswer } = require("../utils/numberAnswer.util");
const { deleteApplicationFiles } = require("../services/fileUpload.service");
const pool = require("../config/db");

const normalizeFieldKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

const getStudentRegistration = (answers = {}, row = {}) =>
  answers.student_registration ||
  answers.student_registration_id ||
  answers.student_registration_number ||
  answers.student_registration_no ||
  answers.student_reg_no ||
  answers.registration_number ||
  answers.registration_no ||
  answers.sr_no ||
  answers.sr_number ||
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

  // Remove repeated wrapping quotes and backslashes from stringified payloads.
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
  // Reject tokens that are only punctuation/symbol noise.
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

  const resolved = tokens.map((token) => {
    const t = normalizeToken(token);
    const match = options.find((opt) => {
      const optionId = normalizeToken(opt.option_id);
      const optionValue = normalizeToken(opt.option_value);
      const optionLabel = normalizeToken(opt.option_label);
      return t === optionId || t === optionValue || t === optionLabel;
    });
    return match ? String(match.option_value).trim() : null;
  }).filter(Boolean);

  // For option-backed fields, only return valid mapped option values.
  if (resolved.length > 0) {
    const uniqueMapped = Array.from(new Set(resolved.filter(isMeaningfulToken)));
    return uniqueMapped.length ? uniqueMapped.join(", ") : null;
  }

  // If nothing matched, keep only meaningful tokens as last resort.
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

const extractUdiseCode = (value) => {
  const v = String(value || "").trim();
  if (!v) return null;

  const tagged = v.match(/udise\s*[:\-]?\s*([0-9]+)/i);
  if (tagged?.[1]) return tagged[1];

  if (/^[0-9]+$/.test(v)) return v;

  const digitRuns = v.match(/[0-9]{5,}/g);
  if (digitRuns?.length) {
    return digitRuns.sort((a, b) => b.length - a.length)[0];
  }

  return null;
};

/**
 * Does a class filter mean anything for this scholarship?
 *
 * CM runs class 6 and class 9 side by side, so its lists are filtered by
 * class. NMMSS is class 8 only and never stores a class on the
 * application, so filtering by class there matches nothing and empties
 * the list.
 *
 * This used to be written as `Number(scholarship_id) !== 6` — the NMMSS id
 * of the 2025-26 session. When NMMSS reopened for 2026-27 as id 8 the
 * guard stopped matching, the filter was applied, and every NMMSS draft
 * vanished from the school's screen. Scholarship ids change every session,
 * so recognise the scheme by name as the rest of the app does.
 */
const NMMSS_NAME_PATTERN = /\bnmmss\b|\bnmms\b|snss|ssss/i;

async function classFilterAppliesTo(scholarshipId) {
  if (!scholarshipId || !Number.isFinite(Number(scholarshipId))) return true;
  const res = await pool.query(
    `SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $1`,
    [scholarshipId]
  );
  return !NMMSS_NAME_PATTERN.test(String(res.rows[0]?.scholarship_name || ""));
}

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

const STUDENT_NAME_FIELD_KEYS = [
  "student_name",
  "candidate_name",
  "applicant_name",
  "full_name",
  "student_full_name",
  "candidate_full_name",
];

const isProbablyApplicantNameLabel = (label) => {
  const l = String(label || "").toLowerCase().trim();
  if (!l.includes("name")) return false;

  // Avoid parent/guardian names
  if (l.includes("father")) return false;
  if (l.includes("mother")) return false;
  if (l.includes("guardian")) return false;

  // Avoid common non-applicant names
  if (l.includes("school")) return false;
  if (l.includes("block")) return false;
  if (l.includes("district")) return false;
  if (l.includes("bank")) return false;
  if (l.includes("branch")) return false;
  if (l.includes("center")) return false;

  // Prefer labels clearly referring to the applicant
  if (l === "name" || l.includes("full name")) return true;
  if (l.includes("candidate") && l.includes("name")) return true;
  if (l.includes("student") && l.includes("name")) return true;
  if (l.includes("applicant") && l.includes("name")) return true;

  return false;
};

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

  // Otherwise rank by label heuristics
  const ranked = rows
    .filter((r) => r.value)
    .map((r) => {
      const label = String(r.field_label || "").toLowerCase();
      let score = 0;
      if (label === "name") score += 6;
      if (label.includes("candidate")) score += 5;
      if (label.includes("student")) score += 4;
      if (label.includes("full")) score += 2;
      if (isProbablyApplicantNameLabel(label)) score += 1;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.value || null;
};

const SCHOOL_APPLICATION_ENRICH_KEYS = [
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
  "student_registration_number",
  "student_registration_no",
  "student_registration",
  "student_registration_id",
  "student_reg_no",
  "registration_number",
  "registration_no",
  "sr_no",
  "sr_number",
];

const enrichSchoolRowsWithAnswers = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const appIds = rows
    .map((r) => Number(r.application_id))
    .filter((v) => Number.isFinite(v));
  if (appIds.length === 0) return rows;

  const answersRes = await pool.query(
    `SELECT aa.application_id,
            aa.field_id,
            LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) AS field_key,
            ff.field_label,
            COALESCE(aa.value_text, aa.value_date::TEXT, aa.value_number::TEXT, aa.value_file_path) AS raw_value
     FROM scert_db.scholarship_application_answers aa
     JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
     WHERE aa.application_id = ANY($1::int[])
       AND (
         ff.field_key = ANY($2)
       OR LOWER(REPLACE(TRIM(ff.field_key), ' ', '')) = ANY($3)
        OR (
           ff.field_label ILIKE '%student%registration%'
           OR ff.field_label ILIKE '%registration%number%'
           OR ff.field_label ILIKE 'sr no%'
           OR ff.field_label ILIKE '%disability%'
           OR ff.field_label ILIKE '%divyang%'
         )
       )`,
    [appIds, SCHOOL_APPLICATION_ENRICH_KEYS, SCHOOL_APPLICATION_ENRICH_KEYS.map(normalizeFieldKey)]
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
    if (
      !answersByApp[ans.application_id].student_registration_number &&
      (label.includes("student") && label.includes("registration"))
    ) {
      answersByApp[ans.application_id].student_registration_number = toDisplayValue(resolvedValue) || null;
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
      row.student_name || answers.student_name || answers.candidate_name || null;
    const previousSchoolUdise = String(answers.previous_school_udise || "").trim() || null;
    const previousSchool = previousSchoolUdise
      ? preschoolByUdise[previousSchoolUdise]
      : null;
    const parentalIncomeRaw = String(answers.parental_annual_income || "").trim();
    const normalizedIncome = parentalIncomeRaw.toLowerCase();
    const compactIncome = normalizedIncome.replace(/\s+/g, "");

    let derivedParentalIncomeCode = null;
    if (parentalIncomeRaw) {
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
      candidate_name: candidateName,
      student_name: candidateName,
      father_name: answers.father_name || null,
      mother_name: answers.mother_name || null,
      date_of_birth: answers.date_of_birth || null,
      sex: answers.sex || null,
      class: answers.class || row.class || null,
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
      sr_no: getStudentRegistration(answers, row),
      student_registration_no: getStudentRegistration(answers, row),
    };
  });
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

/**
 * INIT SCHOOL APPLICATION
 * POST /school/applications/:scholarship_id/init
 */
exports.initApplication = async (req, res) => {
  const schoolUserId = req.user.user_id;
  const roleId = req.user.role_id;
  const scholarshipId = req.params.scholarship_id;
  const { session_id, is_active } = req.session;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!session_id || !is_active) {
    return res.status(403).json({
      message: "Invalid or inactive academic session",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Validate scholarship (only enforce ACTIVE status in active sessions) */
    const schQuery = is_active
      ? `SELECT scholarship_id
         FROM scert_db.scholarships
         WHERE scholarship_id = $1
           AND status = 'ACTIVE'
           AND session_id = $2`
      : `SELECT scholarship_id
         FROM scert_db.scholarships
         WHERE scholarship_id = $1
           AND session_id = $2`;
    
    const sch = await client.query(schQuery, [scholarshipId, session_id]);

    if (sch.rows.length === 0) {
      throw new Error("Scholarship not found or inactive for this session");
    }

    /* 2️⃣ Get school's block_code */
    const schoolProfile = await client.query(
      `SELECT block_code FROM scert_db.school_profiles WHERE user_id = $1`,
      [schoolUserId]
    );

    const blockCode = schoolProfile.rows[0]?.block_code || null;

    /* 3️⃣ Create application */
    const result = await client.query(
      `
      INSERT INTO scert_db.scholarship_applications
      (
        scholarship_id,
        session_id,
        created_by_school_user_id,
        submitted_by_role,
        current_stage,
        status,
        exam_code,
        block_code
      )
      VALUES ($1, $2, $3, 'SCHOOL', 'SCHOOL', 'DRAFT', NULL, $4)
      RETURNING application_id, status, current_stage
      `,
      [scholarshipId, session_id, schoolUserId, blockCode]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Application initialized successfully",
      application_id: result.rows[0].application_id,
      status: result.rows[0].status,
      current_stage: result.rows[0].current_stage,
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School init application error:", err);
    return res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};




/**
 * SAVE APPLICATION ANSWERS (SCHOOL)
 * PUT /school/applications/:application_id/answers
 */
exports.saveAnswers = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id, is_active } = req.session;
  const { answers } = req.body;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ message: "answers array is required" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  const client = await pool.connect();

  // 🔧 Helper: calculate exam code (ONLY for scholarship_id = 6)
  function calculateExamCodeIfApplicable({
    scholarship_id,
    caste_category,
    parental_annual_income,
    percentage,
  }) {
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
  }

  try {
    await client.query("BEGIN");

    /* 1️⃣ Fetch application + ownership */
    const appRes = await client.query(
      `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.scholarship_id,
        s.scholarship_name,
        sa.class,
        sa.exam_code,
        sa.created_by_school_user_id,
        sa.current_stage,
        sa.status,
        sa.is_locked,
        sa.student_user_id,
        sc.user_id AS school_user_id
      FROM scert_db.scholarship_applications sa
      JOIN scert_db.scholarships s
        ON s.scholarship_id = sa.scholarship_id
      LEFT JOIN scert_db.student_profiles sp
        ON sa.student_user_id = sp.user_id
      LEFT JOIN scert_db.school_profiles sc
        ON sp.udise_code = sc.udise_code
      WHERE sa.application_id = $1
        AND sa.session_id = $2
      FOR UPDATE OF sa
      `,
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

    let resolvedSchoolUserId = null;
    if (app.student_user_id) {
      const schoolRes = await client.query(
        `
        SELECT sc.user_id AS school_user_id
        FROM scert_db.student_profiles sp
        JOIN scert_db.school_profiles sc
          ON sc.udise_code = sp.udise_code
        WHERE sp.user_id = $1
        LIMIT 1
        `,
        [app.student_user_id]
      );
      resolvedSchoolUserId = schoolRes.rows[0]?.school_user_id ?? null;
    }

    const effectiveSchoolUserId = Number(app.created_by_school_user_id) || Number(resolvedSchoolUserId) || Number(schoolUserId);

    if (
      Number(app.created_by_school_user_id) !== Number(schoolUserId) &&
      Number(resolvedSchoolUserId) !== Number(schoolUserId)
    ) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (!["DRAFT", "RETURNED", "SUBMITTED"].includes(app.status)) {
      throw new Error("Application not editable");
    }

    if (app.current_stage !== "SCHOOL") {
      throw new Error("Application not editable at this stage");
    }

    // 🔥 NEW: capture class ONLY for scholarship_id = 3
    let selectedClass = null;

    /* 3️⃣ Save answers (Optimized) */
    const requestedFieldIds = answers.map((ans) => Number(ans.field_id)).filter(Boolean);
    if (requestedFieldIds.length > 0) {
      const fieldRes = await client.query(
        `
        SELECT field_id, field_type, field_key
        FROM scert_db.scholarship_form_fields
        WHERE field_id = ANY($1::bigint[])
        `,
        [requestedFieldIds]
      );

      const fieldMap = new Map();
      fieldRes.rows.forEach(f => fieldMap.set(Number(f.field_id), f));

      /* SR Number uniqueness — one SR per school, per scholarship, per session.
         Rules and scope live in services/srNumber.service.js. */
      const srAnswer = srNumber.findSrAnswer(answers, fieldMap);
      if (srAnswer) {
        await srNumber.assertSrNumberAvailable(client, {
          applicationId: applicationId,
          value: srAnswer.value,
          fieldType: srAnswer.fieldType,
          audience: "school",
          onlyIfChanged: true,
        });
      }

      const answerRows = [];
      const preschoolUdiseCodes = [];

      for (const ans of answers) {
        const { field_id, value } = ans;
        if (!field_id) continue;

        const field = fieldMap.get(Number(field_id));
        if (!field) {
          throw new Error(`Invalid field_id ${field_id}`);
        }

        const { field_type, field_key } = field;
        const normalizedFieldKey = String(field_key || "").trim().toLowerCase();

        // ✅ Capture class ONLY for scholarship_id = 3
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

        switch (field_type) {
          case "NUMBER":
            assertValidNumberAnswer(field, value);
            if (value !== null && value !== undefined && value !== "") {
              const parsed = Number(value);
              if (isNaN(parsed)) {
                throw new Error(
                  `Invalid number value for field ${field_key}: ${value}`
                );
              }
              valueNumber = parsed;
            }
            break;

          case "DATE":
            valueDate = value;
            break;

          case "FILE":
            valueFile = value;
            break;

          case "PRESCHOOL": {
            if (!value) {
              throw new Error("Preschool selection is required");
            }

            const udiseCode = extractUdiseCode(value);
            if (!udiseCode) {
              throw new Error(`Invalid preschool selected: ${value}`);
            }

            preschoolUdiseCodes.push({ udiseCode, field_label: field_key });
            valueText = udiseCode;
            break;
          }

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

      // Validate preschools if any
      if (preschoolUdiseCodes.length > 0) {
        const uniqueUdiseCodes = Array.from(new Set(preschoolUdiseCodes.map(p => p.udiseCode)));
        const preschoolRes = await client.query(
          `
          SELECT udise_code
          FROM (
            SELECT udise_code
            FROM scert_db.primary_schools_master
            WHERE is_active = true
            UNION
            SELECT udise_code
            FROM scert_db.school_profiles
          ) all_schools
          WHERE all_schools.udise_code = ANY($1::text[])
          `,
          [uniqueUdiseCodes]
        );
        const validUdiseCodes = new Set(preschoolRes.rows.map(r => r.udise_code));
        for (const p of preschoolUdiseCodes) {
          if (!validUdiseCodes.has(p.udiseCode)) {
            throw new Error(`Invalid preschool selected: ${p.udiseCode}`);
          }
        }
      }

      if (answerRows.length > 0) {
        await client.query(
          `
          INSERT INTO scert_db.scholarship_application_answers
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
            updated_at = CURRENT_TIMESTAMP
          `,
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

    /* ----------------------------------------------------
       4️⃣ STORE CLASS (ONLY FOR SCHOLARSHIP 3, ONCE)
    ---------------------------------------------------- */
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

    /* ----------------------------------------------------
       5️⃣ EXAM CODE (UNCHANGED)
    ---------------------------------------------------- */
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

    // Eligibility is enforced at submit time (submitApplication /
    // markSubmittedAtSchool already refuse a null exam_code there). Throwing
    // here as well used to block an ordinary intermediate save the moment
    // caste, income or percentage hadn't been filled in yet - a school
    // filling the form in any other order than exactly that could never save
    // step 1 at all. This save just records whatever exam_code could be
    // computed (possibly null, same as the CM scheme above).

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

    // A draft gets its application_display_id only when it is first
    // submitted (submitApplication / markSubmittedAtSchool already do that),
    // the same as the student flow. Everything below this point only keeps
    // an ALREADY-ASSIGNED display ID in sync with a later class/exam-code
    // edit (e.g. a school correcting a RETURNED application) - it must never
    // run for a DRAFT, or a draft ends up with an ID before it is submitted.
    if (app.status !== "DRAFT" && isCmScheme) {
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

    if (app.status !== "DRAFT" && isNmmssScheme) {
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
    if (app.status !== "DRAFT" && (isCmScheme || isNmmssScheme)) {
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
      message: "School application answers saved successfully",
      exam_code: examCode,
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School save answers error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};



/**
 * SUBMIT APPLICATION (SCHOOL → BEO)
 * POST /school/applications/:application_id/submit
 *
 * NOTE:
 * - Student submits: STUDENT/DRAFT -> SCHOOL/SUBMITTED
 * - School forwards: SCHOOL/SUBMITTED -> BEO/SUBMITTED
 */
exports.submitApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id, is_active } = req.session;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Fetch application row for lock + exam metadata */
    const appRes = await client.query(
      `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.scholarship_id,
        sa.class,
        sa.exam_code,
        sa.created_by_school_user_id,
        sa.current_stage,
        sa.status,
        sa.is_locked,
        sa.student_user_id
      FROM scert_db.scholarship_applications sa
      JOIN scert_db.scholarships s
        ON s.scholarship_id = sa.scholarship_id
      WHERE sa.application_id = $1
        AND sa.session_id = $2
      FOR UPDATE OF sa
      `,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    let resolvedSchoolUserId = null;
    if (app.student_user_id) {
      const schoolRes = await client.query(
        `
        SELECT sc.user_id AS school_user_id
        FROM scert_db.student_profiles sp
        JOIN scert_db.school_profiles sc
          ON sc.udise_code = sp.udise_code
        WHERE sp.user_id = $1
        LIMIT 1
        `,
        [app.student_user_id]
      );
      resolvedSchoolUserId = schoolRes.rows[0]?.school_user_id ?? null;
    }

    if (
      Number(app.created_by_school_user_id) !== Number(schoolUserId) &&
      Number(resolvedSchoolUserId) !== Number(schoolUserId)
    ) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (
      app.current_stage !== "SCHOOL" ||
      !["SUBMITTED", "RETURNED"].includes(app.status)
    ) {
      throw new Error(
        `Application cannot be forwarded to BEO in current state. Status: ${app.status}, Stage: ${app.current_stage}`
      );
    }

    /* SR Number must still be unique at the moment of submission. Submits
       can skip the save step entirely — the school's bulk "submit selected
       drafts" posts straight here — so the save-time check alone is not
       enough. See services/srNumber.service.js. */
    await srNumber.assertStoredSrNumberUnique(client, { applicationId, audience: "school" });

    const scholarshipName = String(app.scholarship_name || "");
    const scholarshipNameLower = scholarshipName.toLowerCase();
    const isNmmssScheme =
      Number(app.scholarship_id) === 6 ||
      /\bnmmss\b/i.test(scholarshipName) ||
      /\bnmms\b/i.test(scholarshipName) ||
      /snss/i.test(scholarshipNameLower) ||
      /ssss/i.test(scholarshipNameLower);

    if (isNmmssScheme && !app.exam_code) {
      throw new Error(
        "Application is not eligible for this scholarship. Please check eligibility criteria."
      );
    }

    /* 2️⃣ Preschool validation (unchanged) */
    const preschoolCheck = await client.query(
      `
      SELECT
        f.field_id,
        f.field_label,
        aa.value_text
      FROM scert_db.scholarship_form_fields f
      LEFT JOIN scert_db.scholarship_application_answers aa
        ON aa.field_id = f.field_id
       AND aa.application_id = $1
      WHERE f.scholarship_id = (
        SELECT scholarship_id
        FROM scert_db.scholarship_applications
        WHERE application_id = $1
      )
        AND f.field_type = 'PRESCHOOL'
        AND f.is_required = true
      `,
      [applicationId]
    );

    for (const row of preschoolCheck.rows) {
      if (!row.value_text) {
        throw new Error(`Required field missing: ${row.field_label}`);
      }

      const udiseCode = extractUdiseCode(row.value_text);
      if (!udiseCode) {
        throw new Error(`Invalid preschool selected for field: ${row.field_label}`);
      }

      const exists = await client.query(
        `
        SELECT 1
        FROM (
          SELECT udise_code
          FROM scert_db.primary_schools_master
          WHERE is_active = true
          UNION
          SELECT udise_code
          FROM scert_db.school_profiles
        ) all_schools
        WHERE all_schools.udise_code = $1
        `,
        [udiseCode]
      );

      if (exists.rows.length === 0) {
        throw new Error(`Invalid preschool selected for field: ${row.field_label}`);
      }

      // Normalize stored value
      if (String(row.value_text).trim() !== udiseCode) {
        await client.query(
          `UPDATE scert_db.scholarship_application_answers
           SET value_text = $1, updated_at = CURRENT_TIMESTAMP
           WHERE application_id = $2 AND field_id = $3`,
          [udiseCode, applicationId, row.field_id]
        );
      }
    }

    const applicationDisplayId = await generateApplicationDisplayIdIfNeeded({
      client,
      app,
      sessionId: session_id,
    });

    /* 3️⃣ Forward → BEO */
    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET
        status = 'SUBMITTED',
        current_stage = 'BEO',
        submitted_at = CURRENT_TIMESTAMP,
        application_display_id = COALESCE(application_display_id, $4),
        created_by_school_user_id = COALESCE(created_by_school_user_id, $3),
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $1
        AND session_id = $2
      `,
      [applicationId, session_id, schoolUserId, applicationDisplayId]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application submitted to BEO successfully",
      current_stage: "BEO",
      status: "SUBMITTED",
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School submit error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

/**
 * MARK APPLICATION AS SUBMITTED AT SCHOOL (DRAFT → SCHOOL/PENDING bucket)
 * POST /school/applications/:application_id/mark-submitted
 */
exports.markSubmittedAtSchool = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id, is_active } = req.session;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const appRes = await client.query(
      `
      SELECT
        a.application_id,
        a.scholarship_id,
        s.scholarship_name,
        a.class,
        a.exam_code,
        a.application_display_id,
        a.created_by_school_user_id,
        a.submitted_by_role,
        a.current_stage,
        a.status,
        a.is_locked
      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      WHERE a.application_id = $1
        AND a.session_id = $2
      FOR UPDATE OF a
      `,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    if (app.created_by_school_user_id !== schoolUserId) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (String(app.submitted_by_role || "").toUpperCase() !== "SCHOOL") {
      throw new Error(
        "Only school-created applications can be marked submitted from draft"
      );
    }

    if (app.current_stage !== "SCHOOL" || app.status !== "DRAFT") {
      throw new Error(
        `Application cannot be marked submitted in current state. Status: ${app.status}, Stage: ${app.current_stage}`
      );
    }

    /* SR Number must still be unique at the moment of submission. Submits
       can skip the save step entirely — the school's bulk "submit selected
       drafts" posts straight here — so the save-time check alone is not
       enough. See services/srNumber.service.js. */
    await srNumber.assertStoredSrNumberUnique(client, { applicationId, audience: "school" });

    const scholarshipName = String(app.scholarship_name || "");
    const scholarshipNameLower = scholarshipName.toLowerCase();
    const isNmmssScheme =
      Number(app.scholarship_id) === 6 ||
      /\bnmmss\b/i.test(scholarshipName) ||
      /\bnmms\b/i.test(scholarshipName) ||
      /snss/i.test(scholarshipNameLower) ||
      /ssss/i.test(scholarshipNameLower);

    if (isNmmssScheme && !app.exam_code) {
      throw new Error(
        "Application is not eligible for this scholarship. Please verify eligibility criteria."
      );
    }

    /* ✅ Preschool validation for required PRESCHOOL fields */
    const preschoolCheck = await client.query(
      `
      SELECT
        f.field_id,
        f.field_label,
        aa.value_text
      FROM scert_db.scholarship_form_fields f
      LEFT JOIN scert_db.scholarship_application_answers aa
        ON aa.field_id = f.field_id
       AND aa.application_id = $1
      WHERE f.scholarship_id = (
        SELECT scholarship_id
        FROM scert_db.scholarship_applications
        WHERE application_id = $1
      )
        AND f.field_type = 'PRESCHOOL'
        AND f.is_required = true
      `,
      [applicationId]
    );

    for (const row of preschoolCheck.rows) {
      if (!row.value_text) {
        throw new Error(`Required field missing: ${row.field_label}`);
      }

      const udiseCode = extractUdiseCode(row.value_text);
      if (!udiseCode) {
        throw new Error(`Invalid preschool selected for field: ${row.field_label}`);
      }

      const exists = await client.query(
        `
        SELECT 1
        FROM (
          SELECT udise_code
          FROM scert_db.primary_schools_master
          WHERE is_active = true
          UNION
          SELECT udise_code
          FROM scert_db.school_profiles
        ) all_schools
        WHERE all_schools.udise_code = $1
        `,
        [udiseCode]
      );

      if (exists.rows.length === 0) {
        throw new Error(`Invalid preschool selected for field: ${row.field_label}`);
      }

      // Normalize stored value
      if (String(row.value_text).trim() !== udiseCode) {
        await client.query(
          `UPDATE scert_db.scholarship_application_answers
           SET value_text = $1, updated_at = CURRENT_TIMESTAMP
           WHERE application_id = $2 AND field_id = $3`,
          [udiseCode, applicationId, row.field_id]
        );
      }
    }

    const applicationDisplayId = await generateApplicationDisplayIdIfNeeded({
      client,
      app,
      sessionId: session_id,
    });

    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET
        status = 'SUBMITTED',
        current_stage = 'SCHOOL',
        application_display_id = COALESCE(application_display_id, $3),
        submitted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE application_id = $1
        AND session_id = $2
      `,
      [applicationId, session_id, applicationDisplayId]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application marked as submitted (pending at school)",
      current_stage: "SCHOOL",
      status: "SUBMITTED",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School mark-submitted error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};



/**
 * GET SCHOOL APPLICATION COUNTS FOR DASHBOARD CARDS
 * GET /school/applications/counts
 */
exports.getApplicationCounts = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const schoolUserId = req.user.user_id;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const params = [schoolUserId, session_id];
    let scholarshipFilterSql = "";
    if (scholarship_id) {
      params.push(String(scholarship_id));
      scholarshipFilterSql = ` AND sa.scholarship_id::text = $${params.length}`;
    }

    let classFilterSql = "";
    if (class_filter && (await classFilterAppliesTo(scholarship_id))) {
      params.push(String(class_filter));
      classFilterSql = ` AND sa.class::text = $${params.length}`;
    }

    const { rows } = await pool.query(
      `
      WITH visible_apps AS (
        SELECT
          sa.application_id,
          sa.status,
          sa.current_stage,
          sa.submitted_by_role
        FROM scert_db.scholarship_applications sa
        WHERE sa.session_id = $2
          ${scholarshipFilterSql}
          ${classFilterSql}
          AND (
            sa.created_by_school_user_id = $1
            OR EXISTS (
              SELECT 1
              FROM scert_db.student_profiles sp
              JOIN scert_db.school_profiles sc
                ON sc.udise_code = sp.udise_code
              WHERE sp.user_id = sa.student_user_id
                AND sc.user_id = $1
            )
          )
      )
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'DRAFT'
            AND submitted_by_role = 'SCHOOL'
        )::int AS drafts,
        COUNT(*) FILTER (
          WHERE status = 'SUBMITTED'
            AND current_stage = 'SCHOOL'
        )::int AS pending,
        COUNT(*) FILTER (
          WHERE status = 'RETURNED'
            AND current_stage = 'SCHOOL'
        )::int AS returned_by_beo,
        COUNT(*) FILTER (
          WHERE status = 'REJECTED'
            AND current_stage = 'SCHOOL'
        )::int AS rejected,
        -- Forwarded to BEO / SCERT and awaiting approval: the same set the
        -- school's Submitted Applications list shows.
        COUNT(*) FILTER (
          WHERE status = 'SUBMITTED'
            AND current_stage IN ('BEO', 'SCERT')
        )::int AS submitted
      FROM visible_apps
      `,
      params
    );

    // Live figures: a submitted/drafted/returned application must show the
    // moment the school comes back to the dashboard, not up to 20s later.
    res.setHeader("Cache-Control", "private, no-store");
    res.json(rows[0] || { drafts: 0, pending: 0, returned_by_beo: 0, rejected: 0, submitted: 0 });
  } catch (err) {
    console.error("Fetch school application counts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET SCHOOL DRAFT APPLICATIONS
 * GET /school/applications/drafts
 */
exports.getDraftApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const schoolUserId = req.user.user_id;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    let query = `SELECT
         sa.application_id,
        sa.application_display_id AS application_display_id,
         sa.scholarship_id,
         s.scholarship_name,
         sa.status,
         sa.current_stage,
         sa.submitted_by_role,
         sa.class,
         sa.created_at,
         sa.updated_at,
         sp.full_name as student_name
       FROM scert_db.scholarship_applications sa
       JOIN scert_db.scholarships s
         ON s.scholarship_id = sa.scholarship_id
       LEFT JOIN scert_db.student_profiles sp
         ON sa.student_user_id = sp.user_id
       WHERE sa.submitted_by_role = 'SCHOOL'
         AND sa.status = 'DRAFT'
         AND sa.created_by_school_user_id = $1
         AND sa.session_id = $2`;

    const params = [schoolUserId, session_id];

    if (scholarship_id) {
      params.push(scholarship_id);
      query += ` AND sa.scholarship_id = $${params.length}`;
    }

    if (class_filter && scholarship_id && (await classFilterAppliesTo(scholarship_id))) {
      params.push(String(class_filter));
      query += ` AND sa.class::text = $${params.length}`;
    }

    query += ` ORDER BY sa.updated_at DESC`;

    const { rows } = await pool.query(query, params);

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

    res.json(enrichedRows);
  } catch (err) {
    console.error("Fetch school drafts error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET SCHOOL SUBMITTED APPLICATIONS (forwarded to BEO)
 * GET /school/applications/submitted?scholarship_id=&class_filter=
 */
exports.getSubmittedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const schoolUserId = req.user.user_id;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    let query = `
      SELECT
        sa.application_id,
        sa.application_display_id AS application_display_id,
        sa.scholarship_id,
        s.scholarship_name,
        sa.status,
        sa.submitted_at,
        sa.current_stage,
        sa.app_serial_no,
        sa.roll_number,
        sa.exam_code,
        sa.center_id,
        sa.class,
        COALESCE(sc_student.school_name, sc_creator.school_name) AS origin_school,
        COALESCE(sc_student.udise_code, sc_creator.udise_code) AS udise_code,
        COALESCE(sc_student.block_code, sc_creator.block_code) AS block_code,
        COALESCE(sc_student.block_name, sc_creator.block_name) AS block_name,
        COALESCE(sc_student.district_code, sc_creator.district_code) AS district_code,
        COALESCE(sc_student.district_name, sc_creator.district_name) AS district_name,
        COALESCE(sc_student.school_type, sc_creator.school_type) AS school_type,
        COALESCE(sc_student.school_location, sc_creator.school_location) AS school_category,
        sp.full_name AS student_name,
        ec.center_order,
        ec.school_name AS center_name
      FROM scert_db.scholarship_applications sa
      JOIN scert_db.scholarships s
        ON s.scholarship_id = sa.scholarship_id
      LEFT JOIN scert_db.student_profiles sp
        ON sa.student_user_id = sp.user_id
      LEFT JOIN scert_db.school_profiles sc_student
        ON sp.udise_code = sc_student.udise_code
      LEFT JOIN scert_db.school_profiles sc_creator
        ON sc_creator.user_id = sa.created_by_school_user_id
      LEFT JOIN scert_db.exam_centers ec
        ON ec.center_id = sa.center_id
      WHERE (sa.created_by_school_user_id = $1 OR sc_student.user_id = $1)
        AND sa.session_id = $2
        AND sa.status = 'SUBMITTED'
        AND sa.current_stage IN ('BEO', 'SCERT')`;

    const params = [schoolUserId, session_id];

    if (scholarship_id) {
      params.push(scholarship_id);
      query += ` AND sa.scholarship_id = $${params.length}`;
    }

    if (class_filter) {
      const classFieldRes = await pool.query(
        `SELECT field_id FROM scert_db.scholarship_form_fields
         WHERE scholarship_id = $1 AND field_key = 'class' LIMIT 1`,
        [scholarship_id || (await pool.query(
          'SELECT scholarship_id FROM scert_db.scholarship_applications WHERE application_id = (SELECT application_id FROM scert_db.scholarship_applications WHERE (created_by_school_user_id = $1 OR student_user_id IN (SELECT user_id FROM scert_db.student_profiles WHERE udise_code IN (SELECT udise_code FROM scert_db.school_profiles WHERE user_id = $1))) AND session_id = $2 LIMIT 1)',
          [schoolUserId, session_id]
        )).rows[0]?.scholarship_id]
      );
      
      if (classFieldRes.rows.length > 0) {
        const classFieldId = classFieldRes.rows[0].field_id;
        params.push(classFieldId);
        params.push(class_filter);
        query += ` AND EXISTS (
          SELECT 1 FROM scert_db.scholarship_application_answers aa
          WHERE aa.application_id = sa.application_id
          AND aa.field_id = $${params.length - 1}
          AND (aa.value_text = $${params.length} OR aa.value_number::text = $${params.length})
        )`;
      }
    }

    query += ` ORDER BY sa.submitted_at DESC`;

    const { rows } = await pool.query(query, params);

    let enrichedRows = await enrichSchoolRowsWithAnswers(rows);
    if (class_filter) {
      enrichedRows = enrichedRows.filter((row) => {
        // NMMSS/SNSS/SSSS does not use class-based filtering in pending list.
        const scholarshipNameLower = String(row.scholarship_name || "").toLowerCase();
        const isNmmssScheme =
          Number(row.scholarship_id) === 6 ||
          /\bnmmss\b/i.test(scholarshipNameLower) ||
          /\bnmms\b/i.test(scholarshipNameLower) ||
          /snss/i.test(scholarshipNameLower) ||
          /ssss/i.test(scholarshipNameLower);
        if (isNmmssScheme) return true;
        return String(row.class ?? "") === String(class_filter);
      });
    }

    res.json(enrichedRows);

  } catch (err) {
    console.error("Fetch school submitted error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};




/**
 * GET PARTICULAR SCHOOL APPLICATION (VIEW / RESUME)
 * GET /school/applications/:application_id
 */
exports.getApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    /* 1️⃣ Fetch application + scholarship */
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
    sp.full_name as student_name,
    sp.gender,
    sp.age
  FROM scert_db.scholarship_applications sa
  JOIN scert_db.scholarships s
    ON s.scholarship_id = sa.scholarship_id
  LEFT JOIN scert_db.student_profiles sp
    ON sa.student_user_id = sp.user_id
  JOIN scert_db.school_profiles sc
    ON (sa.created_by_school_user_id = sc.user_id OR (sp.udise_code = sc.udise_code))
  WHERE sa.application_id = $1
    AND sc.user_id = $2
    AND sa.session_id = $3
  `,
      [applicationId, schoolUserId, session_id]
    );

    if (appRes.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }

    const application = appRes.rows[0];

    /* 2️⃣ Fetch form fields */
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

    /* 3️⃣ Fetch options (for dropdown / radio / checkbox) */
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
        if (!optionsByField[opt.field_id]) {
          optionsByField[opt.field_id] = [];
        }
        optionsByField[opt.field_id].push(opt);
      }
    }

    /* 4️⃣ Fetch saved answers */
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

    // Fallback: use applicant name from form answers if profile name is null
    if (!application.student_name) {
      const preferredKeyField = fields.find((f) =>
        STUDENT_NAME_FIELD_KEYS.includes(String(f.field_key || '').toLowerCase())
      );

      const labelField = fields.find((f) => isProbablyApplicantNameLabel(f.field_label));

      const bestField = preferredKeyField || labelField;

      if (bestField && answers[bestField.field_id]) {
        application.student_name = answers[bestField.field_id];
      }
    }

    /* 5️⃣ Build final form response */
    const form = fields.map((f) => ({
      ...f,
      options: ["DROPDOWN", "RADIO", "CHECKBOX"].includes(f.field_type)
        ? optionsByField[f.field_id] || []
        : [],
      value: answers[f.field_id] ?? null,
    }));

    /* 6️⃣ Fetch remarks */
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
        status: application.status,
        current_stage: application.current_stage,
        submitted_by_role: application.submitted_by_role,
        submitted_at: application.submitted_at,
        is_locked: application.is_locked,
        // Drives which documents NMMSS asks for when this application is
        // reopened for editing (see FE utils/nmmssDocumentRules.js).
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
    console.error("Get school application error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET SCHOOL RETURNED BY BEO APPLICATIONS
 * GET /school/applications/returned-by-beo
 */
exports.getReturnedByBeoApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const schoolUserId = req.user.user_id;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
         sa.application_id,
        sa.application_display_id AS application_display_id,
         sa.scholarship_id,
         s.scholarship_name,
         sa.status,
         sa.submitted_at,
         sa.current_stage,
         sp.full_name as student_name
       FROM scert_db.scholarship_applications sa
       JOIN scert_db.scholarships s
         ON s.scholarship_id = sa.scholarship_id
       LEFT JOIN scert_db.student_profiles sp
         ON sa.student_user_id = sp.user_id
       LEFT JOIN scert_db.school_profiles sc_student
         ON sp.udise_code = sc_student.udise_code
       WHERE (sa.created_by_school_user_id = $1 OR sc_student.user_id = $1)
         AND sa.session_id = $2
         AND sa.current_stage = 'SCHOOL'
         AND sa.status = 'RETURNED'
       ORDER BY sa.submitted_at DESC`,
      [schoolUserId, session_id]
    );

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

    res.json(enrichedRows);
  } catch (err) {
    console.error("Fetch school returned by BEO error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET SCHOOL PENDING APPLICATIONS (at SCHOOL stage)
 * GET /school/applications/pending
 *
 * Includes:
 * - student-submitted applications (submitted_by_role = 'STUDENT')
 * - school-created applications submitted by school (submitted_by_role = 'SCHOOL')
 */
exports.getPendingApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const schoolUserId = req.user.user_id;
  const { scholarship_id, class_filter } = req.query;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    let query = `SELECT
         sa.application_id,
        sa.application_display_id AS application_display_id,
         sa.scholarship_id,
         s.scholarship_name,
         sa.status,
         sa.submitted_at,
         sa.current_stage,
         sa.submitted_by_role,
         sa.app_serial_no,
         sa.roll_number,
         sa.exam_code,
         sa.center_id,
         sa.class,
         COALESCE(sc_student.school_name, sc_creator.school_name) AS origin_school,
         COALESCE(sc_student.udise_code, sc_creator.udise_code) AS udise_code,
         COALESCE(sc_student.block_code, sc_creator.block_code) AS block_code,
         COALESCE(sc_student.block_name, sc_creator.block_name) AS block_name,
         COALESCE(sc_student.district_code, sc_creator.district_code) AS district_code,
         COALESCE(sc_student.district_name, sc_creator.district_name) AS district_name,
         COALESCE(sc_student.school_type, sc_creator.school_type) AS school_type,
         COALESCE(sc_student.school_location, sc_creator.school_location) AS school_category,
         sp.full_name as student_name,
         ec.center_order,
         ec.school_name AS center_name
       FROM scert_db.scholarship_applications sa
       JOIN scert_db.scholarships s
         ON s.scholarship_id = sa.scholarship_id
       LEFT JOIN scert_db.student_profiles sp
         ON sa.student_user_id = sp.user_id
       LEFT JOIN scert_db.school_profiles sc_student
         ON sp.udise_code = sc_student.udise_code
       LEFT JOIN scert_db.school_profiles sc_creator
         ON sc_creator.user_id = sa.created_by_school_user_id
       LEFT JOIN scert_db.exam_centers ec
         ON ec.center_id = sa.center_id
       WHERE (sa.created_by_school_user_id = $1 OR sc_student.user_id = $1)
         AND sa.session_id = $2
         AND sa.current_stage = 'SCHOOL'
         AND sa.status = 'SUBMITTED'`;

    const params = [schoolUserId, session_id];

    if (scholarship_id) {
      params.push(scholarship_id);
      query += ` AND sa.scholarship_id = $${params.length}`;
    }

    if (class_filter) {
      // Get class field_id for the scholarship
      const classFieldRes = await pool.query(
        `SELECT field_id FROM scert_db.scholarship_form_fields
         WHERE scholarship_id = $1 AND field_key = 'class' LIMIT 1`,
        [scholarship_id || (await pool.query(
          'SELECT scholarship_id FROM scert_db.scholarship_applications WHERE application_id = (SELECT application_id FROM scert_db.scholarship_applications WHERE created_by_school_user_id = $1 AND session_id = $2 LIMIT 1)',
          [schoolUserId, session_id]
        )).rows[0]?.scholarship_id]
      );
      
      if (classFieldRes.rows.length > 0) {
        const classFieldId = classFieldRes.rows[0].field_id;
        params.push(classFieldId);
        params.push(class_filter);
        query += ` AND EXISTS (
          SELECT 1 FROM scert_db.scholarship_application_answers aa
          WHERE aa.application_id = sa.application_id
          AND aa.field_id = $${params.length - 1}
          AND (aa.value_text = $${params.length} OR aa.value_number::text = $${params.length})
        )`;
      }
    }

    query += ` ORDER BY sa.submitted_at DESC NULLS LAST, sa.updated_at DESC`;

    const { rows } = await pool.query(query, params);

    let enrichedRows = await enrichSchoolRowsWithAnswers(rows);
    if (class_filter) {
      enrichedRows = enrichedRows.filter((row) => {
        // NMMSS/SNSS/SSSS does not use class-based filtering in pending list.
        const scholarshipNameLower = String(row.scholarship_name || "").toLowerCase();
        const isNmmssScheme =
          Number(row.scholarship_id) === 6 ||
          /\bnmmss\b/i.test(scholarshipNameLower) ||
          /\bnmms\b/i.test(scholarshipNameLower) ||
          /snss/i.test(scholarshipNameLower) ||
          /ssss/i.test(scholarshipNameLower);
        if (isNmmssScheme) return true;
        return String(row.class ?? "") === String(class_filter);
      });
    }

    res.json(enrichedRows);
  } catch (err) {
    console.error("Fetch school pending applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * RETURN APPLICATION TO STUDENT (SCHOOL)
 * POST /school/applications/:application_id/return
 */
exports.returnToStudent = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;
  const { remark_text } = req.body;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!remark_text || remark_text.trim() === "") {
    return res.status(400).json({ message: "remark_text is required" });
  }

  if (!req.session.is_active) {
  return res.status(403).json({
    message: "Past session data is read-only",
  });
}

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch application
    const appRes = await client.query(
      `SELECT
         a.application_id,
        a.application_display_id AS application_display_id,
         a.student_user_id,
         a.status,
         a.current_stage,
         a.is_locked,
         a.submitted_by_role,
         sc_student.user_id AS school_user_id
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles sp
         ON a.student_user_id = sp.user_id
       LEFT JOIN scert_db.school_profiles sc_student
         ON sp.udise_code = sc_student.udise_code
       WHERE a.application_id = $1
         AND a.session_id = $2`,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    // 2️⃣ Validations
    if (!app.school_user_id || app.school_user_id !== schoolUserId) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (
      app.current_stage !== "SCHOOL" ||
      app.status !== "SUBMITTED"
    ) {
      throw new Error("Application cannot be returned at this stage");
    }

    if (app.submitted_by_role !== "STUDENT") {
      throw new Error("Only student-submitted applications can be returned");
    }

    // 3️⃣ Insert remark
    await client.query(
      `INSERT INTO scert_db.application_remarks
       (application_id, action, from_stage, to_stage, remark_text, created_by)
       VALUES ($1, 'RETURN', 'SCHOOL', 'STUDENT', $2, $3)
       `,
      [applicationId, remark_text.trim(), schoolUserId]
    );

    // 4️⃣ Update application
    await client.query(
      `UPDATE scert_db.scholarship_applications
       SET
         status = 'RETURNED',
         current_stage = 'STUDENT'
       WHERE application_id = $1
       AND session_id = $2`,
      [applicationId, session_id]
    );

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);

    res.json({
      message: "Application returned to student successfully",
      current_stage: "STUDENT",
      status: "RETURNED",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School return error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

/**
 * REJECT APPLICATION (SCHOOL)
 * POST /school/applications/:application_id/reject
 */
exports.rejectApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const applicationId = req.params.application_id;
  const { session_id } = req.session;
  const { remark_text } = req.body;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!req.session.is_active) {
    return res.status(403).json({
      message: "Past session data is read-only",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch application
    const appRes = await client.query(
      `SELECT
         a.application_id,
         a.scholarship_id,
         a.student_user_id,
         a.status,
         a.current_stage,
         a.is_locked,
         a.submitted_by_role,
         a.created_by_school_user_id,
         sc_student.user_id AS school_user_id
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles sp
         ON a.student_user_id = sp.user_id
       LEFT JOIN scert_db.school_profiles sc_student
         ON sp.udise_code = sc_student.udise_code
       WHERE a.application_id = $1
         AND a.session_id = $2
       FOR UPDATE OF a`,
      [applicationId, session_id]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    const app = appRes.rows[0];

    // 2️⃣ Validations
    if (app.school_user_id !== schoolUserId && app.created_by_school_user_id !== schoolUserId) {
      throw new Error("Unauthorized access");
    }

    if (app.is_locked) {
      throw new Error("Application is locked");
    }

    if (app.current_stage !== "SCHOOL" || !['DRAFT', 'SUBMITTED', 'RETURNED'].includes(app.status)) {
      throw new Error("Application cannot be rejected at this stage");
    }

    // 3️⃣ Insert remark
    await client.query(
      `INSERT INTO scert_db.application_remarks
       (application_id, action, from_stage, to_stage, remark_text, created_by)
       VALUES ($1, 'RETURN', 'SCHOOL', 'SCHOOL', $2, $3)
       `,
      [applicationId, remark_text ? remark_text.trim() : 'Application Rejected', schoolUserId]
    );

    // 4️⃣ Update application
    await client.query(
      `UPDATE scert_db.scholarship_applications
       SET
         status = 'REJECTED',
         current_stage = 'SCHOOL',
         is_locked = true,
         updated_at = CURRENT_TIMESTAMP
       WHERE application_id = $1
       AND session_id = $2`,
      [applicationId, session_id]
    );

    await client.query("COMMIT");

    // The SCERT progress tables are cached for 5 minutes; a rejection lowers
    // their totals, so drop them now rather than let SCERT see a stale count.
    await require("./scert.progressReport.controller").invalidateProgressReportCache({
      session_id,
      scholarship_id: app.scholarship_id,
    });

    res.json({
      message: "Application rejected successfully",
      current_stage: "SCHOOL",
      status: "REJECTED",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School reject error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};

/**
 * DELETE A DRAFT APPLICATION
 * DELETE /school/applications/:application_id/draft
 *
 * Permanently removes a draft the school itself created. It is deliberately
 * narrow - the application must be
 *   - one this school created (the same set the Draft Applications list
 *     shows: submitted_by_role SCHOOL, created_by_school_user_id = caller),
 *   - still a DRAFT at the school stage, and not locked,
 * so nothing that has been submitted, returned, rejected or approved, and
 * nothing a student started for themselves, can be deleted from here.
 *
 * The answers, remarks and attendance rows go with it (ON DELETE CASCADE);
 * the uploaded files are removed afterwards. Deleting a draft frees its SR
 * number for reuse and cannot affect roll numbers, which come from
 * app_serial_no and are only assigned at approval.
 */
exports.deleteDraftApplication = async (req, res) => {
  const roleId = req.user.role_id;
  const schoolUserId = req.user.user_id;
  const { session_id } = req.session;
  const applicationId = Number(req.params.application_id);

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!req.session.is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    return res.status(400).json({ message: "Invalid application id" });
  }

  const client = await pool.connect();
  let deleted = null;

  try {
    await client.query("BEGIN");

    // Lock the row so a concurrent submit cannot slip in between the check
    // and the delete.
    const appRes = await client.query(
      `SELECT application_id, application_display_id, scholarship_id, session_id,
              status, current_stage, is_locked, submitted_by_role,
              created_by_school_user_id
         FROM scert_db.scholarship_applications
        WHERE application_id = $1 AND session_id = $2
        FOR UPDATE`,
      [applicationId, session_id]
    );

    const app = appRes.rows[0];
    if (!app) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Application not found" });
    }

    if (
      String(app.created_by_school_user_id) !== String(schoolUserId) ||
      app.submitted_by_role !== "SCHOOL"
    ) {
      await client.query("ROLLBACK");
      return res
        .status(403)
        .json({ message: "You can only delete draft applications created by your school" });
    }

    if (app.status !== "DRAFT" || app.current_stage !== "SCHOOL" || app.is_locked) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Only draft applications can be deleted. This application has already moved on.",
      });
    }

    await client.query(
      `DELETE FROM scert_db.scholarship_applications
        WHERE application_id = $1 AND status = 'DRAFT'`,
      [applicationId]
    );

    await client.query("COMMIT");
    deleted = app;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("School delete draft error:", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }

  // After the commit, so a database failure can never cost a draft its files.
  const filesRemoved = await deleteApplicationFiles({
    sessionId: deleted.session_id,
    scholarshipId: deleted.scholarship_id,
    applicationId: deleted.application_id,
  });

  // A deletion cannot be undone, and there is no audit table, so leave a
  // line in the server log recording who deleted what.
  console.info("School draft application deleted", {
    application_id: deleted.application_id,
    application_display_id: deleted.application_display_id,
    scholarship_id: deleted.scholarship_id,
    session_id: deleted.session_id,
    school_user_id: schoolUserId,
    files_removed: filesRemoved,
  });

  return res.json({
    message: "Draft application deleted",
    application_id: deleted.application_id,
  });
};

exports.getRejectedApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const schoolUserId = req.user.user_id;

  if (roleId !== 2) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    let query = `SELECT
         sa.application_id,
         sa.application_display_id AS application_display_id,
         sa.scholarship_id,
         s.scholarship_name,
         sa.status,
         sa.submitted_at,
         sa.current_stage,
         sa.submitted_by_role,
         sa.app_serial_no,
         sa.roll_number,
         sa.exam_code,
         sa.center_id,
         sa.class,
         COALESCE(sc_student.school_name, sc_creator.school_name) AS origin_school,
         COALESCE(sc_student.udise_code, sc_creator.udise_code) AS udise_code,
         COALESCE(sc_student.block_code, sc_creator.block_code) AS block_code,
         COALESCE(sc_student.block_name, sc_creator.block_name) AS block_name,
         COALESCE(sc_student.district_code, sc_creator.district_code) AS district_code,
         COALESCE(sc_student.district_name, sc_creator.district_name) AS district_name,
         COALESCE(sc_student.school_type, sc_creator.school_type) AS school_type,
         COALESCE(sc_student.school_location, sc_creator.school_location) AS school_category,
         sp.full_name as student_name,
         sp.date_of_birth,
         sp.gender,
         ah.remark_text
       FROM scert_db.scholarship_applications sa
       JOIN scert_db.scholarships s
         ON s.scholarship_id = sa.scholarship_id
       LEFT JOIN scert_db.student_profiles sp
         ON sa.student_user_id = sp.user_id
       LEFT JOIN scert_db.school_profiles sc_student
         ON sp.udise_code = sc_student.udise_code
       LEFT JOIN scert_db.school_profiles sc_creator
         ON sc_creator.user_id = sa.created_by_school_user_id
       LEFT JOIN LATERAL (
         SELECT remark_text 
         FROM scert_db.application_remarks 
         WHERE application_id = sa.application_id AND action = 'RETURN'
         ORDER BY created_at DESC LIMIT 1
       ) ah ON true
       WHERE (sa.created_by_school_user_id = $1 OR sc_student.user_id = $1)
         AND sa.session_id = $2
         AND sa.status = 'REJECTED'
       ORDER BY sa.updated_at DESC;`;

    const { rows } = await pool.query(query, [schoolUserId, session_id]);

    const enrichedRows = await enrichSchoolRowsWithAnswers(rows);

    return res.status(200).json(enrichedRows);
  } catch (err) {
    console.error("Error in getRejectedApplications:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
