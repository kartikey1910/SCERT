/**
 * Wording for the application forms' client-side validation toasts.
 *
 * Toasts are clamped to 220 characters (see ToastContext.jsx), which is
 * fine for most messages but not for "fill these fields": a form with many
 * missing documents would have its list cut off mid-name, hiding exactly
 * what the user needs to see. So the list is trimmed at a field boundary
 * and the remainder is counted instead ("...and 3 more").
 */

const TOAST_BUDGET = 200; // leaves headroom under the 220-char clamp

function summarizeList(prefix, labels) {
  const names = (labels || []).map((l) => String(l || '').trim()).filter(Boolean);
  if (names.length === 0) return prefix.trim();

  const shown = [];
  let length = prefix.length;
  for (let i = 0; i < names.length; i += 1) {
    const remaining = names.length - i - 1;
    // Reserve room for the ", and N more" tail whenever items would be left out.
    const tail = remaining > 0 ? ` and ${remaining} more`.length : 0;
    const next = (shown.length ? 2 : 0) + names[i].length;
    if (shown.length > 0 && length + next + tail > TOAST_BUDGET) break;
    shown.push(names[i]);
    length += next;
  }

  const left = names.length - shown.length;
  return `${prefix}${shown.join(', ')}${left > 0 ? ` and ${left} more` : ''}`;
}

export const requiredFieldsMessage = (labels) =>
  summarizeList('Please fill all required fields: ', labels);

export const invalidValuesMessage = (labels) =>
  summarizeList('Please enter valid values: ', labels);
