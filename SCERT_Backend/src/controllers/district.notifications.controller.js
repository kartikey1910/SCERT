const pool = require("../config/db");

/**
 * GET DISTRICT NOTIFICATIONS
 * GET /api/district/notifications
 */
exports.getNotifications = async (req, res) => {
  const roleId = req.user.role_id;

  if (roleId !== 4) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const result = await pool.query(
      `SELECT notification_id, title, message, pdf_url, created_at 
       FROM scert_db.notifications
       WHERE is_active = true 
         AND (target_role = 'DISTRICT' OR target_role = 'BOTH')
       ORDER BY created_at DESC`
    );

    res.json({ notifications: result.rows });
  } catch (err) {
    console.error("Get District notifications error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
