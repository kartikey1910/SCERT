/**
 * Result publication — SCERT publish switch + the student-facing lookup.
 *
 * Load profile is unlike anything else in this app: for most of the year
 * these endpoints are idle, and for a few hours after SCERT flips the
 * switch every candidate in the state hits them at once. The whole
 * module is therefore built around never touching Postgres when Redis
 * can answer instead:
 *
 *   - published scopes            -> cached, ~1 tiny query per 60s
 *   - a student's score card      -> cached per roll number, 1 query each
 *   - roll numbers that not exist -> negatively cached, so a typo storm
 *                                    or an enumeration sweep cannot turn
 *                                    into a query storm
 *
 * Date of birth is verified in the app layer against the cached record,
 * so repeated wrong-DOB attempts against a valid roll number cost zero
 * database work.
 */

const pool = require("../config/db");
const { createClient } = require("redis");

// ---------------------------------------------------------------------
// Redis (same connection/error convention as result.service.js)
// ---------------------------------------------------------------------

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const publishCacheClient = createClient({ url: redisUrl });
publishCacheClient.on("error", (err) =>
  console.error("result publish redis error:", err)
);
publishCacheClient.connect().catch((err) =>
  console.error("result publish redis connect error:", err)
);

// Published scopes change only when SCERT toggles, and that path
// explicitly busts the key — the TTL is just a backstop so a missed
// invalidation self-heals within a minute.
const SCOPES_TTL_SECONDS = 60;
// A published score card is immutable, so it can be held a long time.
const RESULT_TTL_SECONDS = 3600;
// Unknown roll numbers: short enough that a genuine late upload appears
// quickly, long enough to absorb a burst of mistyped roll numbers.
const NOT_FOUND_TTL_SECONDS = 300;

async function cacheGet(key) {
  try {
    if (!publishCacheClient.isReady) return null;
    const cached = await publishCacheClient.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error("Redis get error (result publish):", err.message);
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  try {
    if (!publishCacheClient.isReady) return;
    await publishCacheClient.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    console.error("Redis set error (result publish):", err.message);
  }
}

async function cacheDeletePattern(pattern) {
  try {
    if (!publishCacheClient.isReady) return;

    // Exact key — no need to scan the keyspace for it.
    if (!pattern.includes("*")) {
      await publishCacheClient.del(pattern);
      return;
    }

    // Result sets here are small (one key per roll number within a single
    // scope) and this runs only on the toggle path, so scanning is safe —
    // it is never called on the request path.
    //
    // node-redis v5 yields an ARRAY of keys per iteration (v4 yielded one
    // key at a time), and a SCAN pass is allowed to return an empty batch
    // even when later batches match. Both cases have to be handled, or
    // DEL is called with no arguments and throws.
    for await (const entry of publishCacheClient.scanIterator({
      MATCH: pattern,
      COUNT: 500,
    })) {
      const keys = Array.isArray(entry) ? entry : [entry];
      if (keys.length) await publishCacheClient.del(keys);
    }
  } catch (err) {
    console.error("Redis invalidate error (result publish):", err.message);
  }
}

const SCOPES_CACHE_KEY = "result-publish:scopes";
const resultCacheKey = (sessionId, scholarshipId, rollNumber) =>
  `result-publish:card:${sessionId}:${scholarshipId}:${rollNumber}`;

// ---------------------------------------------------------------------
// Per-class paper configuration
//
// Taken from the official score-card format (CM Scholarship
// Result-Format.docx): class 6 is 60 + 60 = 120, class 9 is 100 + 100 =
// 200. Anything else falls back to null maxima, which render as "-"
// rather than inventing a total the sheet never specified.
// ---------------------------------------------------------------------

const CLASS_PAPER_CONFIG = {
  6: {
    level_label: "Junior Level (Class-6th)",
    mat_max: 60,
    sat_max: 60,
    total_max: 120,
  },
  9: {
    level_label: "Senior Level (Class-9th)",
    mat_max: 100,
    sat_max: 100,
    total_max: 200,
  },
};

function getClassConfig(classValue) {
  return (
    CLASS_PAPER_CONFIG[Number(classValue)] || {
      level_label: `Class-${classValue}`,
      mat_max: null,
      sat_max: null,
      total_max: null,
    }
  );
}

/** Both classes must be present before results can be published. */
const REQUIRED_CLASSES = [6, 9];

/**
 * The two independent releases SCERT controls.
 *
 *   public   — home-page View Result button + roll-number/DOB lookup
 *   officers — School, BEO and District result lists and downloads
 *
 * Each maps onto its own set of columns in result_publications, so one
 * can be switched off without touching the other.
 */
const AUDIENCES = {
  public: {
    flag: "is_published",
    publishedAt: "published_at",
    publishedBy: "published_by",
    unpublishedAt: "unpublished_at",
    unpublishedBy: "unpublished_by",
  },
  officers: {
    flag: "is_officer_published",
    publishedAt: "officer_published_at",
    publishedBy: "officer_published_by",
    unpublishedAt: "officer_unpublished_at",
    unpublishedBy: "officer_unpublished_by",
  },
};

exports.AUDIENCES = Object.keys(AUDIENCES);

// ---------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------

function normalizeRollNumber(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Accepts what an HTML date input sends (YYYY-MM-DD) as well as the
 * DD/MM/YYYY and DD-MM-YYYY forms people type by hand, and returns a
 * canonical YYYY-MM-DD string. Returns null when the value is not a
 * real calendar date — the same round-trip check used by the sheet
 * parser, so 31/11 is rejected rather than silently rolled into 01/12.
 */
function normalizeDobInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let year;
  let month;
  let day;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * result_students.dob is a DATE, and config/db.js parses type 1082 as a
 * raw 'YYYY-MM-DD' string (deliberately, to avoid UTC shifting). Guard
 * against a Date instance anyway in case that parser is ever removed.
 */
function normalizeStoredDob(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// Published scopes
// ---------------------------------------------------------------------

/**
 * Every (session, scholarship) whose results are currently live.
 * Cached because it is read on every single public lookup.
 */
async function getPublishedScopes() {
  const cached = await cacheGet(SCOPES_CACHE_KEY);
  if (cached) return cached;

  const res = await pool.query(
    `SELECT rp.session_id, rp.scholarship_id, rp.published_at,
            s.session_name, sc.scholarship_name
       FROM scert_db.result_publications rp
       LEFT JOIN scert_db.academic_sessions s ON s.session_id = rp.session_id
       LEFT JOIN scert_db.scholarships sc ON sc.scholarship_id = rp.scholarship_id
      WHERE rp.is_published = TRUE
      ORDER BY rp.session_id DESC, rp.scholarship_id DESC`
  );

  await cacheSet(SCOPES_CACHE_KEY, res.rows, SCOPES_TTL_SECONDS);
  return res.rows;
}

/** True when at least one scope is live — drives the home-page button. */
exports.isAnyResultPublished = async () => {
  const scopes = await getPublishedScopes();
  return {
    published: scopes.length > 0,
    scopes: scopes.map((s) => ({
      session_id: s.session_id,
      scholarship_id: s.scholarship_id,
      session_name: s.session_name,
      scholarship_name: s.scholarship_name,
      published_at: s.published_at,
    })),
  };
};

// ---------------------------------------------------------------------
// SCERT: readiness + publish state
// ---------------------------------------------------------------------

/**
 * What SCERT sees on the Publish Result page: whether each required
 * class has its All-Students sheet loaded, and whether the switch is
 * currently on. `can_publish` is the single flag the UI gates on.
 */
exports.getPublishStatus = async ({ sessionId, scholarshipId }) => {
  const [publicationRes, classCountsRes, uploadsRes] = await Promise.all([
    pool.query(
      `SELECT rp.is_published, rp.published_at, rp.unpublished_at,
              pu.login_id AS published_by_name,
              rp.is_officer_published, rp.officer_published_at, rp.officer_unpublished_at,
              ou.login_id AS officer_published_by_name
         FROM scert_db.result_publications rp
         LEFT JOIN scert_db.users pu ON pu.user_id = rp.published_by
         LEFT JOIN scert_db.users ou ON ou.user_id = rp.officer_published_by
        WHERE rp.session_id = $1 AND rp.scholarship_id = $2`,
      [sessionId, scholarshipId]
    ),
    pool.query(
      `SELECT rs."class"::int AS class_value,
              COUNT(*)::int AS total_students,
              COUNT(*) FILTER (WHERE rs.is_selected)::int AS selected_students,
              COUNT(*) FILTER (WHERE NOT rs.is_absent)::int AS appeared_students
         FROM scert_db.result_students rs
        WHERE rs.session_id = $1 AND rs.scholarship_id = $2
        GROUP BY rs."class"`,
      [sessionId, scholarshipId]
    ),
    pool.query(
      `SELECT DISTINCT ON (ru."class")
              ru."class"::int AS class_value,
              ru.upload_id, ru.file_name, ru.status, ru.total_records, ru.created_at
         FROM scert_db.result_uploads ru
        WHERE ru.session_id = $1 AND ru.scholarship_id = $2
          AND ru.upload_type = 'ALL_STUDENTS'
        ORDER BY ru."class", ru.upload_id DESC`,
      [sessionId, scholarshipId]
    ),
  ]);

  const countsByClass = new Map(
    classCountsRes.rows.map((r) => [Number(r.class_value), r])
  );
  const uploadsByClass = new Map(
    uploadsRes.rows.map((r) => [Number(r.class_value), r])
  );

  const classes = REQUIRED_CLASSES.map((classValue) => {
    const counts = countsByClass.get(classValue);
    const upload = uploadsByClass.get(classValue);
    const totalStudents = counts ? Number(counts.total_students) : 0;

    return {
      class_value: classValue,
      // A sheet counts as present only if it actually landed rows — an
      // upload row that failed before inserting anything must not
      // unlock publishing.
      ready: totalStudents > 0,
      total_students: totalStudents,
      selected_students: counts ? Number(counts.selected_students) : 0,
      appeared_students: counts ? Number(counts.appeared_students) : 0,
      upload: upload
        ? {
            upload_id: upload.upload_id,
            file_name: upload.file_name,
            status: upload.status,
            total_records: upload.total_records,
            uploaded_at: upload.created_at,
          }
        : null,
    };
  });

  const missingClasses = classes.filter((c) => !c.ready).map((c) => c.class_value);
  const p = publicationRes.rows[0] || null;

  return {
    public: {
      is_published: p ? p.is_published : false,
      published_at: p ? p.published_at : null,
      unpublished_at: p ? p.unpublished_at : null,
      published_by_name: p ? p.published_by_name : null,
    },
    officers: {
      is_published: p ? p.is_officer_published : false,
      published_at: p ? p.officer_published_at : null,
      unpublished_at: p ? p.officer_unpublished_at : null,
      published_by_name: p ? p.officer_published_by_name : null,
    },
    classes,
    missing_classes: missingClasses,
    can_publish: missingClasses.length === 0,
    blocking_reason:
      missingClasses.length > 0
        ? `All Students sheet not uploaded for class ${missingClasses.join(" and ")}.`
        : null,
  };
};

/**
 * Flip one switch. Publishing either audience is refused unless every
 * required class has data; unpublishing is always allowed, so a mistaken
 * release can be pulled immediately without any precondition in the way.
 *
 * Only the chosen audience's columns are written. The other switch is
 * left exactly as it was — that independence is the whole point.
 */
exports.setPublishStatus = async ({
  sessionId,
  scholarshipId,
  audience,
  isPublished,
  userId,
}) => {
  const cols = AUDIENCES[audience];
  if (!cols) {
    const err = new Error(`Unknown audience "${audience}".`);
    err.statusCode = 400;
    throw err;
  }

  if (isPublished) {
    const status = await exports.getPublishStatus({ sessionId, scholarshipId });
    if (!status.can_publish) {
      const err = new Error(status.blocking_reason || "Results are not ready to publish.");
      err.statusCode = 409;
      throw err;
    }
  }

  // Column names come from the fixed AUDIENCES map above, never from the
  // request, so interpolating them is safe.
  const { flag, publishedAt, publishedBy, unpublishedAt, unpublishedBy } = cols;
  const table = "scert_db.result_publications";

  const res = await pool.query(
    `INSERT INTO ${table}
       (session_id, scholarship_id, ${flag},
        ${publishedAt}, ${publishedBy}, ${unpublishedAt}, ${unpublishedBy}, updated_at)
     VALUES ($1, $2, $3,
        CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN $3 THEN $4::bigint ELSE NULL END,
        CASE WHEN $3 THEN NULL ELSE CURRENT_TIMESTAMP END,
        CASE WHEN $3 THEN NULL ELSE $4::bigint END,
        CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, scholarship_id) DO UPDATE SET
       ${flag}          = EXCLUDED.${flag},
       ${publishedAt}   = CASE WHEN EXCLUDED.${flag}
                               THEN CURRENT_TIMESTAMP
                               ELSE ${table}.${publishedAt} END,
       ${publishedBy}   = CASE WHEN EXCLUDED.${flag}
                               THEN EXCLUDED.${publishedBy}
                               ELSE ${table}.${publishedBy} END,
       ${unpublishedAt} = CASE WHEN EXCLUDED.${flag}
                               THEN NULL ELSE CURRENT_TIMESTAMP END,
       ${unpublishedBy} = CASE WHEN EXCLUDED.${flag}
                               THEN NULL ELSE EXCLUDED.${unpublishedBy} END,
       updated_at       = CURRENT_TIMESTAMP
     RETURNING *`,
    [sessionId, scholarshipId, isPublished, userId]
  );

  // Only the public release is cached in Redis. Drop the scope list and
  // every cached card in this scope so an unpublish takes effect at once
  // rather than serving stale cards for up to an hour. The department
  // gate is read live from Postgres on every request, so it needs no
  // invalidation.
  if (audience === "public") {
    await cacheDeletePattern(SCOPES_CACHE_KEY);
    await cacheDeletePattern(`result-publish:card:${sessionId}:${scholarshipId}:*`);
  }

  return res.rows[0];
};

// ---------------------------------------------------------------------
// Public: student score-card lookup
// ---------------------------------------------------------------------

/**
 * Shapes one result_students row into the official score card. Marks are
 * laid out exactly as the format's two tables: candidate details, then a
 * per-paper score table carrying maximum / weightage / obtained / total.
 *
 * SCSTMAT and SCSTSAT hold the SC/ST weightage for each paper
 * individually (verified against the agency sheet: 47 + 52 + 3 + 3 =
 * 105), so each paper row carries its own weightage figure and the
 * totals column adds it to that paper's obtained marks.
 */
function buildScoreCard(row, scopeMeta) {
  const config = getClassConfig(row.class_value);

  const matMarks = toNumberOrNull(row.mat_marks);
  const satMarks = toNumberOrNull(row.sat_marks);
  const matWeightage = toNumberOrNull(row.scst_mat_marks);
  const satWeightage = toNumberOrNull(row.scst_sat_marks);

  const sum = (...values) => {
    const present = values.filter((v) => v !== null);
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
  };

  const matTotal = sum(matMarks, matWeightage);
  const satTotal = sum(satMarks, satWeightage);
  // Prefer the agency's own TOTMARKS; fall back to our sum only if the
  // sheet left it blank, so a published card never contradicts the
  // official list.
  const grandTotal =
    toNumberOrNull(row.total_marks) !== null
      ? toNumberOrNull(row.total_marks)
      : sum(matTotal, satTotal);

  let resultStatus;
  if (row.is_absent) resultStatus = "Absent";
  else if (row.is_selected) resultStatus = "Selected";
  else resultStatus = "Not Selected";

  return {
    header: {
      authority: "State Council for Educational Research and Training Uttarakhand, Dehradun",
      exam_title_hi: "मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृत्ति परीक्षा",
      exam_title_en: "Chief Minister Meritorious Student Incentive Scholarship Exam",
      session_name: scopeMeta.session_name || null,
      scholarship_name: scopeMeta.scholarship_name || null,
      level_label: config.level_label,
      class_value: row.class_value,
    },
    identity: {
      district: row.district_name || null,
      block: row.block_name || null,
      school_name: row.school_name || null,
      roll_number: row.roll_number,
    },
    candidate: {
      candidate_name: row.student_name || null,
      father_name: row.father_name || null,
      mother_name: row.mother_name || null,
      date_of_birth: normalizeStoredDob(row.dob),
      sex: row.gender || null,
      caste: row.category || null,
    },
    score_card: {
      papers: [
        {
          sr_no: 1,
          paper: "Paper-1: Mental Ability Test",
          maximum_marks: config.mat_max,
          weightage: matWeightage,
          marks_obtained: matMarks,
          total: matTotal,
        },
        {
          sr_no: 2,
          paper: "Paper-2: Scholastic Aptitude Test",
          maximum_marks: config.sat_max,
          weightage: satWeightage,
          marks_obtained: satMarks,
          total: satTotal,
        },
      ],
      totals: {
        maximum_marks: config.total_max,
        weightage: sum(matWeightage, satWeightage),
        marks_obtained: sum(matMarks, satMarks),
        total: grandTotal,
      },
    },
    result: resultStatus,
    is_selected: Boolean(row.is_selected),
    is_absent: Boolean(row.is_absent),
    footer: {
      signatory: "Exam Controller",
      authority: "SCERT Uttarakhand",
      note: "The score card has been generated electronically, hence does not require any signature.",
      validity: scopeMeta.session_name
        ? `This score card is valid for ${scopeMeta.session_name}.`
        : null,
    },
  };
}

/**
 * Fetches (and caches) the card for a roll number within one published
 * scope. The cached object keeps the DOB so verification can happen
 * without a second query — the card is never returned from here, only
 * from the caller after the DOB matches.
 */
async function loadCardForScope(scope, rollNumber) {
  const key = resultCacheKey(scope.session_id, scope.scholarship_id, rollNumber);
  const cached = await cacheGet(key);
  if (cached) return cached;

  const res = await pool.query(
    `SELECT rs.roll_number, rs."class"::int AS class_value,
            rs.student_name, rs.father_name, rs.mother_name,
            rs.dob, rs.gender, rs.category,
            rs.district_name, rs.block_name, rs.school_name,
            rs.mat_marks, rs.sat_marks,
            rs.scst_mat_marks, rs.scst_sat_marks, rs.total_marks,
            rs.is_selected, rs.is_absent
       FROM scert_db.result_students rs
      WHERE rs.session_id = $1 AND rs.scholarship_id = $2 AND rs.roll_number = $3
      LIMIT 1`,
    [scope.session_id, scope.scholarship_id, rollNumber]
  );

  if (!res.rows.length) {
    const miss = { found: false };
    await cacheSet(key, miss, NOT_FOUND_TTL_SECONDS);
    return miss;
  }

  const row = res.rows[0];
  const payload = {
    found: true,
    dob: normalizeStoredDob(row.dob),
    card: buildScoreCard(row, scope),
  };
  await cacheSet(key, payload, RESULT_TTL_SECONDS);
  return payload;
}

/**
 * The student-facing lookup. Returns a discriminated result rather than
 * throwing, so the controller can map each case to the right status
 * code and a message that never reveals whether a roll number exists.
 */
exports.lookupResult = async ({ rollNumber, dob }) => {
  const normalizedRoll = normalizeRollNumber(rollNumber);
  const normalizedDob = normalizeDobInput(dob);

  if (!normalizedRoll) return { status: "INVALID_INPUT", field: "roll_number" };
  if (!normalizedDob) return { status: "INVALID_INPUT", field: "dob" };

  const scopes = await getPublishedScopes();
  if (!scopes.length) return { status: "NOT_PUBLISHED" };

  for (const scope of scopes) {
    const record = await loadCardForScope(scope, normalizedRoll);
    if (!record.found) continue;

    // The roll number exists but the sheet carried an unparseable date,
    // so there is nothing to verify against. Fail closed and route the
    // student to their school rather than releasing the card unchecked.
    if (!record.dob) return { status: "DOB_UNAVAILABLE" };

    if (record.dob !== normalizedDob) return { status: "MISMATCH" };

    return { status: "OK", card: record.card };
  }

  return { status: "MISMATCH" };
};

/**
 * Builds the official score card for one student within a scope, without
 * requiring a date-of-birth check.
 *
 * The public lookup verifies DOB because the caller is an anonymous
 * visitor. Officer-facing downloads are different: the caller is already
 * authenticated and the calling controller has already restricted the
 * query to rows that officer is entitled to see, so re-checking DOB there
 * would only block a legitimate download.
 *
 * Returns null when the roll number is not in scope — the caller turns
 * that into a 404.
 */
exports.buildScoreCardForRoll = async ({ sessionId, scholarshipId, rollNumber }) => {
  const res = await pool.query(
    `SELECT rs.roll_number, rs."class"::int AS class_value,
            rs.student_name, rs.father_name, rs.mother_name,
            rs.dob, rs.gender, rs.category,
            rs.district_name, rs.block_name, rs.school_name,
            rs.mat_marks, rs.sat_marks,
            rs.scst_mat_marks, rs.scst_sat_marks, rs.total_marks,
            rs.is_selected, rs.is_absent
       FROM scert_db.result_students rs
      WHERE rs.session_id = $1 AND rs.scholarship_id = $2 AND rs.roll_number = $3
      LIMIT 1`,
    [sessionId, scholarshipId, normalizeRollNumber(rollNumber)]
  );
  if (!res.rows.length) return null;

  const [sessionRes, scholarshipRes] = await Promise.all([
    pool.query(`SELECT session_name FROM scert_db.academic_sessions WHERE session_id = $1`, [sessionId]),
    pool.query(`SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $1`, [scholarshipId]),
  ]);

  return buildScoreCard(res.rows[0], {
    session_name: sessionRes.rows[0]?.session_name || null,
    scholarship_name: scholarshipRes.rows[0]?.scholarship_name || null,
  });
};

module.exports = exports;
