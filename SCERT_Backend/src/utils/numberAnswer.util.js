/**
 * Server-side rule for NUMBER fields on the scholarship application form.
 *
 * The form's number boxes refuse a minus sign, but a request sent any other
 * way (an old cached page, a script) would still be saved, so the save
 * endpoints check here as well. Nothing on this form can be negative: the
 * NUMBER fields are ids and phone numbers (Aadhaar, SR number, mobile) and
 * marks percentages.
 *
 * A field whose key or label mentions "percent" is also capped at 100.
 */

const isPercentageField = (field) =>
  /percent/i.test(`${field?.field_key || ""} ${field?.field_label || ""}`);

const reject = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/**
 * Throws a 400 error when `value` is not an acceptable answer for this
 * NUMBER field. Blank values pass - whether a field is required is checked
 * elsewhere.
 */
function assertValidNumberAnswer(field, value) {
  if (value === null || value === undefined || String(value).trim() === "") return;

  const label = String(field?.field_label || field?.field_key || "This field").trim();
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw reject(`${label} must be a number`);
  }
  if (parsed < 0 || /^\s*-/.test(String(value))) {
    throw reject(`${label} cannot be negative`);
  }
  if (isPercentageField(field) && parsed > 100) {
    throw reject(`${label} cannot be more than 100`);
  }
}

module.exports = { assertValidNumberAnswer, isPercentageField };
