const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/scert.nominalroll.controller");

/**
 * GET Nominal Roll Center-wise
 */
router.get(
  "/nominal-roll",
  verifyToken,
  controller.getNominalRoll
);

module.exports = router;
