const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/verifyToken");
const admitCardController = require("../controllers/admitCard.controller");

router.get(
  "/admit-cards/:application_id",
  verifyToken,
  admitCardController.getAdmitCard
);

router.get(
  "/admit-cards/:application_id/pdf",
  verifyToken,
  admitCardController.getAdmitCardPdf
);


router.get(
  "/admit-cards/:application_id/download",
  verifyToken,
  admitCardController.downloadAdmitCard
);
module.exports = router;
