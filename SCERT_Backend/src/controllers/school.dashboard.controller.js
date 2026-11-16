/**
 * School dashboard data that is not an application list.
 */

const pool = require("../config/db");
const summaryService = require("../services/schoolNmmssSummary.service");

const SCHOOL_ROLE_ID = 2;

/**
 * GET /api/school/dashboard/nmmss-summary?scholarship_id=
 *
 * The signed-in school's own NMMSS table and contact details. Scope is the
 * caller's user id and the resolved academic session - nothing in the
 * request can point it at another school.
 */
exports.getNmmssSummary = async (req, res) => {
  if (req.user?.role_id !== SCHOOL_ROLE_ID) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const scholarshipId = Number(req.query.scholarship_id);
  if (!Number.isInteger(scholarshipId) || scholarshipId <= 0) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const summary = await summaryService.getNmmssSummary(pool, {
      schoolUserId: req.user.user_id,
      sessionId: req.session.session_id,
      scholarshipId,
    });

    // Not cached: it carries the school's own profile, so it has to reflect an
    // edit the moment the school returns to the dashboard - a browser-cached
    // copy would keep the "update your profile" prompt up after it was saved.
    // The query is ~30 ms, so there is nothing to gain from caching it.
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(summary);
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("School NMMSS summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
