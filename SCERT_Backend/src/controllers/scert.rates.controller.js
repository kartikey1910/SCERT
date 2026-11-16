const pool = require("../config/db");
const {
  sortStaffRows,
  displayStaffRole,
  isContingenceRole,
  CONTINGENCE_RATE_KEY,
} = require("../services/csStaffRoles.service");

/**
 * 💰 GET HONORARIUM RATES
 */
exports.getHonorariumRates = async (req, res) => {
  const roleId = req.user.role_id;
  
  // Only SCERT admin can access rate config
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const result = await pool.query(
      `SELECT staff_role, honorarium_per_unit 
       FROM scert_db.exam_staff_honorarium_rates 
       ORDER BY staff_role ASC`
    );

    const filteredRates = result.rows
      .filter((row) => row.staff_role !== 'Clerk' && row.staff_role !== 'Sweeper')
      .map((row) => ({ ...row, staff_role: displayStaffRole(row.staff_role) }));

    // Contingence is always listed, so SCERT can set it even before it exists.
    if (!filteredRates.some((row) => isContingenceRole(row.staff_role))) {
      filteredRates.push({ staff_role: 'Contingence', honorarium_per_unit: '0.00' });
    }

    res.json({ rates: sortStaffRows(filteredRates) });
  } catch (err) {
    console.error("Error fetching honorarium rates:", err);
    res.status(500).json({ message: "Failed to fetch rates" });
  }
};

/**
 * 💰 UPDATE HONORARIUM RATES
 */
exports.updateHonorariumRates = async (req, res) => {
  const roleId = req.user.role_id;
  const { rates } = req.body; // Expecting { rates: [{ staff_role: '...', honorarium_per_unit: 400 }, ...] }

  // Only SCERT admin can edit rates
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!Array.isArray(rates)) {
    return res.status(400).json({ message: "Rates must be an array" });
  }

  // A rate is an amount of money: a number, and never negative.
  for (const rate of rates) {
    if (!rate?.staff_role) continue;
    const amount = Number(rate.honorarium_per_unit || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({
        message: `Invalid amount for ${rate.staff_role}: it must be a number that is not negative`,
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const rate of rates) {
      if (!rate.staff_role) continue;
      
      const amount = Number(rate.honorarium_per_unit || 0);

      let dbRole = rate.staff_role;
      if (dbRole === 'Supervisor') dbRole = 'Observer';
      if (dbRole === 'Contingence') dbRole = 'Other Expenses';

      const updateRes = await client.query(
        `UPDATE scert_db.exam_staff_honorarium_rates 
         SET honorarium_per_unit = $1 
         WHERE staff_role = $2`,
        [amount, dbRole]
      );

      // If role doesn't exist yet, insert it
      if (updateRes.rowCount === 0) {
        await client.query(
          `INSERT INTO scert_db.exam_staff_honorarium_rates (staff_role, honorarium_per_unit) 
           VALUES ($1, $2)`,
          [dbRole, amount]
        );
      }
    }

    /* Contingence is one flat amount per report, set here by SCERT and not by
       the BEO. When it is part of this save, bring the reports of the ACTIVE
       session in line with it so it shows the same everywhere (BEO form and
       view, SCERT view, PDF, totals). Earlier sessions keep what they were
       submitted with. Each report's grand total moves by the difference. */
    const savedContingence = rates.some(
      (rate) => rate.staff_role && isContingenceRole(rate.staff_role)
    );
    let reportsUpdated = 0;
    if (savedContingence) {
      const amountRes = await client.query(
        `SELECT honorarium_per_unit FROM scert_db.exam_staff_honorarium_rates WHERE staff_role = $1`,
        [CONTINGENCE_RATE_KEY]
      );
      const amount = Number(amountRes.rows[0]?.honorarium_per_unit ?? 0);

      // Reports that already have a Contingence line: replace its amount.
      const changed = await client.query(
        `
        WITH before AS (
          SELECT d.id, d.report_id, d.total_amount AS old_total
            FROM scert_db.center_exam_staff_details d
            JOIN scert_db.center_superintendent_reports r ON r.report_id = d.report_id
            JOIN scert_db.academic_sessions s ON s.session_id = r.session_id AND s.is_active = true
           WHERE d.staff_role IN ('Other Expenses', 'Contingence')
        ),
        upd AS (
          UPDATE scert_db.center_exam_staff_details d
             SET staff_count = 1, honorarium_per_unit = $1, total_amount = $1
            FROM before b
           WHERE d.id = b.id
          RETURNING d.report_id, b.old_total
        )
        UPDATE scert_db.center_superintendent_reports r
           SET grand_total_amount = COALESCE(r.grand_total_amount, 0) - upd.old_total + $1
          FROM upd
         WHERE r.report_id = upd.report_id
        `,
        [amount]
      );

      // Reports that have no Contingence line yet: add it.
      const added = await client.query(
        `
        WITH missing AS (
          SELECT r.report_id
            FROM scert_db.center_superintendent_reports r
            JOIN scert_db.academic_sessions s ON s.session_id = r.session_id AND s.is_active = true
           WHERE NOT EXISTS (
             SELECT 1 FROM scert_db.center_exam_staff_details d
              WHERE d.report_id = r.report_id
                AND d.staff_role IN ('Other Expenses', 'Contingence')
           )
        ),
        ins AS (
          INSERT INTO scert_db.center_exam_staff_details
                 (report_id, staff_role, staff_count, honorarium_per_unit, total_amount)
          SELECT report_id, $2, 1, $1, $1 FROM missing
          RETURNING report_id
        )
        UPDATE scert_db.center_superintendent_reports r
           SET grand_total_amount = COALESCE(r.grand_total_amount, 0) + $1
          FROM ins
         WHERE r.report_id = ins.report_id
        `,
        [amount, CONTINGENCE_RATE_KEY]
      );
      reportsUpdated = (changed.rowCount || 0) + (added.rowCount || 0);
    }

    await client.query("COMMIT");
    res.json({ message: "Rates updated successfully", contingence_reports_updated: reportsUpdated });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating honorarium rates:", err);
    res.status(500).json({ message: "Failed to update rates" });
  } finally {
    client.release();
  }
};

/**
 * 💰 GET SYSTEM RATES
 */
exports.getSystemRates = async (req, res) => {
  const { report_type } = req.query;

  // Wait, if it's used by BEO/CEO lists, it requires verifyToken, so any logged-in user can READ.
  try {
    const query = report_type
      ? `SELECT rate_key, rate_name, rate_value, report_type FROM scert_db.system_rates WHERE report_type = $1 ORDER BY rate_name ASC`
      : `SELECT rate_key, rate_name, rate_value, report_type FROM scert_db.system_rates ORDER BY rate_name ASC`;
    const values = report_type ? [report_type] : [];

    const result = await pool.query(query, values);
    res.json({ rates: result.rows });
  } catch (err) {
    console.error("Error fetching system rates:", err);
    res.status(500).json({ message: "Failed to fetch rates" });
  }
};

/**
 * 💰 UPDATE SYSTEM RATES
 */
exports.updateSystemRates = async (req, res) => {
  const roleId = req.user.role_id;
  const { rates } = req.body; // Expecting { rates: [{ rate_key: '...', rate_value: 400 }, ...] }

  // Only SCERT admin can edit rates
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!Array.isArray(rates)) {
    return res.status(400).json({ message: "Rates must be an array" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const rate of rates) {
      if (!rate.rate_key) continue;
      
      const amount = Number(rate.rate_value || 0);

      await client.query(
        `UPDATE scert_db.system_rates 
         SET rate_value = $1 
         WHERE rate_key = $2`,
        [amount, rate.rate_key]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "System rates updated successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating system rates:", err);
    res.status(500).json({ message: "Failed to update rates" });
  } finally {
    client.release();
  }
};
