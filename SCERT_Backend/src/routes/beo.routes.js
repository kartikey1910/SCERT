const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const beoController = require("../controllers/beo.profile.controller");
const beoSchoolsController = require("../controllers/beo.schools.controller");
const beoReportController = require("../controllers/beo.centerReport.controller");
const beoProgressReportController = require("../controllers/beo.progressReport.controller");
const beoDocumentsController = require("../controllers/beo.documents.controller");
const attendanceController = require(
  "../controllers/beo.examAttendance.controller"
);
const beoDashboardController = require("../controllers/beo.dashboard.controller");
const beoNotificationsController = require("../controllers/beo.notifications.controller");
const beoResultController = require("../controllers/beo.result.controller");
const scertFeatureLocksController = require("../controllers/scert.feature-locks.controller");

router.put(
  "/profile/complete",
  verifyToken,
  beoController.completeProfile
);

router.put(
  "/profile/edit",
  verifyToken,
  beoController.updateProfile
);

router.get("/profile", verifyToken, beoController.getProfile);

// Feature Locks
router.get("/feature-locks", verifyToken, scertFeatureLocksController.getBeoFeatureLocks);

router.get("/schools", verifyToken, beoSchoolsController.getAllSchools);

router.post(
  "/center-superintendent-reports",
  verifyToken,
  beoReportController.createCenterSuperintendentReport
);

router.get(
  "/center-superintendent-reports",
  verifyToken,
  beoReportController.getCenterSuperintendentReport
);

router.get(
  "/center-superintendent-reports/list",
  verifyToken,
  beoReportController.getBeoSubmittedReports
);

router.get(
  "/center-superintendent-reports/download.pdf",
  verifyToken,
  beoReportController.downloadCenterSuperintendentReportPdf
);

router.get(
  "/progress-reports/registration",
  verifyToken,
  beoProgressReportController.getRegistrationProgressReport
);

router.get(
  "/progress-reports/registration.pdf",
  verifyToken,
  beoProgressReportController.downloadRegistrationProgressReportPdf
);

router.get(
  "/progress-reports/nmmss-summary.pdf",
  verifyToken,
  beoProgressReportController.downloadNmmssProgressReportPdf
);

router.get(
  "/applications/approved",
  verifyToken,
  beoDocumentsController.getApprovedApplications
);

router.get(
  "/applications/approved/schools",
  verifyToken,
  beoDocumentsController.getApprovedApplicationSchools
);

router.get(
  "/nominal-roll",
  verifyToken,
  beoDocumentsController.getNominalRoll
);



router.post(
  "/centers/:center_id/attendance",
  verifyToken,
  attendanceController.uploadCenterAttendance
);

router.get(
  "/centers/:center_id/attendance",
  verifyToken,
  attendanceController.getCenterAttendanceForBEO
);

router.post(
  "/centers/:center_id/attendance-summary",
  verifyToken,
  attendanceController.uploadCenterAttendanceSummary
);

router.get(
  "/centers/:center_id/attendance-summary",
  verifyToken,
  attendanceController.getCenterAttendanceSummaryForBEO
);

// Notifications
router.get("/notifications", verifyToken, beoNotificationsController.getNotifications);
router.get("/dashboard/nmmss-summary", verifyToken, beoDashboardController.getNmmssSummary);

// Result — uploaded All-Students rows for schools in this BEO's block
router.get("/result/students", verifyToken, beoResultController.getBeoResultStudents);

// Result — official selected-candidates report for this block
router.get("/result/selected", verifyToken, beoResultController.getBeoSelectedStudents);
router.get("/result/selected.pdf", verifyToken, beoResultController.downloadBeoSelectedStudentsPdf);
router.get("/result/selected.xlsx", verifyToken, beoResultController.downloadBeoSelectedStudentsXlsx);

module.exports = router;
