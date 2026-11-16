const express = require("express");
const router = express.Router();
const { isStudentAccessEnabled } = require("../services/studentAccess.service");

/**
 * GET /api/public/student-access
 *
 * Whether the student side is open. The home page uses it to show or hide the
 * Student Login button, and the student login page uses it to show the form or
 * a "closed" notice. It reveals nothing but that one flag, and reads as closed
 * if anything goes wrong.
 */
router.get("/student-access", async (req, res) => {
  const enabled = await isStudentAccessEnabled();
  res.setHeader("Cache-Control", "no-store");
  res.json({ enabled });
});

module.exports = router;
