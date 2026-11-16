const path = require("path");
const { randomUUID } = require("crypto");
const { fileTypeFromBuffer } = require("file-type");

const DANGEROUS_EXTENSIONS = new Set([
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
]);

const ALLOWED_FILE_RULES = {
  ".jpg": {
    allowedMimeTypes: new Set(["image/jpeg", "image/jpg"]),
    detectedExtensions: new Set(["jpg"]),
    detectedMimeTypes: new Set(["image/jpeg"]),
    normalizedExtension: ".jpg",
  },
  ".jpeg": {
    allowedMimeTypes: new Set(["image/jpeg", "image/jpg"]),
    detectedExtensions: new Set(["jpg"]),
    detectedMimeTypes: new Set(["image/jpeg"]),
    normalizedExtension: ".jpeg",
  },
  ".png": {
    allowedMimeTypes: new Set(["image/png"]),
    detectedExtensions: new Set(["png"]),
    detectedMimeTypes: new Set(["image/png"]),
    normalizedExtension: ".png",
  },
  ".pdf": {
    allowedMimeTypes: new Set(["application/pdf"]),
    detectedExtensions: new Set(["pdf"]),
    detectedMimeTypes: new Set(["application/pdf"]),
    normalizedExtension: ".pdf",
  },
  ".docx": {
    allowedMimeTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    detectedExtensions: new Set(["zip"]),
    detectedMimeTypes: new Set(["application/zip"]),
    normalizedExtension: ".docx",
  },
};

function createUploadValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function getOriginalExtension(file) {
  return path.extname(String(file?.originalname || "")).toLowerCase();
}

function isDocxBuffer(buffer) {
  const sample = buffer.toString("utf8");
  return sample.includes("[Content_Types].xml") && sample.includes("word/");
}

async function validateCmsUploadFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw createUploadValidationError("File is required");
  }

  const originalExtension = getOriginalExtension(file);
  if (!originalExtension) {
    throw createUploadValidationError("Uploaded file must have a valid extension.");
  }

  if (DANGEROUS_EXTENSIONS.has(originalExtension)) {
    throw createUploadValidationError("Invalid file type. This file extension is not allowed.");
  }

  const rule = ALLOWED_FILE_RULES[originalExtension];
  if (!rule) {
    throw createUploadValidationError(
      "Invalid file type. Only JPG, JPEG, PNG, PDF, and DOCX files are allowed."
    );
  }

  const providedMimeType = String(file.mimetype || "").toLowerCase();
  if (!rule.allowedMimeTypes.has(providedMimeType)) {
    throw createUploadValidationError("Uploaded file MIME type is not allowed.");
  }

  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected) {
    throw createUploadValidationError("Could not validate the uploaded file content.");
  }

  const detectedExtension = String(detected.ext || "").toLowerCase();
  const detectedMimeType = String(detected.mime || "").toLowerCase();

  if (originalExtension === ".docx") {
    if (
      !rule.detectedExtensions.has(detectedExtension) ||
      !rule.detectedMimeTypes.has(detectedMimeType) ||
      !isDocxBuffer(file.buffer)
    ) {
      throw createUploadValidationError(
        "Uploaded file content does not match a valid DOCX document."
      );
    }
  } else if (
    !rule.detectedExtensions.has(detectedExtension) ||
    !rule.detectedMimeTypes.has(detectedMimeType)
  ) {
    throw createUploadValidationError(
      "Uploaded file content does not match the file extension or MIME type."
    );
  }

  return {
    extension: rule.normalizedExtension,
    mimeType: providedMimeType,
    detectedMimeType,
    storedFileName: `${randomUUID()}${rule.normalizedExtension}`,
  };
}

module.exports = {
  validateCmsUploadFile,
  createUploadValidationError,
};
