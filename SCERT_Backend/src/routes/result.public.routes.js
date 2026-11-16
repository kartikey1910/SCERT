const express = require("express");
const router = express.Router();

const controller = require("../controllers/resultPublish.controller");
const resultLookupRateLimiter = require("../middleware/resultLookupRateLimiter");

/**
 * Public, unauthenticated result endpoints.
 *
 * Mounted under /api/public in server.js, so both routes already sit
 * behind publicRateLimiter (60/min per IP). The lookup adds its own
 * tighter limiter on top — see resultLookupRateLimiter.
 */

// Cheap, cacheable, carries no student data: drives the home-page button.
router.get("/results/availability", controller.getPublicAvailability);

// POST, not GET: roll number and date of birth are personal data and
// must stay out of URLs, query strings, and access logs.
router.post(
  "/results/lookup",
  resultLookupRateLimiter,
  controller.lookupPublicResult
);

module.exports = router;
