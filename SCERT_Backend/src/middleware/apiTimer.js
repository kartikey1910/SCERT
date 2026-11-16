const pool = require("../config/db");

module.exports = function apiTimer(req, res, next) {
  const apiStart = process.hrtime.bigint();

  // Track DB time per request
  req.dbTimeNs = 0n;

  /**
   * Safe DB query wrapper
   * Use this instead of pool.query
   */
  req.dbQuery = async (...args) => {
    const qStart = process.hrtime.bigint();
    try {
      return await pool.query(...args);
    } catch (err) {
      throw err;
    } finally {
      const qEnd = process.hrtime.bigint();
      req.dbTimeNs += qEnd - qStart;
    }
  };

  res.on("finish", () => {
    const apiEnd = process.hrtime.bigint();

    const apiMs = Number(apiEnd - apiStart) / 1e6;
    const dbMs = Number(req.dbTimeNs) / 1e6;

    console.log(
      `[API] ${req.method} ${req.originalUrl} | ${res.statusCode} | total=${apiMs.toFixed(
        2
      )} ms | db=${dbMs.toFixed(2)} ms`
    );
  });

  next();
};