const pool = require("../config/db");

let tableReady = false;

async function ensureVisitorTable() {
  if (tableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scert_db.public_visitor_counter (
      id smallint PRIMARY KEY,
      total_visits bigint NOT NULL DEFAULT 0,
      updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO scert_db.public_visitor_counter (id, total_visits)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING
  `);

  tableReady = true;
}

exports.trackVisit = async (req, res) => {
  try {
    await ensureVisitorTable();

    const result = await pool.query(`
      UPDATE scert_db.public_visitor_counter
      SET total_visits = total_visits + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING total_visits
    `);

    return res.status(200).json({
      total_visits: Number(result.rows?.[0]?.total_visits || 0),
    });
  } catch (error) {
    console.error("trackVisit error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getVisitorCount = async (req, res) => {
  try {
    await ensureVisitorTable();

    const result = await pool.query(`
      SELECT total_visits
      FROM scert_db.public_visitor_counter
      WHERE id = 1
      LIMIT 1
    `);

    return res.status(200).json({
      total_visits: Number(result.rows?.[0]?.total_visits || 0),
    });
  } catch (error) {
    console.error("getVisitorCount error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
