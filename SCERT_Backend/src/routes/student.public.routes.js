const express = require("express");
const router = express.Router();
const studentController = require("../controllers/student.registration.controller");

router.post("/register", studentController.registerStudent);

module.exports = router;
