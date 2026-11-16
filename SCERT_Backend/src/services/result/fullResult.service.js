/**
 * Full Result — the agency's uploaded result sheet, read back on screen.
 *
 * Values come from result_students.raw_row (the untouched cell text as
 * uploaded) and the column set is derived from the keys that sheet
 * actually contained — see fullResultSheet.js for why the layout is not
 * hardcoded.
 *
 * District/block/school filtering matches against result_students' OWN
 * text columns rather than school_profiles, because the agency sheet
 * carries its own spellings ("BHAISIYACHHANA", "G.I.C. KHATBAY") which do
 * not line up with the master data ("Bhaisiyachhana"). Filtering through
 * school_profiles here would silently return nothing.
 */

const pool = require("../../config/db");
const sheet = require("./fullResultSheet");

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function buildWhere({ sessionId, scholarshipId, classValue, filters = {} }) {
  const params = [sessionId, scholarshipId, String(classValue)];
  const clauses = [
    `rs.session_id = $1`,
    `rs.scholarship_id = $2`,
    `rs."class"::text = $3`,
  ];

  const textFilter = (value, column) => {
    if (!value) return;
    params.push(String(value).trim());
    clauses.push(`UPPER(TRIM(COALESCE(rs.${column}, ''))) = UPPER($${params.length})`);
  };

  textFilter(filters.district, "district_name");
  textFilter(filters.block, "block_name");
  textFilter(filters.school, "school_name");

  if (filters.selected_only) clauses.push(`rs.is_selected = TRUE`);

  return { whereClause: clauses.join(" AND "), params };
}

/**
 * Which columns this scope's upload actually carried. raw_row omits empty
 * cells, so this is the union across every row rather than a sample of
 * one — a column that is blank for the first student but filled for the
 * hundredth still belongs in the layout.
 */
async function getPresentFields({ sessionId, scholarshipId, classValue, filters = {} }) {
  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });
  const res = await pool.query(
    `SELECT DISTINCT k
       FROM scert_db.result_students rs, jsonb_object_keys(rs.raw_row) k
      WHERE ${whereClause} AND rs.raw_row IS NOT NULL`,
    params
  );
  return res.rows.map((r) => r.k);
}

async function getFullResult({
  sessionId, scholarshipId, classValue, filters = {}, page = 1, pageSize = DEFAULT_PAGE_SIZE,
}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safePageSize;

  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });

  // Field discovery scans the whole scope, so it is deliberately not
  // narrowed by the current filters — the columns stay stable as the user
  // filters down instead of appearing and vanishing.
  const [rowsRes, countRes, presentFields] = await Promise.all([
    pool.query(
      `SELECT rs.raw_row
         FROM scert_db.result_students rs
        WHERE ${whereClause}
        ORDER BY rs.roll_number ASC
        LIMIT ${safePageSize} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_students rs WHERE ${whereClause}`,
      params
    ),
    getPresentFields({ sessionId, scholarshipId, classValue }),
  ]);

  const columns = sheet.describeColumns(presentFields);
  const total = countRes.rows[0]?.total || 0;

  return {
    columns: columns.map(({ key, header, align }) => ({ key, header, align })),
    rows: sheet.toSheetRows(rowsRes.rows, columns, offset + 1),
    page: safePage,
    page_size: safePageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

/**
 * Every row for the current filters, in batches — an unfiltered class is
 * 40k+ rows, too many to hold as one result set comfortably.
 */
async function* iterateFullResult({
  sessionId, scholarshipId, classValue, filters = {}, columns, batchSize = 2000,
}) {
  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });
  let offset = 0;

  for (;;) {
    const res = await pool.query(
      `SELECT rs.raw_row
         FROM scert_db.result_students rs
        WHERE ${whereClause}
        ORDER BY rs.roll_number ASC
        LIMIT ${batchSize} OFFSET ${offset}`,
      params
    );
    if (!res.rows.length) return;
    yield sheet.toSheetRows(res.rows, columns, offset + 1);
    if (res.rows.length < batchSize) return;
    offset += batchSize;
  }
}

async function countFullResult({ sessionId, scholarshipId, classValue, filters = {} }) {
  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });
  const res = await pool.query(
    `SELECT COUNT(*)::int AS total FROM scert_db.result_students rs WHERE ${whereClause}`,
    params
  );
  return res.rows[0]?.total || 0;
}

/** Full column descriptors (widths included) for the export paths. */
async function getExportColumns({ sessionId, scholarshipId, classValue }) {
  const presentFields = await getPresentFields({ sessionId, scholarshipId, classValue });
  return sheet.describeColumns(presentFields);
}

/**
 * Dropdown options, sourced from the result rows themselves so every
 * option is guaranteed to match something. Cascades: blocks narrow to the
 * chosen district, schools to the chosen district/block.
 */
async function getFullResultFilterOptions({
  sessionId, scholarshipId, classValue, district = null, block = null,
}) {
  const base = { sessionId, scholarshipId, classValue };

  const distinct = async (column, filters) => {
    const { whereClause, params } = buildWhere({ ...base, filters });
    const res = await pool.query(
      `SELECT DISTINCT TRIM(rs.${column}) AS value
         FROM scert_db.result_students rs
        WHERE ${whereClause} AND NULLIF(TRIM(COALESCE(rs.${column}, '')), '') IS NOT NULL
        ORDER BY value ASC`,
      params
    );
    return res.rows.map((r) => r.value);
  };

  const [districts, blocks, schools] = await Promise.all([
    distinct("district_name", {}),
    distinct("block_name", district ? { district } : {}),
    distinct("school_name", district || block ? { district, block } : {}),
  ]);

  return { districts, blocks, schools };
}

module.exports = {
  getFullResult,
  iterateFullResult,
  countFullResult,
  getExportColumns,
  getFullResultFilterOptions,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
