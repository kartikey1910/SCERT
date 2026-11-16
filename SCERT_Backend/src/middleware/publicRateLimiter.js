const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { createClient } = require("redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisClient = createClient({ url: redisUrl });

redisClient.on("error", (err) =>
  console.error("publicRateLimiter redis error:", err));
redisClient.connect().catch((err) =>
  console.error("publicRateLimiter redis connect error:", err));

/**
 * Per-IP ceiling for the unauthenticated /api/public endpoints. Does NOT
 * apply to school, BEO, district or SCERT traffic — those mount under
 * their own paths and are never throttled here.
 *
 * Raised from 60 to 300 because the limit is shared by everyone behind one
 * NAT address (a school office, a village cyber cafe) and a single visit
 * already costs ~6 public requests: the homepage CMS block, the
 * announcements block, the visitor counter, the availability check, and
 * then the lookup itself. At 60/min that allowed only ~10 students per
 * minute per shared connection, which would have started returning 429s to
 * whole schools on result-declaration day. 300/min supports ~50.
 *
 * Still deliberately finite: this endpoint family reaches student PII
 * behind nothing but a roll number and date of birth, so an unbounded
 * limit would make bulk enumeration cheap.
 */
const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) =>
      redisClient.sendCommand(args),
    prefix: "public-rate-limit:",
  }),
  handler: (req, res) => {
    res.status(429).json({
      message: "Too many requests. Please slow down."
    });
  },
  skip: (req) => {
    // Never rate limit health checks
    return req.path === "/health";
  }
});

module.exports = publicRateLimiter;
