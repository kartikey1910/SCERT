/**
 * The Student Access switch: whether students can sign up, sign in and use the
 * portal at all.
 *
 * SCERT flips it in the Feature Locks tab. It is kept in session_feature_locks
 * like the BEO feature locks, under the feature name STUDENT_ACCESS, but it
 * always belongs to the ACTIVE session - the public home page and every student
 * request have no "selected session", and a past session's setting must never
 * decide whether students can get in today.
 *
 * It defaults to OFF: with no row (a new session, or the first time), students
 * are closed out until SCERT switches them on. Anything that goes wrong while
 * reading it also reads as OFF.
 */

const pool = require("../config/db");

const STUDENT_ACCESS_FEATURE = "STUDENT_ACCESS";
const STUDENT_ROLE_ID = 1;
const CLOSED_MESSAGE = "Student access is currently closed. Please try again later.";
const CLOSED_CODE = "STUDENT_ACCESS_DISABLED";

// Each server worker keeps its own copy for a few seconds, so a busy student
// portal does not put one query on every request. A change SCERT makes reaches
// the other workers within this time.
const CACHE_TTL_MS = 5000;
let cached = null;

async function readStatus() {
  const res = await pool.query(
    `SELECT s.session_id,
            s.session_name,
            COALESCE(NOT f.is_locked, false) AS enabled
       FROM scert_db.academic_sessions s
       LEFT JOIN scert_db.session_feature_locks f
         ON f.session_id = s.session_id
        AND f.feature_name = $1
      WHERE s.is_active = true
      ORDER BY s.session_id DESC
      LIMIT 1`,
    [STUDENT_ACCESS_FEATURE]
  );

  if (res.rows.length === 0) {
    return { enabled: false, session_id: null, session_name: null };
  }
  const row = res.rows[0];
  return {
    enabled: row.enabled === true,
    session_id: Number(row.session_id),
    session_name: row.session_name,
  };
}

/** { enabled, session_id, session_name } for the active session. */
async function getStudentAccessStatus({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.status;
  const status = await readStatus();
  cached = { status, at: Date.now() };
  return status;
}

/** True only when students are switched on. Any failure to find out is "off". */
async function isStudentAccessEnabled() {
  try {
    return (await getStudentAccessStatus()).enabled === true;
  } catch (err) {
    console.error("Student access check failed (treated as closed):", err);
    return false;
  }
}

/** Switch students on or off for the active session. Returns the new status. */
async function setStudentAccess(enabled) {
  const current = await getStudentAccessStatus({ fresh: true });
  if (!current.session_id) {
    const err = new Error("There is no active academic session");
    err.statusCode = 409;
    throw err;
  }

  await pool.query(
    `INSERT INTO scert_db.session_feature_locks (session_id, feature_name, is_locked, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, feature_name)
     DO UPDATE SET is_locked = EXCLUDED.is_locked, updated_at = CURRENT_TIMESTAMP`,
    [current.session_id, STUDENT_ACCESS_FEATURE, !enabled]
  );

  cached = null;
  return getStudentAccessStatus({ fresh: true });
}

/** The 403 body every closed-out student request gets. */
const closedResponseBody = () => ({ message: CLOSED_MESSAGE, code: CLOSED_CODE });

module.exports = {
  STUDENT_ACCESS_FEATURE,
  STUDENT_ROLE_ID,
  CLOSED_MESSAGE,
  CLOSED_CODE,
  getStudentAccessStatus,
  isStudentAccessEnabled,
  setStudentAccess,
  closedResponseBody,
};
