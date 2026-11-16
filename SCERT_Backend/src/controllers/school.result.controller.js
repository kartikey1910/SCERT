/**
 * School-level Result tabs.
 *
 * Same two reports as District and BEO, pinned to the signed-in school's
 * own students: the full All-Students list and the official
 * selected-candidates list with PDF/XLSX download. Both gated on SCERT
 * having released the result to departments (is_officer_published), which
 * is independent of the public home-page release.
 *
 * Scope is the school's own user_id applied server-side via
 * result_students.application_id -> scholarship_applications
 * .created_by_school_user_id, so no request parameter can widen it. That
 * foreign key is used rather than the sheet's school_name text because
 * every uploaded row carries a matched application (88,351/88,351) while
 * the free-text names vary in spelling and punctuation.
 */

const pool = require("../config/db");
const report = require("../services/resultScopedReport.service");
const publishService = require("../services/resultPublish.service");
const { renderScoreCardPdfBuffer } = require("../utils/scoreCardPdf.util");

const SCHOOL_ROLE_ID = 2;

async function resolveSchool(userId) {
  const res = await pool.query(
    `SELECT user_id, school_name, udise_code, district_name, block_name, block_code
       FROM scert_db.school_profiles WHERE user_id = $1`,
    [userId]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return {
    user_id: String(r.user_id),
    school_name: r.school_name || null,
    udise_code: r.udise_code || null,
    district_name: r.district_name || null,
    block_name: r.block_name || null,
    block_code: r.block_code ? String(r.block_code) : null,
  };
}

function parseId(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadContext(req, res) {
  if (req.user?.role_id !== SCHOOL_ROLE_ID) {
    res.status(403).json({ message: "Unauthorized role" });
    return null;
  }

  const sessionId = parseId(req.query.session_id);
  const scholarshipId = parseId(req.query.scholarship_id);
  if (sessionId === null || scholarshipId === null) {
    res.status(400).json({ message: "session_id and scholarship_id are required" });
    return null;
  }

  const school = await resolveSchool(req.user.user_id);
  if (!school) {
    res.status(404).json({ message: "School profile not found for this user." });
    return null;
  }

  return {
    sessionId,
    scholarshipId,
    scope: {
      level: "SCHOOL",
      school_user_id: school.user_id,
      school_name: school.school_name,
      udise_code: school.udise_code,
      district_name: school.district_name,
      block_name: school.block_name,
      // Matching key consumed by buildScopeClause.
      schoolUserId: school.user_id,
    },
    filters: {
      classValue: req.query.class || null,
      search: req.query.search || null,
      status: req.query.status || null,
      blockName: null, // a school sits in exactly one block
    },
  };
}

function paging(req) {
  return {
    page: Math.max(1, parseId(req.query.page) || 1),
    pageSize: Math.min(200, Math.max(10, parseId(req.query.page_size) || 50)),
  };
}

function schoolMeta(ctx) {
  return {
    school: {
      school_name: ctx.scope.school_name,
      udise_code: ctx.scope.udise_code,
      district_name: ctx.scope.district_name,
      block_name: ctx.scope.block_name,
    },
  };
}

/** GET /api/school/result/students */
exports.getSchoolResultStudents = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const { page, pageSize } = paging(req);
    const data = await report.getAllStudents({ ...ctx, page, pageSize, includeBlocks: false });
    res.json({ ...data, ...schoolMeta(ctx) });
  } catch (err) {
    console.error("getSchoolResultStudents error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/school/result/selected */
exports.getSchoolSelectedStudents = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;
  try {
    const { page, pageSize } = paging(req);
    const data = await report.getSelectedStudents({ ...ctx, page, pageSize, includeBlocks: false });
    res.json({ ...data, ...schoolMeta(ctx) });
  } catch (err) {
    console.error("getSchoolSelectedStudents error:", err);
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
    const safeName = String(ctx.scope.school_name || "school").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60);
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
          `School: ${ctx.scope.school_name || "-"}`,
          `District: ${ctx.scope.district_name || "-"} • Block: ${ctx.scope.block_name || "-"}`,
        ],
      },
    });
  } catch (err) {
    console.error(`school downloadSelected(${format}) error:`, err);
    res.status(500).json({ message: "Internal server error" });
  }
}

exports.downloadSchoolSelectedStudentsPdf = (req, res) => downloadSelected(req, res, "pdf");
exports.downloadSchoolSelectedStudentsXlsx = (req, res) => downloadSelected(req, res, "xlsx");

/**
 * GET /api/school/result/scorecard.pdf?roll_number=...
 *
 * One student's official score card, in the same format the public View
 * Result page shows. Powers the per-row Download button on the school's
 * Result tab.
 *
 * The roll number is verified to belong to THIS school before anything is
 * rendered — otherwise a school could download any student's card in the
 * state by guessing roll numbers, which are sequential and predictable.
 */
exports.downloadSchoolStudentScoreCard = async (req, res) => {
  const ctx = await loadContext(req, res);
  if (!ctx) return;

  const rollNumber = String(req.query.roll_number || "").trim();
  if (!rollNumber) {
    return res.status(400).json({ message: "roll_number is required" });
  }

  try {
    if (!(await report.isReleasedToOfficers(ctx.sessionId, ctx.scholarshipId))) {
      return res.status(403).json({ message: "Results have not been declared yet." });
    }

    // Ownership check: does this roll number sit inside this school's scope?
    const scope = report.buildScopeClause({
      sessionId: ctx.sessionId,
      scholarshipId: ctx.scholarshipId,
      scope: ctx.scope,
      filters: {},
    });
    const owned = await pool.query(
      `SELECT 1 FROM scert_db.result_students rs ${scope.joinClause}
        WHERE ${scope.whereClause} AND rs.roll_number = $${scope.values.length + 1}
        LIMIT 1`,
      [...scope.values, rollNumber]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ message: "No result found for this roll number in your school." });
    }

    const card = await publishService.buildScoreCardForRoll({
      sessionId: ctx.sessionId,
      scholarshipId: ctx.scholarshipId,
      rollNumber,
    });
    if (!card) {
      return res.status(404).json({ message: "No result found for this roll number." });
    }

    const buffer = await renderScoreCardPdfBuffer(card);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=SCORECARD_${rollNumber}.pdf`);
    return res.send(buffer);
  } catch (err) {
    console.error("downloadSchoolStudentScoreCard error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
