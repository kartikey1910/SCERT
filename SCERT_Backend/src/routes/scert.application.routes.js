const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/scert.application.controller");

/**
 * 📥 SCERT Inbox
 * Applications submitted by BEO
 */
router.get(
  "/applications/inbox",
  verifyToken,
  controller.getInbox
);

/**
 * 📋 Get approved applications
 */
router.get(
  "/applications/approved",
  verifyToken,
  controller.getApprovedApplications
);

/**
 * 👀 View application (full details)
 */
router.get(
  "/applications/:application_id",
  verifyToken,
  controller.viewApplication
);

/**
 * ✏️ Edit answers (SCERT level)
 */
router.put(
  "/applications/:application_id/answers",
  verifyToken,
  controller.editAnswers
);

/**
 * 🔁 Change assigned center (before approval)
 */
router.put(
  "/applications/:application_id/change-center",
  verifyToken,
  controller.changeCenter
);

/**
 * 🔄 Return application to BEO
 */
router.post(
  "/applications/:application_id/return",
  verifyToken,
  controller.returnApplication
);

/**
 * ✅ Final approval (locks application)
 */
router.post(
  "/applications/:application_id/approve",
  verifyToken,
  controller.approveApplication
);

/**
 * 🏫 Centers (per scholarship)
 */
router.get(
  "/centers",
  verifyToken,
  controller.getCenters
);

module.exports = router;
