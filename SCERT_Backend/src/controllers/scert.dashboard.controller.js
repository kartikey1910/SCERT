/**
 * SCERT dashboard data that is not an application list.
 */

const pool = require("../config/db");
const summaryService = require("../services/scertNmmssSummary.service");

const SCERT_ROLE_ID = 5;

/**
 * GET /api/scert/dashboard/nmmss-summary
 *   ?scholarship_id=&level=district|block|school&district_code=&block_code=
 */
exports.getNmmssSummary = async (req, res) => {
  if (req.user?.role_id !== SCERT_ROLE_ID) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const scholarshipId = Number(req.query.scholarship_id);
  if (!Number.isInteger(scholarshipId) || scholarshipId <= 0) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const summary = await summaryService.getScertNmmssSummary(pool, {
      level: String(req.query.level || "district"),
      districtCode: req.query.district_code ? String(req.query.district_code) : undefined,
      blockCode: req.query.block_code ? String(req.query.block_code) : undefined,
      sessionId: req.session.session_id,
      scholarshipId,
    });

    // Live figures: an approval or a return must show on the next visit.
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(summary);
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("SCERT NMMSS summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
