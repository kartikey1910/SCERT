const pool = require("../config/db");
const { resolveFileUrl } = require("../utils/fileUrl.util");

const formatTimeValue = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  let hours = Number(match[1]);
  const minutes = match[2];
  if (Number.isNaN(hours)) return raw;
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, "0")}:${minutes} ${meridiem}`;
};

const formatTimeRange = (startValue, endValue) => {
  const start = formatTimeValue(startValue);
  const end = formatTimeValue(endValue);
  if (start && end) return `${start} - ${end}`;
  return start || end || "Not Available";
};

exports.getAdmitCardData = async (applicationId, user, options = {}) => {
  const { skipAccessCheck = false } = options;
  const { role_id, user_id } = user;

  /* 1️⃣ Fetch application + scholarship */
  const appRes = await pool.query(
    `
    SELECT
  sa.application_id,
  sa.application_display_id,
  sa.roll_number,
  sa.status,
  sa.admit_card_generated_at,
  sa.student_user_id,
  sa.created_by_school_user_id,
  sa.exam_code,

  sch.exam_date,
  sch.mat_start_time,
  sch.mat_end_time,
  sch.sat_start_time,
  sch.sat_end_time,
  sch.exam_instructions,
  sch.scholarship_name,
  sess.session_name,

  sp.school_name,
  sp.udise_code,
  sp.address,
  sp.block_code,
  sp.district_code,
  sp.block_name,
  sp.district_name,
  center_sp.school_name as center_school_name,
  center_sp.address as center_school_address,
  ec.center_order,
  
  stp.full_name as student_full_name


    FROM scert_db.scholarship_applications sa
    JOIN scert_db.scholarships sch
      ON sch.scholarship_id = sa.scholarship_id
    JOIN scert_db.school_profiles sp
      ON sp.user_id = sa.created_by_school_user_id
    JOIN scert_db.academic_sessions sess
      ON sess.session_id = sa.session_id
    LEFT JOIN scert_db.exam_centers ec
      ON ec.center_id = sa.center_id
    LEFT JOIN scert_db.school_profiles center_sp
      ON center_sp.user_id = ec.school_user_id
    LEFT JOIN scert_db.student_profiles stp
      ON stp.user_id = sa.student_user_id
    WHERE sa.application_id = $1
    `,
    [applicationId]
  );

  if (appRes.rows.length === 0) {
    throw new Error("Application not found");
  }

  const app = appRes.rows[0];

  /* 2️⃣ Approval check */
  if (app.status !== "APPROVED") {
    console.log('Status check failed:', app.status);
    throw new Error(`Application status is ${app.status}, not APPROVED`);
  }
  
  if (!app.roll_number) {
    console.log('Roll number missing');
    throw new Error("Roll number not generated");
  }
  
  if (!app.admit_card_generated_at) {
    console.log('Admit card timestamp missing');
    throw new Error("Admit card not generated yet");
  }

  /* 3️⃣ Role-based access */
  if (!skipAccessCheck) {
    if (role_id === 1 && app.student_user_id !== user_id) {
      throw new Error("Forbidden");
    }

    if (role_id === 2 && app.created_by_school_user_id !== user_id) {
      throw new Error("Forbidden");
    }

    if (role_id === 3) {
      const beoRes = await pool.query(
        `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
        [user_id]
      );

      if (
        beoRes.rows.length === 0 ||
        beoRes.rows[0].block_code !== app.block_code
      ) {
        throw new Error("Forbidden");
      }
    }
  }
  
  // SCERT (role_id 5) can access all admit cards
  // No additional check needed for SCERT

  /* 4️⃣ Fetch all form fields for the application */
  const fieldsRes = await pool.query(
    `
    SELECT
  ff.field_key,
  ff.field_label,
  ff.field_type,
  COALESCE(
    aa.value_text,
    aa.value_date::TEXT,
    aa.value_number::TEXT,
    aa.value_file_path
  ) AS value
FROM scert_db.scholarship_application_answers aa

JOIN scert_db.scholarship_form_fields ff
  ON ff.field_id = aa.field_id

JOIN scert_db.scholarship_applications sa
  ON sa.application_id = aa.application_id

WHERE aa.application_id = $1
  AND ff.scholarship_id = sa.scholarship_id
  AND ff.is_active = true;

    `,
    [applicationId]
  );

  const form = {};
  for (const row of fieldsRes.rows) {
    form[row.field_key] = row.value;
  }

  const safeValue = (value, fallback = "—") => {
    return value !== undefined && value !== null && value !== ""
      ? value
      : fallback;
  };

  /* 5️⃣ Final admit card object */
  // Fallback: use student_name from form if student_full_name from profile is null
  const studentName = app.student_full_name || form.student_name || form.name || form.student_full_name;
  
const photoPath =
  form.candidate_photograph ||
  form.candidate_photo ||
  form.photo ||
  form.student_photo;
const signaturePath =
  form.signature_of_candidate ||
  form.candidate_signature ||
  form.signature;

const { resolveFileUrl, resolveFileDiskPath } = require("../utils/fileUrl.util");

const photoUrl =
  resolveFileUrl(photoPath) || "/static/placeholders/photo.png";

const photoDiskPath =
  resolveFileDiskPath(photoPath); // 👈 NEW
const signatureUrl =
  resolveFileUrl(signaturePath) || null;
const signatureDiskPath =
  resolveFileDiskPath(signaturePath);
  


  const scholarshipNameLower = String(app.scholarship_name || '').toLowerCase();
  const isNmmss = scholarshipNameLower.includes('nmmss') || scholarshipNameLower.includes('snss') || scholarshipNameLower.includes('ssss');

  // CM needs 6/9; NMMSS is always Class 8.
  const studentClass = isNmmss ? '8' : (form.class || form.student_class || form.current_class || null);

  // exam_code 1 = the student sits both NMMSS and SNSS/SSSS papers;
  // exam_code 2 = SNSS/SSSS only. CM applications don't carry this field.
  const eligibility = isNmmss
    ? (Number(app.exam_code) === 1 ? 'NMMSS/SNSS/SSSS' : 'SNSS/SSSS')
    : null;

  return {
    application_id: app.application_id,
    application_display_id: app.application_display_id,
    roll_number: app.roll_number,
    scholarship_name: app.scholarship_name,
    session_name: app.session_name,
    student_class: studentClass,
    eligibility,

    student: {
  name: safeValue(studentName),
  father_name: safeValue(form.father_name, "Not Provided"),
  date_of_birth: safeValue(form.date_of_birth, "Not Provided"),
  caste_category: safeValue(form.caste_category, "Not Provided"),
  sex: safeValue(form.sex, "Not Provided"),

  photo_url: photoUrl,          // UI
  photo_disk_path: photoDiskPath, // PDF
  signature_url: signatureUrl,
  signature_disk_path: signatureDiskPath
},

    school: {
      name: app.school_name,
      block: app.block_name || app.block_code,
      district: app.district_name || app.district_code,
    },

    exam: {
      date: app.exam_date,
      mat_time: formatTimeRange(app.mat_start_time, app.mat_end_time),
      sat_time: formatTimeRange(app.sat_start_time, app.sat_end_time),
      instructions: safeValue(app.exam_instructions, ""),
    },

    center: {
      name: app.center_school_name || app.school_name,
      address: app.center_school_address || app.address || `UDISE: ${app.udise_code}`,
    }
  };
};
