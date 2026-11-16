const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/verifyToken");
const scholarshipController = require("../controllers/scert.scholarship.controller");

router.post(
  "/scholarships",
  verifyToken,
  scholarshipController.createScholarship
);

router.put(
  "/scholarships/:id",
  verifyToken,
  scholarshipController.updateScholarship
);

router.get(
  "/scholarships",
  verifyToken,
  scholarshipController.getAllScholarships
);

router.get(
  "/scholarships/:id",
  verifyToken,
  scholarshipController.getScholarshipById
);


router.put(
  "/scholarships/:id/status",
  verifyToken,
  scholarshipController.updateScholarshipStatus
);

module.exports = router;
