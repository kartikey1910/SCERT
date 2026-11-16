/**
 * Staff roles on the Center Superintendent (CS) report: their order, how they
 * are named on screen, and which one is the SCERT-set Contingence.
 *
 * The database keeps the older names (Observer, Other Expenses) as its keys, so
 * saved reports and the rate table keep working; everything shown to a person
 * goes through displayStaffRole.
 *
 * ORDER (every place that lists staff uses this one):
 *   Center Superintendent, Supervisor, Examination Incharge, Invigilator,
 *   Reliever, Office Assistant, Peon, Contingence
 */

const ROLE_ORDER = [
  (r) => r.includes("superintendent"),
  (r) => r.includes("supervisor") || r.includes("observer"),
  (r) => r.includes("incharge") || r.includes("in charge") || r.includes("in-charge"),
  (r) => r.includes("invigilator"),
  (r) => r.includes("reliever"),
  (r) => r.includes("office"),
  (r) => r.includes("peon"),
  (r) => r.includes("conting") || r.includes("other expen"),
];

const normalise = (role) => String(role || "").toLowerCase();

/** Position of a role in the report; roles not listed sort last, in their given order. */
function staffRoleRank(role) {
  const r = normalise(role);
  const idx = ROLE_ORDER.findIndex((matches) => matches(r));
  return idx === -1 ? ROLE_ORDER.length : idx;
}

/** A copy of `rows` in report order (stable for equal ranks). */
function sortStaffRows(rows, roleKey = "staff_role") {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        staffRoleRank(a.row?.[roleKey]) - staffRoleRank(b.row?.[roleKey]) || a.index - b.index
    )
    .map(({ row }) => row);
}

/** The name a person sees for a stored role. */
function displayStaffRole(role) {
  const r = normalise(role);
  if (r === "observer") return "Supervisor";
  if (r.includes("other expen") || r.includes("conting")) return "Contingence";
  return role;
}

/** True for the Contingence line (stored as "Other Expenses"). */
const isContingenceRole = (role) => {
  const r = normalise(role);
  return r.includes("other expen") || r.includes("conting");
};

/** The key the Contingence amount is stored under in exam_staff_honorarium_rates. */
const CONTINGENCE_RATE_KEY = "Other Expenses";

module.exports = {
  staffRoleRank,
  sortStaffRows,
  displayStaffRole,
  isContingenceRole,
  CONTINGENCE_RATE_KEY,
};
