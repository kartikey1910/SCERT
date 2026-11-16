/**
 * Result publication — SCERT controls and the public score-card lookup.
 */

const service = require("../services/resultPublish.service");

function parseId(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** SCERT is role 5 — same check the rest of result.controller.js uses. */
const SCERT_ROLE_ID = 5;

function requireScert(req, res) {
  if (req.user?.role_id !== SCERT_ROLE_ID) {
    res.status(403).json({ message: "Unauthorized role" });
    return false;
  }
  return true;
}

/**
 * GET /api/results/publish/status?session_id=&scholarship_id=
 * SCERT only. Readiness of each class plus the current switch state.
 */
exports.getPublishStatus = async (req, res) => {
  if (!requireScert(req, res)) return;

  const sessionId = parseId(req.query.session_id);
  const scholarshipId = parseId(req.query.scholarship_id);

  if (sessionId === null || scholarshipId === null) {
    return res
      .status(400)
      .json({ message: "session_id and scholarship_id are required" });
  }

  try {
    const status = await service.getPublishStatus({ sessionId, scholarshipId });
    res.json(status);
  } catch (err) {
    console.error("getPublishStatus error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

const AUDIENCE_MESSAGES = {
  public: {
    on: "Results are now live on the home page. Students can look up their score card.",
    off: "Results removed from the home page. School, BEO and District access is unchanged.",
  },
  officers: {
    on: "Results released to School, BEO and District users.",
    off: "Results withdrawn from School, BEO and District users. The home-page lookup is unchanged.",
  },
};

/**
 * PUT /api/results/publish
 * SCERT only. Body: { session_id, scholarship_id, audience, is_published }
 *
 * audience is "public" (home-page lookup) or "officers" (School, BEO,
 * District). It is required rather than defaulted: guessing which switch
 * an older client meant could silently release or withdraw the wrong one.
 */
exports.setPublishStatus = async (req, res) => {
  if (!requireScert(req, res)) return;

  const sessionId = parseId(req.body.session_id);
  const scholarshipId = parseId(req.body.scholarship_id);
  const { is_published, audience } = req.body;

  if (sessionId === null || scholarshipId === null) {
    return res
      .status(400)
      .json({ message: "session_id and scholarship_id are required" });
  }
  if (!service.AUDIENCES.includes(audience)) {
    return res.status(400).json({
      message: `audience must be one of: ${service.AUDIENCES.join(", ")}`,
    });
  }
  if (typeof is_published !== "boolean") {
    return res.status(400).json({ message: "is_published must be a boolean" });
  }

  try {
    await service.setPublishStatus({
      sessionId,
      scholarshipId,
      audience,
      isPublished: is_published,
      userId: req.user.user_id,
    });

    // Return the recomputed status so the UI reflects the new state
    // without a second round trip.
    const status = await service.getPublishStatus({ sessionId, scholarshipId });
    res.json({
      message: AUDIENCE_MESSAGES[audience][is_published ? "on" : "off"],
      ...status,
    });
  } catch (err) {
    // 409 is raised deliberately by the service when a required class
    // sheet is missing — surface its message rather than a generic 500.
    if (err.statusCode === 409 || err.statusCode === 400) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("setPublishStatus error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/public/results/availability
 * Unauthenticated. Drives whether the home page shows the
 * "View Result" button. Deliberately carries no student data.
 */
exports.getPublicAvailability = async (req, res) => {
  try {
    const availability = await service.isAnyResultPublished();
    res.json(availability);
  } catch (err) {
    console.error("getPublicAvailability error:", err);
    // Fail closed: if this endpoint is broken the button stays hidden
    // rather than sending students to a page that cannot work.
    res.status(200).json({ published: false, scopes: [] });
  }
};

/**
 * POST /api/public/results/lookup
 * Unauthenticated. Body: { roll_number, dob }
 *
 * POST rather than GET because roll number and date of birth are
 * personal data and must not land in a URL, query string, browser
 * history, or access log.
 */
exports.lookupPublicResult = async (req, res) => {
  const { roll_number, dob } = req.body || {};

  try {
    const outcome = await service.lookupResult({ rollNumber: roll_number, dob });

    switch (outcome.status) {
      case "OK":
        return res.json({ found: true, result: outcome.card });

      case "NOT_PUBLISHED":
        return res.status(403).json({
          found: false,
          code: "NOT_PUBLISHED",
          message: "Results have not been declared yet.",
        });

      case "INVALID_INPUT":
        return res.status(400).json({
          found: false,
          code: "INVALID_INPUT",
          message:
            outcome.field === "dob"
              ? "Please enter a valid date of birth."
              : "Please enter a valid roll number.",
        });

      case "DOB_UNAVAILABLE":
        return res.status(409).json({
          found: false,
          code: "DOB_UNAVAILABLE",
          message:
            "Your date of birth could not be verified from the exam records. Please contact your school or block education office.",
        });

      case "MISMATCH":
      default:
        // One message for "no such roll number" and "wrong date of
        // birth" alike — telling them apart would let someone confirm
        // which roll numbers exist.
        return res.status(404).json({
          found: false,
          code: "NOT_FOUND",
          message:
            "No result found for the roll number and date of birth entered. Please check and try again.",
        });
    }
  } catch (err) {
    console.error("lookupPublicResult error:", err);
    res.status(500).json({ found: false, message: "Internal server error" });
  }
};
