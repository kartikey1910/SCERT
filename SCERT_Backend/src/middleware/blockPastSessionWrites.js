/**
 * Blocks write operations on past sessions
 */
module.exports = function blockPastSessionWrites(req, res, next) {
  const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];

  if (!writeMethods.includes(req.method)) {
    return next();
  }

  if (!req.session || req.session.is_active !== true) {
    return res.status(403).json({
      message: "Past session data is read-only"
    });
  }

  next();
};
