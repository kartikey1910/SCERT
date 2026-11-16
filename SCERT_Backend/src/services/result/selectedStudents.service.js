/**
 * Selected Students — the official list, SCERT level.
 *
 * Ordered district → block → merit, which is how the published
 * चयनित अभ्यर्थियों की सूची is laid out (the same block-wise-then-merit
 * convention the district and BEO selected lists already follow).
 */

const pool = require("../../config/db");
const sheet = require("./selectedStudentsSheet");

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const ORDER_BY = `
  ORDER BY COALESCE(NULLIF(TRIM(rs.district_name), ''), 'ZZZ') ASC,
           COALESCE(NULLIF(TRIM(rs.block_name), ''), 'ZZZ') ASC,
           rs.total_marks DESC NULLS LAST,
           rs.roll_number ASC
`;

// The PDF goes block by block in block-code order (1, 2, 3 ...), each block
// still in merit order. Block codes run district by district, so this keeps
// the districts together too.
const ORDER_BY_BLOCK = `
  ORDER BY NULLIF(regexp_replace(COALESCE(rs.block_code::text, ''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
           COALESCE(NULLIF(TRIM(rs.block_name), ''), 'ZZZ') ASC,
           rs.total_marks DESC NULLS LAST,
           rs.roll_number ASC
`;

function buildWhere({ sessionId, scholarshipId, classValue, filters = {} }) {
  const params = [sessionId, scholarshipId, String(classValue)];
  const clauses = [
    `rs.session_id = $1`,
    `rs.scholarship_id = $2`,
    `rs."class"::text = $3`,
    `rs.is_selected = TRUE`,
  ];

  const textFilter = (value, column) => {
    if (!value) return;
    params.push(String(value).trim());
    clauses.push(`UPPER(TRIM(COALESCE(rs.${column}, ''))) = UPPER($${params.length})`);
  };

  textFilter(filters.district, "district_name");
  textFilter(filters.block, "block_name");
  textFilter(filters.school, "school_name");

  return { whereClause: clauses.join(" AND "), params };
}

async function getSelectedStudents({
  sessionId, scholarshipId, classValue, filters = {}, page = 1, pageSize = DEFAULT_PAGE_SIZE,
}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safePageSize;

  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });

  const [rowsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT ${sheet.SELECT_COLUMNS.map((c) => `rs.${c}`).join(", ")}
         FROM scert_db.result_students rs
        WHERE ${whereClause}
        ${ORDER_BY}
        LIMIT ${safePageSize} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_students rs WHERE ${whereClause}`,
      params
    ),
  ]);

  const total = countRes.rows[0]?.total || 0;

  return {
    columns: sheet.describeColumns(),
    rows: sheet.toSheetRows(rowsRes.rows, offset + 1),
    page: safePage,
    page_size: safePageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

/**
 * All matching rows, in batches, for the exports. `byBlock` uses the PDF's
 * block-code order and adds `block_key` to each row for grouping.
 */
async function* iterateSelectedStudents({
  sessionId, scholarshipId, classValue, filters = {}, batchSize = 2000, byBlock = false,
}) {
  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });
  let offset = 0;

  for (;;) {
    const res = await pool.query(
      `SELECT ${sheet.SELECT_COLUMNS.map((c) => `rs.${c}`).join(", ")}, rs.block_code
         FROM scert_db.result_students rs
        WHERE ${whereClause}
        ${byBlock ? ORDER_BY_BLOCK : ORDER_BY}
        LIMIT ${batchSize} OFFSET ${offset}`,
      params
    );
    if (!res.rows.length) return;
    const sheetRows = sheet.toSheetRows(res.rows, offset + 1);
    if (byBlock) {
      sheetRows.forEach((r, i) => {
        r.block_key = `${res.rows[i].block_code ?? ""}|${res.rows[i].block_name ?? ""}`;
      });
    }
    yield sheetRows;
    if (res.rows.length < batchSize) return;
    offset += batchSize;
  }
}

async function countSelectedStudents({ sessionId, scholarshipId, classValue, filters = {} }) {
  const { whereClause, params } = buildWhere({ sessionId, scholarshipId, classValue, filters });
  const res = await pool.query(
    `SELECT COUNT(*)::int AS total FROM scert_db.result_students rs WHERE ${whereClause}`,
    params
  );
  return res.rows[0]?.total || 0;
}

/** Cascading dropdowns, restricted to selected candidates. */
async function getSelectedStudentsFilterOptions({
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
  getSelectedStudents,
  iterateSelectedStudents,
  countSelectedStudents,
  getSelectedStudentsFilterOptions,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
