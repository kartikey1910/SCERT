const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { createClient } = require("redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisClient = createClient({ url: redisUrl });

redisClient.on("error", (err) =>
  console.error("resultLookupRateLimiter redis error:", err));
redisClient.connect().catch((err) =>
  console.error("resultLookupRateLimiter redis connect error:", err));

/**
 * Second, tighter limit layered under the 300/min publicRateLimiter that
 * already covers everything on /api/public.
 *
 * The score-card lookup is the one public endpoint that can reach
 * Postgres, so on result day it is what needs protecting. Raised from 30
 * to 100 alongside the public limit: this budget is shared by everyone
 * behind one NAT address, so 30/min meant a school office checking results
 * for a queue of students hit 429s within the first minute. 100/min lets a
 * shared connection serve a student every 0.6s — faster than anyone can
 * type a roll number and date of birth — while a scraper is still capped
 * near 1.7 requests/second, far too slow to enumerate roll number and
 * date-of-birth combinations at scale.
 *
 * The store is Redis-backed so the limit is shared across all three
 * cluster workers instead of being counted three times over.
 */
const resultLookupRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: "result-lookup-rate-limit:",
  }),
  handler: (req, res) => {
    res.status(429).json({
      found: false,
      code: "RATE_LIMITED",
      message:
        "Too many result lookups from this connection. Please wait a minute and try again.",
    });
  },
});

module.exports = resultLookupRateLimiter;
