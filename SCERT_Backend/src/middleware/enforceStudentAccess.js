const {
  STUDENT_ROLE_ID,
  isStudentAccessEnabled,
  closedResponseBody,
} = require("../services/studentAccess.service");

/**
 * When SCERT has switched Student Access off, an already signed-in student can
 * no longer use the portal: every authenticated request from a student is
 * refused, not just the login and sign-up. Other roles are untouched.
 *
 * Mount after verifyToken, which sets req.user.
 */
module.exports = async function enforceStudentAccess(req, res, next) {
  if (Number(req.user?.role_id) !== STUDENT_ROLE_ID) return next();

  if (await isStudentAccessEnabled()) return next();

  return res.status(403).json(closedResponseBody());
};
