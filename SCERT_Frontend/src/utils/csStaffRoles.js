/**
 * Staff roles on the Center Superintendent (CS) report: their order, their
 * on-screen names, and the Contingence line. Mirrors
 * SCERT_BE/src/services/csStaffRoles.service.js - the server already sends rows
 * in this order and with these names, and this keeps every screen right even if
 * it is handed rows in another order.
 *
 * Order: Center Superintendent, Supervisor, Examination Incharge, Invigilator,
 * Reliever, Office Assistant, Peon, Contingence.
 */

const ROLE_ORDER = [
  (r) => r.includes('superintendent'),
  (r) => r.includes('supervisor') || r.includes('observer'),
  (r) => r.includes('incharge') || r.includes('in charge') || r.includes('in-charge'),
  (r) => r.includes('invigilator'),
  (r) => r.includes('reliever'),
  (r) => r.includes('office'),
  (r) => r.includes('peon'),
  (r) => r.includes('conting') || r.includes('other expen'),
];

const normalise = (role) => String(role || '').toLowerCase();

export function staffRoleRank(role) {
  const r = normalise(role);
  const idx = ROLE_ORDER.findIndex((matches) => matches(r));
  return idx === -1 ? ROLE_ORDER.length : idx;
}

/** A copy of `rows` in report order (stable for equal ranks). */
export function sortStaffRows(rows, roleKey = 'staff_role') {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        staffRoleRank(a.row?.[roleKey]) - staffRoleRank(b.row?.[roleKey]) || a.index - b.index
    )
    .map(({ row }) => row);
}

/** The name shown for a stored role (the database still says Observer / Other Expenses). */
export function displayStaffRole(role) {
  const r = normalise(role);
  if (r === 'observer') return 'Supervisor';
  if (r.includes('other expen') || r.includes('conting')) return 'Contingence';
  return role;
}

/** True for the Contingence line - an amount SCERT sets, never the BEO. */
export const isContingenceRole = (role) => {
  const r = normalise(role);
  return r.includes('other expen') || r.includes('conting');
};
