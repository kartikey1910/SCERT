const express = require("express");
const router = express.Router();
const admitCardController = require("../controllers/admitCard.controller");

router.get(
  "/admit-cards/:application_id/pdf",
  admitCardController.getPublicAdmitCardPdf
);

module.exports = router;
