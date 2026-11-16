const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const {
  STUDENT_ROLE_ID,
  isStudentAccessEnabled,
  closedResponseBody,
} = require("../services/studentAccess.service");

/**
 * CREATE SCERT USER
 * Only inserts into USERS table
 */
exports.createScert = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  try {
    // check duplicate login_id
    const existing = await pool.query(
      "SELECT user_id FROM scert_db.users WHERE login_id = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // role_id = 5 → SCERT
    const result = await pool.query(
      `INSERT INTO scert_db.users (role_id, login_id, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [5, email, passwordHash]
    );

    res.status(201).json({
      message: "SCERT user created successfully",
      user_id: result.rows[0].user_id,
    });
  } catch (err) {
    console.error("createScert error:", err);
    return next(err);
  }
};

// exports.login = async (req, res, next) => {
//   const { login_id, password } = req.body;

//   if (!login_id || !password) {
//     return res.status(400).json({ message: "login_id and password required" });
//   }

//   try {
//     const result = await pool.query(
//       `
//       SELECT 
//         u.user_id,
//         u.password_hash,
//         u.is_active,
//         u.is_first_login,
//         u.profile_completed,
//         COALESCE(u.failed_attempts, 0) AS failed_attempts,
//         u.lock_until,
//         COALESCE(u.token_version, 0) AS token_version,
//         r.role_name,
//         r.role_id
//       FROM scert_db.users u
//       JOIN scert_db.roles r
//         ON u.role_id = r.role_id
//       WHERE u.login_id = $1
//       `,
//       [login_id]
//     );

//     if (result.rows.length === 0) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     const user = result.rows[0];
//     const now = new Date();
//     const lockUntil = user.lock_until ? new Date(user.lock_until) : null;
//     const isLockActive = lockUntil && lockUntil > now;

//     if (!user.is_active) {
//       return res.status(403).json({ message: "Account inactive" });
//     }

//     if (isLockActive) {
//       return res.status(403).json({
//         message: "Account locked due to multiple failed login attempts. Please try again after 15 minutes.",
//       });
//     }

//     const match = await bcrypt.compare(password, user.password_hash);
//     if (!match) {
//       await pool.query(
//         `
//         UPDATE scert_db.users
//         SET failed_attempts = CASE
//               WHEN lock_until IS NOT NULL AND lock_until <= CURRENT_TIMESTAMP THEN 1
//               ELSE COALESCE(failed_attempts, 0) + 1
//             END,
//             lock_until = CASE
//               WHEN (
//                 CASE
//                   WHEN lock_until IS NOT NULL AND lock_until <= CURRENT_TIMESTAMP THEN 1
//                   ELSE COALESCE(failed_attempts, 0) + 1
//                 END
//               ) >= 5
//                 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
//               ELSE NULL
//             END,
//             updated_at = CURRENT_TIMESTAMP
//         WHERE user_id = $1
//         RETURNING failed_attempts, lock_until
//         `,
//         [user.user_id]
//       );

//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     await pool.query(
//       `UPDATE scert_db.users
//        SET last_login_at = CURRENT_TIMESTAMP,
//            failed_attempts = 0,
//            lock_until = NULL
//        WHERE user_id = $1`,
//       [user.user_id]
//     );

//     const token = jwt.sign(
//       {
//         user_id: user.user_id,
//         role: user.role_name,
//         role_id: user.role_id,
//         token_version: Number(user.token_version || 0),
//       },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN || "4h" }
//     );

//     res.json({
//       token,
//       role: user.role_name,
//       role_id: user.role_id,
//       is_first_login: user.is_first_login,
//       profile_completed: user.profile_completed,
//     });
//   } catch (err) {
//     console.error("login error:", err);
//     return next(err);
//   }
// };



exports.login = async (req, res, next) => {
  const { login_id, password } = req.body;

  if (!login_id || !password) {
    return res.status(400).json({ message: "login_id and password required" });
  }

  const client = await pool.connect(); // 🔥 single connection

  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch user
    const result = await client.query(
      `
      SELECT 
        u.user_id,
        u.password_hash,
        u.is_active,
        u.is_first_login,
        u.profile_completed,
        COALESCE(u.failed_attempts, 0) AS failed_attempts,
        u.lock_until,
        COALESCE(u.token_version, 0) AS token_version,
        r.role_name,
        r.role_id
      FROM scert_db.users u
      JOIN scert_db.roles r
        ON u.role_id = r.role_id
      WHERE u.login_id = $1
      `,
      [login_id]
    );

    if (result.rows.length === 0) {
      await client.query("COMMIT");
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];
    const now = new Date();
    const lockUntil = user.lock_until ? new Date(user.lock_until) : null;
    const isLockActive = lockUntil && lockUntil > now;

    if (!user.is_active) {
      await client.query("COMMIT");
      return res.status(403).json({ message: "Account inactive" });
    }

    if (isLockActive) {
      await client.query("COMMIT");
      return res.status(403).json({
        message:
          "Account locked due to multiple failed login attempts. Please try again later.",
      });
    }

    // 2️⃣ Check password
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      // 3️⃣ Update failed attempts
      await client.query(
        `
        UPDATE scert_db.users
        SET failed_attempts = CASE
              WHEN lock_until IS NOT NULL AND lock_until <= CURRENT_TIMESTAMP THEN 1
              ELSE COALESCE(failed_attempts, 0) + 1
            END,
            lock_until = CASE
              WHEN (
                CASE
                  WHEN lock_until IS NOT NULL AND lock_until <= CURRENT_TIMESTAMP THEN 1
                  ELSE COALESCE(failed_attempts, 0) + 1
                END
              ) >= 5
                THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
              ELSE NULL
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        `,
        [user.user_id]
      );

      await client.query("COMMIT");

      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Student Access switched off by SCERT: a student with the right password is
    // told so and gets no token. Checked after the password, so the message is
    // never shown to someone who only guessed a login id.
    if (Number(user.role_id) === STUDENT_ROLE_ID && !(await isStudentAccessEnabled())) {
      await client.query("COMMIT");
      return res.status(403).json(closedResponseBody());
    }

    // 4️⃣ Successful login → reset attempts
    await client.query(
      `
      UPDATE scert_db.users
      SET last_login_at = CURRENT_TIMESTAMP,
          failed_attempts = 0,
          lock_until = NULL
      WHERE user_id = $1
      `,
      [user.user_id]
    );

    await client.query("COMMIT");

    // 5️⃣ Generate token
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role_name,
        role_id: user.role_id,
        token_version: Number(user.token_version || 0),
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "4h" }
    );

    return res.json({
      token,
      role: user.role_name,
      role_id: user.role_id,
      is_first_login: user.is_first_login,
      profile_completed: user.profile_completed,
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("login error:", err);
    return next(err);
  } finally {
    client.release(); // 🔥 NO LEAK
  }
};

exports.changePassword = async (req, res, next) => {
  const { current_password, new_password } = req.body;
  const userId = req.user.user_id;
  const client = await pool.connect();

  try {
    if (!current_password || !new_password) {
      return res.status(400).json({
        message: "current_password and new_password are required",
      });
    }

    if (String(new_password).length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters long",
      });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `SELECT password_hash, is_first_login, COALESCE(token_version, 0) AS token_version
       FROM scert_db.users
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(401).json({ message: "User not found" });
    }

    const { password_hash, is_first_login } = result.rows[0];

    const isMatch = await bcrypt.compare(current_password, password_hash);
    if (!isMatch) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const isSamePassword = await bcrypt.compare(new_password, password_hash);
    if (isSamePassword) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      return res.status(400).json({
        message: "New password must be different from the current password",
      });
    }

    const newHash = await bcrypt.hash(new_password, 10);

    await client.query(
      `
      UPDATE scert_db.users
      SET password_hash = $1,
          is_first_login = false,
          token_version = COALESCE(token_version, 0) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
      `,
      [newHash, userId]
    );

    
    // Invalidate token cache so new token_version 
    // is picked up immediately
    try {
      const { tokenCacheClient } = require("../middleware/verifyToken");
      await tokenCacheClient.del(`user_auth:${userId}`);
    } catch (_) {}

await client.query("COMMIT");

    res.json({
      message: "Password changed successfully. Please log in again.",
      requires_relogin: true,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Change password error:", err);
    return next(err);
  } finally {
    client.release();
  }
};
