const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/beo.assignement.controller");

/**
 * ASSIGN CENTER + SUBMIT APPLICATIONS (BEO → SCERT)
 * POST /beo/applications/assign-center
 */
router.post(
  "/beo/applications/assign-center",
  verifyToken,
  controller.assignCenterAndSubmitApplications
);

module.exports = router;
