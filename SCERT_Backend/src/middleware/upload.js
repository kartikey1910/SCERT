const multer = require("multer");
const path = require("path");

const DEFAULT_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;
const EXEMPLAR_PDF_UPLOAD_FILE_SIZE = 15 * 1024 * 1024;

// Store file in memory (buffer)
const storage = multer.memoryStorage();

const DEFAULT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const DEFAULT_BLOCKED_EXTENSIONS = [
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
];

function createFileFilter(options = {}) {
  const allowedMimeTypes = Array.isArray(options.allowedMimeTypes) && options.allowedMimeTypes.length
    ? options.allowedMimeTypes.map((value) => String(value).toLowerCase())
    : DEFAULT_ALLOWED_MIME_TYPES;
  const allowedExtensions = Array.isArray(options.allowedExtensions) && options.allowedExtensions.length
    ? options.allowedExtensions.map((value) => String(value).toLowerCase())
    : null;
  const blockedExtensions = Array.isArray(options.blockedExtensions) && options.blockedExtensions.length
    ? options.blockedExtensions.map((value) => String(value).toLowerCase())
    : DEFAULT_BLOCKED_EXTENSIONS;
  const allowedLabel = options.allowedLabel || "JPEG, PNG, WEBP, and PDF";

  return (req, file, cb) => {
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    const mimeType = String(file.mimetype || "").toLowerCase();

    if (blockedExtensions.includes(extension)) {
      return cb(new Error("Invalid file type. This file extension is not allowed."), false);
    }

    if (allowedExtensions && !allowedExtensions.includes(extension)) {
      return cb(
        new Error(`Invalid file type. Only ${allowedLabel} files are allowed.`),
        false
      );
    }

    if (!allowedMimeTypes.includes(mimeType)) {
      return cb(
        new Error(`Invalid file type. Only ${allowedLabel} files are allowed.`),
        false
      );
    }

    return cb(null, true);
  };
}

function createUploader(maxFileSize = DEFAULT_UPLOAD_FILE_SIZE, options = {}) {
  return multer({
    storage,
    limits: {
      fileSize: maxFileSize,
    },
    fileFilter: createFileFilter(options),
  });
}

const upload = createUploader();

function getUploadSizeLabel(maxFileSize) {
  return `${Math.round(maxFileSize / (1024 * 1024))} MB`;
}

function uploadSingle(fieldName, options = {}) {
  const maxFileSize =
    Number(options?.maxFileSize) > 0 ? Number(options.maxFileSize) : DEFAULT_UPLOAD_FILE_SIZE;
  const uploader = createUploader(maxFileSize, options);

  return (req, res, next) => {
    uploader.single(fieldName)(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            message: `File is too large. Maximum allowed size is ${getUploadSizeLabel(maxFileSize)}.`,
          });
        }

        return res.status(400).json({
          message: err.message || "File upload failed.",
        });
      }

      return res.status(400).json({
        message: err.message || "Invalid file upload request.",
      });
    });
  };
}

module.exports = upload;
module.exports.uploadSingle = uploadSingle;
module.exports.DEFAULT_UPLOAD_FILE_SIZE = DEFAULT_UPLOAD_FILE_SIZE;
module.exports.EXEMPLAR_PDF_UPLOAD_FILE_SIZE = EXEMPLAR_PDF_UPLOAD_FILE_SIZE;
