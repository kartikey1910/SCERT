const pool = require("../config/db");

const SESSION_CACHE_TTL_MS = 60 * 1000;
let sessionsCache = null;

/**
 * GET ALL ACADEMIC SESSIONS
 * GET /scert/sessions
 */
exports.getAllSessions = async (req, res) => {
  try {
    const now = Date.now();

    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Vary", "Authorization");

    if (sessionsCache && sessionsCache.expiresAt > now) {
      return res.json(sessionsCache.data);
    }

    const result = await pool.query(
      `SELECT session_id, session_name, is_active, created_at
       FROM scert_db.academic_sessions
       ORDER BY session_id DESC`
    );

    sessionsCache = {
      data: result.rows,
      expiresAt: now + SESSION_CACHE_TTL_MS,
    };

    return res.json(result.rows);
  } catch (err) {
    console.error("Get sessions error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
