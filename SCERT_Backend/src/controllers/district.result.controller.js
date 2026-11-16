/**
 * District-level Result tabs.
 *
 * Two reports, both scoped to the signed-in district officer's own
 * district and both gated on SCERT having published the result:
 *   - Result            : every uploaded All-Students row, block-wise
 *   - Selected Students : the official selected-candidates list + download
 *
 * All the query/column/ordering logic lives in resultScopedReport.service
 * so this and the BEO controller cannot drift apart.
 */

const pool = require("../config/db");
const districtBlockMaster = require("../master-data/district-block.master.json");
const report = require("../services/resultScopedReport.service");

const DISTRICT_ROLE_ID = 4;

function getDistrictNameFromMaster(districtCode) {
  const dc = String(districtCode);
  const dcNum = Number(dc);
  const entry = Object.values(districtBlockMaster || {}).find((d) => {
    const dNum = Number(String(d.district_code));
    if (!Number.isNaN(dcNum) && !Number.isNaN(dNum)) return dNum === dcNum;
    return String(d.district_code) === dc;
  });
  return entry?.district_name || null;
}

async function resolveDistrict(userId) {
  const res = await pool.query(
    `SELECT district_code, district_name FROM scert_db.district_profiles WHERE user_id = $1`,
    [userId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    district_code: row.district_code ? String(row.district_code) : null,
    // Prefer the master spelling; fall back to the profile's own.
    district_name: getDistrictNameFromMaster(row.district_code) || row.district_name || null,
  };
}

function parseId(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Validates role + scope and resolves the district, or writes the error. */
async function loadContext(req, res) {
  if (req.user?.role_id !== DISTRICT_ROLE_ID) {
    res.status(403).json({ message: "Unauthorized role" });
    return null;
  }

  const sessionId = parseId(req.query.session_id);
  const scholarshipId = parseId(req.query.scholarship_id);
  if (sessionId === null || scholarshipId === null) {
    res.status(400).json({ message: "session_id and scholarship_id are required" });
    return null;
  }

  const district = await resolveDistrict(req.user.user_id);
  if (!district) {
    res.status(404).json({ message: "District profile not found for this user." });
    return null;
  }

  return {
    sessionId,
    scholarshipId,
    scope: {
      level: "DISTRICT",
      district_code: district.district_code,
      district_name: district.district_name,
      districtName: district.district_name,
    },
    filters: {
      classValue: req.query.class || null,
      blockName: req.query.block || null,
      search: req.query.search || null,
      status: req.query.status || null,
    },
  };
}

function paging(req) {
  return {
    page: Math.max(1, parseId(req.query.page) || 1),
    pageSize: Math.min(200, Math.max(10, parseId(req.query.page_size) || 50)),
  };
}

/** GET /api/district/result/students */
exports.getDistrictResultStudents = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const { page, pageSize } = paging(req);
    const data = await report.getAllStudents({ ...ctx, page, pageSize, includeBlocks: true });
    res.json({ ...data, district: { district_code: ctx.scope.district_code, district_name: ctx.scope.district_name } });
  } catch (err) {
    console.error("getDistrictResultStudents error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/district/result/selected */
exports.getDistrictSelectedStudents = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const { page, pageSize } = paging(req);
    const data = await report.getSelectedStudents({ ...ctx, page, pageSize, includeBlocks: true });
    res.json({ ...data, district: { district_code: ctx.scope.district_code, district_name: ctx.scope.district_name } });
  } catch (err) {
    console.error("getDistrictSelectedStudents error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

async function downloadSelected(req, res, format) {
  const ctx = await loadContext(req, res);
  if (!ctx) return;

  try {
    if (!(await report.isReleasedToOfficers(ctx.sessionId, ctx.scholarshipId))) {
      return res.status(403).json({ message: "Results have not been declared yet." });
    }

    const { sessionName, scholarshipName } = await report.getReportMetaNames(ctx.sessionId, ctx.scholarshipId);
    const classPart = ctx.filters.classValue ? `_CLASS${ctx.filters.classValue}` : "";
    const safeName = String(ctx.scope.district_name || "district").replace(/[^A-Za-z0-9]+/g, "_");
    const base = `SELECTED_STUDENTS_${safeName}${classPart}`;
    const levelLabel = ctx.filters.classValue ? `Class-${ctx.filters.classValue}` : "All Classes";

    return await report.sendCachedSelectedDownload(res, {
      ctx,
      format,
      filename: `${base}.${format}`,
      sheetName: "Selected Students",
      pdf: {
        title: "List of Selected Candidates",
        metaLines: [
          scholarshipName,
          `Session: ${sessionName} • ${levelLabel}`,
          `District: ${ctx.scope.district_name}${ctx.filters.blockName ? ` • Block: ${ctx.filters.blockName}` : ""}`,
        ],
      },
    });
  } catch (err) {
    console.error(`district downloadSelected(${format}) error:`, err);
    res.status(500).json({ message: "Internal server error" });
  }
}

exports.downloadDistrictSelectedStudentsPdf = (req, res) => downloadSelected(req, res, "pdf");
exports.downloadDistrictSelectedStudentsXlsx = (req, res) => downloadSelected(req, res, "xlsx");
