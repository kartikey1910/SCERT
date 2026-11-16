/**
 * Result module — upload ingestion.
 *
 * Handles the five sheet types supplied by the exam agency:
 *   ALL_STUDENTS       full appeared-candidate list (master record)
 *   SELECTED_STUDENTS  the selected subset (marks selection, enriches columns)
 *   ANSWER_KEY         correct answers per paper code (MAT6 / SAT6 / MAT6B)
 *   STUDENT_RESPONSES  per-question OMR responses, scored on ingest
 *   BLOCK_SUMMARY      official district/block figures
 *
 * Response workbooks reach ~30k students x 100 questions x 2 papers
 * (~6M rows per class), so those are parsed with the streaming reader and
 * written with COPY. Nothing accumulates the full row set in memory.
 */

const crypto = require("crypto");
const { Readable } = require("stream");
const ExcelJS = require("exceljs");
const copyFrom = require("pg-copy-streams").from;

const pool = require("../../config/db");
const P = require("./sheetProfiles");

const STUDENT_INSERT_CHUNK = 500;
const COPY_FLUSH_ROWS = 5000;

// ---------------------------------------------------------------------
// Upload registry helpers
// ---------------------------------------------------------------------

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function createUpload(client, {
  sessionId, scholarshipId, classValue, uploadType,
  fileName, fileHash, sheetNames, uploadedBy,
}) {
  const res = await client.query(
    `INSERT INTO scert_db.result_uploads
       (session_id, scholarship_id, "class", upload_type, status,
        file_name, file_hash, sheet_names, uploaded_by)
     VALUES ($1, $2, $3, $4, 'PROCESSING', $5, $6, $7, $8)
     RETURNING upload_id`,
    [sessionId, scholarshipId, classValue, uploadType,
      fileName || "unknown.xlsx", fileHash, sheetNames || null, uploadedBy]
  );
  return res.rows[0].upload_id;
}

async function finalizeUpload(client, uploadId, stats) {
  const {
    total = 0, matched = 0, unmatched = 0, inserted = 0,
    updated = 0, errors = 0, validationFailures = 0, errorMessage = null,
  } = stats;

  const status = errorMessage ? "FAILED" : (errors > 0 || unmatched > 0 ? "PARTIAL" : "SUCCESS");

  await client.query(
    `UPDATE scert_db.result_uploads
        SET status = $2, total_records = $3, matched_records = $4,
            unmatched_records = $5, inserted_records = $6, updated_records = $7,
            error_records = $8, validation_failures = $9, error_message = $10,
            completed_at = CURRENT_TIMESTAMP
      WHERE upload_id = $1`,
    [uploadId, status, total, matched, unmatched, inserted, updated,
      errors, validationFailures, errorMessage]
  );
  return status;
}

async function recordErrors(client, uploadId, scope, errors) {
  if (!errors.length) return;

  for (let i = 0; i < errors.length; i += 500) {
    const chunk = errors.slice(i, i + 500);
    const values = [];
    const placeholders = chunk.map((err, idx) => {
      const b = idx * 9;
      values.push(
        uploadId, scope.sessionId, scope.scholarshipId, scope.classValue,
        err.sheetName || null, err.rowNumber || null, err.rollNumber || null,
        err.errorType, err.detail || null
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
    });

    await client.query(
      `INSERT INTO scert_db.result_upload_errors
         (upload_id, session_id, scholarship_id, "class",
          sheet_name, row_number, roll_number, error_type, error_detail)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  }
}

/**
 * Roll numbers are only unique within a session+scholarship+class, so the
 * lookup must be scoped — an unscoped match can bind a result row to a
 * different year's application.
 */
async function loadApplicationMap(client, { sessionId, scholarshipId, classValue }) {
  const res = await client.query(
    `SELECT roll_number, application_id, student_user_id
       FROM scert_db.scholarship_applications
      WHERE session_id = $1
        AND scholarship_id = $2
        AND "class" = $3
        AND roll_number IS NOT NULL`,
    [sessionId, scholarshipId, classValue]
  );

  const map = new Map();
  for (const row of res.rows) {
    map.set(String(row.roll_number).trim(), row);
  }
  return map;
}

/**
 * Production's Postgres is a separate, network-reached server with
 * statement_timeout=30s and idle_in_transaction_session_timeout=1min —
 * both far too short for a multi-million-row COPY. SET LOCAL scopes the
 * override to just the current transaction; it reverts automatically at
 * COMMIT/ROLLBACK, so the database's global limits stay untouched for
 * every other connection.
 */
async function setUploadTimeouts(client) {
  await client.query("SET LOCAL statement_timeout = '15min'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '15min'");
}

/**
 * Best-effort failure marker for uploads that fail after their
 * result_uploads row was already committed in an earlier, separate
 * transaction (see ingestStudentResponses) — a later phase's own
 * ROLLBACK can't reach back and mark it, since that row lives in a
 * transaction that already committed on a different connection.
 */
async function markUploadFailed(uploadId, err) {
  if (!uploadId) return;
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE scert_db.result_uploads
            SET status = 'FAILED', error_message = $2, completed_at = CURRENT_TIMESTAMP
          WHERE upload_id = $1 AND status = 'PROCESSING'`,
        [uploadId, String(err?.message || err).slice(0, 1000)]
      );
    } finally {
      client.release();
    }
  } catch (_) {
    // Best-effort — if this also can't reach the DB, the upload just stays
    // PROCESSING, which is already visible as stuck in the upload history.
  }
}

/** Duplicate-upload guard: same bytes, same scope, already loaded. */
async function findDuplicateUpload(client, { sessionId, scholarshipId, classValue, uploadType, fileHash }) {
  if (!fileHash) return null;
  const res = await client.query(
    `SELECT upload_id, file_name, created_at
       FROM scert_db.result_uploads
      WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3
        AND upload_type = $4 AND file_hash = $5 AND status <> 'FAILED'
      ORDER BY upload_id DESC LIMIT 1`,
    [sessionId, scholarshipId, classValue, uploadType, fileHash]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------
// Shared sheet helpers
// ---------------------------------------------------------------------

function readHeaderCells(worksheet, rowNumber) {
  const row = worksheet.getRow(rowNumber);
  const cells = [];
  for (let c = 1; c <= worksheet.columnCount; c++) {
    cells.push(P.cellValue(row.getCell(c)));
  }
  return cells;
}

/** First non-empty value among every column that matched this field. */
function pick(row, index, field) {
  const cols = index.get(field);
  if (!cols) return null;
  for (const col of cols) {
    const value = P.cellValue(row.getCell(col));
    if (value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

// =====================================================================
// 1 + 2. Student sheets (ALL_STUDENTS / SELECTED_STUDENTS)
// =====================================================================

const STUDENT_COLUMNS = [
  "upload_id", "session_id", "scholarship_id", "class", "roll_number",
  "student_name", "father_name", "mother_name", "dob", "gender", "category",
  "district_name", "block_code", "school_name", "center_name",
  "mat_marks", "sat_marks", "total_marks",
  "is_selected", "is_absent", "is_matched", "application_id", "student_user_id",
  "app_display_id", "sr_number", "dob_raw", "dob_invalid",
  "gender_code", "category_code", "is_divyang", "aadhaar_number",
  "mobile_number", "village", "post_office", "block_name",
  "school_type_code", "school_category_code", "prev_school_name",
  "prev_school_type", "center_code", "paper_set",
  "scst_mat_marks", "scst_sat_marks",
  "mat_attendance", "sat_attendance", "overall_attendance",
  "source_upload_id", "selected_upload_id", "raw_row",
];

// Columns that a sparser sheet must not blank out on re-upload.
const STUDENT_MERGE_COLUMNS = STUDENT_COLUMNS.filter(
  (col) => ![
    "upload_id", "session_id", "scholarship_id", "class", "roll_number",
    "is_selected", "selected_upload_id",
  ].includes(col)
);

function parseStudentRow(row, index, rowNumber) {
  const rollNumber = P.normalizeText(pick(row, index, "roll_number"), 20);
  if (!rollNumber) return null;

  const dobRaw = pick(row, index, "dob");
  const dob = P.normalizeDate(dobRaw);
  const category = P.resolveCategory(pick(row, index, "category"));
  const gender = P.resolveGender(pick(row, index, "gender"));

  const matAttendance = P.normalizeAttendance(pick(row, index, "mat_attendance"));
  const satAttendance = P.normalizeAttendance(pick(row, index, "sat_attendance"));
  const overallAttendance = P.normalizeAttendance(pick(row, index, "overall_attendance"));

  // Absence comes from the P/A columns. When ABS is missing, a candidate
  // counts as absent only if both papers were missed.
  const isAbsent = overallAttendance
    ? overallAttendance === "A"
    : (matAttendance === "A" && satAttendance === "A");

  const raw = {};
  for (const [field, cols] of index.entries()) {
    const value = P.cellValue(row.getCell(cols[0]));
    if (value !== null && String(value).trim() !== "") {
      raw[field] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    }
  }

  return {
    rowNumber,
    roll_number: rollNumber,
    student_name: P.normalizeText(pick(row, index, "student_name"), 200),
    father_name: P.normalizeText(pick(row, index, "father_name"), 200),
    mother_name: P.normalizeText(pick(row, index, "mother_name"), 200),
    dob: dob.date,
    dob_raw: dob.raw ? String(dob.raw).slice(0, 30) : null,
    dob_invalid: P.normalizeFlag(pick(row, index, "dob_invalid")) || (!dob.date && !!dob.raw),
    gender: gender.label,
    gender_code: gender.code,
    category: category.label,
    category_code: category.code,
    is_divyang: P.normalizeFlag(pick(row, index, "divyang")),
    aadhaar_number: P.normalizeDigits(pick(row, index, "aadhaar_number"), 20),
    mobile_number: P.normalizeDigits(pick(row, index, "mobile_number"), 15),
    village: P.normalizeText(pick(row, index, "village"), 200),
    post_office: P.normalizeText(pick(row, index, "post_office"), 200),
    app_display_id: P.normalizeText(pick(row, index, "app_display_id"), 20),
    sr_number: P.normalizeText(pick(row, index, "sr_number"), 30),

    district_name: P.normalizeText(pick(row, index, "district_name"), 150),
    block_code: P.normalizeText(pick(row, index, "block_code"), 20),
    block_name: P.normalizeText(pick(row, index, "block_name"), 150),
    school_name: P.normalizeText(pick(row, index, "school_name"), 300),
    school_type_code: P.normalizeText(pick(row, index, "school_type"), 10),
    school_category_code: P.normalizeText(pick(row, index, "school_category"), 10),
    prev_school_name: P.normalizeText(pick(row, index, "prev_school_name"), 300),
    prev_school_type: P.normalizeText(pick(row, index, "prev_school_type"), 10),

    center_code: P.normalizeText(pick(row, index, "center_code"), 20),
    center_name: P.normalizeText(pick(row, index, "center_name"), 300),
    paper_set: P.normalizeText(pick(row, index, "paper_set"), 20),

    mat_marks: P.normalizeNumber(pick(row, index, "mat_marks")),
    sat_marks: P.normalizeNumber(pick(row, index, "sat_marks")),
    scst_mat_marks: P.normalizeNumber(pick(row, index, "scst_mat_marks")),
    scst_sat_marks: P.normalizeNumber(pick(row, index, "scst_sat_marks")),
    total_marks: P.normalizeNumber(pick(row, index, "total_marks")),

    mat_attendance: matAttendance,
    sat_attendance: satAttendance,
    overall_attendance: overallAttendance,
    is_absent: isAbsent,
    is_selected: P.normalizeFlag(pick(row, index, "selected")),
    raw_row: raw,
  };
}

async function insertStudentRows(client, rows, scope, uploadId, mode) {
  let inserted = 0;

  const updateClause = mode === "merge"
    ? STUDENT_MERGE_COLUMNS
        .map((col) => `${col} = COALESCE(EXCLUDED.${col}, scert_db.result_students.${col})`)
        .concat([
          "is_selected = TRUE",
          // uploadId is a database-generated identifier; cast to a number so
          // it can never carry anything but digits into the statement.
          `selected_upload_id = ${Number(uploadId)}`,
          "updated_at = CURRENT_TIMESTAMP",
        ])
        .join(", ")
    : STUDENT_COLUMNS
        .filter((col) => !["session_id", "scholarship_id", "class", "roll_number"].includes(col))
        .map((col) => `${col} = EXCLUDED.${col}`)
        .concat(["updated_at = CURRENT_TIMESTAMP"])
        .join(", ");

  for (let i = 0; i < rows.length; i += STUDENT_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + STUDENT_INSERT_CHUNK);
    const values = [];
    const placeholders = chunk.map((row, idx) => {
      const base = idx * STUDENT_COLUMNS.length;
      values.push(
        uploadId, scope.sessionId, scope.scholarshipId, scope.classValue, row.roll_number,
        row.student_name, row.father_name, row.mother_name, row.dob, row.gender, row.category,
        row.district_name, row.block_code, row.school_name, row.center_name,
        row.mat_marks, row.sat_marks, row.total_marks,
        row.is_selected, row.is_absent, row.is_matched, row.application_id, row.student_user_id,
        row.app_display_id, row.sr_number, row.dob_raw, row.dob_invalid,
        row.gender_code, row.category_code, row.is_divyang, row.aadhaar_number,
        row.mobile_number, row.village, row.post_office, row.block_name,
        row.school_type_code, row.school_category_code, row.prev_school_name,
        row.prev_school_type, row.center_code, row.paper_set,
        row.scst_mat_marks, row.scst_sat_marks,
        row.mat_attendance, row.sat_attendance, row.overall_attendance,
        mode === "merge" ? null : uploadId,
        mode === "merge" ? uploadId : null,
        JSON.stringify(row.raw_row || {})
      );
      const marks = STUDENT_COLUMNS.map((_, c) => `$${base + c + 1}`).join(", ");
      return `(${marks})`;
    });

    const res = await client.query(
      `INSERT INTO scert_db.result_students (${STUDENT_COLUMNS.map((c) => `"${c}"`).join(", ")})
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (session_id, scholarship_id, "class", roll_number)
       DO UPDATE SET ${updateClause}`,
      values
    );
    inserted += res.rowCount || chunk.length;
  }

  return inserted;
}

/**
 * @param {'ALL_STUDENTS'|'SELECTED_STUDENTS'} uploadType
 *   ALL_STUDENTS replaces the scope outright — it is the master list.
 *   SELECTED_STUDENTS never deletes; it clears the selection flag across
 *   the scope, then re-flags and enriches the listed candidates.
 */
async function ingestStudentSheet({
  sessionId, scholarshipId, classValue, uploadType,
  fileName, buffer, uploadedBy,
}) {
  const scope = { sessionId, scholarshipId, classValue };
  const fileHash = sha256(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find((ws) => ws.rowCount > 1);
  if (!worksheet) {
    const err = new Error("The workbook has no sheet with data rows.");
    err.statusCode = 400;
    throw err;
  }

  const headerCells = readHeaderCells(worksheet, 1);
  const index = P.buildHeaderIndex(headerCells, P.STUDENT_FIELD_ALIASES);

  if (!index.has("roll_number")) {
    const err = new Error(
      "Could not find a roll number column. Expected one of: ROLLNO, ROLL NUMBER, ROLL."
    );
    err.statusCode = 400;
    throw err;
  }

  const parsed = [];
  const errors = [];
  const seenRolls = new Set();

  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    if (!row || !row.hasValues) continue;

    const studentRow = parseStudentRow(row, index, r);
    if (!studentRow) {
      const hasAnything = headerCells.some((_, c) => {
        const value = P.cellValue(row.getCell(c + 1));
        return value !== null && String(value).trim() !== "";
      });
      if (hasAnything) {
        errors.push({
          sheetName: worksheet.name, rowNumber: r,
          errorType: "MISSING_ROLL", detail: "Row has data but no roll number",
        });
      }
      continue;
    }

    if (seenRolls.has(studentRow.roll_number)) {
      errors.push({
        sheetName: worksheet.name, rowNumber: r, rollNumber: studentRow.roll_number,
        errorType: "DUPLICATE_ROLL",
        detail: "Roll number appears more than once in this file; first occurrence kept",
      });
      continue;
    }
    seenRolls.add(studentRow.roll_number);
    parsed.push(studentRow);
  }

  if (!parsed.length) {
    const err = new Error("No rows with a roll number were found in the sheet.");
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();
  let uploadId = null;
  try {
    await client.query("BEGIN");
    await setUploadTimeouts(client);

    const duplicate = await findDuplicateUpload(client, {
      ...scope, uploadType, fileHash,
    });

    uploadId = await createUpload(client, {
      ...scope, uploadType, fileName, fileHash,
      sheetNames: [worksheet.name], uploadedBy,
    });

    const applicationMap = await loadApplicationMap(client, scope);

    let matched = 0;
    for (const row of parsed) {
      const application = applicationMap.get(row.roll_number) || null;
      row.is_matched = Boolean(application);
      row.application_id = application ? application.application_id : null;
      row.student_user_id = application ? application.student_user_id : null;

      if (application) {
        matched++;
      } else {
        errors.push({
          sheetName: worksheet.name, rowNumber: row.rowNumber, rollNumber: row.roll_number,
          errorType: "UNMATCHED_ROLL",
          detail: "No approved application found with this roll number in this session, scholarship and class",
        });
      }
    }

    if (uploadType === "ALL_STUDENTS") {
      await client.query(
        `DELETE FROM scert_db.result_students
          WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
        [sessionId, scholarshipId, classValue]
      );
    } else {
      await client.query(
        `UPDATE scert_db.result_students
            SET is_selected = FALSE, selected_upload_id = NULL
          WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3
            AND is_selected = TRUE`,
        [sessionId, scholarshipId, classValue]
      );
    }

    const written = await insertStudentRows(
      client, parsed, scope, uploadId,
      uploadType === "ALL_STUDENTS" ? "replace" : "merge"
    );

    await recordErrors(client, uploadId, scope, errors);

    const unmatched = parsed.length - matched;
    const status = await finalizeUpload(client, uploadId, {
      total: parsed.length, matched, unmatched,
      inserted: written, errors: errors.length,
    });

    await client.query("COMMIT");

    const selectedCount = parsed.filter((row) => row.is_selected).length;
    const absentCount = parsed.filter((row) => row.is_absent).length;

    return {
      upload_id: uploadId,
      upload_type: uploadType,
      status,
      sheet_name: worksheet.name,
      columns_detected: [...index.keys()],
      total_rows: parsed.length,
      matched_students: matched,
      unmatched_students: unmatched,
      selected_students: selectedCount,
      absent_students: absentCount,
      present_students: parsed.length - absentCount,
      error_count: errors.length,
      duplicate_of_upload_id: duplicate ? duplicate.upload_id : null,
      warning: duplicate
        ? `This exact file was already uploaded on ${new Date(duplicate.created_at).toISOString().slice(0, 10)}. The scope has been reloaded from it.`
        : null,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// =====================================================================
// 3. Answer key
// =====================================================================

async function ingestAnswerKey({
  sessionId, scholarshipId, classValue, fileName, buffer, uploadedBy,
}) {
  const scope = { sessionId, scholarshipId, classValue };
  const fileHash = sha256(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find((ws) => ws.rowCount > 1);
  if (!worksheet) {
    const err = new Error("The workbook has no sheet with data rows.");
    err.statusCode = 400;
    throw err;
  }

  const headerCells = readHeaderCells(worksheet, 1);
  const paperCol = headerCells.findIndex((h) => P.normalizeHeader(h) === "PAPER") + 1;
  if (!paperCol) {
    const err = new Error("Could not find the PAPER column in the answer key.");
    err.statusCode = 400;
    throw err;
  }

  const questionColumns = P.findQuestionColumns(headerCells);
  if (!questionColumns.length) {
    const err = new Error("No question columns found. Expected columns named Q001, Q002, …");
    err.statusCode = 400;
    throw err;
  }

  const papers = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    if (!row || !row.hasValues) continue;

    const rawCode = P.normalizeText(P.cellValue(row.getCell(paperCol)));
    if (!rawCode) continue;

    const parsedCode = P.parsePaperCode(rawCode, classValue);
    if (!parsedCode) continue;

    const answers = [];
    for (const { questionNumber, col } of questionColumns) {
      const answer = P.normalizeAnswer(P.cellValue(row.getCell(col)));
      if (answer && answer !== "*") answers.push({ questionNumber, answer });
    }
    if (answers.length) papers.push({ ...parsedCode, answers });
  }

  if (!papers.length) {
    const err = new Error("No answer key rows found.");
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();
  let uploadId = null;
  try {
    await client.query("BEGIN");
    await setUploadTimeouts(client);

    uploadId = await createUpload(client, {
      ...scope, uploadType: "ANSWER_KEY", fileName, fileHash,
      sheetNames: [worksheet.name], uploadedBy,
    });

    // Full replace for the scope: a re-uploaded key with fewer papers must
    // not leave a stale paper behind to be scored against.
    await client.query(
      `DELETE FROM scert_db.result_answer_keys
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
      [sessionId, scholarshipId, classValue]
    );

    let totalAnswers = 0;
    for (const paper of papers) {
      const values = [];
      const placeholders = paper.answers.map((entry, idx) => {
        const b = idx * 9;
        values.push(
          uploadId, sessionId, scholarshipId, classValue,
          paper.paperCode, paper.examType, paper.bookletCode,
          entry.questionNumber, entry.answer
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
      });

      await client.query(
        `INSERT INTO scert_db.result_answer_keys
           (upload_id, session_id, scholarship_id, "class",
            paper_code, exam_type, booklet_code, question_number, correct_answer)
         VALUES ${placeholders.join(", ")}`,
        values
      );
      totalAnswers += paper.answers.length;
    }

    const status = await finalizeUpload(client, uploadId, {
      total: totalAnswers, inserted: totalAnswers,
    });

    await client.query("COMMIT");

    return {
      upload_id: uploadId,
      upload_type: "ANSWER_KEY",
      status,
      papers: papers.map((p) => ({
        paper_code: p.paperCode,
        exam_type: p.examType,
        booklet_code: p.bookletCode,
        questions: p.answers.length,
      })),
      total_answers: totalAnswers,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// =====================================================================
// 4. Student responses (streamed + COPY)
// =====================================================================

/** Postgres COPY TEXT format escaping. */
function copyEscape(value) {
  if (value === null || value === undefined) return "\\N";
  if (value === true) return "t";
  if (value === false) return "f";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function writeWithBackpressure(stream, line) {
  if (stream.write(line)) return null;
  return new Promise((resolve) => stream.once("drain", resolve));
}

const RESPONSE_COPY_COLUMNS = [
  "upload_id", "session_id", "scholarship_id", "class", "roll_number",
  "application_id", "student_user_id", "sheet_name", "paper_code", "exam_type",
  "booklet_code", "booklet_number", "question_number", "marked_answer",
  "is_correct", "total_correct", "total_wrong", "total_blank",
  "raw_total_marks", "score_validated",
];

async function ingestStudentResponses({
  sessionId, scholarshipId, classValue, fileName, buffer, uploadedBy,
}) {
  const scope = { sessionId, scholarshipId, classValue };
  const fileHash = sha256(buffer);
  let uploadId = null;

  try {
    // ---- Phase 1: setup — its own short-lived connection ----------------
    // Split into three phases (setup / one connection per sheet / rollup)
    // rather than holding a single connection for the whole multi-minute
    // ingest, because production's network path to the database has been
    // observed killing long-lived connections after roughly 1-2 minutes of
    // continuous, active use — a hard connection-duration limit somewhere
    // between here and the DB server (not a Postgres-side timeout, which
    // was already ruled out: raising statement_timeout to 15min didn't
    // stop the crash). No single connection below needs to survive longer
    // than one sheet's COPY.
    let keysByPaper;
    let applicationMap;
    {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setUploadTimeouts(client);

        uploadId = await createUpload(client, {
          ...scope, uploadType: "STUDENT_RESPONSES", fileName, fileHash,
          sheetNames: null, uploadedBy,
        });

        // Answer keys for the scope, grouped by paper code.
        const keyRes = await client.query(
          `SELECT paper_code, question_number, correct_answer
             FROM scert_db.result_answer_keys
            WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
          [sessionId, scholarshipId, classValue]
        );

        if (!keyRes.rows.length) {
          const err = new Error(
            "No answer key has been uploaded for this session, scholarship and class. Upload the answer key before the student responses."
          );
          err.statusCode = 400;
          throw err;
        }

        keysByPaper = new Map();
        for (const row of keyRes.rows) {
          if (!keysByPaper.has(row.paper_code)) keysByPaper.set(row.paper_code, new Map());
          keysByPaper.get(row.paper_code).set(row.question_number, String(row.correct_answer).trim().toUpperCase());
        }

        applicationMap = await loadApplicationMap(client, scope);

        // Clear any prior responses for this scope before COPY, since COPY
        // cannot upsert and the table has a uniqueness constraint.
        await client.query(
          `DELETE FROM scert_db.result_student_responses
            WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
          [sessionId, scholarshipId, classValue]
        );

        await client.query("COMMIT");
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
        throw err;
      } finally {
        client.release();
      }
    }

    // A file scored against the wrong key can flag every single student, so
    // the collected detail is capped while the counts stay exact.
    const MAX_TRACKED_ERRORS = 20000;
    const errors = [];
    let suppressedErrors = 0;
    const addError = (entry) => {
      if (errors.length < MAX_TRACKED_ERRORS) errors.push(entry);
      else suppressedErrors++;
    };

    const sheetSummaries = [];
    // rollNumber -> rollup. Plain in-memory accumulator, built across
    // sheets regardless of which DB connection streamed which sheet.
    const scores = new Map();
    const processedSheets = [];
    let totalRows = 0;
    let totalResponses = 0;
    let validationFailures = 0;
    let unmatchedStudents = 0;

    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
      worksheets: "emit",
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "ignore",
      entries: "emit",
    });

    // ---- Phase 2: one fresh connection per sheet -------------------------
    for await (const worksheet of reader) {
      const sheetName = worksheet.name || "";
      const paper = P.derivePaperCode(sheetName, classValue);

      if (!paper) {
        // Index or notes sheets are expected; only flag them.
        addError({
          sheetName, errorType: "UNKNOWN_SHEET",
          detail: `Sheet "${sheetName}" is not a MAT/SAT paper sheet and was skipped`,
        });
        // Drain the sheet so the reader can advance.
        for await (const _ of worksheet) { /* skip */ }
        continue;
      }

      const answerKey = keysByPaper.get(paper.paperCode);
      if (!answerKey) {
        addError({
          sheetName, paperCode: paper.paperCode, errorType: "MISSING_ANSWER_KEY",
          detail: `No answer key found for paper ${paper.paperCode}. Available: ${[...keysByPaper.keys()].join(", ")}`,
        });
        for await (const _ of worksheet) { /* skip */ }
        continue;
      }

      let index = null;
      let questionColumns = [];
      let sheetRows = 0;
      let sheetResponses = 0;
      const seen = new Set();

      const sheetClient = await pool.connect();
      try {
        await sheetClient.query("BEGIN");
        await setUploadTimeouts(sheetClient);

        const copyStream = sheetClient.query(copyFrom(
          `COPY scert_db.result_student_responses (${RESPONSE_COPY_COLUMNS.join(", ")}) FROM STDIN`
        ));
        const copyDone = new Promise((resolve, reject) => {
          copyStream.on("finish", resolve);
          copyStream.on("error", reject);
        });

        let buffered = [];
        const flush = async () => {
          if (!buffered.length) return;
          const pending = writeWithBackpressure(copyStream, buffered.join(""));
          buffered = [];
          if (pending) await pending;
        };

        for await (const row of worksheet) {
          // First row carries the headers.
          if (!index) {
            const cells = [];
            const columnCount = Math.max(row.cellCount || 0, row.actualCellCount || 0);
            for (let c = 1; c <= columnCount; c++) cells.push(P.cellValue(row.getCell(c)));
            index = P.buildHeaderIndex(cells, P.RESPONSE_FIELD_ALIASES);
            questionColumns = P.findQuestionColumns(cells);

            if (!index.has("roll_number") || !questionColumns.length) {
              addError({
                sheetName, errorType: "BAD_VALUE",
                detail: `Sheet "${sheetName}" has no ROLLNO column or no Q columns; skipped`,
              });
              break;
            }
            continue;
          }

          const rollNumber = P.normalizeText(pick(row, index, "roll_number"), 20);
          if (!rollNumber) continue;

          sheetRows++;

          if (seen.has(rollNumber)) {
            addError({
              sheetName, rowNumber: row.number, rollNumber, paperCode: paper.paperCode,
              errorType: "DUPLICATE_ROLL",
              detail: "Roll number appears twice on this paper sheet; first occurrence kept",
            });
            continue;
          }
          seen.add(rollNumber);

          const application = applicationMap.get(rollNumber) || null;
          if (!application) {
            unmatchedStudents++;
            addError({
              sheetName, rowNumber: row.number, rollNumber, paperCode: paper.paperCode,
              errorType: "UNMATCHED_ROLL",
              detail: "No application found with this roll number in this session, scholarship and class",
            });
          }

          const bookletNumber = P.normalizeText(pick(row, index, "booklet_number"), 30);
          const totalRight = P.normalizeInteger(pick(row, index, "total_right"));
          const totalWrong = P.normalizeInteger(pick(row, index, "total_wrong"));
          const totalBlank = P.normalizeInteger(pick(row, index, "total_blank"));
          const rawTotalMarks = P.normalizeNumber(pick(row, index, "total_marks"));

          let computedCorrect = 0;
          const answers = [];

          for (const { questionNumber, col } of questionColumns) {
            const marked = P.normalizeAnswer(P.cellValue(row.getCell(col)));
            const correct = answerKey.get(questionNumber);
            // '*' is a multiply-shaded bubble and can never be correct.
            const isCorrect = Boolean(
              marked && marked !== "*" && correct && marked === correct
            );
            if (isCorrect) computedCorrect++;
            answers.push({ questionNumber, marked, isCorrect });
          }

          const scoreValidated = totalRight === null || computedCorrect === totalRight;
          if (!scoreValidated) {
            validationFailures++;
            addError({
              sheetName, rowNumber: row.number, rollNumber, paperCode: paper.paperCode,
              errorType: "SCORE_MISMATCH",
              detail: `Recomputed correct answers = ${computedCorrect}, sheet reports TOTRIGHT = ${totalRight}`,
            });
          }

          for (const entry of answers) {
            buffered.push(
              [
                uploadId, sessionId, scholarshipId, classValue, rollNumber,
                application ? application.application_id : null,
                application ? application.student_user_id : null,
                sheetName, paper.paperCode, paper.examType, paper.bookletCode,
                bookletNumber, entry.questionNumber, entry.marked, entry.isCorrect,
                totalRight, totalWrong, totalBlank, rawTotalMarks, scoreValidated,
              ].map(copyEscape).join("\t") + "\n"
            );
            sheetResponses++;
          }

          if (buffered.length >= COPY_FLUSH_ROWS) await flush();

          if (!scores.has(rollNumber)) {
            scores.set(rollNumber, {
              rollNumber,
              applicationId: application ? application.application_id : null,
              studentUserId: application ? application.student_user_id : null,
              matPaperCode: null, matScore: null, matCorrect: null, matWrong: null, matBlank: null,
              satPaperCode: null, satScore: null, satCorrect: null, satWrong: null, satBlank: null,
            });
          }
          const score = scores.get(rollNumber);
          if (paper.examType === "MAT") {
            score.matPaperCode = paper.paperCode;
            score.matScore = rawTotalMarks;
            score.matCorrect = totalRight;
            score.matWrong = totalWrong;
            score.matBlank = totalBlank;
          } else {
            score.satPaperCode = paper.paperCode;
            score.satScore = rawTotalMarks;
            score.satCorrect = totalRight;
            score.satWrong = totalWrong;
            score.satBlank = totalBlank;
          }
        }

        await flush();
        copyStream.end();
        await copyDone;

        await sheetClient.query("COMMIT");
      } catch (err) {
        try { await sheetClient.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
        throw err;
      } finally {
        sheetClient.release();
      }

      totalRows += sheetRows;
      totalResponses += sheetResponses;
      processedSheets.push(sheetName);
      sheetSummaries.push({
        sheet_name: sheetName,
        paper_code: paper.paperCode,
        exam_type: paper.examType,
        booklet_code: paper.bookletCode,
        students: sheetRows,
        responses: sheetResponses,
      });
    }

    if (!sheetSummaries.length) {
      const err = new Error(
        "No MAT/SAT paper sheets could be read from this workbook. Sheets must be named MAT, MATB or SAT."
      );
      err.statusCode = 400;
      throw err;
    }

    // ---- Phase 3: per-student rollup + finalize — its own short transaction ----
    const scoreRows = [...scores.values()];
    const totalErrors = errors.length + suppressedErrors;
    let status;
    {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setUploadTimeouts(client);

        // Per-student rollup
        await client.query(
          `DELETE FROM scert_db.result_exam_scores
            WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
          [sessionId, scholarshipId, classValue]
        );

        for (let i = 0; i < scoreRows.length; i += STUDENT_INSERT_CHUNK) {
          const chunk = scoreRows.slice(i, i + STUDENT_INSERT_CHUNK);
          const values = [];
          const placeholders = chunk.map((score, idx) => {
            const b = idx * 16;
            values.push(
              sessionId, scholarshipId, classValue, score.rollNumber,
              score.applicationId, score.studentUserId,
              score.matPaperCode, score.matScore, score.matCorrect, score.matWrong, score.matBlank,
              score.satPaperCode, score.satScore, score.satCorrect, score.satWrong, score.satBlank
            );
            return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16})`;
          });

          await client.query(
            `INSERT INTO scert_db.result_exam_scores
               (session_id, scholarship_id, "class", roll_number, application_id, student_user_id,
                mat_paper_code, mat_score, mat_correct, mat_wrong, mat_blank,
                sat_paper_code, sat_score, sat_correct, sat_wrong, sat_blank)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (session_id, scholarship_id, "class", roll_number)
             DO UPDATE SET
               mat_paper_code = COALESCE(EXCLUDED.mat_paper_code, scert_db.result_exam_scores.mat_paper_code),
               mat_score      = COALESCE(EXCLUDED.mat_score,      scert_db.result_exam_scores.mat_score),
               mat_correct    = COALESCE(EXCLUDED.mat_correct,    scert_db.result_exam_scores.mat_correct),
               mat_wrong      = COALESCE(EXCLUDED.mat_wrong,      scert_db.result_exam_scores.mat_wrong),
               mat_blank      = COALESCE(EXCLUDED.mat_blank,      scert_db.result_exam_scores.mat_blank),
               sat_paper_code = COALESCE(EXCLUDED.sat_paper_code, scert_db.result_exam_scores.sat_paper_code),
               sat_score      = COALESCE(EXCLUDED.sat_score,      scert_db.result_exam_scores.sat_score),
               sat_correct    = COALESCE(EXCLUDED.sat_correct,    scert_db.result_exam_scores.sat_correct),
               sat_wrong      = COALESCE(EXCLUDED.sat_wrong,      scert_db.result_exam_scores.sat_wrong),
               sat_blank      = COALESCE(EXCLUDED.sat_blank,      scert_db.result_exam_scores.sat_blank),
               updated_at     = CURRENT_TIMESTAMP`,
            values
          );
        }

        await recordErrors(client, uploadId, scope, errors);

        await client.query(
          `UPDATE scert_db.result_uploads SET sheet_names = $2 WHERE upload_id = $1`,
          [uploadId, processedSheets]
        );

        status = await finalizeUpload(client, uploadId, {
          total: totalRows,
          matched: totalRows - unmatchedStudents,
          unmatched: unmatchedStudents,
          inserted: totalResponses,
          errors: totalErrors,
          validationFailures,
        });

        await client.query("COMMIT");
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
        throw err;
      } finally {
        client.release();
      }
    }

    return {
      upload_id: uploadId,
      upload_type: "STUDENT_RESPONSES",
      status,
      sheets: sheetSummaries,
      total_students: totalRows,
      total_responses: totalResponses,
      students_scored: scoreRows.length,
      unmatched_students: unmatchedStudents,
      validation_failures: validationFailures,
      error_count: totalErrors,
      errors_truncated: suppressedErrors > 0,
    };
  } catch (err) {
    await markUploadFailed(uploadId, err);
    throw err;
  }
}


// =====================================================================
// 5. Block summary
// =====================================================================

/** The summary sheet has a banner row above the real headers. */
function findSummaryHeaderRow(worksheet) {
  const limit = Math.min(worksheet.rowCount, 10);
  for (let r = 1; r <= limit; r++) {
    const cells = readHeaderCells(worksheet, r).map(P.normalizeHeader);
    const hasDistrict = cells.some((c) => ["DISTRICT", "DISTRICTNAME", "DISTT"].includes(c));
    const hasBlock = cells.some((c) => ["BLOCK", "BLOCKNAME"].includes(c));
    if (hasDistrict && hasBlock) return r;
  }
  return null;
}

async function ingestBlockSummary({
  sessionId, scholarshipId, classValue, fileName, buffer, uploadedBy,
}) {
  const scope = { sessionId, scholarshipId, classValue };
  const fileHash = sha256(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets.find((ws) => ws.rowCount > 1);
  if (!worksheet) {
    const err = new Error("The workbook has no sheet with data rows.");
    err.statusCode = 400;
    throw err;
  }

  const headerRowNumber = findSummaryHeaderRow(worksheet);
  if (!headerRowNumber) {
    const err = new Error(
      "Could not find the header row. The summary sheet needs DISTRICT and BLOCK columns."
    );
    err.statusCode = 400;
    throw err;
  }

  const headerCells = readHeaderCells(worksheet, headerRowNumber);
  const index = P.buildHeaderIndex(headerCells, P.SUMMARY_FIELD_ALIASES);

  const rows = [];
  const errors = [];

  for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    if (!row || !row.hasValues) continue;

    const districtName = P.normalizeText(pick(row, index, "district_name"), 150);
    const blockName = P.normalizeText(pick(row, index, "block_name"), 150);
    if (!districtName || !blockName) continue;

    // Skip any trailing TOTAL / GRAND TOTAL line.
    if (/^(GRAND\s+)?TOTAL$/i.test(districtName) || /^(GRAND\s+)?TOTAL$/i.test(blockName)) {
      continue;
    }

    const raw = {};
    for (const [field, cols] of index.entries()) {
      const value = P.cellValue(row.getCell(cols[0]));
      if (value !== null && String(value).trim() !== "") raw[field] = value;
    }

    rows.push({
      district_name: districtName,
      block_name: blockName,
      registered: P.normalizeInteger(pick(row, index, "registered")) || 0,
      absent: P.normalizeInteger(pick(row, index, "absent")) || 0,
      present: P.normalizeInteger(pick(row, index, "present")) || 0,
      selected: P.normalizeInteger(pick(row, index, "selected")) || 0,
      selected_gen: P.normalizeInteger(pick(row, index, "selected_gen")) || 0,
      selected_obc: P.normalizeInteger(pick(row, index, "selected_obc")) || 0,
      selected_sc: P.normalizeInteger(pick(row, index, "selected_sc")) || 0,
      selected_st: P.normalizeInteger(pick(row, index, "selected_st")) || 0,
      selected_ews: P.normalizeInteger(pick(row, index, "selected_ews")) || 0,
      raw_row: raw,
      rowNumber: r,
    });
  }

  if (!rows.length) {
    const err = new Error("No district/block rows were found in the summary sheet.");
    err.statusCode = 400;
    throw err;
  }

  // Internal consistency: registered should equal present + absent, and the
  // category split should equal the selected total.
  for (const row of rows) {
    if (row.registered && row.present + row.absent !== row.registered) {
      errors.push({
        rowNumber: row.rowNumber, errorType: "BAD_VALUE",
        detail: `${row.district_name}/${row.block_name}: present (${row.present}) + absent (${row.absent}) does not equal registered (${row.registered})`,
      });
    }
    const categorySum = row.selected_gen + row.selected_obc + row.selected_sc
      + row.selected_st + row.selected_ews;
    if (row.selected && categorySum !== row.selected) {
      errors.push({
        rowNumber: row.rowNumber, errorType: "BAD_VALUE",
        detail: `${row.district_name}/${row.block_name}: category split (${categorySum}) does not equal selected (${row.selected})`,
      });
    }
  }

  const client = await pool.connect();
  let uploadId = null;
  try {
    await client.query("BEGIN");
    await setUploadTimeouts(client);

    uploadId = await createUpload(client, {
      ...scope, uploadType: "BLOCK_SUMMARY", fileName, fileHash,
      sheetNames: [worksheet.name], uploadedBy,
    });

    await client.query(
      `DELETE FROM scert_db.result_block_summary
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
      [sessionId, scholarshipId, classValue]
    );

    for (let i = 0; i < rows.length; i += STUDENT_INSERT_CHUNK) {
      const chunk = rows.slice(i, i + STUDENT_INSERT_CHUNK);
      const values = [];
      const placeholders = chunk.map((row, idx) => {
        const b = idx * 15;
        values.push(
          uploadId, sessionId, scholarshipId, classValue,
          row.district_name, row.block_name,
          row.registered, row.absent, row.present, row.selected,
          row.selected_gen, row.selected_obc, row.selected_sc,
          row.selected_st, row.selected_ews
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15})`;
      });

      await client.query(
        `INSERT INTO scert_db.result_block_summary
           (upload_id, session_id, scholarship_id, "class",
            district_name, block_name, registered, absent, present, selected,
            selected_gen, selected_obc, selected_sc, selected_st, selected_ews)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (session_id, scholarship_id, "class", district_name, block_name)
         DO UPDATE SET
           registered = EXCLUDED.registered, absent = EXCLUDED.absent,
           present = EXCLUDED.present, selected = EXCLUDED.selected,
           selected_gen = EXCLUDED.selected_gen, selected_obc = EXCLUDED.selected_obc,
           selected_sc = EXCLUDED.selected_sc, selected_st = EXCLUDED.selected_st,
           selected_ews = EXCLUDED.selected_ews, upload_id = EXCLUDED.upload_id,
           updated_at = CURRENT_TIMESTAMP`,
        values
      );
    }

    await recordErrors(client, uploadId, scope, errors);

    const status = await finalizeUpload(client, uploadId, {
      total: rows.length, inserted: rows.length, errors: errors.length,
    });

    await client.query("COMMIT");

    const totals = rows.reduce((acc, row) => ({
      registered: acc.registered + row.registered,
      absent: acc.absent + row.absent,
      present: acc.present + row.present,
      selected: acc.selected + row.selected,
    }), { registered: 0, absent: 0, present: 0, selected: 0 });

    return {
      upload_id: uploadId,
      upload_type: "BLOCK_SUMMARY",
      status,
      blocks: rows.length,
      districts: new Set(rows.map((row) => row.district_name)).size,
      totals,
      error_count: errors.length,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// =====================================================================
// Read side — verification dashboard (answer keys / responses / scores / errors)
// =====================================================================

function paginationParams(page, limit, maxLimit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), maxLimit);
  const safePage = Math.max(Number(page) || 1, 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit, page: safePage };
}

async function listAnswerKeys({
  sessionId, scholarshipId, classValue, paperCode = null, page = 1, limit = 50,
}) {
  const { limit: safeLimit, offset, page: safePage } = paginationParams(page, limit);

  const conditions = ["session_id = $1", "scholarship_id = $2", `"class" = $3`];
  const params = [sessionId, scholarshipId, classValue];
  if (paperCode) {
    params.push(paperCode);
    conditions.push(`paper_code = $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const [rowsRes, countRes, papersRes] = await Promise.all([
    pool.query(
      `SELECT paper_code, exam_type, booklet_code, question_number, correct_answer
         FROM scert_db.result_answer_keys
        WHERE ${where}
        ORDER BY paper_code ASC, question_number ASC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_answer_keys WHERE ${where}`,
      params
    ),
    pool.query(
      `SELECT DISTINCT paper_code FROM scert_db.result_answer_keys
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3
        ORDER BY paper_code ASC`,
      [sessionId, scholarshipId, classValue]
    ),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0].total,
    page: safePage,
    limit: safeLimit,
    papers: papersRes.rows.map((row) => row.paper_code),
  };
}

async function listStudentResponses({
  sessionId, scholarshipId, classValue,
  paperCode = null, rollNumber = null, onlyInvalid = false,
  page = 1, limit = 50,
}) {
  const { limit: safeLimit, offset, page: safePage } = paginationParams(page, limit);

  const conditions = ["session_id = $1", "scholarship_id = $2", `"class" = $3`];
  const params = [sessionId, scholarshipId, classValue];
  if (paperCode) {
    params.push(paperCode);
    conditions.push(`paper_code = $${params.length}`);
  }
  if (rollNumber) {
    params.push(`${rollNumber}%`);
    conditions.push(`roll_number LIKE $${params.length}`);
  }
  if (onlyInvalid) {
    conditions.push("score_validated = FALSE");
  }
  const where = conditions.join(" AND ");

  const [rowsRes, countRes, papersRes] = await Promise.all([
    pool.query(
      `SELECT roll_number, paper_code, exam_type, booklet_code, question_number,
              marked_answer, is_correct, score_validated, total_correct, total_wrong, total_blank
         FROM scert_db.result_student_responses
        WHERE ${where}
        ORDER BY roll_number ASC, paper_code ASC, question_number ASC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_student_responses WHERE ${where}`,
      params
    ),
    pool.query(
      `SELECT DISTINCT paper_code FROM scert_db.result_student_responses
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3
        ORDER BY paper_code ASC`,
      [sessionId, scholarshipId, classValue]
    ),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0].total,
    page: safePage,
    limit: safeLimit,
    papers: papersRes.rows.map((row) => row.paper_code),
  };
}

/**
 * Backs both the "All Students" and "Selected Students" tabs — the two
 * source sheets write into the same result_students table (SELECTED_STUDENTS
 * merges into existing rows rather than creating a separate record), so
 * "Selected Students" is just this same query with is_selected = TRUE.
 */
async function listStudents({
  sessionId, scholarshipId, classValue,
  search = null, onlySelected = false, onlyUnmatched = false, onlyAbsent = false,
  page = 1, limit = 50,
}) {
  const { limit: safeLimit, offset, page: safePage } = paginationParams(page, limit);

  const conditions = ["session_id = $1", "scholarship_id = $2", `"class" = $3`];
  const params = [sessionId, scholarshipId, classValue];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(roll_number ILIKE $${params.length} OR student_name ILIKE $${params.length})`);
  }
  if (onlySelected) conditions.push("is_selected = TRUE");
  if (onlyUnmatched) conditions.push("is_matched = FALSE");
  if (onlyAbsent) conditions.push("overall_attendance = 'A'");
  const where = conditions.join(" AND ");

  const [rowsRes, countRes, summaryRes] = await Promise.all([
    pool.query(
      `SELECT roll_number, student_name, father_name, mother_name, dob, dob_invalid,
              gender, category, district_name, block_name, school_name, center_name,
              mat_marks, sat_marks, scst_mat_marks, scst_sat_marks, total_marks,
              is_selected, is_absent, is_matched,
              mat_attendance, sat_attendance, overall_attendance
         FROM scert_db.result_students
        WHERE ${where}
        ORDER BY roll_number ASC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_students WHERE ${where}`,
      params
    ),
    // Summary ignores the current filters so the at-a-glance counts stay
    // stable while someone searches or toggles a filter.
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_selected)::int AS selected,
              COUNT(*) FILTER (WHERE is_matched)::int AS matched,
              COUNT(*) FILTER (WHERE overall_attendance = 'A')::int AS absent
         FROM scert_db.result_students
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
      [sessionId, scholarshipId, classValue]
    ),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0].total,
    page: safePage,
    limit: safeLimit,
    summary: summaryRes.rows[0],
  };
}

async function listBlockSummary({ sessionId, scholarshipId, classValue, page = 1, limit = 200 }) {
  const { limit: safeLimit, offset, page: safePage } = paginationParams(page, limit, 500);
  const params = [sessionId, scholarshipId, classValue];

  const [rowsRes, countRes, totalsRes] = await Promise.all([
    pool.query(
      `SELECT district_name, block_name, registered, absent, present, selected,
              selected_gen, selected_obc, selected_sc, selected_st, selected_ews
         FROM scert_db.result_block_summary
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3
        ORDER BY district_name ASC, block_name ASC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_block_summary
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(registered),0)::int AS registered,
              COALESCE(SUM(absent),0)::int AS absent,
              COALESCE(SUM(present),0)::int AS present,
              COALESCE(SUM(selected),0)::int AS selected
         FROM scert_db.result_block_summary
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3`,
      params
    ),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0].total,
    page: safePage,
    limit: safeLimit,
    totals: totalsRes.rows[0],
  };
}

async function listGeneratedScores({
  sessionId, scholarshipId, classValue, rollNumber = null, page = 1, limit = 50,
}) {
  const { limit: safeLimit, offset, page: safePage } = paginationParams(page, limit);

  const conditions = ["session_id = $1", "scholarship_id = $2", `"class" = $3`];
  const params = [sessionId, scholarshipId, classValue];
  if (rollNumber) {
    params.push(`${rollNumber}%`);
    conditions.push(`roll_number LIKE $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const [rowsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT roll_number, mat_paper_code, mat_score, mat_correct, mat_wrong, mat_blank,
              sat_paper_code, sat_score, sat_correct, sat_wrong, sat_blank, total_score
         FROM scert_db.result_exam_scores
        WHERE ${where}
        ORDER BY total_score DESC NULLS LAST, roll_number ASC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_exam_scores WHERE ${where}`,
      params
    ),
  ]);

  return { rows: rowsRes.rows, total: countRes.rows[0].total, page: safePage, limit: safeLimit };
}

/**
 * Scope-wide error listing — every upload for this session/scholarship/class,
 * not just one. result_upload_errors is never cleared on re-upload, so this
 * is the full history unless an upload_id narrows it.
 */
async function listErrorsByScope({
  sessionId, scholarshipId, classValue, uploadId = null, errorType = null,
  page = 1, limit = 50,
}) {
  const { limit: safeLimit, offset, page: safePage } = paginationParams(page, limit);

  const conditions = ["session_id = $1", "scholarship_id = $2", `"class" = $3`];
  const params = [sessionId, scholarshipId, classValue];
  if (uploadId) {
    params.push(uploadId);
    conditions.push(`upload_id = $${params.length}`);
  }
  if (errorType) {
    params.push(errorType);
    conditions.push(`error_type = $${params.length}`);
  }
  const where = conditions.join(" AND ");

  const [rowsRes, countRes, byTypeRes] = await Promise.all([
    pool.query(
      `SELECT e.error_id, e.upload_id, u.upload_type, e.sheet_name, e.row_number,
              e.roll_number, e.paper_code, e.error_type, e.error_detail, e.created_at
         FROM scert_db.result_upload_errors e
         JOIN scert_db.result_uploads u ON u.upload_id = e.upload_id
        WHERE ${where}
        ORDER BY e.error_id DESC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_upload_errors WHERE ${where}`,
      params
    ),
    pool.query(
      `SELECT error_type, COUNT(*)::int AS count
         FROM scert_db.result_upload_errors
        WHERE session_id = $1 AND scholarship_id = $2 AND "class" = $3
        GROUP BY error_type ORDER BY count DESC`,
      [sessionId, scholarshipId, classValue]
    ),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0].total,
    page: safePage,
    limit: safeLimit,
    by_type: byTypeRes.rows,
  };
}

// =====================================================================
// Read side — upload registry + row-level errors
// =====================================================================

async function listUploads({
  sessionId = null, scholarshipId = null, classValue = null,
  uploadType = null, limit = 50,
}) {
  const conditions = [];
  const params = [];

  if (sessionId) { params.push(sessionId); conditions.push(`session_id = $${params.length}`); }
  if (scholarshipId) { params.push(scholarshipId); conditions.push(`scholarship_id = $${params.length}`); }
  if (classValue) { params.push(classValue); conditions.push(`"class" = $${params.length}`); }
  if (uploadType) { params.push(uploadType); conditions.push(`upload_type = $${params.length}`); }

  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const res = await pool.query(
    `SELECT upload_id, session_id, scholarship_id, "class", upload_type, status,
            file_name, sheet_names, total_records, matched_records, unmatched_records,
            inserted_records, error_records, validation_failures, error_message,
            uploaded_by, created_at, completed_at
       FROM scert_db.result_uploads
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY upload_id DESC
      LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

async function listUploadErrors({ uploadId, errorType = null, page = 1, limit = 100 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const conditions = ["upload_id = $1"];
  const params = [uploadId];

  if (errorType) {
    params.push(errorType);
    conditions.push(`error_type = $${params.length}`);
  }

  const where = conditions.join(" AND ");

  const [rowsRes, countRes, summaryRes] = await Promise.all([
    pool.query(
      `SELECT error_id, sheet_name, row_number, roll_number, paper_code,
              error_type, error_detail, created_at
         FROM scert_db.result_upload_errors
        WHERE ${where}
        ORDER BY error_id ASC
        LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM scert_db.result_upload_errors WHERE ${where}`,
      params
    ),
    pool.query(
      `SELECT error_type, COUNT(*)::int AS count
         FROM scert_db.result_upload_errors
        WHERE upload_id = $1
        GROUP BY error_type
        ORDER BY count DESC`,
      [uploadId]
    ),
  ]);

  return {
    errors: rowsRes.rows,
    total: countRes.rows[0].total,
    page: safePage,
    limit: safeLimit,
    by_type: summaryRes.rows,
  };
}

module.exports = {
  ingestStudentSheet,
  ingestAnswerKey,
  ingestStudentResponses,
  ingestBlockSummary,
  listUploads,
  listUploadErrors,
  listAnswerKeys,
  listStudentResponses,
  listGeneratedScores,
  listErrorsByScope,
  listStudents,
  listBlockSummary,
  sha256,
};
