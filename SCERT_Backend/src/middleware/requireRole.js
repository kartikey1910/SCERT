module.exports = function requireRole(minRole) {
  return (req, res, next) => {
    const roleId = Number(req.user?.role_id);
    const requiredRoleId = Number(minRole);

    if (!Number.isFinite(roleId) || roleId < requiredRoleId) {
      return res.status(403).json({ message: "Unauthorized role" });
    }

    return next();
  };
};
