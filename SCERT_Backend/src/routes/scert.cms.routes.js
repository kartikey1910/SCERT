const express = require("express");
const router = express.Router();
const controller = require("../controllers/homepageCms.controller");
const { uploadSingle, EXEMPLAR_PDF_UPLOAD_FILE_SIZE } = require("../middleware/upload");

router.get("/cms/homepage", controller.getHomePageSections);
router.get("/cms/homepage/:section", controller.getHomePageSection);
router.put("/cms/homepage/:section", controller.updateHomePageSection);
router.get("/cms/page/:pageName", controller.getPageSections);
router.get("/cms/page/:pageName/:section", controller.getPageSection);
router.put("/cms/page/:pageName/:section", controller.updatePageSection);
router.post("/cms/upload-image", uploadSingle("image"), controller.uploadHomePageImage);
router.post(
  "/cms/upload-file",
  uploadSingle("file", {
    maxFileSize: EXEMPLAR_PDF_UPLOAD_FILE_SIZE,
    allowedExtensions: [".jpg", ".jpeg", ".png", ".pdf", ".docx"],
    allowedMimeTypes: [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    blockedExtensions: [
      ".php",
      ".phtml",
      ".php3",
      ".php4",
      ".php5",
      ".phar",
      ".js",
      ".mjs",
      ".cjs",
      ".sh",
      ".bash",
      ".zsh",
      ".exe",
      ".bat",
      ".cmd",
      ".com",
      ".scr",
      ".msi",
      ".dll",
      ".jar",
      ".py",
      ".pl",
      ".rb",
    ],
    allowedLabel: "JPG, JPEG, PNG, PDF, and DOCX",
  }),
  controller.uploadCmsFile
);

module.exports = router;
