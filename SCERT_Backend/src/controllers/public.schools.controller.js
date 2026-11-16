const pool = require("../config/db");

/**
 * GET /api/public/schools
 * Query:
 *   q=<optional>
 *   district_name=<optional>
 *   block_name=<optional>
 *   school_category=<optional>
 *   school_type_name=<optional>
 *   page=<optional>
 *   limit=<optional>
 */
exports.listPublicSchools = async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();
    const hasQuery = q.length > 0;
    const districtName = String(req.query?.district_name || "").trim();
    const blockName = String(req.query?.block_name || "").trim();
    const schoolCategory = String(req.query?.school_category || "")
      .trim()
      .toLowerCase();
    const schoolTypeName = String(req.query?.school_type_name || "")
      .trim()
      .toLowerCase();
    const rawPage = Number.parseInt(String(req.query?.page || "1"), 10);
    const rawLimit = Number.parseInt(String(req.query?.limit || "20"), 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 5), 100) : 20;

    const params = [];
    const where = [];
    const normalizedDistrictSql = `NULLIF(TRIM(REGEXP_REPLACE(COALESCE(u.district_name, ''), '\\s*\\([0-9]+\\)\\s*$', '', 'g')), '')`;
    const normalizedBlockSql = `NULLIF(TRIM(REGEXP_REPLACE(COALESCE(u.block_name, ''), '\\s*\\([0-9]+\\)\\s*$', '', 'g')), '')`;

    const normalizedSchoolTypeSql = `
      CASE
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('1') THEN 'primary'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('2') THEN 'ps to ups'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('3') THEN 'ps to secondary'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('4') THEN 'sec only'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('5') THEN 'sec to h sec'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('6') THEN 'ups only'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('7') THEN 'ups to h sec'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) IN ('8') THEN 'ups to sec'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%primary%' THEN 'primary'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%ps to ups%' THEN 'ps to ups'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%ps to secondary%' THEN 'ps to secondary'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%sec only%' THEN 'sec only'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%sec to h sec%' THEN 'sec to h sec'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%ups only%' THEN 'ups only'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%ups to h sec%' THEN 'ups to h sec'
        WHEN LOWER(TRIM(COALESCE(u.school_type_raw, ''))) LIKE '%ups to sec%' THEN 'ups to sec'
        ELSE LOWER(TRIM(COALESCE(u.school_type_raw, '')))
      END
    `;

    const normalizedSchoolTypeNameSql = `
      CASE
        WHEN LOWER(TRIM(COALESCE(u.school_type_name_raw, ''))) IN ('aided', 'govt aided', 'govt. aided', 'govt add.', 'high school aided') THEN 'Govt Aided'
        WHEN LOWER(TRIM(COALESCE(u.school_type_name_raw, ''))) IN ('dept of edu', 'co education') THEN 'Dept of Edu'
        WHEN LOWER(TRIM(COALESCE(u.school_type_name_raw, ''))) IN ('local body') THEN 'Local Body'
        ELSE TRIM(COALESCE(u.school_type_name_raw, ''))
      END
    `;

    const normalizedSchoolCategorySql = `
      CASE
        WHEN LOWER(TRIM(COALESCE(u.school_category_raw, ''))) IN ('ups only', 'ups only') THEN 'UPS only'
        WHEN LOWER(TRIM(COALESCE(u.school_category_raw, ''))) IN ('hr secodary', 'hs', 'hsec only') THEN 'Hr Secondary'
        ELSE TRIM(COALESCE(u.school_category_raw, ''))
      END
    `;

    if (districtName) {
      params.push(districtName);
      where.push(
        `LOWER(COALESCE(${normalizedDistrictSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${params.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
      );
    }

    if (blockName) {
      params.push(blockName);
      where.push(
        `LOWER(COALESCE(${normalizedBlockSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${params.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
      );
    }

    if (schoolCategory) {
      params.push(schoolCategory);
      where.push(`LOWER(TRIM(COALESCE(u.school_category, ''))) = LOWER(TRIM($${params.length}))`);
    }
    if (schoolTypeName) {
      params.push(schoolTypeName);
      where.push(
        `LOWER(TRIM(COALESCE(u.school_type_name, ''))) = LOWER(TRIM($${params.length}))`
      );
    }

    if (hasQuery) {
      params.push(`%${q}%`);
      params.push(`%${q}%`);
      params.push(`%${q}%`);
      params.push(`%${q}%`);
      where.push(`(
        u.school_name ILIKE $${params.length - 3}
        OR u.udise_code ILIKE $${params.length - 2}
        OR u.district_name ILIKE $${params.length - 1}
        OR u.block_name ILIKE $${params.length}
      )`);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const baseCte = `
      WITH unified AS (
        SELECT
          sp.udise_code,
          sp.school_name,
          sp.district_name,
          sp.block_name,
          sp.school_type AS school_type_raw,
          sp.school_type AS school_type_name_raw,
          sp.school_category AS school_category_raw,
          1 AS src_priority
        FROM scert_db.school_profiles sp
        UNION ALL
        SELECT
          psm.udise_code,
          psm.school_name,
          psm.district_name,
          psm.block_name,
          COALESCE(psm.school_management_code, psm.school_category_code, '') AS school_type_raw,
          COALESCE(psm.school_management_code, '') AS school_type_name_raw,
          COALESCE(psm.school_category_code, '') AS school_category_raw,
          2 AS src_priority
        FROM scert_db.primary_schools_master psm
        WHERE COALESCE(psm.is_active, true) = true
      ),
      deduped AS (
        SELECT DISTINCT ON (TRIM(udise_code))
          TRIM(udise_code) AS udise_code,
          school_name,
          district_name,
          block_name,
          school_type_raw,
          school_type_name_raw,
          school_category_raw
        FROM unified
        ORDER BY TRIM(udise_code), src_priority
      ),
      normalized AS (
        SELECT
          u.udise_code,
          u.school_name,
          u.district_name,
          u.block_name,
          ${normalizedSchoolTypeSql} AS school_type,
          ${normalizedSchoolTypeNameSql} AS school_type_name,
          ${normalizedSchoolCategorySql} AS school_category
        FROM deduped u
      )
    `;

    const totalSql = `
      ${baseCte}
      SELECT COUNT(*)::int AS total
      FROM normalized u
      ${whereClause}
    `;
    const totalResult = await pool.query(totalSql, params);
    const total = Number(totalResult.rows?.[0]?.total || 0);
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const safeOffset = (safePage - 1) * limit;

    const listParams = [...params, limit, safeOffset];
    const sql = `
      ${baseCte}
      SELECT
        u.udise_code,
        u.school_name,
        u.district_name,
        u.block_name,
        u.school_type,
        u.school_type_name,
        u.school_category
      FROM normalized u
      ${whereClause}
      ORDER BY u.school_name ASC, u.udise_code ASC
      LIMIT $${listParams.length - 1}
      OFFSET $${listParams.length}
    `;

    const result = await pool.query(sql, listParams);

    const districtFilterSql = `
      ${baseCte}
      SELECT MIN(${normalizedDistrictSql}) AS district_name
      FROM normalized u
      WHERE ${normalizedDistrictSql} IS NOT NULL
      GROUP BY LOWER(${normalizedDistrictSql})
      ORDER BY district_name ASC
    `;
    const districtFilterRes = await pool.query(districtFilterSql);

    const blockFilterParams = [];
    let blockFilterWhere = `WHERE ${normalizedBlockSql} IS NOT NULL`;
    if (districtName) {
      blockFilterParams.push(districtName);
      blockFilterWhere += ` AND LOWER(COALESCE(${normalizedDistrictSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($1, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`;
    }
    const blockFilterSql = `
      ${baseCte}
      SELECT MIN(${normalizedBlockSql}) AS block_name
      FROM normalized u
      ${blockFilterWhere}
      GROUP BY LOWER(${normalizedBlockSql})
      ORDER BY block_name ASC
    `;
    const blockFilterRes = await pool.query(blockFilterSql, blockFilterParams);

    const categoryFilterParams = [];
    const categoryWhere = [];
    if (districtName) {
      categoryFilterParams.push(districtName);
      categoryWhere.push(
        `LOWER(COALESCE(${normalizedDistrictSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${categoryFilterParams.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
      );
    }
    if (blockName) {
      categoryFilterParams.push(blockName);
      categoryWhere.push(
        `LOWER(COALESCE(${normalizedBlockSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${categoryFilterParams.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
      );
    }
    const categoryWhereClause =
      categoryWhere.length > 0
        ? `WHERE ${categoryWhere.join(" AND ")} AND TRIM(COALESCE(u.school_category, '')) <> ''`
        : `WHERE TRIM(COALESCE(u.school_category, '')) <> ''`;
    const categoryFilterSql = `
      ${baseCte}
      SELECT DISTINCT u.school_category
      FROM normalized u
      ${categoryWhereClause}
      ORDER BY u.school_category ASC
    `;
    const categoryFilterRes = await pool.query(categoryFilterSql, categoryFilterParams);

    const typeFilterParams = [];
    const typeWhere = [];
    if (districtName) {
      typeFilterParams.push(districtName);
      typeWhere.push(
        `LOWER(COALESCE(${normalizedDistrictSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${typeFilterParams.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
      );
    }
    if (blockName) {
      typeFilterParams.push(blockName);
      typeWhere.push(
        `LOWER(COALESCE(${normalizedBlockSql}, '')) = LOWER(COALESCE(NULLIF(TRIM(REGEXP_REPLACE($${typeFilterParams.length}, '\\s*\\([0-9]+\\)\\s*$', '', 'g')), ''), ''))`
      );
    }
    if (schoolCategory) {
      typeFilterParams.push(schoolCategory);
      typeWhere.push(
        `LOWER(TRIM(COALESCE(u.school_category, ''))) = LOWER(TRIM($${typeFilterParams.length}))`
      );
    }
    const typeWhereClause =
      typeWhere.length > 0
        ? `WHERE ${typeWhere.join(" AND ")} AND TRIM(COALESCE(u.school_type_name, '')) <> ''`
        : `WHERE TRIM(COALESCE(u.school_type_name, '')) <> ''`;
    const typeFilterSql = `
      ${baseCte}
      SELECT DISTINCT u.school_type_name
      FROM normalized u
      ${typeWhereClause}
      ORDER BY u.school_type_name ASC
    `;
    const typeFilterRes = await pool.query(typeFilterSql, typeFilterParams);

    return res.json({
      total,
      page: safePage,
      limit,
      pages,
      schools: result.rows.map((r) => ({
        udise_code: r.udise_code,
        school_name: r.school_name,
        district_name: r.district_name,
        block_name: r.block_name,
        school_type: r.school_type,
        school_type_name: r.school_type_name,
        school_category: r.school_category,
      })),
      filters: {
        districts: districtFilterRes.rows
          .map((r) => String(r.district_name || "").trim())
          .filter(Boolean),
        blocks: blockFilterRes.rows
          .map((r) => String(r.block_name || "").trim())
          .filter(Boolean),
        school_categories: categoryFilterRes.rows
          .map((r) => String(r.school_category || "").trim())
          .filter(Boolean),
        school_types: typeFilterRes.rows
          .map((r) => String(r.school_type_name || "").trim())
          .filter(Boolean),
      },
    });
  } catch (err) {
    console.error("Public schools list error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
