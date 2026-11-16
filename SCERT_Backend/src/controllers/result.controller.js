const resultService = require("../services/result.service");
const resultUploadService = require("../services/result/resultUpload.service");
const fullResultService = require("../services/result/fullResult.service");
const selectedStudentsService = require("../services/result/selectedStudents.service");
const selectedStudentsSheet = require("../services/result/selectedStudentsSheet");
const frontPage = require("../utils/resultFrontPage.util");
const pool = require("../config/db");

const { sendTablePdf } = require("../utils/pdfTable.util");
const { sendTableXlsx } = require("../utils/xlsxTable.util");

const ALLOWED_CHART_TYPES = new Set([
  "overall_analytics",
  "gender_analytics",
  "category_analytics",
  "marks_distribution",
  "districts",
  "blocks",
  "schools",
  "gender_rank_distribution",
]);

const ALLOWED_HIERARCHY_LEVELS = new Set(["district", "block", "school"]);

function parseRequiredNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return {
      error: `${fieldName} must be a valid number`,
      value: null,
    };
  }

  return { error: null, value: parsed };
}

function parseOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { error: null, value: null };
  }

  return parseRequiredNumber(value, fieldName);
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function ensureScert(req, res) {
  if (req.user?.role_id !== 5) {
    res.status(403).json({ message: "Unauthorized role" });
    return false;
  }

  return true;
}

function buildOptionalFiltersFromQuery(query = {}) {
  return {
    district: normalizeText(query.district),
    block: normalizeText(query.block),
    school: normalizeText(query.school),
    category: normalizeText(query.category),
    gender: normalizeText(query.gender),
    school_type: normalizeText(query.school_type),
    school_category: normalizeText(query.school_category),
    area_type: normalizeText(query.area_type),
  };
}

function parseCommonOptionalScope(query = {}) {
  const sessionParsed = parseOptionalNumber(query.session_id, "session_id");
  if (sessionParsed.error) return sessionParsed;

  const scholarshipParsed = parseOptionalNumber(query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return scholarshipParsed;

  const classParsed = parseOptionalNumber(query.class, "class");
  if (classParsed.error) return classParsed;

  return {
    error: null,
    value: {
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(query),
    },
  };
}

function parseRequestedChartTypes(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return {
      error: null,
      value: Array.from(ALLOWED_CHART_TYPES),
    };
  }

  const types = String(value)
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  if (types.length === 0) {
    return {
      error: null,
      value: Array.from(ALLOWED_CHART_TYPES),
    };
  }

  const invalid = types.filter((type) => !ALLOWED_CHART_TYPES.has(type));
  if (invalid.length > 0) {
    return {
      error: `Invalid chart type(s): ${invalid.join(", ")}`,
      value: null,
    };
  }

  return {
    error: null,
    value: Array.from(new Set(types)),
  };
}

// ==========================================
// UPLOADS
// ==========================================

const UPLOAD_TYPES = new Set([
  "ALL_STUDENTS",
  "SELECTED_STUDENTS",
  "ANSWER_KEY",
  "STUDENT_RESPONSES",
  "BLOCK_SUMMARY",
]);

/**
 * Validates the scope every upload is filed under: session + scholarship +
 * class. Returns null and sends the response when anything is invalid.
 */
function parseUploadScope(req, res) {
  if (!req.file) {
    res.status(400).json({ message: "Please choose a file to upload." });
    return null;
  }

  const sessionParsed = parseRequiredNumber(req.body.session_id, "session_id");
  if (sessionParsed.error) {
    res.status(400).json({ message: sessionParsed.error });
    return null;
  }

  const scholarshipParsed = parseRequiredNumber(req.body.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    res.status(400).json({ message: scholarshipParsed.error });
    return null;
  }

  const classParsed = parseRequiredNumber(req.body.class, "class");
  if (classParsed.error) {
    res.status(400).json({ message: classParsed.error });
    return null;
  }

  return {
    sessionId: sessionParsed.value,
    scholarshipId: scholarshipParsed.value,
    classValue: classParsed.value,
    fileName: req.file.originalname,
    buffer: req.file.buffer,
    uploadedBy: req.user.user_id,
  };
}

function handleUploadError(res, err, context) {
  // Validation problems carry a statusCode and a message written for the
  // person doing the upload; everything else is logged and generalised.
  if (Number.isInteger(err?.statusCode) && err.statusCode < 500) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  console.error(`${context} failed:`, err);
  return res.status(500).json({
    message: "The file could not be processed. Please check the format and try again.",
  });
}

/**
 * Upload types whose parser loads the whole workbook into memory via
 * ExcelJS `xlsx.load()`. Only STUDENT_RESPONSES avoids this — it uses the
 * streaming WorkbookReader and can therefore take the full 64 MB.
 */
const MEMORY_HEAVY_UPLOAD_TYPES = new Set([
  "ALL_STUDENTS",
  "SELECTED_STUDENTS",
  "ANSWER_KEY",
  "BLOCK_SUMMARY",
]);

/**
 * Ceiling for the non-streaming parsers.
 *
 * Measured on the real class-9 all-students sheet: a 10 MB file expands to
 * ~598 MB of process memory once ExcelJS builds its object graph — about
 * 62x the file size. Against Node's ~2.1 GB heap limit that puts the
 * practical breaking point near 34 MB, and a worker that crosses it dies
 * with "JavaScript heap out of memory", taking every other in-flight
 * request on that worker with it. PM2's max_memory_restart does not catch
 * this: it monitors the cluster master, not the forked workers.
 *
 * 20 MB caps the parse near ~1.25 GB, leaving headroom for the rest of the
 * worker, while still being double the largest sheet actually in use.
 */
const MEMORY_HEAVY_UPLOAD_MAX_BYTES =
  Number(process.env.RESULT_UPLOAD_PARSE_MAX_BYTES) || 20 * 1024 * 1024;

/**
 * Rejects a file that would OOM the parser, with a message the uploader can
 * act on, instead of letting it take the worker down.
 */
function enforceParseSizeLimit(req, res, uploadType) {
  if (!MEMORY_HEAVY_UPLOAD_TYPES.has(uploadType)) return true;

  const size = req.file?.size || 0;
  if (size <= MEMORY_HEAVY_UPLOAD_MAX_BYTES) return true;

  const asMb = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
  res.status(413).json({
    message:
      `This file is ${asMb(size)}, larger than the ${asMb(MEMORY_HEAVY_UPLOAD_MAX_BYTES)} limit for ` +
      `${uploadType.replace(/_/g, " ").toLowerCase()} uploads. Please split it into smaller files ` +
      `(for example one per class) and upload them separately.`,
  });
  return false;
}

/**
 * Single entry point for every result upload. The upload_type field decides
 * which sheet parser runs, so the client sends one request shape regardless
 * of which of the five sheets is being loaded.
 */
exports.uploadResults = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const uploadType = String(req.body.upload_type || "ALL_STUDENTS").trim().toUpperCase();
  if (!UPLOAD_TYPES.has(uploadType)) {
    return res.status(400).json({
      message: `Unknown upload type "${uploadType}". Expected one of: ${[...UPLOAD_TYPES].join(", ")}.`,
    });
  }

  const scope = parseUploadScope(req, res);
  if (!scope) return;

  // Checked after parseUploadScope so req.file is populated, and before any
  // parsing begins.
  if (!enforceParseSizeLimit(req, res, uploadType)) return;

  try {
    let result;
    switch (uploadType) {
      case "ANSWER_KEY":
        result = await resultUploadService.ingestAnswerKey(scope);
        break;
      case "STUDENT_RESPONSES":
        result = await resultUploadService.ingestStudentResponses(scope);
        break;
      case "BLOCK_SUMMARY":
        result = await resultUploadService.ingestBlockSummary(scope);
        break;
      default:
        result = await resultUploadService.ingestStudentSheet({ ...scope, uploadType });
        break;
    }

    return res.json(result);
  } catch (err) {
    return handleUploadError(res, err, `Result upload (${uploadType})`);
  }
};

exports.uploadAnswerKey = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scope = parseUploadScope(req, res);
  if (!scope) return;
  if (!enforceParseSizeLimit(req, res, "ANSWER_KEY")) return;

  try {
    return res.json(await resultUploadService.ingestAnswerKey(scope));
  } catch (err) {
    return handleUploadError(res, err, "Answer key upload");
  }
};

exports.uploadStudentResponses = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scope = parseUploadScope(req, res);
  if (!scope) return;

  try {
    return res.json(await resultUploadService.ingestStudentResponses(scope));
  } catch (err) {
    return handleUploadError(res, err, "Student responses upload");
  }
};

exports.uploadBlockSummary = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scope = parseUploadScope(req, res);
  if (!scope) return;
  if (!enforceParseSizeLimit(req, res, "BLOCK_SUMMARY")) return;

  try {
    return res.json(await resultUploadService.ingestBlockSummary(scope));
  } catch (err) {
    return handleUploadError(res, err, "Block summary upload");
  }
};

exports.listUploads = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scopeParsed = parseCommonOptionalScope(req.query);
  if (scopeParsed.error) {
    return res.status(400).json({ message: scopeParsed.error });
  }

  const uploadType = normalizeText(req.query.upload_type);
  if (uploadType && !UPLOAD_TYPES.has(uploadType.toUpperCase())) {
    return res.status(400).json({
      message: `Unknown upload type "${uploadType}". Expected one of: ${[...UPLOAD_TYPES].join(", ")}.`,
    });
  }

  try {
    const uploads = await resultUploadService.listUploads({
      sessionId: scopeParsed.value.sessionId,
      scholarshipId: scopeParsed.value.scholarshipId,
      classValue: scopeParsed.value.classValue,
      uploadType: uploadType ? uploadType.toUpperCase() : null,
      limit: req.query.limit,
    });
    return res.json({ uploads });
  } catch (err) {
    console.error("List result uploads failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.listUploadErrors = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const uploadParsed = parseRequiredNumber(req.params.upload_id, "upload_id");
  if (uploadParsed.error) {
    return res.status(400).json({ message: uploadParsed.error });
  }

  try {
    const data = await resultUploadService.listUploadErrors({
      uploadId: uploadParsed.value,
      errorType: normalizeText(req.query.error_type),
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json(data);
  } catch (err) {
    console.error("List result upload errors failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
exports.getSummaryReport = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  try {
    const data = await resultService.getSummaryReportData({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
    });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error in getSummaryReport:", error);
    res.status(500).json({ message: "Failed to fetch summary report." });
  }
};

exports.getSubjectWiseFilterOptions = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  const examType = String(req.query.exam_type || '').toUpperCase();
  if (!examType) return res.status(400).json({ message: "exam_type is required" });

  const filters = buildOptionalFiltersFromQuery(req.query);

  try {
    const data = await resultService.getSubjectWiseFilterOptions({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      examType,
      filters
    });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error in getSubjectWiseFilterOptions:", error);
    res.status(500).json({ message: "Failed to fetch filter options." });
  }
};

exports.getSubjectWiseReport = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  const examType = String(req.query.exam_type || '').toUpperCase();
  if (!examType) return res.status(400).json({ message: "exam_type is required" });

  let questionGroups = [];
  if (req.query.question_groups) {
    questionGroups = String(req.query.question_groups).split(',').filter(Boolean);
  }

  const filters = buildOptionalFiltersFromQuery(req.query);

  try {
    const data = await resultService.getSubjectWiseReportData({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      examType,
      questionGroups,
      filters
    });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error in getSubjectWiseReport:", error);
    res.status(500).json({ message: "Failed to fetch subject-wise report." });
  }
};

exports.getSelectionSummary = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  try {
    const summary = await resultService.getSelectionSummary({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: {
        district: normalizeText(req.query.district),
        block: normalizeText(req.query.block),
        school: normalizeText(req.query.school),
        category: normalizeText(req.query.category),
        gender: normalizeText(req.query.gender),
      },
    });

    return res.json(summary);
  } catch (err) {
    console.error("Result summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getFilterOptions = async (req, res) => {
  if (!ensureScert(req, res)) return;

  try {
    const filters = await resultService.getFilterOptions({
      district: normalizeText(req.query.district),
      block: normalizeText(req.query.block),
    });

    return res.json(filters);
  } catch (err) {
    console.error("Result filter options error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getLatestUploadView = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  try {
    const data = await resultService.getLatestUploadView({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
    });

    return res.json(data);
  } catch (err) {
    console.error("Result latest upload view error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getAnalytics = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  try {
    const analytics = await resultService.getAnalytics({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: {
        district: normalizeText(req.query.district),
        block: normalizeText(req.query.block),
        school: normalizeText(req.query.school),
        category: normalizeText(req.query.category),
        gender: normalizeText(req.query.gender),
      },
    });

    return res.json(analytics);
  } catch (error) {
    console.error("Error generating charts:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ==========================================
// VERIFICATION APIs
// ==========================================

/** Every verification-tab endpoint needs the same required scope. */
function parseVerificationScope(req, res) {
  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) { res.status(400).json({ message: sessionParsed.error }); return null; }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) { res.status(400).json({ message: scholarshipParsed.error }); return null; }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) { res.status(400).json({ message: classParsed.error }); return null; }

  return {
    sessionId: sessionParsed.value,
    scholarshipId: scholarshipParsed.value,
    classValue: classParsed.value,
    page: req.query.page,
    limit: req.query.limit,
  };
}

exports.getStudents = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseVerificationScope(req, res);
  if (!scope) return;

  try {
    const data = await resultUploadService.listStudents({
      ...scope,
      search: normalizeText(req.query.search),
      onlySelected: String(req.query.only_selected) === "true",
      onlyUnmatched: String(req.query.only_unmatched) === "true",
      onlyAbsent: String(req.query.only_absent) === "true",
    });
    return res.json(data);
  } catch (err) {
    console.error("Error fetching result students:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getBlockSummaryList = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseVerificationScope(req, res);
  if (!scope) return;

  try {
    const data = await resultUploadService.listBlockSummary(scope);
    return res.json(data);
  } catch (err) {
    console.error("Error fetching block summary:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getAnswerKeys = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseVerificationScope(req, res);
  if (!scope) return;

  try {
    const data = await resultUploadService.listAnswerKeys({
      ...scope,
      paperCode: normalizeText(req.query.paper_code),
    });
    return res.json(data);
  } catch (err) {
    console.error("Error fetching answer keys:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getStudentResponses = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseVerificationScope(req, res);
  if (!scope) return;

  try {
    const data = await resultUploadService.listStudentResponses({
      ...scope,
      paperCode: normalizeText(req.query.paper_code),
      rollNumber: normalizeText(req.query.roll_number),
      onlyInvalid: String(req.query.only_invalid) === "true",
    });
    return res.json(data);
  } catch (err) {
    console.error("Error fetching student responses:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getGeneratedScores = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseVerificationScope(req, res);
  if (!scope) return;

  try {
    const data = await resultUploadService.listGeneratedScores({
      ...scope,
      rollNumber: normalizeText(req.query.roll_number),
    });
    return res.json(data);
  } catch (err) {
    console.error("Error fetching generated scores:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getUploadErrors = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseVerificationScope(req, res);
  if (!scope) return;

  try {
    const data = await resultUploadService.listErrorsByScope({
      ...scope,
      uploadId: normalizeText(req.query.upload_id),
      errorType: normalizeText(req.query.error_type),
    });
    return res.json(data);
  } catch (err) {
    console.error("Error fetching upload errors:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getTopRankers = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scopeParsed = parseCommonOptionalScope(req.query);
  if (scopeParsed.error) {
    return res.status(400).json({ message: scopeParsed.error });
  }

  const rawPage = Number.parseInt(String(req.query.page || "1"), 10);
  const rawLimit = Number.parseInt(String(req.query.limit || "25"), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 25;

  try {
    const result = await resultService.getTopRankers({
      ...scopeParsed.value,
      page,
      limit,
    });

    return res.json(result);
  } catch (err) {
    console.error("Result top rankers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getTopDistricts = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scopeParsed = parseCommonOptionalScope(req.query);
  if (scopeParsed.error) {
    return res.status(400).json({ message: scopeParsed.error });
  }

  try {
    const result = await resultService.getTopDistricts(scopeParsed.value);
    return res.json(result);
  } catch (err) {
    console.error("Result top districts error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getTopBlocks = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scopeParsed = parseCommonOptionalScope(req.query);
  if (scopeParsed.error) {
    return res.status(400).json({ message: scopeParsed.error });
  }

  try {
    const result = await resultService.getTopBlocks(scopeParsed.value);
    return res.json(result);
  } catch (err) {
    console.error("Result top blocks error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getTopSchools = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const scopeParsed = parseCommonOptionalScope(req.query);
  if (scopeParsed.error) {
    return res.status(400).json({ message: scopeParsed.error });
  }

  try {
    const result = await resultService.getTopSchools(scopeParsed.value);
    return res.json(result);
  } catch (err) {
    console.error("Result top schools error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getSchoolParticipationSummary = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  try {
    const result = await resultService.getSchoolParticipationSummary({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
    });
    return res.json(result);
  } catch (err) {
    console.error("Result school participation summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getSchoolParticipation = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  const rawPage = Number.parseInt(String(req.query.page || "1"), 10);
  const rawLimit = Number.parseInt(String(req.query.limit || "25"), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 25;

  try {
    const result = await resultService.getSchoolParticipation({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
      page,
      limit,
    });
    return res.json(result);
  } catch (err) {
    console.error("Result school participation error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getHierarchySummary = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  const level = String(req.query.level || "").trim().toLowerCase();
  if (!ALLOWED_HIERARCHY_LEVELS.has(level)) {
    return res.status(400).json({
      message: "level must be one of: district, block, school",
    });
  }

  const filters = buildOptionalFiltersFromQuery(req.query);

  if (level === "block" && !filters.district) {
    return res.status(400).json({
      message: "district is required when level=block",
    });
  }

  if (level === "school" && (!filters.district || !filters.block)) {
    return res.status(400).json({
      message: "district and block are required when level=school",
    });
  }

  try {
    const result = await resultService.getHierarchySummary({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      level,
      filters,
    });

    return res.json(result);
  } catch (err) {
    console.error("Result hierarchy summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ==========================================
// SELECTED STUDENTS DOWNLOAD (PDF / XLSX)
// ==========================================

const ATTENDANCE_LABELS = { P: "Present", A: "Absent" };

/** Shared column set for both the PDF and XLSX selected-students export. */
const SELECTED_STUDENTS_COLUMNS = [
  { key: "sno", label: "S.No", pdfWidth: 32, xlsxWidth: 6, align: "right" },
  { key: "district_name", label: "District", pdfWidth: 70, xlsxWidth: 16 },
  { key: "block_name", label: "Block", pdfWidth: 70, xlsxWidth: 16 },
  { key: "block_code", label: "Block Code", pdfWidth: 44, xlsxWidth: 10 },
  { key: "school_name", label: "School Name", pdfWidth: 130, xlsxWidth: 32 },
  { key: "roll_number", label: "Roll No.", pdfWidth: 60, xlsxWidth: 14 },
  { key: "app_display_id", label: "Application ID", pdfWidth: 60, xlsxWidth: 16 },
  { key: "sr_number", label: "SR No.", pdfWidth: 50, xlsxWidth: 12 },
  { key: "student_name", label: "Student Name", pdfWidth: 100, xlsxWidth: 24 },
  { key: "father_name", label: "Father's Name", pdfWidth: 100, xlsxWidth: 24 },
  { key: "mother_name", label: "Mother's Name", pdfWidth: 100, xlsxWidth: 24 },
  { key: "dob", label: "Date of Birth", pdfWidth: 55, xlsxWidth: 14 },
  { key: "gender", label: "Gender", pdfWidth: 45, xlsxWidth: 10 },
  { key: "category", label: "Category", pdfWidth: 45, xlsxWidth: 10 },
  { key: "is_divyang", label: "Divyang", pdfWidth: 40, xlsxWidth: 9 },
  { key: "aadhaar_number", label: "Aadhaar No.", pdfWidth: 65, xlsxWidth: 16 },
  { key: "mobile_number", label: "Mobile No.", pdfWidth: 55, xlsxWidth: 14 },
  { key: "prev_school_name", label: "Previous School", pdfWidth: 100, xlsxWidth: 26 },
  { key: "school_type_code", label: "School Type", pdfWidth: 50, xlsxWidth: 12 },
  { key: "school_category_code", label: "School Category", pdfWidth: 55, xlsxWidth: 14 },
  { key: "center_code", label: "Center Code", pdfWidth: 50, xlsxWidth: 12 },
  { key: "center_name", label: "Center Name", pdfWidth: 100, xlsxWidth: 24 },
  { key: "paper_set", label: "Paper Set", pdfWidth: 45, xlsxWidth: 10 },
  { key: "mat_marks", label: "MAT Marks", pdfWidth: 45, xlsxWidth: 11, align: "right" },
  { key: "sat_marks", label: "SAT Marks", pdfWidth: 45, xlsxWidth: 11, align: "right" },
  { key: "scst_mat_marks", label: "SC/ST MAT", pdfWidth: 45, xlsxWidth: 11, align: "right" },
  { key: "scst_sat_marks", label: "SC/ST SAT", pdfWidth: 45, xlsxWidth: 11, align: "right" },
  { key: "total_marks", label: "Total Marks", pdfWidth: 50, xlsxWidth: 12, align: "right" },
  { key: "mat_attendance", label: "MAT Attendance", pdfWidth: 55, xlsxWidth: 14 },
  { key: "sat_attendance", label: "SAT Attendance", pdfWidth: 55, xlsxWidth: 14 },
  { key: "overall_attendance", label: "Overall Attendance", pdfWidth: 55, xlsxWidth: 16 },
];

function formatExportRow(row, index) {
  return {
    sno: index + 1,
    district_name: row.district_name || "-",
    block_name: row.block_name || "-",
    block_code: row.block_code || "-",
    school_name: row.school_name || "-",
    roll_number: row.roll_number || "-",
    app_display_id: row.app_display_id || "-",
    sr_number: row.sr_number || "-",
    student_name: row.student_name || "-",
    father_name: row.father_name || "-",
    mother_name: row.mother_name || "-",
    dob: row.dob || (row.dob_invalid ? "Invalid" : "-"),
    gender: row.gender || "-",
    category: row.category || "-",
    is_divyang: row.is_divyang ? "Yes" : "No",
    aadhaar_number: row.aadhaar_number || "-",
    mobile_number: row.mobile_number || "-",
    prev_school_name: row.prev_school_name || "-",
    school_type_code: row.school_type_code || "-",
    school_category_code: row.school_category_code || "-",
    center_code: row.center_code || "-",
    center_name: row.center_name || "-",
    paper_set: row.paper_set || "-",
    mat_marks: row.mat_marks ?? "-",
    sat_marks: row.sat_marks ?? "-",
    scst_mat_marks: row.scst_mat_marks ?? "-",
    scst_sat_marks: row.scst_sat_marks ?? "-",
    total_marks: row.total_marks ?? "-",
    mat_attendance: ATTENDANCE_LABELS[row.mat_attendance] || "-",
    sat_attendance: ATTENDANCE_LABELS[row.sat_attendance] || "-",
    overall_attendance: ATTENDANCE_LABELS[row.overall_attendance] || "-",
  };
}

exports.exportSelectedStudents = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  const format = String(req.query.format || "xlsx").toLowerCase();
  if (!["xlsx", "pdf"].includes(format)) {
    return res.status(400).json({ message: "format must be xlsx or pdf" });
  }

  const filters = buildOptionalFiltersFromQuery(req.query);

  try {
    const [rows, { sessionName, scholarshipName }] = await Promise.all([
      resultService.getSelectedStudentsExport({
        sessionId: sessionParsed.value,
        scholarshipId: scholarshipParsed.value,
        classValue: classParsed.value,
        filters,
      }),
      resultService.getSessionAndScholarshipNames({
        sessionId: sessionParsed.value,
        scholarshipId: scholarshipParsed.value,
      }),
    ]);

    const exportRows = rows.map(formatExportRow);
    const baseName = `selected_students_class${classParsed.value}_session${sessionParsed.value}_scholarship${scholarshipParsed.value}`;

    if (format === "xlsx") {
      return await sendTableXlsx(res, {
        filename: `${baseName}.xlsx`,
        sheetName: `Class ${classParsed.value} Selected`,
        columns: SELECTED_STUDENTS_COLUMNS.map((c) => ({ key: c.key, label: c.label, width: c.xlsxWidth })),
        rows: exportRows,
      });
    }

    return sendTablePdf(res, {
      filename: `${baseName}.pdf`,
      title: `Selected Students — Class ${classParsed.value}`,
      metaLines: [
        `${scholarshipName} · Session ${sessionName}`,
        filters.district ? `District: ${filters.district}` : null,
        filters.block ? `Block: ${filters.block}` : null,
        `Total: ${exportRows.length}`,
      ].filter(Boolean),
      columns: SELECTED_STUDENTS_COLUMNS.map((c) => ({ key: c.key, label: c.label, width: c.pdfWidth, align: c.align || "left" })),
      rows: exportRows,
      bodyFontSize: 6,
      margin: 20,
    });
  } catch (err) {
    console.error("Export selected students failed:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal server error" });
    }
  }
};

exports.getCharts = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    return res.status(400).json({ message: sessionParsed.error });
  }

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    return res.status(400).json({ message: scholarshipParsed.error });
  }

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) {
    return res.status(400).json({ message: classParsed.error });
  }

  const chartTypesParsed = parseRequestedChartTypes(req.query.types);
  if (chartTypesParsed.error) {
    return res.status(400).json({ message: chartTypesParsed.error });
  }

  try {
    const result = await resultService.getCharts({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
      types: chartTypesParsed.value,
    });
    return res.json(result);
  } catch (err) {
    console.error("Result charts error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getSchoolParticipationHierarchy = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  try {
    const data = await resultService.getSchoolParticipationHierarchy({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
    });
    return res.json(data);
  } catch (err) {
    console.error("School participation hierarchy error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getRemainingSchools = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });

  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));

  try {
    const data = await resultService.getRemainingSchools({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
      page,
      limit,
    });
    return res.json(data);
  } catch (err) {
    console.error("Remaining schools error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ==========================================
// EXAM ANALYTICAL REPORT APIs
// ==========================================

exports.getExamAnalyticsSummary = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });
  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });
  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  try {
    const data = await resultService.getExamAnalyticsSummary({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
    });
    return res.json(data);
  } catch (err) {
    console.error("Exam analytics summary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getExamAnalyticsCharts = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });
  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });
  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  const groupBy = req.query.group_by;
  if (!['gender', 'category', 'school_type', 'school_location'].includes(groupBy)) {
    return res.status(400).json({ message: "Invalid or missing group_by parameter. Allowed: gender, category, school_type, school_location" });
  }

  try {
    const data = await resultService.getExamAnalyticsCharts({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
      groupBy,
    });
    return res.json(data);
  } catch (err) {
    console.error("Exam analytics charts error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getExamAnalyticsTable = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });
  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });
  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  const level = req.query.level;
  if (!['district', 'block', 'school'].includes(level)) {
    return res.status(400).json({ message: "Invalid or missing level parameter. Allowed: district, block, school" });
  }

  try {
    const data = await resultService.getExamAnalyticsTable({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
      level,
    });
    return res.json(data);
  } catch (err) {
    console.error("Exam analytics table error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getExamAnalyticsFilters = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });
  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });
  const classParsed = parseRequiredNumber(req.query.class, "class");
  if (classParsed.error) return res.status(400).json({ message: classParsed.error });

  try {
    const data = await resultService.getExamAnalyticsFilters({
      sessionId: sessionParsed.value,
      scholarshipId: scholarshipParsed.value,
      classValue: classParsed.value,
      filters: buildOptionalFiltersFromQuery(req.query),
    });
    return res.json(data);
  } catch (err) {
    console.error("Exam analytics filters error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ==========================================
// OVERALL PERFORMANCE REPORT API
// ==========================================

exports.getOverallPerformanceReport = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) return res.status(400).json({ message: sessionParsed.error });
  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) return res.status(400).json({ message: scholarshipParsed.error });

  // Accept comma-separated classes (e.g., "6,9") or single class
  const rawClass = String(req.query.class || "").trim();
  if (!rawClass) return res.status(400).json({ message: "class is required" });
  const classValues = rawClass.split(",").map(c => c.trim()).filter(Boolean);

  // Optional drill-down scope. district is a name, block is its numeric
  // code (unambiguous state-wide) — both resolved/validated against the
  // canonical master data inside the service.
  const district = normalizeText(req.query.district);
  const block = normalizeText(req.query.block);

  try {
    // Run each class in parallel and return a map { "6": reportData, "9": reportData }
    const results = await Promise.all(
      classValues.map(async (cls) => {
        const data = await resultService.getOverallPerformanceAggregates({
          sessionId: sessionParsed.value,
          scholarshipId: scholarshipParsed.value,
          classValue: cls,
          district,
          block,
        });
        return [cls, data];
      })
    );
    const payload = Object.fromEntries(results);
    return res.json(payload);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    console.error("Overall performance report error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Static district/block nav list for the report's left-side drill-down —
// no DB query, just the same master data getCanonicalDistricts/
// getCanonicalBlocksForDistrict already read for name resolution above.
exports.getOverallPerformanceGeoMaster = async (req, res) => {
  if (!ensureScert(req, res)) return;

  const districts = resultService.getCanonicalDistricts().map((d) => ({
    code: d.code,
    name: d.name,
    blocks: resultService.getCanonicalBlocksForDistrict(d.name).map((b) => ({ code: b.code, name: b.name })),
  }));

  return res.json({ districts });
};

// ==========================================
// FULL RESULT (agency ALL DATA sheet, SCERT only)
// ==========================================

/** Shared scope parsing for the three Full Result endpoints. */
function parseFullResultScope(req, res) {
  const sessionParsed = parseRequiredNumber(req.query.session_id, "session_id");
  if (sessionParsed.error) {
    res.status(400).json({ message: sessionParsed.error });
    return null;
  }
  const scholarshipParsed = parseRequiredNumber(req.query.scholarship_id, "scholarship_id");
  if (scholarshipParsed.error) {
    res.status(400).json({ message: scholarshipParsed.error });
    return null;
  }
  const classValue = normalizeText(req.query.class);
  if (!classValue) {
    res.status(400).json({ message: "class is required" });
    return null;
  }

  return {
    sessionId: sessionParsed.value,
    scholarshipId: scholarshipParsed.value,
    classValue,
    filters: {
      district: normalizeText(req.query.district),
      block: normalizeText(req.query.block),
      school: normalizeText(req.query.school),
    },
  };
}

exports.getFullResult = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const data = await fullResultService.getFullResult({
      ...scope,
      page: req.query.page,
      pageSize: req.query.page_size,
    });
    return res.json(data);
  } catch (err) {
    console.error("Full result error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getFullResultFilterOptions = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const options = await fullResultService.getFullResultFilterOptions({
      sessionId: scope.sessionId,
      scholarshipId: scope.scholarshipId,
      classValue: scope.classValue,
      district: scope.filters.district,
      block: scope.filters.block,
    });
    return res.json(options);
  } catch (err) {
    console.error("Full result filter options error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * A full unfiltered class is 40k+ rows across 30-odd columns. Laying that
 * out as a paginated PDF runs to thousands of pages and takes far longer
 * than the reverse proxy will wait, so the PDF is capped and the message
 * points at the Excel export, which has no such limit — a spreadsheet is
 * the right shape for the whole sheet anyway, since that is the format it
 * arrived in.
 */
const FULL_RESULT_PDF_MAX_ROWS = 12000;

/** Shared by both export paths: every row for the current filters. */
async function collectFullResultRows(scope) {
  const columns = await fullResultService.getExportColumns(scope);
  const rows = [];
  for await (const batch of fullResultService.iterateFullResult({ ...scope, columns })) {
    rows.push(...batch);
  }
  return { columns, rows };
}

function fullResultFileSuffix(scope) {
  return [scope.filters.district, scope.filters.block, scope.filters.school]
    .filter(Boolean)
    .join("_")
    .replace(/[^A-Za-z0-9]+/g, "_");
}

exports.downloadFullResultPdf = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const total = await fullResultService.countFullResult(scope);
    if (total === 0) {
      return res.status(404).json({ message: "No rows match the selected filters." });
    }
    if (total > FULL_RESULT_PDF_MAX_ROWS) {
      return res.status(413).json({
        message:
          `This selection has ${total.toLocaleString("en-IN")} rows, which is too many for a single PDF ` +
          `(limit ${FULL_RESULT_PDF_MAX_ROWS.toLocaleString("en-IN")}). ` +
          `Use "Export Excel" for the complete sheet, or narrow it with the district, block or school filter.`,
      });
    }

    const { columns, rows } = await collectFullResultRows(scope);
    const suffix = fullResultFileSuffix(scope);

    return await sendTablePdf(res, {
      filename: `FULL_RESULT_CLASS_${scope.classValue}${suffix ? `_${suffix}` : ""}.pdf`,
      title: `Full Result — Class ${scope.classValue}`,
      metaLines: [
        scope.filters.district ? `District: ${scope.filters.district}` : null,
        scope.filters.block ? `Block: ${scope.filters.block}` : null,
        scope.filters.school ? `School: ${scope.filters.school}` : null,
        `Total students: ${total.toLocaleString("en-IN")}`,
      ].filter(Boolean),
      columns: columns.map((c) => ({ key: c.key, label: c.header, width: c.width, align: c.align })),
      rows,
      layout: "landscape",
      bodyFontSize: columns.length > 24 ? 6 : 7.5,
      margin: 18,
    });
  } catch (err) {
    console.error("Full result PDF error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.end();
  }
};

/**
 * Excel export — the whole sheet, uncapped. This is the route for a
 * complete class: the workbook stays small, opens in seconds, and matches
 * the format the agency supplied in the first place.
 */
exports.downloadFullResultXlsx = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const total = await fullResultService.countFullResult(scope);
    if (total === 0) {
      return res.status(404).json({ message: "No rows match the selected filters." });
    }

    const { columns, rows } = await collectFullResultRows(scope);
    const suffix = fullResultFileSuffix(scope);

    return await sendTableXlsx(res, {
      filename: `FULL_RESULT_CLASS_${scope.classValue}${suffix ? `_${suffix}` : ""}.xlsx`,
      sheetName: `Class ${scope.classValue}`,
      columns: columns.map((c) => ({
        key: c.key,
        label: c.header,
        width: Math.max(10, Math.round((c.width || 90) / 6)),
      })),
      rows,
    });
  } catch (err) {
    console.error("Full result XLSX error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.end();
  }
};

// ==========================================
// SELECTED STUDENTS (official list, SCERT only)
// ==========================================

/** Session name drives the title year on both the sheet and the cover. */
async function loadSessionName(sessionId) {
  try {
    const res = await pool.query(
      `SELECT session_name FROM scert_db.academic_sessions WHERE session_id = $1`,
      [sessionId]
    );
    return res.rows[0]?.session_name || null;
  } catch {
    return null;
  }
}

exports.getSelectedStudentsList = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const [data, sessionName] = await Promise.all([
      selectedStudentsService.getSelectedStudents({
        ...scope,
        page: req.query.page,
        pageSize: req.query.page_size,
      }),
      loadSessionName(scope.sessionId),
    ]);

    return res.json({
      ...data,
      title: selectedStudentsSheet.sheetTitle(scope.classValue, sessionName),
      title_en: selectedStudentsSheet.sheetTitleEn(scope.classValue, sessionName),
    });
  } catch (err) {
    console.error("Selected students error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getSelectedStudentsFilterOptions = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const options = await selectedStudentsService.getSelectedStudentsFilterOptions({
      sessionId: scope.sessionId,
      scholarshipId: scope.scholarshipId,
      classValue: scope.classValue,
      district: scope.filters.district,
      block: scope.filters.block,
    });
    return res.json(options);
  } catch (err) {
    console.error("Selected students filter options error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function collectSelectedStudentRows(scope) {
  const rows = [];
  for await (const batch of selectedStudentsService.iterateSelectedStudents(scope)) {
    rows.push(...batch);
  }
  return rows;
}

/**
 * The PDF's sections: one per block, in block-code order, each closed by
 * a total bar. Every block after the first starts on a new page.
 */
async function collectSelectedStudentBlocks(scope) {
  const blocks = [];
  let current = null;
  for await (const batch of selectedStudentsService.iterateSelectedStudents({ ...scope, byBlock: true })) {
    for (const row of batch) {
      if (!current || current.key !== row.block_key) {
        current = { key: row.block_key, block: row.block, district: row.district, rows: [] };
        blocks.push(current);
      }
      current.rows.push(row);
    }
  }
  return blocks.map((b) => ({
    rows: b.rows,
    totalLabel:
      `Total selected in ${b.block || "Unknown block"}` +
      `${b.district ? ` (${b.district})` : ""}: ${b.rows.length.toLocaleString("en-IN")}`,
  }));
}

exports.downloadSelectedStudentsPdf = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const total = await selectedStudentsService.countSelectedStudents(scope);
    if (total === 0) {
      return res.status(404).json({ message: "No selected students match the selected filters." });
    }

    const [blocks, sessionName] = await Promise.all([
      collectSelectedStudentBlocks(scope),
      loadSessionName(scope.sessionId),
    ]);

    // Whether a Devanagari face is available has to be known before the
    // title is chosen, and registerFont needs the document — so the font
    // is probed against a throwaway document first, and the same answer
    // then drives the cover page, the title text and the title font.
    const hindiAvailable = frontPage.isDevanagariAvailable();
    const suffix = fullResultFileSuffix(scope);

    return await sendTablePdf(res, {
      filename: `SELECTED_STUDENTS_CLASS_${scope.classValue}${suffix ? `_${suffix}` : ""}.pdf`,
      title: hindiAvailable
        ? selectedStudentsSheet.sheetTitle(scope.classValue, sessionName)
        : selectedStudentsSheet.sheetTitleEn(scope.classValue, sessionName),
      titleFont: hindiAvailable ? frontPage.HINDI_FONT_KEY : null,
      metaLines: [
        scope.filters.district ? `District: ${scope.filters.district}` : null,
        scope.filters.block ? `Block: ${scope.filters.block}` : null,
        scope.filters.school ? `School: ${scope.filters.school}` : null,
        `Total selected: ${total.toLocaleString("en-IN")}`,
      ].filter(Boolean),
      columns: selectedStudentsSheet.exportColumns().map((c) => ({
        key: c.key, label: c.header, width: c.pdfWidth || c.width, align: c.align,
      })),
      groups: blocks,
      // The whole document is landscape, cover included — a 15-column
      // table has no chance of fitting on a portrait page.
      layout: "landscape",
      bodyFontSize: 8,
      margin: 20,
      prepareDoc: (doc) => frontPage.registerDevanagari(doc),
      coverPage: (doc) => frontPage.drawFrontPage(doc, {
        classValue: scope.classValue,
        sessionName,
        examDate: normalizeText(req.query.exam_date),
        hindiAvailable,
      }),
    });
  } catch (err) {
    console.error("Selected students PDF error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.end();
  }
};

/**
 * Excel keeps the Devanagari title unconditionally — XLSX stores Unicode
 * text directly, with no font to embed.
 */
exports.downloadSelectedStudentsXlsx = async (req, res) => {
  if (!ensureScert(req, res)) return;
  const scope = parseFullResultScope(req, res);
  if (!scope) return;

  try {
    const total = await selectedStudentsService.countSelectedStudents(scope);
    if (total === 0) {
      return res.status(404).json({ message: "No selected students match the selected filters." });
    }

    const [rows, sessionName] = await Promise.all([
      collectSelectedStudentRows(scope),
      loadSessionName(scope.sessionId),
    ]);
    const suffix = fullResultFileSuffix(scope);

    return await sendTableXlsx(res, {
      filename: `SELECTED_STUDENTS_CLASS_${scope.classValue}${suffix ? `_${suffix}` : ""}.xlsx`,
      sheetName: `Class ${scope.classValue}`,
      titleRow: selectedStudentsSheet.sheetTitle(scope.classValue, sessionName),
      columns: selectedStudentsSheet.exportColumns().map((c) => ({
        key: c.key,
        label: c.header,
        width: Math.max(10, Math.round((c.width || 90) / 5)),
      })),
      rows,
    });
  } catch (err) {
    console.error("Selected students XLSX error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal server error" });
    }
    return res.end();
  }
};

// ==========================================
// VERIFICATION APIs
// ==========================================
