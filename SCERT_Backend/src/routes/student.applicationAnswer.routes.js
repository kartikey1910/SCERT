const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/student.application.controller");
const { uploadSingle } = require("../middleware/upload");
const fileUploadController = require("../controllers/fileUpload.controller");


// Student init
router.post(
  "/applications/:scholarship_id/init",
  verifyToken,
  controller.initApplication
);


router.put(
  "/applications/:application_id/answers",
  verifyToken,
  controller.saveAnswers
);

router.post(
  "/applications/:application_id/submit",
  verifyToken,
  controller.submitApplication
);

router.post(
  "/applications/:application_id/upload-file",
  verifyToken,
  uploadSingle("file"),
  fileUploadController.uploadFile
);

module.exports = router;
