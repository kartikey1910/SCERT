/**
 * Row packing for the scholarship application forms.
 *
 * The forms build their rows as arrays of fields, and used to give every
 * radio field (Sex, Category, Divyangta, Parental Income ...) and every
 * document upload a row of its own. Those fields are short - a label over
 * two to four options, or over a file chooser - so a whole row each left most
 * of every line empty, and was the main reason the form ran to nearly two
 * screens.
 *
 * This merges each run of consecutive same-kind rows into one row, which the
 * stylesheet lays out compactly:
 *
 *   radios  ->  .form-row-radios  a wrapping band: as many option groups per
 *                                 line as fit, the rest wrapping underneath
 *   files   ->  .form-row-files   a grid of as many document boxes per line
 *                                 as fit (step 2)
 *
 * It works from the rows the caller has already built, so each form keeps its
 * own ordering rules: a run is only ever merged if the fields were already
 * next to each other.
 *
 * @param {Array<Array<object>>} rows  rows of field definitions
 * @param {{ isRadioField: (f: object) => boolean, isFileField: (f: object) => boolean }} kinds
 * @returns {Array<{ fields: object[], kind: 'radios' | 'files' | 'normal' }>}
 */
export function packFormRows(rows, { isRadioField, isFileField }) {
  const kindOf = (row) => {
    if (row.length === 0) return 'normal';
    if (row.every(isRadioField)) return 'radios';
    if (row.every(isFileField)) return 'files';
    return 'normal';
  };

  const packed = [];
  for (const row of rows) {
    const kind = kindOf(row);
    const previous = packed[packed.length - 1];
    if (kind !== 'normal' && previous && previous.kind === kind) {
      previous.fields.push(...row);
    } else {
      packed.push({ fields: [...row], kind });
    }
  }
  return packed;
}

/** The class list for a packed row. */
export function formRowClassName({ fields, kind }) {
  if (kind === 'radios') return 'form-row form-row-radios';
  if (kind === 'files') return 'form-row form-row-files';
  return `form-row${fields.length === 3 ? ' candidate-form-row' : ''}`;
}

const typeOf = (field) => String(field?.field_type || '').trim().toUpperCase();

/** Field-type predicates the forms pass to packFormRows. */
export const rowKinds = {
  isRadioField: (field) => typeOf(field) === 'RADIO',
  isFileField: (field) => typeOf(field) === 'FILE',
};
