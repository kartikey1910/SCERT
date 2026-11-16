const SAFE_NAME_REGEX = /^[\p{L}\s.'-]+$/u;

function createValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeNameValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function validateNameField(fieldLabel, value, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) {
      throw createValidationError(`${fieldLabel} is required`);
    }
    return null;
  }

  const normalizedValue = normalizeNameValue(value);

  if (!normalizedValue) {
    if (required) {
      throw createValidationError(`${fieldLabel} is required`);
    }
    return null;
  }

  if (/[<>]/.test(normalizedValue) || /<\/?[a-z][^>]*>/i.test(normalizedValue)) {
    throw createValidationError(`${fieldLabel} contains invalid characters`);
  }

  if (!SAFE_NAME_REGEX.test(normalizedValue)) {
    throw createValidationError(
      `${fieldLabel} may contain only letters, spaces, dots, apostrophes, and hyphens`
    );
  }

  if (!/[\p{L}]/u.test(normalizedValue)) {
    throw createValidationError(`${fieldLabel} must contain letters`);
  }

  return normalizedValue;
}

module.exports = {
  validateNameField,
};
