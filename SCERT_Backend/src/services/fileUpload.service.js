const pool = require("../config/db");
const path = require("path");
const { normalizeFile, MAX_FILE_SIZE } = require("../utils/fileProcessor");
const { promises: fsp } = require("fs");

async function ensureDir(dirPath) {
  try {
    await fsp.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code === 'EEXIST') return;
    const parts = dirPath.split(path.sep);
    for (let i = 1; i <= parts.length; i++) {
      const current = parts.slice(0, i).join(path.sep) || path.sep;
      if (!current || current === path.sep) continue;
      try {
        await fsp.mkdir(current);
      } catch (e) {
        if (e.code !== 'EEXIST' && e.code !== 'EISDIR') throw e;
      }
    }
  }
}

exports.uploadApplicationFile = async ({
  applicationId,
  fieldId,
  fileBuffer,
  fileName,
  mimeType,
  userId,
  roleId,
  bypassLock = false,
}) => {
  let app, field, storagePath;

  const client1 = await pool.connect();

  try {
    await client1.query("BEGIN");

    /* =========================
       1️⃣ Application validation
       ========================= */

    const appRes = await client1.query(
      `SELECT
         sa.application_id,
         sa.scholarship_id,
         sa.session_id,
         sa.student_user_id,
         sa.created_by_school_user_id,
         sa.current_stage,
         sa.status,
         sa.is_locked
       FROM scert_db.scholarship_applications sa
       WHERE sa.application_id = $1`,
      [applicationId]
    );

    if (appRes.rows.length === 0) {
      throw new Error("Application not found");
    }

    app = appRes.rows[0];

    const isApprovedBypass = bypassLock && app.status === 'APPROVED';

    if (!isApprovedBypass) {
      if (app.is_locked) {
        throw new Error("Application is locked");
      }

      if (!["DRAFT", "RETURNED", "SUBMITTED", "RETURNED_TO_BEO"].includes(app.status)) {
        throw new Error("Application not editable in current status");
      }
    }

    /* =========================
       2️⃣ Role-based access
       ========================= */

    if (roleId === 1) {
      if (app.student_user_id !== userId) {
        throw new Error("Unauthorized access");
      }

      if (app.current_stage !== "STUDENT" || !["DRAFT", "RETURNED"].includes(app.status)) {
        throw new Error("You have already filled this scholarship application.");
      }
    } else if (roleId === 2) {
      const schoolCheck = await client1.query(
        `SELECT sa.created_by_school_user_id, sc.user_id AS school_user_id
         FROM scert_db.scholarship_applications sa
         LEFT JOIN scert_db.student_profiles sp
           ON sa.student_user_id = sp.user_id
         LEFT JOIN scert_db.school_profiles sc
           ON sp.udise_code = sc.udise_code
         WHERE sa.application_id = $1`,
        [applicationId]
      );

      const schoolApp = schoolCheck.rows[0];

      if (
        schoolApp.created_by_school_user_id !== userId &&
        schoolApp.school_user_id !== userId
      ) {
        throw new Error("Unauthorized access");
      }

      if (app.current_stage !== "SCHOOL") {
        throw new Error("Application not editable at this stage");
      }
    } else if (roleId === 3) {
      const beoCheck = await client1.query(
        `SELECT bp.block_code, sp.block_code AS app_block_code
         FROM scert_db.beo_profiles bp
         CROSS JOIN scert_db.scholarship_applications sa
         JOIN scert_db.school_profiles sp
           ON sa.created_by_school_user_id = sp.user_id
         WHERE bp.user_id = $1
           AND sa.application_id = $2`,
        [userId, applicationId]
      );

      if (
        beoCheck.rows.length === 0 ||
        beoCheck.rows[0].block_code !== beoCheck.rows[0].app_block_code
      ) {
        throw new Error("Unauthorized access");
      }

      if (!isApprovedBypass && app.current_stage !== "BEO") {
        throw new Error("Application not editable at this stage");
      }
    } else {
      throw new Error("Unauthorized role");
    }

    /* =========================
       3️⃣ Field validation
       ========================= */

    const fieldRes = await client1.query(
      `SELECT ff.field_id, ff.field_key, ff.field_type
       FROM scert_db.scholarship_form_fields ff
       WHERE ff.field_id = $1
         AND ff.scholarship_id = $2
         AND ff.is_active = true`,
      [fieldId, app.scholarship_id]
    );

    if (fieldRes.rows.length === 0) {
      throw new Error("Invalid field_id for this scholarship");
    }

    field = fieldRes.rows[0];

    if (field.field_type !== "FILE") {
      throw new Error("Field is not a file upload field");
    }

    /* =========================
       4️⃣ Path generation
       ========================= */

    const fileExtension = fileName.split(".").pop();
    const timestamp = Date.now();

    storagePath = `${app.session_id}/${app.scholarship_id}/${applicationId}/${field.field_key}/${timestamp}.${fileExtension}`;

    await client1.query("COMMIT");
  } catch (err) {
    try { await client1.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally {
    client1.release();
  }

  const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads");
  const fullPath = path.join(uploadsDir, storagePath);
  const dirPath = path.dirname(fullPath);

  await ensureDir(dirPath);

  /* =========================
     5️⃣ Resize / Compress
     ========================= */

  const processedBuffer = await normalizeFile(fileBuffer, mimeType);

  if (processedBuffer.length > MAX_FILE_SIZE) {
    throw new Error("File size exceeds 2MB even after compression");
  }

  await fsp.writeFile(fullPath, processedBuffer);

  /* =========================
     6️⃣ Save DB record
     ========================= */

  const client2 = await pool.connect();

  try {
    await client2.query("BEGIN");

    await client2.query(
      `INSERT INTO scert_db.scholarship_application_answers
       (application_id, field_id, value_file_path)
       VALUES ($1, $2, $3)
       ON CONFLICT (application_id, field_id)
       DO UPDATE SET
         value_file_path = EXCLUDED.value_file_path,
         updated_at = CURRENT_TIMESTAMP`,
      [applicationId, fieldId, storagePath]
    );

    await client2.query("COMMIT");
  } catch (err) {
    try { await client2.query("ROLLBACK"); } catch (_) {}
    try { await fsp.unlink(fullPath); } catch (_) {}
    throw err;
  } finally {
    client2.release();
  }

  return {
    success: true,
    file_path: storagePath,
    field_key: field.field_key,
  };
};

/**
 * Removes every uploaded file belonging to one application.
 *
 * Uploads are written to <UPLOAD_DIR>/<session>/<scholarship>/<application>/
 * (see uploadApplicationFile), so an application's files are exactly the
 * contents of one directory. That directory is derived from the
 * application's own three ids and NEVER from the paths stored on its
 * answers: some existing answers point at a different application's
 * directory, and following a stored path here could delete another
 * student's documents.
 *
 * Best effort by design. This runs after the database delete has committed,
 * where a leftover file is harmless clutter but a thrown error would report
 * a delete that actually succeeded as failed.
 *
 * @returns {Promise<boolean>} true if the directory was removed or absent
 */
exports.deleteApplicationFiles = async ({ sessionId, scholarshipId, applicationId }) => {
  const ids = [sessionId, scholarshipId, applicationId].map((v) => Number(v));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return false;

  const uploadsDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads"));
  const target = path.resolve(uploadsDir, ...ids.map(String));

  // Belt and braces: three positive integers cannot contain "..", but the
  // guard costs nothing and this is a recursive delete.
  if (!target.startsWith(uploadsDir + path.sep)) return false;

  try {
    await fsp.rm(target, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error("deleteApplicationFiles failed:", target, err.message);
    return false;
  }
};
