const express = require("express");
const router = express.Router();
const controller = require("../controllers/public.schools.controller");

router.get("/schools", controller.listPublicSchools);

module.exports = router;
