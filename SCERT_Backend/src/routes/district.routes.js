const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const districtController = require("../controllers/district.profile.controller");
const districtProgressReportController = require("../controllers/district.progressReport.controller");
const districtApprovedApplicationsController = require("../controllers/district.approvedApplications.controller");
const districtCentersController = require("../controllers/district.centers.controller");
const districtSubmittedApplicationsController = require("../controllers/district.submittedApplications.controller");
const attendanceController = require("../controllers/beo.examAttendance.controller");
const districtNotificationsController = require("../controllers/district.notifications.controller");
const districtDashboardController = require("../controllers/district.dashboard.controller");
const districtResultController = require("../controllers/district.result.controller");

router.put(
  "/profile/complete",
  verifyToken,
  districtController.completeProfile
);

router.put(
  "/profile/edit",
  verifyToken,
  districtController.editProfile
);

router.get("/profile", verifyToken, districtController.getProfile);
router.get("/dashboard/nmmss-summary", verifyToken, districtDashboardController.getNmmssSummary);
router.get("/dashboard/nmmss-summary.pdf", verifyToken, districtDashboardController.downloadNmmssSummaryPdf);
router.get("/beos", verifyToken, districtController.getBeos);

// Progress reports (student registration)
router.get(
  "/progress-reports/registration/districts",
  verifyToken,
  districtProgressReportController.getDistrictWiseRegistrationProgress
);
router.get(
  "/progress-reports/registration/districts.pdf",
  verifyToken,
  districtProgressReportController.downloadDistrictWiseRegistrationProgressPdf
);
router.get(
  "/progress-reports/registration/blocks",
  verifyToken,
  districtProgressReportController.getBlockWiseRegistrationProgress
);
router.get(
  "/progress-reports/registration/blocks.pdf",
  verifyToken,
  districtProgressReportController.downloadBlockWiseRegistrationProgressPdf
);
router.get(
  "/progress-reports/registration/schools",
  verifyToken,
  districtProgressReportController.getSchoolWiseRegistrationProgress
);
router.get(
  "/progress-reports/registration/schools.pdf",
  verifyToken,
  districtProgressReportController.downloadSchoolWiseRegistrationProgressPdf
);

// Approved applications (District scope)
router.get(
  "/applications/approved",
  verifyToken,
  districtApprovedApplicationsController.getApprovedApplications
);

// Submitted applications (BEO -> SCERT, District scope)
router.get(
  "/applications/submitted-summary",
  verifyToken,
  districtSubmittedApplicationsController.getSubmittedSummaryByBlock
);
router.get(
  "/applications/submitted",
  verifyToken,
  districtSubmittedApplicationsController.getSubmittedApplicationsByBlock
);
router.get(
  "/applications/:application_id",
  verifyToken,
  districtApprovedApplicationsController.getApplication
);

// List of centers (District scope)
router.get(
  "/centers",
  verifyToken,
  districtCentersController.getCenters
);

router.get(
  "/centers/:center_id/attendance",
  verifyToken,
  attendanceController.getCenterAttendanceForDistrict
);

router.get(
  "/centers/:center_id/attendance-summary",
  verifyToken,
  attendanceController.getCenterAttendanceSummaryForDistrict
);

// Notifications
router.get("/notifications", verifyToken, districtNotificationsController.getNotifications);

// Result — uploaded All-Students rows for schools in this district
router.get(
  "/result/students",
  verifyToken,
  districtResultController.getDistrictResultStudents
);

// Result — official selected-candidates report for this district
router.get(
  "/result/selected",
  verifyToken,
  districtResultController.getDistrictSelectedStudents
);
router.get(
  "/result/selected.pdf",
  verifyToken,
  districtResultController.downloadDistrictSelectedStudentsPdf
);
router.get(
  "/result/selected.xlsx",
  verifyToken,
  districtResultController.downloadDistrictSelectedStudentsXlsx
);

module.exports = router;
