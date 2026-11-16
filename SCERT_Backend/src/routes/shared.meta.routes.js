const express = require("express");
const router = express.Router();

const sessionController = require("../controllers/scert.session.controller");
const scholarshipController = require("../controllers/scert.scholarship.controller");

router.get("/sessions", sessionController.getAllSessions);
router.get("/scholarships", scholarshipController.getAllScholarships);

module.exports = router;
