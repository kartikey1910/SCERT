const pool = require("../config/db");
const fsp = require("fs/promises");
const path = require("path");

/**
 * CREATE NOTIFICATION
 * POST /api/scert/notifications
 */
exports.createNotification = async (req, res) => {
  const roleId = req.user.role_id;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { target_role, title, message } = req.body;

  if (!target_role || !title || !message) {
    return res.status(400).json({ message: "target_role, title, and message are required" });
  }

  if (!['BEO', 'DISTRICT', 'BOTH'].includes(target_role)) {
    return res.status(400).json({ message: "Invalid target_role. Must be BEO, DISTRICT, or BOTH" });
  }

  try {
    let pdfUrl = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
      const fileName = `${Date.now()}_${safeName}`;
      const relativePath = path.join("notifications", fileName).replace(/\\/g, "/");
      const absolutePath = path.join(__dirname, "../../uploads", relativePath);

      await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
      await fsp.writeFile(absolutePath, req.file.buffer);
      
      pdfUrl = `/api/uploads/${relativePath}`;
    }

    const result = await pool.query(
      `INSERT INTO scert_db.notifications (target_role, title, message, pdf_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [target_role, title, message, pdfUrl]
    );

    res.status(201).json({
      message: "Notification created successfully",
      notification: result.rows[0],
    });
  } catch (err) {
    console.error("Create notification error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET ALL NOTIFICATIONS (SCERT View)
 * GET /api/scert/notifications
 */
exports.getNotifications = async (req, res) => {
  const roleId = req.user.role_id;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM scert_db.notifications
       ORDER BY created_at DESC`
    );

    res.json({ notifications: result.rows });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * DELETE (Soft-Delete) NOTIFICATION
 * DELETE /api/scert/notifications/:id
 */
exports.deleteNotification = async (req, res) => {
  const roleId = req.user.role_id;
  const { id } = req.params;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const result = await pool.query(
      `UPDATE scert_db.notifications
       SET is_active = false
       WHERE notification_id = $1
       RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Notification deleted successfully" });
  } catch (err) {
    console.error("Delete notification error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
