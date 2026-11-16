const express = require("express");
const router = express.Router();
const controller = require("../controllers/homepageCms.controller");

router.get("/cms/homepage", controller.getHomePageSectionsPublic);
router.get("/cms/page/:pageName", controller.getPageSectionsPublic);
router.get("/cms-files/:pageName/:sectionName/:fileName", controller.serveCmsFile);

module.exports = router;
