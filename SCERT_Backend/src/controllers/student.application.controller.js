const srNumber = require("../services/srNumber.service");
const { assertValidNumberAnswer } = require("../utils/numberAnswer.util");
const pool = require("../config/db");
const extractUdiseCode = (value) => {
  const v = String(value || "").trim();
  if (!v) return null;
  const tagged = v.match(/udise\s*[:\-]?\s*([0-9]+)/i);
  if (tagged?.[1]) return tagged[1];
  if (/^[0-9]+$/.test(v)) return v;
  const digitRuns = v.match(/[0-9]{5,}/g);
  if (digitRuns?.length) {
    // Prefer the longest run (UDISE codes are typically long)
    return digitRuns.sort((a, b) => b.length - a.length)[0];
  }
  return null;
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
    // GENERAL/OBC/EWS:
    // >=55  -> code by income (1 if <=3.5L else 2)
    // >=50  -> code 2 (income not applicable)
    // <50   -> not eligible
    if (pct >= 55) {
      if (incomeUnderLimit === null) return null;
      return incomeUnderLimit ? 1 : 2;
    }
    if (pct >= 50) return 2;
    return null;
  }
  if (isScSt) {
    // SC/ST:
    // >=50  -> code by income (1 if <=3.5L else 2)
    // >=40  -> code 2 (income not applicable)
    // <40   -> not eligible
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
/**
 * INIT / GET APPLICATION
 * Used by Student and School (on behalf)
 */
exports.initApplication = async (req, res) => {
  const apiStart = process.hrtime.bigint();
  const scholarshipId = req.params.scholarship_id;
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id, is_active } = req.session;
  if (roleId !== 1) {
    return res.status(403).json({ message: "Unauthorized role" });
  }
  if (!is_active) {
    return res.status(403).json({ message: "Past session is read-only" });
  }
  try {
    /* ----------------------------------------------------
       1️⃣ VALIDATE SCHOLARSHIP (READ ONLY)
    ---------------------------------------------------- */
    const schQuery = `
      SELECT scholarship_id
      FROM scert_db.scholarships
      WHERE scholarship_id = $1
        AND session_id = $2
        AND status = 'ACTIVE'
    `;
    const schRes = await pool.query(schQuery, [scholarshipId, session_id]);
    if (schRes.rows.length === 0) {
      return res.status(404).json({ message: "Scholarship not found" });
    }
    /* ----------------------------------------------------
       2️⃣ CHECK EXISTING APPLICATION (READ ONLY)
    ---------------------------------------------------- */
    const existing = await pool.query(
      `
      SELECT application_id, status, current_stage
      FROM scert_db.scholarship_applications
      WHERE scholarship_id = $1
        AND student_user_id = $2
        AND session_id = $3
      `,
      [scholarshipId, userId, session_id]
    );
    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      const exStatus = String(ex.status || '').toUpperCase();
      const exStage = String(ex.current_stage || '').toUpperCase();
      const alreadySubmitted =
        exStatus === 'SUBMITTED' || ['SCHOOL', 'BEO', 'SCERT'].includes(exStage);
      return res.json({
        ...ex,
        message: alreadySubmitted
          ? "You have already filled this scholarship application."
          : "Application already exists",
      });
    }
    /* ----------------------------------------------------
       3️⃣ DERIVE BLOCK CODE (READ ONLY)
    ---------------------------------------------------- */
    const studentBlockRes = await pool.query(
      `
      SELECT sp.block_code
      FROM scert_db.student_profiles stp
      LEFT JOIN scert_db.school_profiles sp
        ON sp.udise_code = stp.udise_code
      WHERE stp.user_id = $1
      LIMIT 1
      `,
      [userId]
    );
    const blockCode = studentBlockRes.rows[0]?.block_code || null;
    /* ----------------------------------------------------
       4️⃣ INSERT APPLICATION (SHORT TRANSACTION)
    ---------------------------------------------------- */
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '30s'`);
      const insert = await client.query(
        `
        INSERT INTO scert_db.scholarship_applications
        (
          scholarship_id,
          session_id,
          student_user_id,
          submitted_by_role,
          current_stage,
          status,
          exam_code,
          block_code
        )
        VALUES ($1, $2, $3, 'STUDENT', 'STUDENT', 'DRAFT', NULL, $4)
        ON CONFLICT ON CONSTRAINT uq_one_app_per_student
        DO NOTHING
        RETURNING application_id, status, current_stage
        `,
        [scholarshipId, session_id, userId, blockCode]
      );
      await client.query("COMMIT");
      if (insert.rows.length === 0) {
        const existingAfterConflict = await pool.query(
          `
          SELECT application_id, status, current_stage
          FROM scert_db.scholarship_applications
          WHERE scholarship_id = $1
            AND student_user_id = $2
            AND session_id = $3
          LIMIT 1
          `,
          [scholarshipId, userId, session_id]
        );
        if (existingAfterConflict.rows.length > 0) {
          return res.json({
            ...existingAfterConflict.rows[0],
            message: "Application already exists",
          });
        }
        const existingAnySession = await pool.query(
          `
          SELECT application_id, status, current_stage, session_id
          FROM scert_db.scholarship_applications
          WHERE scholarship_id = $1
            AND student_user_id = $2
          ORDER BY application_id DESC
          LIMIT 1
          `,
          [scholarshipId, userId]
        );
        if (existingAnySession.rows.length > 0) {
          return res.json({
            application_id: existingAnySession.rows[0].application_id,
            status: existingAnySession.rows[0].status,
            current_stage: existingAnySession.rows[0].current_stage,
            message: "Application already exists",
          });
        }
      }
      return res.status(201).json({
        ...insert.rows[0],
        message: "Application initialized",
      });
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Init student application error:", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    const apiEnd = process.hrtime.bigint();
    console.log(
      `[PERF] student.initApplication | ${Number(apiEnd - apiStart) / 1e6} ms`
    );
  }
};
/**
 * SAVE / UPDATE APPLICATION ANSWERS
 * PUT /applications/:application_id/answers
 */
exports.saveAnswers = async (req, res) => {
  const apiStart = process.hrtime.bigint();
  const applicationId = req.params.application_id;
  const { answers } = req.body;
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id, is_active } = req.session;
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ message: "answers array is required" });
  }
  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }
  try {
    const requestedFieldIds = Array.from(
      new Set(
        (answers || [])
          .map((ans) => Number(ans?.field_id))
          .filter((value) => Number.isFinite(value))
      )
    );
    /* ----------------------------------------------------
       1️⃣ FETCH APPLICATION (READ ONLY)
    ---------------------------------------------------- */
    const appRes = await pool.query(
      `
      SELECT
        application_id,
        scholarship_id,
        student_user_id,
        created_by_school_user_id,
        current_stage,
        status,
        is_locked
      FROM scert_db.scholarship_applications
      WHERE application_id = $1
        AND session_id = $2
      `,
      [applicationId, session_id]
    );
    if (appRes.rows.length === 0) {
      return res.status(404).json({ message: "Application not found" });
    }
    const app = appRes.rows[0];
    if (app.is_locked) {
      return res.status(403).json({ message: "Application is locked" });
    }
    if (!["DRAFT", "RETURNED"].includes(app.status)) {
      return res.status(400).json({
        message: "You have already filled this scholarship application.",
      });
    }
    if (roleId === 1) {
      if (app.student_user_id !== userId) {
        return res.status(403).json({ message: "Unauthorized access" });
      }
      if (app.current_stage !== "STUDENT") {
        return res.status(400).json({
          message: "You have already filled this scholarship application.",
        });
      }
    } else {
      return res.status(403).json({ message: "Unauthorized role" });
    }
    /* ----------------------------------------------------
       2️⃣ FETCH FIELD METADATA ONCE
    ---------------------------------------------------- */
    const fieldMetaRes = await pool.query(
      `
      SELECT field_id, field_type, field_key
      FROM scert_db.scholarship_form_fields
      WHERE scholarship_id = $1
        AND field_id = ANY($2::bigint[])
      `,
      [app.scholarship_id, requestedFieldIds]
    );
    const fieldMap = new Map();
    fieldMetaRes.rows.forEach(f => fieldMap.set(f.field_id, f));
    /* ----------------------------------------------------
       3️⃣ WRITE PHASE (TRANSACTION)
    ---------------------------------------------------- */
    // 🔥 NEW: capture class ONLY for scholarship 3
    let selectedClass = null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '30s'`);
      const lockedAppRes = await client.query(
        `
        SELECT
          a.application_id,
          a.scholarship_id,
          s.scholarship_name,
          a.class,
          a.exam_code,
          a.application_display_id
        FROM scert_db.scholarship_applications a
        JOIN scert_db.scholarships s
          ON s.scholarship_id = a.scholarship_id
        WHERE a.application_id = $1
          AND a.session_id = $2
        FOR UPDATE OF a
        `,
        [applicationId, session_id]
      );
      if (lockedAppRes.rows.length === 0) {
        throw new Error("Application not found");
      }
      const lockedApp = lockedAppRes.rows[0];
      const scholarshipName = String(lockedApp.scholarship_name || "");
      const scholarshipNameLower = scholarshipName.toLowerCase();
      const isCmScheme =
        Number(lockedApp.scholarship_id) === 3 ||
        /\bcm\b/i.test(scholarshipName) ||
        /chief\s*minister/i.test(scholarshipName);
      const isNmmssScheme =
        Number(lockedApp.scholarship_id) === 6 ||
        /\bnmmss\b/i.test(scholarshipName) ||
        /\bnmms\b/i.test(scholarshipName) ||
        /snss/i.test(scholarshipNameLower) ||
        /ssss/i.test(scholarshipNameLower);
      const previousClass = lockedApp.class;
      const previousExamCode = lockedApp.exam_code;
      const previousDisplayId = lockedApp.application_display_id;

      /* SR Number uniqueness — one SR per school, per scholarship, per session.
         Rules and scope live in services/srNumber.service.js. */
      const srAnswer = srNumber.findSrAnswer(answers, fieldMap);
      if (srAnswer) {
        await srNumber.assertSrNumberAvailable(client, {
          applicationId: applicationId,
          value: srAnswer.value,
          fieldType: srAnswer.fieldType,
          audience: "student",
          onlyIfChanged: true,
        });
      }

      const changedFieldKeys = new Set();
      const answerRows = [];
      for (const ans of answers) {
        const field = fieldMap.get(ans.field_id);
        if (!field) {
          throw new Error(`Invalid field_id ${ans.field_id}`);
        }
        const { field_type, field_key } = field;
        const normalizedFieldKey = String(field_key || "").trim().toLowerCase();
        changedFieldKeys.add(normalizedFieldKey);
        // ✅ Capture class ONLY for scholarship_id = 3
        if (isCmScheme && ["class", "class_level"].includes(normalizedFieldKey)) {
          const parsedClass = Number(ans.value);
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
            assertValidNumberAnswer(field, ans.value);
            valueNumber = ans.value;
            break;
          case "DATE":
            valueDate = ans.value;
            break;
          case "FILE":
            valueFile = ans.value;
            break;
          default:
            valueText = Array.isArray(ans.value) ? JSON.stringify(ans.value) : ans.value;
        }
        answerRows.push({
          application_id: Number(applicationId),
          field_id: Number(ans.field_id),
          value_text: valueText,
          value_number: valueNumber,
          value_date: valueDate,
          value_file_path: valueFile,
        });
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
            $4::bigint[],
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
      const eligibilitySensitiveKeys = new Set([
        "caste_category",
        "parental_annual_income",
        "percentage_of_class_vii",
      ]);
      const shouldRecalculateExamCode =
        isNmmssScheme &&
        (
          previousExamCode === null ||
          Array.from(changedFieldKeys).some((key) => eligibilitySensitiveKeys.has(key))
        );
      let examCode = previousExamCode;
      if (shouldRecalculateExamCode) {
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
        examCode = calculateExamCodeIfApplicable({
          scholarship_id: 6,
          caste_category: eligibilityRes.rows[0].caste_category,
          parental_annual_income: eligibilityRes.rows[0].parental_annual_income,
          percentage: eligibilityRes.rows[0].percentage,
        });
        if (!examCode) {
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
      }
      const newClass = selectedClass !== null ? selectedClass : previousClass;
      const newExamCode = examCode;
      let shouldClearDisplayId = false;
      if (isCmScheme) {
        const prevClassNum =
          previousClass === null || previousClass === undefined
            ? null
            : Number(previousClass);
        const newClassNum =
          newClass === null || newClass === undefined ? null : Number(newClass);
        if (prevClassNum !== newClassNum) {
          shouldClearDisplayId = true;
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
          shouldClearDisplayId = true;
        }
      }
      if (shouldClearDisplayId && previousDisplayId) {
        await client.query(
          `
          UPDATE scert_db.scholarship_applications
          SET application_display_id = NULL
          WHERE application_id = $1
          `,
          [applicationId]
        );
      }
      await client.query("COMMIT");
      return res.json({
        message: "Application answers saved successfully",
        exam_code: examCode,
      });
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Student save answers error:", err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      message: status >= 500 ? "Internal server error" : err.message,
    });
  } finally {
    const apiEnd = process.hrtime.bigint();
    console.log(
      `[PERF] student.saveAnswers | ${Number(apiEnd - apiStart) / 1e6} ms`
    );
  }
};
/**
 * SUBMIT APPLICATION
 * POST /applications/:application_id/submit
 */
exports.submitApplication = async (req, res) => {
  const applicationId = req.params.application_id;
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id, is_active } = req.session;
  // 🧑‍🎓 ONLY STUDENT
  if (roleId !== 1) {
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
    /* 1️⃣ Fetch application */
    const appRes = await client.query(
      `
      SELECT
        a.application_id,
        a.scholarship_id,
        s.scholarship_name,
        a.class,
        a.exam_code,
        a.application_display_id,
        a.student_user_id,
        a.status,
        a.current_stage,
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
      const err = new Error("Application not found"); err.statusCode = 404; throw err;
    }
    const app = appRes.rows[0];
    /* 2️⃣ Validations */
    if (app.is_locked) {
      const err = new Error("Application is locked"); err.statusCode = 403; throw err;
    }
    if (app.student_user_id !== userId) {
      const err = new Error("Unauthorized access"); err.statusCode = 403; throw err;
    }
    if (
      app.current_stage !== "STUDENT" ||
      !["DRAFT", "RETURNED"].includes(app.status)
    ) {
      const err = new Error("You have already filled this scholarship application."); err.statusCode = 400; throw err;
    }

    /* SR Number must still be unique at the moment of submission. Submits
       can skip the save step entirely — the school's bulk "submit selected
       drafts" posts straight here — so the save-time check alone is not
       enough. See services/srNumber.service.js. */
    await srNumber.assertStoredSrNumberUnique(client, { applicationId, audience: "student" });
    const scholarshipName = String(app.scholarship_name || "");
    const scholarshipNameLower = scholarshipName.toLowerCase();
    const isNmmssScheme =
      Number(app.scholarship_id) === 6 ||
      /\bnmmss\b/i.test(scholarshipName) ||
      /\bnmms\b/i.test(scholarshipName) ||
      /snss/i.test(scholarshipNameLower) ||
      /ssss/i.test(scholarshipNameLower);
    if (isNmmssScheme && !app.exam_code) {
      const err = new Error("You are not eligible for this scholarship based on the entered details. Please review eligibility criteria."); err.statusCode = 400; throw err;
    }
    /* 3️⃣ Validate required preschool fields */
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
        const err = new Error(`Required field missing: ${row.field_label}`);
        err.statusCode = 400;
        throw err;
      }
      const udiseCode = extractUdiseCode(row.value_text);
      if (!udiseCode) {
        const err = new Error(`Invalid preschool selected for field: ${row.field_label}`);
        err.statusCode = 400;
        throw err;
      }
      const schoolExists = await client.query(
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
      if (schoolExists.rows.length === 0) {
        const err = new Error(`Invalid preschool selected for field: ${row.field_label}`);
        err.statusCode = 400;
        throw err;
      }
      // Normalize saved value so other modules (school verification, exports, etc.) work reliably.
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
    /* 4️⃣ Submit → SCHOOL */
    await client.query(
      `
      UPDATE scert_db.scholarship_applications
      SET
        status = 'SUBMITTED',
        current_stage = 'SCHOOL',
        submitted_by_role = 'STUDENT',
        application_display_id = COALESCE(application_display_id, $3),
        submitted_at = CURRENT_TIMESTAMP
      WHERE application_id = $1
        AND session_id = $2
      `,
      [applicationId, session_id, applicationDisplayId]
    );
    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applicationId);
    res.json({
      message: "Application submitted successfully",
      current_stage: "SCHOOL",
      status: "SUBMITTED",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Student submit application error:", err);
    const statusCode = err.statusCode || 500;
    const message = err.statusCode ? err.message : "Internal server error";
    res.status(statusCode).json({ message });
  } finally {
    client.release();
  }
};
/**
 * GET MY APPLICATIONS (STUDENT)
 * GET /student/applications
 */
exports.getMyApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id } = req.session;
  if (roleId !== 1) {
    return res.status(403).json({ message: "Unauthorized role" });
  }
  const client = await pool.connect();
  try {
    const appsRes = await client.query(
      `
      SELECT
        a.application_id,
        a.application_display_id AS application_display_id,
        a.scholarship_id,
        a.status,
        a.current_stage,
        a.created_at,
        a.submitted_at,
        a.is_locked,
        a.exam_code,
        stp.full_name AS student_name,
        s.scholarship_name,
        s.scholarship_details,
        s.eligibility,
        s.last_date
      FROM scert_db.scholarship_applications a
      JOIN scert_db.scholarships s
        ON s.scholarship_id = a.scholarship_id
      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = a.student_user_id
      WHERE a.student_user_id = $1
        AND a.session_id = $2
      ORDER BY a.application_id DESC
      `,
      [userId, session_id]
    );
    if (appsRes.rows.length === 0) {
      return res.json([]);
    }
    const applicationIds = appsRes.rows.map((row) => row.application_id);
    const answersRes = await client.query(
      `
      SELECT
        aa.application_id,
        aa.field_id,
        f.field_label AS label,
        f.field_key,
        f.field_type,
        f.sort_order,
        aa.value_text,
        aa.value_number,
        aa.value_date,
        aa.value_file_path,
        ps.school_name AS preschool_name,
        ps.district_name AS preschool_district,
        ps.block_name AS preschool_block
      FROM scert_db.scholarship_application_answers aa
      JOIN scert_db.scholarship_form_fields f
        ON aa.field_id = f.field_id
      LEFT JOIN scert_db.primary_schools_master ps
        ON f.field_type = 'PRESCHOOL'
       AND ps.udise_code = aa.value_text
      WHERE aa.application_id = ANY($1::bigint[])
      ORDER BY aa.application_id DESC, f.sort_order ASC, aa.field_id ASC
      `,
      [applicationIds]
    );
    const answersByApplicationId = {};
    answersRes.rows.forEach((row) => {
      if (!answersByApplicationId[row.application_id]) {
        answersByApplicationId[row.application_id] = [];
      }
      answersByApplicationId[row.application_id].push(row);
    });
    const payload = appsRes.rows
      .map((row) => {
        const answers = answersByApplicationId[row.application_id] || [];
        const isDraft = String(row.status || "").toUpperCase() === "DRAFT";
        if (isDraft && answers.length === 0) {
          return null;
        }
        return {
          scholarship: {
            scholarship_id: row.scholarship_id,
            scholarship_name: row.scholarship_name,
            scholarship_details: row.scholarship_details,
            eligibility: row.eligibility,
            last_date: row.last_date,
          },
          application: {
            application_id: row.application_id,
            application_display_id: row.application_display_id,
            scholarship_id: row.scholarship_id,
            status: row.status,
            current_stage: row.current_stage,
            created_at: row.created_at,
            submitted_at: row.submitted_at,
            is_locked: row.is_locked,
            exam_code: row.exam_code,
            student_name: row.student_name,
          },
          answers,
        };
      })
      .filter(Boolean);
    res.json(payload);
  } catch (err) {
    console.error("Get my applications error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};
/**
 * GET MY APPLICATION (STUDENT)
 * GET /applications/:scholarship_id/my
 */
exports.getMyApplication = async (req, res) => {
  const scholarshipId = req.params.scholarship_id;
  const roleId = req.user.role_id;
  const userId = req.user.user_id;
  const { session_id } = req.session;
  // 🧑‍🎓 Only Student
  if (roleId !== 1) {
    return res.status(403).json({ message: "Unauthorized role" });
  }
  const client = await pool.connect();
  try {
    // 1️⃣ Fetch application
    const appRes = await client.query(
      `SELECT
         a.application_id,
        a.application_display_id AS application_display_id,
         a.status,
         a.current_stage,
         a.created_at,
         a.is_locked,
         a.exam_code,
         stp.full_name AS student_name
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.student_profiles stp
         ON stp.user_id = a.student_user_id
       WHERE a.scholarship_id = $1
         AND a.student_user_id = $2
         AND a.session_id = $3`,
      [scholarshipId, userId, session_id]
    );
    if (appRes.rows.length === 0) {
      return res.status(404).json({
        message: "Application not found",
      });
    }
    const application = appRes.rows[0];
    // 2️⃣ Fetch answers
const ansRes = await client.query(
  `
  SELECT
    aa.field_id,
    f.field_label AS label,
    f.field_key,
    f.field_type,
    aa.value_text,
    aa.value_number,
    aa.value_date,
    aa.value_file_path,
    -- preschool enrichment
    ps.school_name AS preschool_name,
    ps.district_name AS preschool_district,
    ps.block_name AS preschool_block
  FROM scert_db.scholarship_application_answers aa
  JOIN scert_db.scholarship_form_fields f
    ON aa.field_id = f.field_id
  LEFT JOIN scert_db.primary_schools_master ps
    ON f.field_type = 'PRESCHOOL'
   AND ps.udise_code = aa.value_text
  WHERE aa.application_id = $1
  `,
  [application.application_id]
);
    const hasSavedAnswers = Array.isArray(ansRes.rows) && ansRes.rows.length > 0;
    const isDraft = String(application.status || '').toUpperCase() === 'DRAFT';
    // Empty draft created by init() should not appear in "My Applications"
    // until student explicitly saves at least one answer.
    if (isDraft && !hasSavedAnswers) {
      return res.status(404).json({
        message: "Application not found",
      });
    }
    res.json({
      application,
      answers: ansRes.rows,
    });
  } catch (err) {
    console.error("Get my application error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};