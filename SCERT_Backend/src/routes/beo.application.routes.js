const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/beo.application.controller");
const { uploadSingle } = require("../middleware/upload");
const fileUploadController = require("../controllers/fileUpload.controller");

router.get(
  "/applications/inbox",
  verifyToken,
  controller.getInbox
);

router.get(
  "/applications/submitted-to-scert",
  verifyToken,
  controller.getSubmittedToScertApplications
);

router.get(
  "/applications/returned-by-scert",
  verifyToken,
  controller.getReturnedBySCERTApplications
);

router.get(
  "/applications/returned-to-school",
  verifyToken,
  controller.getReturnedToSchoolApplications
);

router.get(
  "/applications/approved",
  verifyToken,
  controller.getApprovedApplications
);

router.get(
  "/applications/:application_id",
  verifyToken,
  controller.viewApplication
);

router.put(
  "/applications/:application_id/answers",
  verifyToken,
  controller.editAnswers
);


router.post(
  "/applications/:application_id/return",
  verifyToken,
  controller.returnApplication
);

router.post(
  "/applications/:application_id/submit-to-scert",
  verifyToken,
  controller.submitToSCERT
);


// 🔹 Applications for center assignment
router.get(
  "/applications",
  verifyToken,
  controller.getApplicationsForCenterAssignment
);

// 🔹 Centers for scholarship
router.get(
  "/centers",
  verifyToken,
  controller.getCentersForScholarship
);

router.post(
  "/applications/:application_id/upload-file",
  verifyToken,
  uploadSingle("file"),
  fileUploadController.uploadFile
);

module.exports = router;
