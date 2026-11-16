const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/school.application.controller");
const { uploadSingle } = require("../middleware/upload");
const fileUploadController = require("../controllers/fileUpload.controller");

router.post(
  "/school/applications/:scholarship_id/init",
  verifyToken,
  controller.initApplication
);

router.put(
  "/school/applications/:application_id/answers",
  verifyToken,
  controller.saveAnswers
);

router.post(
  "/school/applications/:application_id/submit",
  verifyToken,
  controller.submitApplication
);

router.post(
  "/school/applications/:application_id/mark-submitted",
  verifyToken,
  controller.markSubmittedAtSchool
);

router.delete(
  "/school/applications/:application_id/draft",
  verifyToken,
  controller.deleteDraftApplication
);

router.get(
  "/school/applications/drafts",
  verifyToken,
  controller.getDraftApplications
);

router.get(
  "/school/applications/submitted",
  verifyToken,
  controller.getSubmittedApplications
);


router.get(
  "/school/applications/:application_id",
  verifyToken,
  controller.getApplication
);

router.post(
  "/applications/:application_id/return",
  verifyToken,
  controller.returnToStudent
);

router.post(
  "/school/applications/:application_id/upload-file",
  verifyToken,
  uploadSingle("file"),
  fileUploadController.uploadFile
);

module.exports = router;
