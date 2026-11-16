const pool = require("../config/db");
const { resolveFileUrl } = require("../utils/fileUrl.util");

/**
 * GET NOMINAL ROLL CENTER-WISE
 * GET /scert/nominal-roll
 */
exports.getNominalRoll = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;

  const { scholarship_id, class_filter, center_id } = req.query;

  // 🔐 Role check
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({
      message: "scholarship_id is required",
    });
  }

  try {
    let conditions = [];
    let values = [];
    let idx = 1;

    // Base conditions
    conditions.push(`sa.session_id = $${idx++}`);
    values.push(session_id);

    conditions.push(`sa.scholarship_id = $${idx++}`);
    values.push(scholarship_id);

    conditions.push(`sa.status = 'APPROVED'`);

    // Note: class filter will be applied after fetching answers

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
        sa.exam_code,

        -- Attendance (from BEO absentee upload)
        att.mat_status,
        att.sat_status,

        -- Student info
        stp.full_name AS candidate_name,

        -- School resolution (student OR creator)
        COALESCE(sp_student.school_name, sp_creator.school_name) AS school_name,
        COALESCE(sp_student.udise_code, sp_creator.udise_code) AS udise_code,
        COALESCE(sp_student.block_code, sp_creator.block_code) AS block_code,
        COALESCE(sp_student.district_code, sp_creator.district_code) AS district_code,
        COALESCE(sp_student.block_name, sp_creator.block_name) AS block_name,
        COALESCE(sp_student.district_name, sp_creator.district_name) AS district_name,
        COALESCE(sp_student.school_type, sp_creator.school_type) AS school_type,
        COALESCE(sp_student.school_category, sp_creator.school_category) AS school_category,

        -- Center info
        ec.center_order,
        ec.school_name AS center_name,
        sa.exam_code

      FROM scert_db.scholarship_applications sa

      LEFT JOIN scert_db.student_profiles stp
        ON stp.user_id = sa.student_user_id

      LEFT JOIN scert_db.school_profiles sp_student
        ON stp.udise_code = sp_student.udise_code

      LEFT JOIN scert_db.school_profiles sp_creator
        ON sa.created_by_school_user_id = sp_creator.user_id

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
        CASE
          WHEN COALESCE(sp_student.block_code, sp_creator.block_code) ~ '^[0-9]+$'
            THEN COALESCE(sp_student.block_code, sp_creator.block_code)::int
          ELSE NULL
        END ASC NULLS LAST,
        COALESCE(sp_student.block_code, sp_creator.block_code) ASC,
        ec.center_order ASC NULLS LAST,
        CASE
          WHEN sa.roll_number ~ '^[0-9]+$' THEN sa.roll_number::bigint
          ELSE NULL
        END ASC NULLS LAST,
        sa.roll_number ASC NULLS LAST,
        sa.app_serial_no ASC NULLS LAST,
        sa.application_id ASC
    `;

    const { rows } = await pool.query(query, values);

    // Fetch form field mappings for this scholarship
    // IMPORTANT: include even inactive fields so older answers still resolve in exports.
    const fieldsRes = await pool.query(
      `SELECT field_id, field_key, field_label, field_type
       FROM scert_db.scholarship_form_fields
       WHERE scholarship_id = $1`,
      [scholarship_id]
    );

    const fieldMap = {};
    const fieldMetaById = {};
    fieldsRes.rows.forEach((f) => {
      // Normalize field_key: trim whitespace/newlines + lower-case
      const key = String(f.field_key || '').trim().toLowerCase();
      if (!key) return;
      // Keep first occurrence if duplicates exist
      if (!fieldMap[key]) fieldMap[key] = f.field_id;
      fieldMetaById[String(f.field_id)] = {
        key,
        label: String(f.field_label || '').trim().toLowerCase(),
        type: String(f.field_type || '').trim().toUpperCase(),
      };
    });

    const normalizeCheckboxLikeValue = (value) => {
      if (typeof value !== 'string') return value;
      const v = value.trim();

      // Some numeric fields are stored as NUMBER and come back like "9212223435.00".
      // For IDs / phone numbers we want the integer text.
      if (/^\d+\.0+$/.test(v)) {
        return v.replace(/\.0+$/, '');
      }

      // Some checkbox answers come back like: {"Option"}
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
      return normalizeCheckboxLikeValue(val);
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
    const appIds = rows.map((r) => r.application_id);
    const answersRes = appIds.length
      ? await pool.query(
          `SELECT application_id, field_id, value_text, value_number, value_date, value_file_path FROM scert_db.scholarship_application_answers WHERE application_id = ANY($1)`,
          [appIds]
        )
      : { rows: [] };

    // Group answers by application_id
    const answersByApp = {};
    answersRes.rows.forEach(ans => {
      if (!answersByApp[ans.application_id]) {
        answersByApp[ans.application_id] = {};
      }
      answersByApp[ans.application_id][ans.field_id] = ans.value_text ?? ans.value_number ?? ans.value_date ?? ans.value_file_path ?? null;
    });

    // Enrich rows with form data
    let enrichedRows = rows.map((row) => {
      const answers = answersByApp[row.application_id] || {};

      // If no candidate_name from student_profiles, use student_name from form answers
      const studentName =
        row.candidate_name ||
        getAnswer(answers, 'student_name') ||
        getAnswer(answers, 'candidate_name') ||
        getAnswer(answers, 'applicant_name') ||
        null;

      // Get photo from multiple possible field keys
      const photoPath =
        getAnswer(answers, 'candidate_photograph') ||
        getAnswer(answers, 'candidate_photo') ||
        getAnswer(answers, 'photo') ||
        getAnswer(answers, 'student_photo') ||
        getFilePathByPattern(answers, {
          include: ['photo', 'photograph', 'image'],
          exclude: ['signature', 'sign'],
        }) ||
        null;
      const signaturePath =
        getAnswer(answers, 'candidate_signature') ||
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
        date_of_birth: getAnswer(answers, 'date_of_birth') || getAnswer(answers, 'dob'),
        sex: getAnswer(answers, 'sex') || getAnswer(answers, 'gender'),
        caste_category: getAnswer(answers, 'caste_category') || getAnswer(answers, 'caste'),
        type_of_divyangta:
          getAnswer(answers, 'type_of_divyangta') ||
          getAnswer(answers, 'type_of_disability') ||
          null,
        aadhaar_number:
          getAnswer(answers, 'aadhaar_number') ||
          getAnswer(answers, 'aadhaar_no') ||
          getAnswer(answers, 'aadhar_no') ||
          null,
        contact_no: getAnswer(answers, 'mobile_number'),
        class: getAnswer(answers, 'class') || getAnswer(answers, 'class_level'),
        photo_url: photoPath ? resolveFileUrl(photoPath) : null,
        signature_url: signaturePath ? resolveFileUrl(signaturePath) : null,

        // Student registration number from form
        student_registration_number:
          getAnswer(answers, 'student_registration_number') ||
          getAnswer(answers, 'student_registration') ||
          null,

        // NMMSS-specific fields
        marks_class_7:
          getAnswer(answers, 'marks_class_7') ||
          getAnswer(answers, 'percentage_marks_class_7') ||
          getAnswer(answers, 'percentage_of_class_vii') ||
          null,
        parental_income_code:
          getAnswer(answers, 'parental_income_code') ||
          getAnswer(answers, 'income_code') ||
          getAnswer(answers, 'parental_annual_income') ||
          null,
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
      },
      applications: enrichedRows,
    });
  } catch (err) {
    console.error("SCERT nominal roll error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
