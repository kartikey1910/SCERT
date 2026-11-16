const { uploadApplicationFile } = require("../services/fileUpload.service");

/**
 * Upload file for application field
 * POST /applications/:application_id/upload-file
 */
exports.uploadFile = async (req, res) => {
  try {
    const applicationId = req.params.application_id;
    const { field_id } = req.body;
    const userId = req.user.user_id;
    const roleId = req.user.role_id;
    const { session_id } = req.session;

    // Validate field_id
    if (!field_id) {
      return res.status(400).json({ message: "field_id is required" });
    }

    // Validate file exists
    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }

    let bypassLock = false;
    if (roleId === 3 && session_id) {
      const pool = require("../config/db");
      const flRes = await pool.query(
        `SELECT is_locked FROM scert_db.session_feature_locks
         WHERE session_id = $1 AND feature_name = 'EDIT_APPROVED_APPLICATIONS'`,
        [session_id]
      );
      bypassLock = flRes.rows.length > 0 ? !flRes.rows[0].is_locked : false;
    }

    // Upload file
    const result = await uploadApplicationFile({
      applicationId: parseInt(applicationId),
      fieldId: parseInt(field_id),
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      userId,
      roleId,
      bypassLock,
    });

    res.json({
      message: "File uploaded successfully",
      ...result,
    });
  } catch (err) {
    console.error("File upload error:", err);
    res.status(400).json({ message: err.message });
  }
};
