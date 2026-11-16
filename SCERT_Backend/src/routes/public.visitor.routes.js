const express = require("express");
const router = express.Router();
const controller = require("../controllers/public.visitor.controller");

router.get("/visitors", controller.getVisitorCount);
router.post("/visitors/track", controller.trackVisit);

module.exports = router;
