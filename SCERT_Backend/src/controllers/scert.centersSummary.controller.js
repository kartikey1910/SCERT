const pool = require("../config/db");
const districtBlockMaster = require("../master-data/district-block.master.json");
const { createClient } = require("redis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const summaryCacheClient = createClient({ url: redisUrl });

summaryCacheClient.on("error", (err) =>
  console.error("scert summary report redis error:", err)
);

summaryCacheClient.connect().catch((err) =>
  console.error("scert summary report redis connect error:", err)
);

/**
 * Drops the cached district / block APPROVED-student counts of one
 * scholarship, so a status change that moves applications into or out of
 * APPROVED shows up immediately instead of after the 5 minute cache. Only
 * the *_counts keys depend on application status - the plain district/block
 * center totals depend on exam_centers, not applications, so they are left
 * alone. Never throws: a cache problem must not fail the action that
 * triggered it.
 */
async function invalidateCentersSummaryCache({ session_id, scholarship_id }) {
  try {
    if (!summaryCacheClient.isReady) return;
    const keys = [`scert_centers_districts_counts:${session_id}:${scholarship_id}`];
    for await (const key of summaryCacheClient.scanIterator({
      MATCH: `scert_centers_blocks_counts:${session_id}:${scholarship_id}:*`,
      COUNT: 200,
    })) {
      keys.push(...(Array.isArray(key) ? key : [key]));
    }
    await summaryCacheClient.del(keys);
  } catch (err) {
    console.error("centers summary cache invalidation error:", err.message);
  }
}
exports.invalidateCentersSummaryCache = invalidateCentersSummaryCache;

function getAllDistrictsFromMaster() {
  const districts = Object.values(districtBlockMaster || {})
    .map((d) => ({
      district_code: String(d.district_code),
      district_name: d.district_name,
      total_blocks: Array.isArray(d.blocks) ? d.blocks.length : Object.keys(d.blocks || {}).length,
    }))
    .filter((d) => d.district_code && d.district_name);

  districts.sort((a, b) => String(a.district_code).localeCompare(String(b.district_code)));
  return districts;
}

function normalizeTwoDigitCode(code) {
  const s = String(code);
  const n = Number(s);
  if (!Number.isNaN(n)) return String(n).padStart(2, "0");
  return s;
}

function getBlocksForDistrictFromMaster(district_code) {
  const dcNorm = normalizeTwoDigitCode(district_code);
  const dcNum = Number(dcNorm);

  const entry = Object.values(districtBlockMaster || {}).find((d) => {
    const dNorm = normalizeTwoDigitCode(d.district_code);
    const dNum = Number(dNorm);
    if (!Number.isNaN(dcNum) && !Number.isNaN(dNum)) return dNum === dcNum;
    return dNorm === dcNorm;
  });

  if (!entry || !entry.blocks) return [];

  const blocks = Object.values(entry.blocks)
    .map((b) => ({
      block_code: String(b.block_code),
      block_name: b.block_name,
    }))
    .filter((b) => b.block_code && b.block_name);

  blocks.sort((a, b) => String(a.block_code).localeCompare(String(b.block_code)));
  return blocks;
}

/**
 * 📋 SCERT: DISTRICT SUMMARY (List of Centers)
 * GET /api/scert/list-centers/districts?scholarship_id=
 */
exports.getDistrictCentersSummary = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  const cacheKey = `scert_centers_districts:${session_id}:${scholarship_id}`;

  try {
    if (summaryCacheClient.isReady) {
      const cached = await summaryCacheClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }
  } catch (err) {
    console.error("Redis get error for centers summary:", err.message);
  }

  try {
    // Count ONLY centers per district (FAST)
    const centersRes = await pool.query(
      `SELECT sp.district_code::int AS district_code_int, COUNT(c.center_id)::int AS total_centers
       FROM scert_db.exam_centers c
       JOIN scert_db.school_profiles sp ON sp.user_id = c.school_user_id
       WHERE c.session_id = $1 AND c.scholarship_id = $2 AND c.is_active = true
       GROUP BY sp.district_code::int`,
      [session_id, scholarship_id]
    );

    const centersByDistrict = new Map();
    for (const r of centersRes.rows) {
      centersByDistrict.set(normalizeTwoDigitCode(r.district_code_int), Number(r.total_centers || 0));
    }

    const districts = getAllDistrictsFromMaster().map((d) => ({
      district_code: d.district_code,
      district_name: d.district_name,
      total_blocks: Number(d.total_blocks || 0),
      total_centers: Number(centersByDistrict.get(String(d.district_code)) || 0),
      // total_students is NO LONGER included here to keep it blazing fast.
    }));

    const responseData = {
      session_id,
      scholarship_id: Number(scholarship_id),
      total: districts.length,
      districts,
    };

    try {
      if (summaryCacheClient.isReady) {
        await summaryCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins cache
      }
    } catch (err) {
      console.error("Redis set error for centers summary:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("SCERT district centers summary error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * 📋 SCERT: BLOCK SUMMARY (List of Centers)
 * GET /api/scert/list-centers/blocks?scholarship_id=&district_code=
 */
exports.getBlockCentersSummary = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code } = req.query;

  if (roleId !== 5) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!scholarship_id) {
    return res.status(400).json({ message: "scholarship_id is required" });
  }

  if (!district_code) {
    return res.status(400).json({ message: "district_code is required" });
  }

  const cacheKey = `scert_centers_blocks:${session_id}:${scholarship_id}:${district_code}`;

  try {
    if (summaryCacheClient.isReady) {
      const cached = await summaryCacheClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    }
  } catch (err) {
    console.error("Redis get error for block centers summary:", err.message);
  }

  try {
    // Count ONLY centers per block (FAST)
    const centersRes = await pool.query(
      `SELECT sp.block_code::int AS block_code_int, COUNT(c.center_id)::int AS total_centers
       FROM scert_db.exam_centers c
       JOIN scert_db.school_profiles sp ON sp.user_id = c.school_user_id
       WHERE c.session_id = $1 AND c.scholarship_id = $2 AND c.is_active = true
         AND sp.district_code::int = $3::int
       GROUP BY sp.block_code::int`,
      [session_id, scholarship_id, String(district_code)]
    );

    const centersByBlock = new Map();
    for (const r of centersRes.rows) {
      centersByBlock.set(normalizeTwoDigitCode(r.block_code_int), Number(r.total_centers || 0));
    }

    const blocks = getBlocksForDistrictFromMaster(district_code).map((b) => ({
      block_code: b.block_code,
      block_name: b.block_name,
      total_centers: Number(centersByBlock.get(String(b.block_code)) || 0),
    }));

    const responseData = {
      session_id,
      scholarship_id: Number(scholarship_id),
      district_code: String(district_code),
      total: blocks.length,
      blocks,
    };

    try {
      if (summaryCacheClient.isReady) {
        await summaryCacheClient.setEx(cacheKey, 300, JSON.stringify(responseData)); // 5 mins cache
      }
    } catch (err) {
      console.error("Redis set error for block centers summary:", err.message);
    }

    res.json(responseData);
  } catch (err) {
    console.error("SCERT district centers summary error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * 📋 SCERT: DISTRICT STUDENT COUNTS
 * GET /api/scert/list-centers/districts/counts?scholarship_id=
 */
exports.getDistrictStudentsCount = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id } = req.query;

  if (roleId !== 5) return res.status(403).json({ message: "Unauthorized" });
  if (!scholarship_id) return res.status(400).json({ message: "scholarship_id required" });

  const cacheKey = `scert_centers_districts_counts:${session_id}:${scholarship_id}`;
  try {
    if (summaryCacheClient.isReady) {
      const cached = await summaryCacheClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }
  } catch (err) { }

  try {
    const studentsRes = await pool.query(
      `SELECT sp.district_code::int AS district_code_int, COUNT(sa.application_id)::int AS total_students
       FROM scert_db.scholarship_applications sa
       JOIN scert_db.exam_centers c ON c.center_id = sa.center_id
       JOIN scert_db.school_profiles sp ON sp.user_id = c.school_user_id
       WHERE sa.session_id = $1 AND sa.scholarship_id = $2 AND sa.status = 'APPROVED'
       GROUP BY sp.district_code::int`,
      [session_id, scholarship_id]
    );

    const counts = {};
    for (const r of studentsRes.rows) {
      counts[normalizeTwoDigitCode(r.district_code_int)] = Number(r.total_students);
    }

    try {
      if (summaryCacheClient.isReady) {
        await summaryCacheClient.setEx(cacheKey, 300, JSON.stringify(counts));
      }
    } catch (err) {}

    res.json(counts);
  } catch (err) {
    res.status(500).json({ message: "Error counting students" });
  }
};

/**
 * 📋 SCERT: BLOCK STUDENT COUNTS
 * GET /api/scert/list-centers/blocks/counts?scholarship_id=&district_code=
 */
exports.getBlockStudentsCount = async (req, res) => {
  const roleId = req.user.role_id;
  const { session_id } = req.session;
  const { scholarship_id, district_code } = req.query;

  if (roleId !== 5) return res.status(403).json({ message: "Unauthorized" });
  if (!scholarship_id || !district_code) return res.status(400).json({ message: "scholarship_id and district_code required" });

  const cacheKey = `scert_centers_blocks_counts:${session_id}:${scholarship_id}:${district_code}`;
  try {
    if (summaryCacheClient.isReady) {
      const cached = await summaryCacheClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }
  } catch (err) { }

  try {
    const studentsRes = await pool.query(
      `SELECT sp.block_code::int AS block_code_int, COUNT(sa.application_id)::int AS total_students
       FROM scert_db.scholarship_applications sa
       JOIN scert_db.exam_centers c ON c.center_id = sa.center_id
       JOIN scert_db.school_profiles sp ON sp.user_id = c.school_user_id
       WHERE sa.session_id = $1 AND sa.scholarship_id = $2 AND sa.status = 'APPROVED'
         AND sp.district_code::int = $3::int
       GROUP BY sp.block_code::int`,
      [session_id, scholarship_id, String(district_code)]
    );

    const counts = {};
    for (const r of studentsRes.rows) {
      counts[normalizeTwoDigitCode(r.block_code_int)] = Number(r.total_students);
    }

    try {
      if (summaryCacheClient.isReady) {
        await summaryCacheClient.setEx(cacheKey, 300, JSON.stringify(counts));
      }
    } catch (err) {}

    res.json(counts);
  } catch (err) {
    res.status(500).json({ message: "Error counting students" });
  }
};
