const pool = require("../config/db");
const PRESCHOOL_CACHE_TTL_MS = 60 * 1000;
const preschoolCache = new Map();
const preschoolInFlight = new Map();

/**
 * ADD FORM FIELD
 * POST /scert/scholarships/:id/fields
 */
exports.addField = async (req, res) => {
  const roleId = req.user.role_id;
   const scholarshipId = req.params.id;
  const { session_id } = req.session;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }


  const sch = await pool.query(
  `SELECT scholarship_id
   FROM scert_db.scholarships
   WHERE scholarship_id = $1
     AND session_id = $2`,
  [scholarshipId, session_id]
);

if (sch.rows.length === 0) {
  return res.status(404).json({
    message: "Scholarship not found in current session",
  });
}


 
  const { field_label, field_key, field_type, is_required } = req.body;

  if (!field_label || !field_key || !field_type) {
    return res.status(400).json({
      message: "field_label, field_key, field_type are required",
    });
  }



  try {
    // 1️⃣ Ensure field_key is unique per scholarship
    const existing = await pool.query(
      `SELECT field_id
       FROM scert_db.scholarship_form_fields
       WHERE scholarship_id = $1 AND field_key = $2`,
      [scholarshipId, field_key]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: "field_key must be unique per scholarship",
      });
    }

    // 2️⃣ Auto-generate sort_order
    const orderRow = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS "nextOrder"
       FROM scert_db.scholarship_form_fields
       WHERE scholarship_id = $1`,
      [scholarshipId]
    );

    const sortOrder = orderRow.rows[0].nextOrder;

    // 3️⃣ Insert field
    const result = await pool.query(
      `INSERT INTO scert_db.scholarship_form_fields (
        scholarship_id,
        field_label,
        field_key,
        field_type,
        is_required,
        sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING field_id`,
      [
        scholarshipId,
        field_label,
        field_key,
        field_type,
        is_required ? true : false,
        sortOrder,
      ]
    );

    res.status(201).json({
      message: "Field added successfully",
      field_id: result.rows[0].field_id,
      sort_order: sortOrder,
    });
  } catch (err) {
    console.error("Add field error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * UPDATE FORM FIELD
 * PUT /scert/fields/:field_id
 */
exports.updateField = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const fieldId = req.params.field_id;
  const { field_label, is_required, sort_order, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE scert_db.scholarship_form_fields f
SET
  field_label = COALESCE($1, field_label),
  is_required = COALESCE($2, is_required),
  sort_order = COALESCE($3, sort_order),
  is_active = COALESCE($4, is_active)
FROM scert_db.scholarships s
WHERE f.field_id = $5
  AND f.scholarship_id = s.scholarship_id
  AND s.session_id = $6`,
      [
        field_label ?? null,
        is_required ?? null,
        sort_order ?? null,
        is_active ?? null,
        fieldId,
        session_id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Field not found" });
    }

    res.json({ message: "Field updated successfully" });
  } catch (err) {
    console.error("Update field error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * ADD FIELD OPTION (AUTO SORT ORDER)
 * POST /scert/fields/:field_id/options
 */
exports.addFieldOption = async (req, res) => {
  const roleId = req.user.role_id;

  const { session_id } = req.session;
  const fieldId = req.params.field_id;


  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }


const fieldCheck = await pool.query(
  `SELECT f.field_id
   FROM scert_db.scholarship_form_fields f
   JOIN scert_db.scholarships s
     ON f.scholarship_id = s.scholarship_id
   WHERE f.field_id = $1
     AND s.session_id = $2`,
  [fieldId, session_id]
);

if (fieldCheck.rows.length === 0) {
  return res.status(404).json({
    message: "Field not found in current session",
  });
}




  const { option_label, option_value } = req.body;

  if (!option_label || !option_value) {
    return res.status(400).json({
      message: "option_label and option_value are required",
    });
  }

  try {
    // 1️⃣ Auto-generate sort_order
    const orderRow = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS "nextOrder"
       FROM scert_db.scholarship_form_field_options
       WHERE field_id = $1`,
      [fieldId]
    );

    const sortOrder = orderRow.rows[0].nextOrder;

    // 2️⃣ Insert option
    const result = await pool.query(
      `INSERT INTO scert_db.scholarship_form_field_options (
        field_id,
        option_label,
        option_value,
        sort_order
      ) VALUES ($1, $2, $3, $4)
      RETURNING option_id`,
      [fieldId, option_label, option_value, sortOrder]
    );

    res.status(201).json({
      message: "Option added successfully",
      option_id: result.rows[0].option_id,
      sort_order: sortOrder,
    });
  } catch (err) {
    console.error("Add option error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * REORDER FIELDS ✅
 */
exports.reorderFields = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const updates = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const item of updates) {
      await client.query(
        `UPDATE scert_db.scholarship_form_fields f
SET sort_order = $1
FROM scert_db.scholarships s
WHERE f.field_id = $2
  AND f.scholarship_id = s.scholarship_id
  AND s.session_id = $3`,
        [item.sort_order, item.field_id, session_id]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Fields reordered successfully" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("reorderFields error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * REORDER OPTIONS ✅
 */
exports.reorderOptions = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  const updates = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const item of updates) {
      await client.query(
        `UPDATE scert_db.scholarship_form_field_options o
SET sort_order = $1
FROM scert_db.scholarship_form_fields f
JOIN scert_db.scholarships s
  ON f.scholarship_id = s.scholarship_id
WHERE o.option_id = $2
  AND o.field_id = f.field_id
  AND s.session_id = $3`,
        [item.sort_order, item.option_id, session_id]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Options reordered successfully" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("reorderOptions error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    client.release();
  }
};


exports.getPreschools = async (req, res) => {
  const page = parseInt(req.query.page || 1);
  const limit = parseInt(req.query.limit || 20);
  const offset = (page - 1) * limit;
  const search = req.query.search?.trim();
  const district = req.query.district;
  const block = req.query.block;
  const cacheKey = JSON.stringify({
    page,
    limit,
    search: search || "",
    district: district || "",
    block: block || "",
  });

  try {
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Vary", "Authorization");

    const now = Date.now();
    const cached = preschoolCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return res.json(cached.data);
    }

    const existingPromise = preschoolInFlight.get(cacheKey);
    if (existingPromise) {
      const data = await existingPromise;
      return res.json(data);
    }

    const conditions = [];
    const values = [];
    let idx = 1;

    if (search) {
      conditions.push(
        `(
          school_name ILIKE $${idx}
          OR udise_code ILIKE $${idx}
          OR district_name ILIKE $${idx}
          OR block_name ILIKE $${idx}
          OR school_type::text ILIKE $${idx}
        )`
      );
      values.push(`%${search}%`);
      idx++;
    }

    if (district) {
      conditions.push(`district_name = $${idx}`);
      values.push(district);
      idx++;
    }

    if (block) {
      conditions.push(`block_name = $${idx}`);
      values.push(block);
      idx++;
    }

    const filtersClause = conditions.length
      ? ` AND ${conditions.join(" AND ")}`
      : "";

    const fetchPromise = pool.query(
      `
      WITH unified_schools AS (
        SELECT
          psm.udise_code,
          psm.school_name,
          psm.district_name,
          psm.block_name,
          psm.school_management_code AS school_type,
          1 AS source_priority
        FROM scert_db.primary_schools_master psm
        WHERE psm.is_active = true

        UNION ALL

        SELECT
          sp.udise_code,
          sp.school_name,
          sp.district_name,
          sp.block_name,
          sp.school_type,
          2 AS source_priority
        FROM scert_db.school_profiles sp
        JOIN scert_db.users u
          ON u.user_id = sp.user_id
        WHERE u.is_active = true
      ),
      deduped_schools AS (
        SELECT DISTINCT ON (udise_code)
          udise_code,
          school_name,
          district_name,
          block_name,
          school_type
        FROM unified_schools
        ORDER BY udise_code, source_priority
      )
      SELECT
        udise_code,
        school_name,
        district_name,
        block_name,
        school_type,
        COUNT(*) OVER()::int AS total_count
      FROM deduped_schools
      WHERE 1 = 1
      ${filtersClause}
      ORDER BY school_name
      LIMIT $${idx} OFFSET $${idx + 1}
      `,
      [...values, limit, offset]
    );
    preschoolInFlight.set(cacheKey, fetchPromise);

    const dataRes = await fetchPromise;
    const rows = dataRes.rows || [];
    const total = rows.length > 0 ? Number(rows[0].total_count || 0) : 0;
    const payload = {
      data: rows.map(({ total_count, ...rest }) => rest),
      page,
      limit,
      total,
    };

    preschoolCache.set(cacheKey, {
      data: payload,
      expiresAt: now + PRESCHOOL_CACHE_TTL_MS,
    });
    preschoolInFlight.delete(cacheKey);

    return res.json(payload);
  } catch (err) {
    preschoolInFlight.delete(cacheKey);
    console.error("Get preschools error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
