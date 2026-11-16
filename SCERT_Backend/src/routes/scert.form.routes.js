const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/scholarshipForm.controller");

router.post(
  "/scholarships/:id/fields",
  verifyToken,
  controller.addField
);

router.put(
  "/fields/:field_id",
  verifyToken,
  controller.updateField
);

router.post(
  "/fields/:field_id/options",
  verifyToken,
  controller.addFieldOption
);

router.put(
  "/scholarships/:id/fields/reorder",
  verifyToken,
  controller.reorderFields
);

router.put(
  "/fields/:field_id/options/reorder",
  verifyToken,
  controller.reorderOptions
);
module.exports = router;
