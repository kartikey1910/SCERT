const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/verifyToken");
const { uploadSingle } = require("../middleware/upload");
const controller = require("../controllers/result.controller");
const publishController = require("../controllers/resultPublish.controller");

// A class-9 response workbook is ~31 MB (30k students x 100 questions x
// 3 sheets), so result uploads need a far larger ceiling than the 5 MB
// default used elsewhere in the app.
const RESULT_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;

const xlsxUpload = () =>
  uploadSingle("file", {
    maxFileSize: RESULT_UPLOAD_MAX_BYTES,
    allowedExtensions: [".xlsx"],
    allowedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    allowedLabel: "XLSX",
  });

/**
 * Ingesting millions of response rows takes longer than the app-wide
 * 120s response timeout, and the upload itself needs an unbounded request
 * timeout. Applied before multer so the socket survives the transfer.
 */
function allowLongRunningUpload(req, res, next) {
  req.setTimeout(0);
  res.setTimeout(15 * 60 * 1000);
  next();
}

// Unified entry point — upload_type selects the parser.
router.post(
  "/upload",
  verifyToken,
  allowLongRunningUpload,
  xlsxUpload(),
  controller.uploadResults
);

// Type-specific aliases, kept so existing clients keep working.
router.post(
  "/upload-answer-key",
  verifyToken,
  allowLongRunningUpload,
  xlsxUpload(),
  controller.uploadAnswerKey
);

router.post(
  "/upload-student-responses",
  verifyToken,
  allowLongRunningUpload,
  xlsxUpload(),
  controller.uploadStudentResponses
);

router.post(
  "/upload-block-summary",
  verifyToken,
  allowLongRunningUpload,
  xlsxUpload(),
  controller.uploadBlockSummary
);

// Upload registry + row-level errors
router.get("/uploads", verifyToken, controller.listUploads);
router.get("/uploads/:upload_id/errors", verifyToken, controller.listUploadErrors);

router.get("/summary", verifyToken, controller.getSelectionSummary);
router.get("/summary-report", verifyToken, controller.getSummaryReport);
router.get("/subject-wise-report", verifyToken, controller.getSubjectWiseReport);
router.get("/subject-wise/filter-options", verifyToken, controller.getSubjectWiseFilterOptions);
router.get("/filter-options", verifyToken, controller.getFilterOptions);
router.get("/latest-upload", verifyToken, controller.getLatestUploadView);
router.get("/analytics", verifyToken, controller.getAnalytics);
router.get("/top-rankers", verifyToken, controller.getTopRankers);
router.get("/top-districts", verifyToken, controller.getTopDistricts);
router.get("/top-blocks", verifyToken, controller.getTopBlocks);
router.get("/top-schools", verifyToken, controller.getTopSchools);
router.get(
  "/school-participation-summary",
  verifyToken,
  controller.getSchoolParticipationSummary
);
router.get(
  "/school-participation",
  verifyToken,
  controller.getSchoolParticipation
);
router.get(
  "/hierarchy-summary",
  verifyToken,
  controller.getHierarchySummary
);
router.get(
  "/selected-students/export",
  verifyToken,
  controller.exportSelectedStudents
);
router.get(
  "/school-participation-hierarchy",
  verifyToken,
  controller.getSchoolParticipationHierarchy
);
router.get(
  "/remaining-schools",
  verifyToken,
  controller.getRemainingSchools
);
router.get("/charts", verifyToken, controller.getCharts);

// Exam Analytical Report APIs
router.get("/exam-analytics/summary", verifyToken, controller.getExamAnalyticsSummary);
router.get("/exam-analytics/charts", verifyToken, controller.getExamAnalyticsCharts);
router.get("/exam-analytics/table", verifyToken, controller.getExamAnalyticsTable);
router.get("/exam-analytics/filters", verifyToken, controller.getExamAnalyticsFilters);

// Verification APIs
router.get("/students", verifyToken, controller.getStudents);
router.get("/block-summary", verifyToken, controller.getBlockSummaryList);
router.get("/answer-keys", verifyToken, controller.getAnswerKeys);
router.get("/student-responses", verifyToken, controller.getStudentResponses);
router.get("/generated-scores", verifyToken, controller.getGeneratedScores);
router.get("/upload-errors", verifyToken, controller.getUploadErrors);

// Overall Performance Report
router.get("/overall-performance-report", verifyToken, controller.getOverallPerformanceReport);
router.get("/overall-performance-report/geo", verifyToken, controller.getOverallPerformanceGeoMaster);

// Full Result — the agency ALL DATA sheet reproduced verbatim (SCERT only)
router.get("/full-result", verifyToken, controller.getFullResult);
router.get("/full-result/filter-options", verifyToken, controller.getFullResultFilterOptions);
router.get("/full-result.pdf", verifyToken, controller.downloadFullResultPdf);
router.get("/full-result.xlsx", verifyToken, controller.downloadFullResultXlsx);

// Selected Students — the official चयनित अभ्यर्थियों की सूची (SCERT only)
router.get("/selected-students", verifyToken, controller.getSelectedStudentsList);
router.get("/selected-students/filter-options", verifyToken, controller.getSelectedStudentsFilterOptions);
router.get("/selected-students.pdf", verifyToken, controller.downloadSelectedStudentsPdf);
router.get("/selected-students.xlsx", verifyToken, controller.downloadSelectedStudentsXlsx);

// Publish Result (SCERT only — role check lives in the controller,
// matching how the rest of this router handles authorisation)
router.get("/publish/status", verifyToken, publishController.getPublishStatus);
router.put("/publish", verifyToken, publishController.setPublishStatus);

module.exports = router;
