const pool = require("../config/db");

const { createClient } = require("redis");
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const sessionCacheClient = createClient({ url: redisUrl });
sessionCacheClient.on("error", (err) =>
  console.error("resolveSessionContext redis error:", err));
sessionCacheClient.connect().catch((err) =>
  console.error("resolveSessionContext redis connect error:", err));
const SESSION_CACHE_KEY = "active_academic_session";
const SESSION_CACHE_TTL = 60;

/**
 * Resolves academic session for every request
 * Attaches: req.session = { session_id, session_name, is_active }
 */
module.exports = async function resolveSessionContext(req, res, next) {
  try {
    const { role_id } = req.user || {};

    let sessionId = null;

    // Officers (and School, for now) can switch session via header
    if ([2, 3, 4, 5].includes(role_id)) {
      const rawSessionId = String(req.headers["x-session-id"] || "").trim();
      // Guard against invalid header values like "undefined", "null", or non-numeric text.
      if (/^\d+$/.test(rawSessionId)) {
        sessionId = Number(rawSessionId);
      } else {
        sessionId = null;
      }
    }

    if (sessionId) {
      // PATH A - Explicit session — try Redis cache first, then DB
      const cacheKey = `session:${sessionId}`;
      let sessionData = null;

      try {
        const cached = await sessionCacheClient.get(cacheKey);
        if (cached) {
          sessionData = JSON.parse(cached);
        }
      } catch (redisErr) {
        // Redis down — fall through to DB
      }

      if (!sessionData) {
        const result = await pool.query(`
          SELECT session_id, session_name, is_active
          FROM scert_db.academic_sessions
          WHERE session_id = $1
        `, [sessionId]);

        if (result.rowCount === 0) {
          return res.status(400).json({
            message: "Invalid or missing academic session"
          });
        }

        sessionData = {
          session_id: result.rows[0].session_id,
          session_name: result.rows[0].session_name,
          is_active: result.rows[0].is_active,
        };

        try {
          await sessionCacheClient.setEx(cacheKey, SESSION_CACHE_TTL, JSON.stringify(sessionData));
        } catch (redisErr) {
          // Redis down — continue without caching
        }
      }

      req.session = sessionData;
      return next();
    }

    // PATH B — default active session, Redis cache
    let session = null;

    // Try Redis first — shared across all workers
    try {
      const cached = await sessionCacheClient.get(SESSION_CACHE_KEY);
      if (cached) {
        session = JSON.parse(cached);
      }
    } catch (redisErr) {
      // Redis down — fall through to DB silently
      console.error("resolveSessionContext redis get error:", redisErr.message);
    }

    if (!session) {
      const result = await pool.query(
        `SELECT session_id, session_name, is_active
         FROM scert_db.academic_sessions
         WHERE is_active = true
         LIMIT 1`
      );

      if (result.rowCount === 0) {
        return res.status(400).json({
          message: "Invalid or missing academic session",
        });
      }

      session = {
        session_id: result.rows[0].session_id,
        session_name: result.rows[0].session_name,
        is_active: result.rows[0].is_active,
      };

      try {
        await sessionCacheClient.setEx(
          SESSION_CACHE_KEY,
          SESSION_CACHE_TTL,
          JSON.stringify(session)
        );
      } catch (redisErr) {
        console.error("resolveSessionContext redis set error:", redisErr.message);
      }
    }

    req.session = session;
    next();
  } catch (error) {
    console.error("resolveSessionContext error:", error);
    return res.status(500).json({
      message: "Failed to resolve academic session"
    });
  }
};


module.exports.clearActiveSessionCache = async function () {
  try {
    await sessionCacheClient.del(SESSION_CACHE_KEY);
  } catch (err) {
    console.error("resolveSessionContext cache clear error:", err);
  }
};
