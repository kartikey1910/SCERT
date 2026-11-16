/**
 * District dashboard data that is not an application list.
 */

const pool = require("../config/db");
const summaryService = require("../services/scertNmmssSummary.service");
const { sendTablePdf } = require("../utils/pdfTable.util");

const DISTRICT_ROLE_ID = 4;

/**
 * GET /api/district/dashboard/nmmss-summary
 *   ?scholarship_id=&level=block|school&block_code=
 *
 * The district is the signed-in user's own; the request cannot change it.
 */
exports.getNmmssSummary = async (req, res) => {
  if (req.user?.role_id !== DISTRICT_ROLE_ID) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const scholarshipId = Number(req.query.scholarship_id);
  if (!Number.isInteger(scholarshipId) || scholarshipId <= 0) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  try {
    const profile = await pool.query(
      `SELECT district_code, district_name FROM scert_db.district_profiles WHERE user_id = $1`,
      [req.user.user_id]
    );
    if (!profile.rows.length) {
      return res.status(404).json({ message: "District profile not found" });
    }
    const districtCode = String(profile.rows[0].district_code);

    const summary = await summaryService.getDistrictNmmssSummary(pool, {
      districtCode,
      level: String(req.query.level || "block"),
      blockCode: req.query.block_code ? String(req.query.block_code) : undefined,
      sessionId: req.session.session_id,
      scholarshipId,
    });

    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      ...summary,
      district: { district_code: districtCode, district_name: profile.rows[0].district_name || "" },
    });
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("District NMMSS summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/district/dashboard/nmmss-summary.pdf
 *   ?scholarship_id=&level=block|school&block_code=
 *
 * The NMMSS table above as a PDF, at the level the user is looking at: the
 * district's blocks, or one block's schools.
 */
exports.downloadNmmssSummaryPdf = async (req, res) => {
  if (req.user?.role_id !== DISTRICT_ROLE_ID) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const scholarshipId = Number(req.query.scholarship_id);
  if (!Number.isInteger(scholarshipId) || scholarshipId <= 0) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }
  const level = String(req.query.level || "block");
  const sessionId = req.session.session_id;

  try {
    const profile = await pool.query(
      `SELECT district_code, district_name FROM scert_db.district_profiles WHERE user_id = $1`,
      [req.user.user_id]
    );
    if (!profile.rows.length) {
      return res.status(404).json({ message: "District profile not found" });
    }
    const districtCode = String(profile.rows[0].district_code);
    const districtName = profile.rows[0].district_name || districtCode;

    const summary = await summaryService.getDistrictNmmssSummary(pool, {
      districtCode,
      level,
      blockCode: req.query.block_code ? String(req.query.block_code) : undefined,
      sessionId,
      scholarshipId,
    });

    const meta = await pool.query(
      `SELECT
         (SELECT session_name FROM scert_db.academic_sessions WHERE session_id = $1) AS session_name,
         (SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $2) AS scholarship_name`,
      [sessionId, scholarshipId]
    );
    const sessionName = meta.rows[0]?.session_name || String(sessionId);
    const scholarshipName = meta.rows[0]?.scholarship_name || String(scholarshipId);

    const isSchoolLevel = level === "school";
    const toPdfRow = (r, sno, name) => ({
      sno,
      name,
      enrolled: r.enrolled ?? 0,
      registered_nmmss: r.registered_nmmss ?? 0,
      registered_snss_ssss: r.registered_snss_ssss ?? 0,
      registered_total: r.registered_total ?? 0,
      appeared: r.appeared ?? 0,
      qualified: "—",
      selected: "—",
    });
    const rows = summary.rows || [];
    const pdfRows = rows.map((r, idx) =>
      toPdfRow(r, idx + 1, (isSchoolLevel ? r.school_name : r.block_name) || "—")
    );
    let blockName = null;
    if (isSchoolLevel) {
      const block = await pool.query(
        `SELECT MODE() WITHIN GROUP (ORDER BY block_name) AS block_name
           FROM scert_db.school_profiles
          WHERE block_code::text = $1 AND district_code::text = $2`,
        [String(req.query.block_code), districtCode]
      );
      blockName = block.rows[0]?.block_name || String(req.query.block_code);
    }

    await sendTablePdf(res, {
      filename: isSchoolLevel
        ? `district_progress_report_nmmss_schools_${req.query.block_code}_${sessionId}_${scholarshipId}.pdf`
        : `district_progress_report_nmmss_blocks_${districtCode}_${sessionId}_${scholarshipId}.pdf`,
      title: isSchoolLevel ? "Progress Report (School-wise)" : "Progress Report (Block-wise)",
      layout: "landscape",
      metaLines: [
        `Session: ${sessionName}   Scholarship: ${scholarshipName}   District: ${districtName}` +
          (blockName ? `   Block: ${blockName}` : ""),
        "Qualified and Selected figures will appear once the NMMSS results are declared.",
      ],
      columns: [
        { key: "sno", label: "S.No", width: 40, align: "right" },
        { key: "name", label: isSchoolLevel ? "Name of the School" : "Name of the Block", width: 220, align: "left" },
        { key: "enrolled", label: "Enrolled in Class 8", width: 90, align: "right" },
        { key: "registered_nmmss", label: "Registered NMMSS (Code 1)", width: 110, align: "right" },
        { key: "registered_snss_ssss", label: "Registered SNSS/SSSS (Code 2)", width: 120, align: "right" },
        { key: "registered_total", label: "Registered Total", width: 100, align: "right" },
        { key: "appeared", label: "Appeared in Exam", width: 90, align: "right" },
        { key: "qualified", label: "Qualified", width: 70, align: "right" },
        { key: "selected", label: "Selected", width: 70, align: "right" },
      ],
      rows: pdfRows,
      totalsRow: toPdfRow(summary.totals || {}, "", "Total"),
    });
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("District NMMSS summary PDF error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
