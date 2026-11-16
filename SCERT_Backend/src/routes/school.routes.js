const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const schoolController = require("../controllers/school.profile.controller");
const schoolAppController = require("../controllers/school.application.controller");
const schoolDocumentsController = require("../controllers/school.documents.controller");
const schoolResultController = require("../controllers/school.result.controller");
const schoolDashboardController = require("../controllers/school.dashboard.controller");

// Result — this school's own students. Declared before the
// "/applications/:application_id" param route further down so these fixed
// paths are never swallowed by it.
router.get("/result/students", verifyToken, schoolResultController.getSchoolResultStudents);
router.get("/result/selected", verifyToken, schoolResultController.getSchoolSelectedStudents);
router.get("/result/selected.pdf", verifyToken, schoolResultController.downloadSchoolSelectedStudentsPdf);
router.get("/result/selected.xlsx", verifyToken, schoolResultController.downloadSchoolSelectedStudentsXlsx);
// Per-student official score card (the Download button on each result row)
router.get("/result/scorecard.pdf", verifyToken, schoolResultController.downloadSchoolStudentScoreCard);

router.put(
  "/profile/complete",
  verifyToken,
  schoolController.completeProfile
);

router.put(
  "/profile/edit",
  verifyToken,
  schoolController.updateProfile
);

router.get("/profile", verifyToken, schoolController.getProfile);

// Application routes
router.get("/applications/counts", verifyToken, schoolAppController.getApplicationCounts);
router.get("/dashboard/nmmss-summary", verifyToken, schoolDashboardController.getNmmssSummary);
router.get("/applications/pending", verifyToken, schoolAppController.getPendingApplications);
router.get("/applications/submitted", verifyToken, schoolAppController.getSubmittedApplications);
router.get("/applications/rejected", verifyToken, schoolAppController.getRejectedApplications);
router.get("/applications/returned-by-beo", verifyToken, schoolAppController.getReturnedByBeoApplications);
router.get("/applications/drafts", verifyToken, schoolAppController.getDraftApplications);
router.get("/applications/approved", verifyToken, schoolDocumentsController.getApprovedApplications);

// IMPORTANT: keep "/applications/drafts" above this param route
router.get("/applications/:application_id", verifyToken, schoolAppController.getApplication);
router.put("/applications/:application_id/answers", verifyToken, schoolAppController.saveAnswers);
router.post("/applications/:application_id/submit", verifyToken, schoolAppController.submitApplication);
router.post("/applications/:application_id/return", verifyToken, schoolAppController.returnToStudent);
router.post("/applications/:application_id/reject", verifyToken, schoolAppController.rejectApplication);

module.exports = router;
