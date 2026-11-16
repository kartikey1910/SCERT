/**
 * BEO-level Result tabs.
 *
 * Identical to the district reports but pinned to the signed-in BEO's own
 * block: every uploaded All-Students row for that block, plus the official
 * selected-candidates list with PDF/XLSX download. Both gated on SCERT
 * having published the result.
 *
 * The block comes from beo_profiles and is applied server-side, so no
 * request parameter can widen the scope past the officer's own block.
 */

const pool = require("../config/db");
const report = require("../services/resultScopedReport.service");

const BEO_ROLE_ID = 3;

async function resolveBlock(userId) {
  const res = await pool.query(
    `SELECT block_code, block_name, district_code, district_name
       FROM scert_db.beo_profiles WHERE user_id = $1`,
    [userId]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    block_code: r.block_code ? String(r.block_code) : null,
    block_name: r.block_name || null,
    district_code: r.district_code ? String(r.district_code) : null,
    district_name: r.district_name || null,
  };
}

function parseId(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadContext(req, res) {
  if (req.user?.role_id !== BEO_ROLE_ID) {
    res.status(403).json({ message: "Unauthorized role" });
    return null;
  }

  const sessionId = parseId(req.query.session_id);
  const scholarshipId = parseId(req.query.scholarship_id);
  if (sessionId === null || scholarshipId === null) {
    res.status(400).json({ message: "session_id and scholarship_id are required" });
    return null;
  }

  const block = await resolveBlock(req.user.user_id);
  if (!block || !block.block_name) {
    res.status(404).json({ message: "Block profile not found for this user." });
    return null;
  }

  return {
    sessionId,
    scholarshipId,
    scope: {
      level: "BLOCK",
      block_code: block.block_code,
      block_name: block.block_name,
      district_code: block.district_code,
      district_name: block.district_name,
      // Matching keys consumed by buildScopeClause. District is included
      // as well as block so the scope stays correct even if a block name
      // were ever reused across districts.
      districtName: block.district_name,
      blockName: block.block_name,
    },
    filters: {
      classValue: req.query.class || null,
      search: req.query.search || null,
      status: req.query.status || null,
      // No block filter: a BEO already has exactly one block.
      blockName: null,
    },
  };
}

function paging(req) {
  return {
    page: Math.max(1, parseId(req.query.page) || 1),
    pageSize: Math.min(200, Math.max(10, parseId(req.query.page_size) || 50)),
  };
}

function blockMeta(ctx) {
  return {
    block: {
      block_code: ctx.scope.block_code,
      block_name: ctx.scope.block_name,
      district_name: ctx.scope.district_name,
    },
  };
}

/** GET /api/beo/result/students */
exports.getBeoResultStudents = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const { page, pageSize } = paging(req);
    const data = await report.getAllStudents({ ...ctx, page, pageSize, includeBlocks: false });
    res.json({ ...data, ...blockMeta(ctx) });
  } catch (err) {
    console.error("getBeoResultStudents error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/beo/result/selected */
exports.getBeoSelectedStudents = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const { page, pageSize } = paging(req);
    const data = await report.getSelectedStudents({ ...ctx, page, pageSize, includeBlocks: false });
    res.json({ ...data, ...blockMeta(ctx) });
  } catch (err) {
    console.error("getBeoSelectedStudents error:", err);
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
    const safeName = String(ctx.scope.block_name || "block").replace(/[^A-Za-z0-9]+/g, "_");
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
          `District: ${ctx.scope.district_name} • Block: ${ctx.scope.block_name}`,
        ],
      },
    });
  } catch (err) {
    console.error(`beo downloadSelected(${format}) error:`, err);
    res.status(500).json({ message: "Internal server error" });
  }
}

exports.downloadBeoSelectedStudentsPdf = (req, res) => downloadSelected(req, res, "pdf");
exports.downloadBeoSelectedStudentsXlsx = (req, res) => downloadSelected(req, res, "xlsx");
