const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/beo.center.controller");

router.get(
  "/centers/eligible-schools",
  verifyToken,
  controller.getEligibleSchoolsForCenters
);

router.post(
  "/centers",
  verifyToken,
  controller.createCenters
);

router.get(
  "/centers",
  verifyToken,
  controller.getCenters
);

router.put(
  "/centers/:center_id",
  verifyToken,
  controller.updateCenterSuperintendent
);

module.exports = router;
