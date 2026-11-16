const pool = require("../config/db");
const { getStudentAccessStatus, setStudentAccess } = require("../services/studentAccess.service");

const VALID_FEATURES = [
  'UPLOAD_ABSENTEE',
  'UPLOAD_ABSENTEE_DURING_EXAM',
  'UPLOAD_CS_REPORT',
  'CREATE_CENTER',
  'ALLOCATE_CENTERS',
  'EDIT_APPROVED_APPLICATIONS'
];

// Default lock state per feature when no DB row exists yet.
// true  = locked by default (BEO cannot use until SCERT unlocks)
// false = unlocked by default (BEO can use unless SCERT locks it)
const FEATURE_DEFAULTS = {
  'UPLOAD_ABSENTEE':            true,
  'UPLOAD_ABSENTEE_DURING_EXAM': false,  // New key — default unlocked so existing BEOs are not blocked
  'UPLOAD_CS_REPORT':           true,
  'CREATE_CENTER':              true,
  'ALLOCATE_CENTERS':           true,
  'EDIT_APPROVED_APPLICATIONS': true,
};

/**
 * GET FEATURE LOCKS FOR SCERT
 * GET /api/scert/feature-locks?session_id=...
 */
exports.getFeatureLocks = async (req, res) => {
  const roleId = req.user.role_id;
  
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ message: "session_id is required" });
  }

  try {
    const result = await pool.query(
      `SELECT feature_name, is_locked 
       FROM scert_db.session_feature_locks 
       WHERE session_id = $1`,
      [session_id]
    );

    // Map existing locks, defaulting missing ones to FEATURE_DEFAULTS
    const locks = {};
    VALID_FEATURES.forEach(f => locks[f] = FEATURE_DEFAULTS[f] ?? true);
    
    result.rows.forEach(row => {
      locks[row.feature_name] = row.is_locked;
    });

    res.json({ locks });
  } catch (err) {
    console.error("Get feature locks error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * TOGGLE FEATURE LOCK
 * PUT /api/scert/feature-locks
 */
exports.toggleFeatureLock = async (req, res) => {
  const roleId = req.user.role_id;
  
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { session_id, feature_name, is_locked } = req.body;

  if (!session_id || !feature_name || typeof is_locked !== 'boolean') {
    return res.status(400).json({ message: "session_id, feature_name, and is_locked are required" });
  }

  if (!VALID_FEATURES.includes(feature_name)) {
    return res.status(400).json({ message: "Invalid feature_name" });
  }

  try {
    // Upsert the lock state
    const result = await pool.query(
      `INSERT INTO scert_db.session_feature_locks (session_id, feature_name, is_locked, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (session_id, feature_name) 
       DO UPDATE SET is_locked = EXCLUDED.is_locked, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [session_id, feature_name, is_locked]
    );

    res.json({ message: "Lock state updated", lock: result.rows[0] });
  } catch (err) {
    console.error("Update feature lock error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET BEO FEATURE LOCKS
 * GET /api/beo/feature-locks?session_id=...
 */
exports.getBeoFeatureLocks = async (req, res) => {
  const roleId = req.user.role_id;
  
  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ message: "session_id is required" });
  }

  try {
    // First, check if the requested session is the CURRENT ACTIVE session
    const sessionCheck = await pool.query(
      `SELECT is_active FROM scert_db.academic_sessions WHERE session_id = $1`,
      [session_id]
    );

    const locks = {};
    
    // If session doesn't exist or is NOT active, lock write/upload features but
    // keep read-only report features (like UPLOAD_ABSENTEE_DURING_EXAM) at their default.
    if (sessionCheck.rowCount === 0 || !sessionCheck.rows[0].is_active) {
      // For past sessions: lock all upload/write features, but respect defaults for report views
      const pastSessionLocks = {
        'UPLOAD_ABSENTEE':            true,
        'UPLOAD_ABSENTEE_DURING_EXAM': true,  // Lock uploads for past sessions too
        'UPLOAD_CS_REPORT':           true,
              'CREATE_CENTER':              true,
        'ALLOCATE_CENTERS':           true,
      };
      VALID_FEATURES.forEach(f => locks[f] = pastSessionLocks[f] ?? true);

      // Still fetch SCERT's explicit overrides even for inactive sessions
      const result = await pool.query(
        `SELECT feature_name, is_locked 
         FROM scert_db.session_feature_locks 
         WHERE session_id = $1`,
        [session_id]
      );
      result.rows.forEach(row => {
        locks[row.feature_name] = row.is_locked;
      });

      return res.json({ locks, session_active: false });
    }

    // It is the active session, fetch SCERT controls
    const result = await pool.query(
      `SELECT feature_name, is_locked 
       FROM scert_db.session_feature_locks 
       WHERE session_id = $1`,
      [session_id]
    );

    VALID_FEATURES.forEach(f => locks[f] = FEATURE_DEFAULTS[f] ?? true); // Default per feature
    result.rows.forEach(row => {
      locks[row.feature_name] = row.is_locked;
    });

    res.json({ locks, session_active: true });
  } catch (err) {
    console.error("Get BEO feature locks error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET STUDENT ACCESS (SCERT)
 * GET /api/scert/student-access
 *
 * Whether the student side is open for the active session.
 */
exports.getStudentAccess = async (req, res) => {
  if (req.user.role_id !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const status = await getStudentAccessStatus({ fresh: true });
    res.json(status);
  } catch (err) {
    console.error("Get student access error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * SET STUDENT ACCESS (SCERT)
 * PUT /api/scert/student-access   body: { enabled: boolean }
 *
 * Opens or closes the student side (sign-up, sign-in and every student
 * request). Always applies to the ACTIVE session.
 */
exports.setStudentAccess = async (req, res) => {
  if (req.user.role_id !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const { enabled } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "enabled must be true or false" });
  }

  try {
    const status = await setStudentAccess(enabled);
    res.json({
      message: enabled ? "Student access is now on" : "Student access is now off",
      ...status,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error("Set student access error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
