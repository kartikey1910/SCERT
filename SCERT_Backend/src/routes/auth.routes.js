const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const verifyToken = require("../middleware/verifyToken");

router.post("/scert/create", authController.createScert);
router.post("/login", authController.login);

router.post(
  "/change-password", verifyToken, authController.changePassword);
// Also support PUT for semantic correctness.
router.put(
  "/change-password", verifyToken, authController.changePassword);

module.exports = router;
