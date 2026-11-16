const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const { createClient } = require("redis");
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const tokenCacheClient = createClient({ url: redisUrl });
tokenCacheClient.on("error", (err) => 
  console.error("verifyToken redis error:", err));
tokenCacheClient.connect().catch((err) => 
  console.error("verifyToken redis connect error:", err));
const USER_CACHE_TTL = 30;

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Token missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (
      !Object.prototype.hasOwnProperty.call(decoded, "token_version") ||
      decoded.token_version === null ||
      decoded.token_version === undefined
    ) {
      return res.status(401).json({
        message: "Session expired. Please log in again.",
      });
    }

    let user;
    try {
      const cached = await tokenCacheClient.get(`user_auth:${decoded.user_id}`);
      if (cached) {
        user = JSON.parse(cached);
      }
    } catch (err) {
      console.error("verifyToken redis get error:", err);
    }

    if (!user) {
      const userRes = await pool.query(
        `SELECT user_id, is_active, COALESCE(token_version, 0) AS token_version
         FROM scert_db.users
         WHERE user_id = $1`,
        [decoded.user_id]
      );

      if (userRes.rows.length === 0) {
        return res.status(401).json({ message: "Invalid token" });
      }

      user = userRes.rows[0];
      try {
        await tokenCacheClient.setEx(`user_auth:${decoded.user_id}`, USER_CACHE_TTL, JSON.stringify(user));
      } catch (err) {
        console.error("verifyToken redis set error:", err);
      }
    }
    if (!user.is_active) {
      return res.status(403).json({ message: "Account inactive" });
    }

    const tokenVersion = Number(decoded.token_version);
    const currentTokenVersion = Number(user.token_version ?? 0);

    if (!Number.isFinite(tokenVersion) || tokenVersion !== currentTokenVersion) {
      return res.status(401).json({
        message: "Session expired. Please log in again.",
      });
    }

    req.user = {
      ...decoded,
      token_version: currentTokenVersion,
    };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports.tokenCacheClient = tokenCacheClient;
