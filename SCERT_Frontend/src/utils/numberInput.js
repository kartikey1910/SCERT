/**
 * Behaviour of the plain NUMBER boxes on the scholarship application forms
 * (the ones without a fixed digit count - Aadhaar and mobile numbers are
 * digit-only text boxes already).
 *
 * Nothing on these forms can be negative, and a browser number box will
 * happily take "-5", "1e5" or "+3" from the keyboard, the mouse wheel or a
 * paste. This keeps those characters out at every entry point, and caps a
 * percentage at 100. The server checks the same rules again on save
 * (SCERT_BE/src/utils/numberAnswer.util.js).
 */

const isPercentageField = (field) =>
  /percent/i.test(`${field?.field_key || ''} ${field?.field_label || ''}`);

/** Keys that make no sense in a non-negative number: sign and exponent. */
const BLOCKED_KEYS = new Set(['-', '+', 'e', 'E']);

/** onKeyDown handler: stops the sign and exponent characters being typed. */
export function blockNumberKeys(event) {
  if (BLOCKED_KEYS.has(event.key)) event.preventDefault();
}

/**
 * The value to store after the user changes the box: sign/exponent characters
 * removed (this is what a paste of "-5" ends up as), and a percentage above
 * 100 refused - the box keeps its previous value instead.
 */
export function sanitizeNumberValue(raw, field, previous = '') {
  const cleaned = String(raw ?? '').replace(/[-+eE]/g, '');
  if (cleaned === '') return '';
  if (isPercentageField(field) && Number(cleaned) > 100) return String(previous ?? '');
  return cleaned;
}

/** Attributes for the <input>: browser-side limits, and decimals for a percentage. */
export function numberInputAttrs(field) {
  const percentage = isPercentageField(field);
  return {
    min: 0,
    max: percentage ? 100 : undefined,
    step: percentage ? 'any' : undefined,
    onKeyDown: blockNumberKeys,
    onWheel: (event) => event.currentTarget.blur(),
  };
}
