/**
 * BEO dashboard data that is not an application list.
 */

const pool = require("../config/db");
const summaryService = require("../services/beoNmmssSummary.service");

const BEO_ROLE_ID = 3;

/**
 * GET /api/beo/dashboard/nmmss-summary?scholarship_id=
 *
 * The signed-in BEO's own block: status counts, school-wise table and
 * contact details. Scope is the caller's user id (-> block) and the resolved
 * academic session - nothing in the request can point it at another block.
 */
exports.getNmmssSummary = async (req, res) => {
  if (req.user?.role_id !== BEO_ROLE_ID) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const scholarshipId = Number(req.query.scholarship_id);
  if (!Number.isInteger(scholarshipId) || scholarshipId <= 0) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const summary = await summaryService.getBeoNmmssSummary(pool, {
      beoUserId: req.user.user_id,
      sessionId: req.session.session_id,
      scholarshipId,
    });

    // Live figures: an approval or a return must show the moment the BEO comes
    // back to the dashboard.
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(summary);
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("BEO NMMSS summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
