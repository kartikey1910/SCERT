const path = require("path");

exports.resolveFileUrl = (relativePath) => {
  if (!relativePath) return null;

  const raw = String(relativePath).trim();
  if (!raw) return null;

  // Already an absolute URL
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  // Normalize legacy/static prefixes to current API static prefix
  if (raw.startsWith("/api/uploads/")) return raw;
  if (raw.startsWith("/uploads/")) return `/api${raw}`;
  if (raw.startsWith("cms-private/")) {
    const parts = raw.split("/").filter(Boolean);
    if (parts.length >= 4) {
      const [, pageName, sectionName, ...fileParts] = parts;
      return `/api/public/cms-files/${encodeURIComponent(pageName)}/${encodeURIComponent(
        sectionName
      )}/${fileParts.map((part) => encodeURIComponent(part)).join("/")}`;
    }
  }

  return `/api/uploads/${raw.replace(/^\/+/, "")}`;
};

exports.resolveFileDiskPath = (relativePath) => {
  if (!relativePath) return null;

  const raw = String(relativePath).trim();
  if (raw.startsWith("cms-private/")) {
    return path.join(__dirname, "../../private_uploads", raw);
  }

  return path.join(
    __dirname,
    "../../uploads",
    raw
  );
};
