const express = require("express");
const router = express.Router();
const studentController = require("../controllers/student.registration.controller");
const studentProfilecontroller = require("../controllers/student.profile.controller");
const applicationController = require("../controllers/student.application.controller");
const verifyToken = require("../middleware/verifyToken");



router.get(
  "/profile",
  verifyToken,
  studentProfilecontroller.getProfile
);

router.get(
  "/applications",
  applicationController.getMyApplications
);

router.get(
  "/applications/:scholarship_id/my",
  applicationController.getMyApplication
);

router.put(
  "/profile/complete",
  verifyToken,
  studentProfilecontroller.completeProfile
);

router.put(
  "/profile/edit",
  verifyToken,
  studentProfilecontroller.updateProfile
);


module.exports = router;
