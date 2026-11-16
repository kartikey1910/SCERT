const pool = require("../config/db");
const ACTIVE_SCHOLARSHIP_CACHE_TTL_MS = 60 * 1000;
const activeScholarshipsCache = new Map();
const activeScholarshipsInFlight = new Map();
const SCHOLARSHIP_FORM_CACHE_TTL_MS = 2 * 60 * 1000;
const scholarshipFormCache = new Map();
const scholarshipFormInFlight = new Map();

/**
 * GET ACTIVE SCHOLARSHIPS
 */
exports.getActiveScholarships = async (req, res) => {
  const { session_id } = req.session;
  const cacheKey = String(session_id);

  try {
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Vary", "Authorization, x-session-id");

    const now = Date.now();
    const cached = activeScholarshipsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return res.json(cached.data);
    }

    const existingPromise = activeScholarshipsInFlight.get(cacheKey);
    if (existingPromise) {
      const data = await existingPromise;
      return res.json(data);
    }

    const fetchPromise = pool.query(
      `SELECT
         scholarship_id,
         scholarship_name,
         scholarship_details,
         eligibility,
         last_date
       FROM scert_db.scholarships
       WHERE status = 'ACTIVE'
         AND last_date >= CURRENT_DATE
         AND session_id = $1
       ORDER BY created_at DESC, scholarship_id DESC`,
      [session_id]
    );

    activeScholarshipsInFlight.set(cacheKey, fetchPromise);
    const result = await fetchPromise;
    activeScholarshipsCache.set(cacheKey, {
      data: result.rows,
      expiresAt: now + ACTIVE_SCHOLARSHIP_CACHE_TTL_MS,
    });
    activeScholarshipsInFlight.delete(cacheKey);

    return res.json(result.rows);
  } catch (err) {
    activeScholarshipsInFlight.delete(cacheKey);
    console.error("Fetch active scholarships error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * GET ACTIVE SCHOLARSHIPS FORM
 */
exports.getScholarshipForm = async (req, res) => {
  const scholarshipId = req.params.id;
  const { session_id } = req.session;
  const roleId = req.user?.role_id;
  const roleScope = roleId === 5 ? "SCERT" : "PUBLIC_ACTIVE_ONLY";
  const cacheKey = `${session_id}:${scholarshipId}:${roleScope}`;

  try {
    res.setHeader("Cache-Control", "private, max-age=120");
    res.setHeader("Vary", "Authorization, x-session-id");

    const now = Date.now();
    const cached = scholarshipFormCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return res.json(cached.data);
    }

    const existingPromise = scholarshipFormInFlight.get(cacheKey);
    if (existingPromise) {
      const data = await existingPromise;
      return res.json(data);
    }

    const fetchPromise = (async () => {
    // 1) fetch scholarship (allow DRAFT for SCERT users, ACTIVE for others)
    let query;
    if (roleId === 5) {
      // SCERT can access DRAFT scholarships for form building
      query = `SELECT scholarship_id, scholarship_name, last_date, status
       FROM scert_db.scholarships
       WHERE scholarship_id = $1
         AND session_id = $2`;
    } else {
      // Others can only access ACTIVE scholarships with valid dates
      query = `SELECT scholarship_id, scholarship_name, last_date, status
       FROM scert_db.scholarships
       WHERE scholarship_id = $1
         AND status = 'ACTIVE'
         AND last_date >= CURRENT_DATE
         AND session_id = $2`;
    }
    
      const sch = await pool.query(query, [scholarshipId, session_id]);

      if (sch.rows.length === 0) {
        const notFoundErr = new Error("Scholarship not available");
        notFoundErr.status = 404;
        throw notFoundErr;
      }

      // 2) fetch fields (ordered)
      const fieldsResult = await pool.query(
        `SELECT
         field_id,
         field_label,
         field_key,
         field_type,
         is_required,
         sort_order
       FROM scert_db.scholarship_form_fields
       WHERE scholarship_id = $1
         AND is_active = true
       ORDER BY sort_order ASC`,
        [scholarshipId]
      );

      const fields = fieldsResult.rows;

      // 3) fetch options for all fields (ordered)
      const fieldIds = fields.map((f) => f.field_id);
      const optionsByField = {};

      if (fieldIds.length > 0) {
        const optionsResult = await pool.query(
          `SELECT
           option_id,
           field_id,
           option_label,
           option_value,
           sort_order
         FROM scert_db.scholarship_form_field_options
         WHERE field_id = ANY($1::bigint[])
           AND is_active = true
         ORDER BY field_id ASC, sort_order ASC`,
          [fieldIds]
        );

        const options = optionsResult.rows;

        // group options by field_id
        for (const opt of options) {
          if (!optionsByField[opt.field_id]) {
            optionsByField[opt.field_id] = [];
          }
          optionsByField[opt.field_id].push({
            option_id: opt.option_id,
            option_label: opt.option_label,
            option_value: opt.option_value,
            sort_order: opt.sort_order,
          });
        }
      }

      // 4) attach options to fields
      const form = fields.map((f) => ({
        ...f,
        options: ["DROPDOWN", "RADIO", "CHECKBOX"].includes(f.field_type)
          ? optionsByField[f.field_id] || []
          : [],
      }));

      return {
        scholarship: sch.rows[0],
        form,
      };
    })();

    scholarshipFormInFlight.set(cacheKey, fetchPromise);
    const data = await fetchPromise;
    scholarshipFormCache.set(cacheKey, {
      data,
      expiresAt: now + SCHOLARSHIP_FORM_CACHE_TTL_MS,
    });
    scholarshipFormInFlight.delete(cacheKey);

    return res.json(data);
  } catch (err) {
    scholarshipFormInFlight.delete(cacheKey);
    if (err?.status === 404) {
      return res.status(404).json({ message: err.message });
    }
    console.error("Fetch scholarship form error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
