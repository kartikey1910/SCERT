const express = require("express");
const router = express.Router();
const scertController = require("../controllers/scert.roles.controller");
const verifyToken = require("../middleware/verifyToken");
const { uploadSingle } = require("../middleware/upload");
const controller = require("../controllers/scert.profile.controller");
const scertProgressReportController = require("../controllers/scert.progressReport.controller");
const beoReportController = require("../controllers/beo.centerReport.controller");
const beoCenterController = require("../controllers/beo.center.controller");
const scertDashboardController = require("../controllers/scert.dashboard.controller");
const scertCentersSummaryController = require("../controllers/scert.centersSummary.controller");
const attendanceController = require(
  "../controllers/beo.examAttendance.controller"
);

// later we will protect this with SCERT-only middleware
router.post("/school/create", scertController.createSchool);
router.post("/beo/create", scertController.createBeo);
router.post("/district/create", scertController.createDistrict);

router.get("/schools", scertController.getAllSchools);
router.get("/beos", scertController.getAllBeos);
router.get("/districts", scertController.getAllDistricts);
router.put("/users/:user_id/reset-password", verifyToken, scertController.resetUserPassword);
router.put("/users/:user_id/delete", verifyToken, scertController.deleteUser);

router.get("/profile", verifyToken, controller.getProfile);
router.put("/profile/edit", verifyToken, controller.editProfile);



router.get(
  "/center-superintendent-reports",
  verifyToken,
  beoReportController.getAllCenterSuperintendentReports
);

router.get(
  "/centers",
  verifyToken,
  beoCenterController.getAllCentersForScert
);

// List of Centers (SCERT reports)
router.get(
  "/list-centers/districts",
  verifyToken,
  scertCentersSummaryController.getDistrictCentersSummary
);
router.get(
  "/list-centers/districts/counts",
  verifyToken,
  scertCentersSummaryController.getDistrictStudentsCount
);
router.get(
  "/list-centers/blocks",
  verifyToken,
  scertCentersSummaryController.getBlockCentersSummary
);
router.get(
  "/list-centers/blocks/counts",
  verifyToken,
  scertCentersSummaryController.getBlockStudentsCount
);

router.get("/dashboard/nmmss-summary", verifyToken, scertDashboardController.getNmmssSummary);

router.get(
  "/progress-reports/registration/districts",
  verifyToken,
  scertProgressReportController.getDistrictWiseRegistrationProgress
);

router.get(
  "/progress-reports/registration/districts.pdf",
  verifyToken,
  scertProgressReportController.downloadDistrictWiseRegistrationProgressPdf
);

router.get(
  "/progress-reports/registration/blocks",
  verifyToken,
  scertProgressReportController.getBlockWiseRegistrationProgress
);

router.get(
  "/progress-reports/registration/blocks.pdf",
  verifyToken,
  scertProgressReportController.downloadBlockWiseRegistrationProgressPdf
);

router.get(
  "/progress-reports/registration/schools",
  verifyToken,
  scertProgressReportController.getSchoolWiseRegistrationProgress
);

router.get(
  "/progress-reports/registration/schools.pdf",
  verifyToken,
  scertProgressReportController.downloadSchoolWiseRegistrationProgressPdf
);

router.get(
  "/centers/:center_id/attendance",
  verifyToken,
  attendanceController.getCenterAttendanceForSCERT
);

router.get(
  "/centers/:center_id/attendance-summary",
  verifyToken,
  attendanceController.getCenterAttendanceSummaryForSCERT
);

// Rates configuration
const scertRatesController = require("../controllers/scert.rates.controller");
router.get("/rates/honorarium", verifyToken, scertRatesController.getHonorariumRates);
router.put("/rates/honorarium", verifyToken, scertRatesController.updateHonorariumRates);
router.get("/rates/system", verifyToken, scertRatesController.getSystemRates);
router.put("/rates/system", verifyToken, scertRatesController.updateSystemRates);

const scertNotificationsController = require("../controllers/scert.notifications.controller");
const scertFeatureLocksController = require("../controllers/scert.feature-locks.controller");

// Notifications
router.get("/notifications", verifyToken, scertNotificationsController.getNotifications);
router.post(
  "/notifications", 
  verifyToken, 
  uploadSingle("pdf", { allowedExtensions: [".pdf"], allowedMimeTypes: ["application/pdf"] }),
  scertNotificationsController.createNotification
);
router.delete("/notifications/:id", verifyToken, scertNotificationsController.deleteNotification);

// Feature Locks
router.get("/feature-locks", verifyToken, scertFeatureLocksController.getFeatureLocks);
router.put("/feature-locks", verifyToken, scertFeatureLocksController.toggleFeatureLock);
router.get("/student-access", verifyToken, scertFeatureLocksController.getStudentAccess);
router.put("/student-access", verifyToken, scertFeatureLocksController.setStudentAccess);

module.exports = router;
