const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const controller = require("../controllers/scholarshipPublic.controller");
const preschoolController = require("../controllers/scholarshipForm.controller");

router.get("/scholarships/active", verifyToken, controller.getActiveScholarships);
router.get("/scholarships/:id/form", verifyToken, controller.getScholarshipForm);
router.get("/preschools", preschoolController.getPreschools);
module.exports = router;
