/**
 * SR Number uniqueness — one SR (Scholar Register) number per school, per
 * scholarship, per session.
 *
 * A school's SR number identifies one student in that school's register, so
 * two live applications carrying the same SR number in the same school,
 * scholarship and session are the same student entered twice.
 *
 * WHY THIS IS ONE SHARED MODULE
 * The check used to be written out separately in the school and student
 * save handlers, and had never actually fired for any scholarship:
 *
 *   - it matched only the field keys "sr_no" and "student_registration_no",
 *     but every live form stores the field as "student_registration";
 *   - the NMMSS form's key carries a trailing newline, which Postgres TRIM()
 *     does not strip (it removes spaces only);
 *   - NMMSS's SR field is a NUMBER, stored in value_number, while the check
 *     compared value_text — always NULL for that field.
 *
 * It was added after CM 2026-27 applications had closed, so NMMSS was the
 * first live window it faced. The rules now live here once, and every path
 * that can write or submit an SR number calls it: school save / submit /
 * mark-submitted, student save / submit, and the BEO edit.
 *
 * SCOPE
 * "The same school" is derived from the application itself, so every caller
 * agrees on it: the UDISE of the school that created it, or failing that the
 * UDISE of the student who owns it. Applications created by any school login
 * with that UDISE, and by any student registered under it, are compared.
 *
 * A REJECTED application does not hold its SR number. Rejection is final
 * (the application is locked and nothing reopens it), so when a school
 * rejects one by mistake the only way forward is a fresh application for the
 * same student - which needs the same SR number. Every other status counts.
 * Deleted drafts are removed outright, so they never hold one either.
 */

/**
 * Every spelling the app already uses for the SR field (the same list
 * getStudentRegistration() reads in the application controllers).
 */
const SR_FIELD_KEYS = [
  "student_registration",
  "student_registration_id",
  "student_registration_number",
  "student_registration_no",
  "student_reg_no",
  "registration_number",
  "registration_no",
  "sr_no",
  "sr_number",
];

/** Lowercase with ALL whitespace removed — newlines included. */
function canonicalKey(key) {
  return String(key || "").toLowerCase().replace(/\s+/g, "");
}

function isSrFieldKey(key) {
  return SR_FIELD_KEYS.includes(canonicalKey(key));
}

/**
 * Compare form: NUMBER fields numerically ("0123" and "123" are the same SR,
 * exactly as the bigint column stores them); text fields trimmed and
 * case-insensitive.
 */
function canonicalValue(value, fieldType) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (String(fieldType || "").toUpperCase() === "NUMBER") {
    const n = Number(raw);
    if (Number.isFinite(n)) return String(n);
  }
  return raw.toLowerCase();
}

// The same two normalisations, expressed in SQL. regexp_replace with \s
// covers the newline that plain TRIM() misses.
const SQL_FIELD_KEY = `LOWER(REGEXP_REPLACE(ff.field_key, '\\s', '', 'g'))`;
const SQL_ANSWER_VALUE = `LOWER(REGEXP_REPLACE(
    COALESCE(NULLIF(REGEXP_REPLACE(aa.value_text, '^\\s+|\\s+$', '', 'g'), ''), aa.value_number::text),
    '^\\s+|\\s+$', '', 'g'))`;

/**
 * Finds the SR answer in a save payload. `fieldMap` maps field_id to the
 * form-field row (field_key, field_type), as the save handlers build it.
 * Returns null when this payload does not touch the SR field.
 *
 * The handlers do not agree on the key type: node-postgres returns bigint
 * columns as strings, so one map is keyed "87" and another 87, and the
 * payload may carry either. A lookup that tries only one form misses
 * silently — the old student-side check keyed by Number() against a
 * string-keyed map, which on its own guaranteed it never fired — so every
 * form is tried.
 */
function findSrAnswer(answers, fieldMap) {
  for (const ans of answers || []) {
    if (!ans || ans.field_id == null || ans.field_id === "") continue;
    const field =
      fieldMap.get(ans.field_id) ||
      fieldMap.get(String(ans.field_id)) ||
      fieldMap.get(Number(ans.field_id));
    if (field && isSrFieldKey(field.field_key)) {
      return { value: ans.value, fieldType: field.field_type };
    }
  }
  return null;
}

function conflictMessage(srValue, conflict, audience) {
  if (audience === "student") {
    // A student is not shown another student's application details.
    return (
      `SR Number "${srValue}" is already registered on another application from your school ` +
      `for this scholarship and session. Please check your SR Number, or contact your school.`
    );
  }
  const ref = conflict.application_display_id || `#${conflict.application_id}`;
  return (
    `SR Number "${srValue}" is already used in application ${ref} (${conflict.status}) ` +
    `from this school for this scholarship and session. Each student's SR Number can be used only once.`
  );
}

/** The SR answer currently saved on an application, or null. */
async function readStoredSr(client, applicationId) {
  const res = await client.query(
    `SELECT aa.value_text, aa.value_number, ff.field_type
       FROM scert_db.scholarship_application_answers aa
       JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
      WHERE aa.application_id = $1
        AND ${SQL_FIELD_KEY} = ANY($2::text[])
      LIMIT 1`,
    [applicationId, SR_FIELD_KEYS]
  );
  const row = res.rows[0];
  if (!row) return null;
  const value = row.value_text != null && String(row.value_text).trim() !== ""
    ? row.value_text
    : row.value_number;
  return value == null ? null : { value, fieldType: row.field_type };
}

/**
 * Throws a 400 when `value` is already the SR number of another application
 * in the same school, scholarship and session. Call inside the transaction
 * that writes or submits the application.
 *
 * The advisory lock serialises two requests claiming the same SR number in
 * the same school at the same moment: the second waits until the first
 * commits, then sees its row. Without it, two simultaneous saves could both
 * pass the check.
 *
 * `onlyIfChanged` is for save paths. The school and BEO screens send the
 * whole form on every save, SR included, so without it a school or BEO
 * editing any field of an application whose SR predates this check —
 * 13,049 CM 2026-27 applications share an SR within their school — would be
 * refused over a number nobody touched. Saves therefore check only an SR
 * that is new to this application; the submit paths still check the stored
 * SR, so an existing duplicate cannot be submitted or forwarded.
 */
async function assertSrNumberAvailable(client, { applicationId, value, fieldType, audience = "school", onlyIfChanged = false }) {
  const srValue = canonicalValue(value, fieldType);
  if (!srValue) return;

  if (onlyIfChanged) {
    const stored = await readStoredSr(client, applicationId);
    if (stored && canonicalValue(stored.value, stored.fieldType) === srValue) return;
  }

  const scopeRes = await client.query(
    `SELECT a.session_id, a.scholarship_id, a.created_by_school_user_id,
            COALESCE(NULLIF(sp.udise_code, ''), NULLIF(stp.udise_code, '')) AS udise
       FROM scert_db.scholarship_applications a
       LEFT JOIN scert_db.school_profiles  sp  ON sp.user_id  = a.created_by_school_user_id
       LEFT JOIN scert_db.student_profiles stp ON stp.user_id = a.student_user_id
      WHERE a.application_id = $1`,
    [applicationId]
  );
  const scope = scopeRes.rows[0];
  if (!scope) return;

  const schoolKey = scope.udise || `school-user:${scope.created_by_school_user_id || "none"}`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `sr-number|${scope.session_id}|${scope.scholarship_id}|${schoolKey}|${srValue}`,
  ]);

  // Resolve the school's footprint up front — each lookup is a few rows —
  // so the conflict query below only ever visits this one school's
  // applications (a few hundred at most) through existing indexes, instead
  // of the whole scholarship. The no-conflict case, which is every valid
  // save, has to prove absence, so it must not depend on an early LIMIT hit.
  const fieldIds = (await client.query(
    `SELECT ff.field_id FROM scert_db.scholarship_form_fields ff
      WHERE ff.scholarship_id = $1 AND ${SQL_FIELD_KEY} = ANY($2::text[])`,
    [scope.scholarship_id, SR_FIELD_KEYS]
  )).rows.map((r) => r.field_id);
  if (!fieldIds.length) return;

  const schoolUserIds = scope.udise
    ? (await client.query(
        `SELECT user_id FROM scert_db.school_profiles WHERE udise_code = $1`, [scope.udise]
      )).rows.map((r) => r.user_id)
    : [];
  if (scope.created_by_school_user_id && !schoolUserIds.map(String).includes(String(scope.created_by_school_user_id))) {
    schoolUserIds.push(scope.created_by_school_user_id);
  }
  const studentUserIds = scope.udise
    ? (await client.query(
        `SELECT user_id FROM scert_db.student_profiles WHERE udise_code = $1`, [scope.udise]
      )).rows.map((r) => r.user_id)
    : [];

  const conflictRes = await client.query(
    `SELECT o.application_id, o.application_display_id, o.status
       FROM scert_db.scholarship_applications o
       JOIN scert_db.scholarship_application_answers aa
         ON aa.application_id = o.application_id AND aa.field_id = ANY($4::bigint[])
      WHERE o.session_id = $1
        AND o.scholarship_id = $2
        AND o.application_id <> $3
        AND o.status::text <> 'REJECTED'
        AND (o.created_by_school_user_id = ANY($5::bigint[]) OR o.student_user_id = ANY($6::bigint[]))
        AND ${SQL_ANSWER_VALUE} = $7
      ORDER BY o.application_id
      LIMIT 1`,
    [scope.session_id, scope.scholarship_id, applicationId, fieldIds, schoolUserIds, studentUserIds, srValue]
  );

  if (conflictRes.rows.length) {
    const displayValue = String(value).trim();
    const err = new Error(conflictMessage(displayValue, conflictRes.rows[0], audience));
    err.statusCode = 400;
    err.code = "SR_NUMBER_TAKEN";
    throw err;
  }
}

/**
 * Submit-time check: reads the SR number already saved on the application
 * and asserts it is still unique. Submits can bypass a save entirely — the
 * school's bulk "submit selected drafts" posts straight to /submit — so the
 * save-time check alone cannot guarantee uniqueness.
 */
async function assertStoredSrNumberUnique(client, { applicationId, audience = "school" }) {
  const stored = await readStoredSr(client, applicationId);
  if (!stored) return;
  await assertSrNumberAvailable(client, {
    applicationId,
    value: stored.value,
    fieldType: stored.fieldType,
    audience,
  });
}

module.exports = {
  SR_FIELD_KEYS,
  isSrFieldKey,
  canonicalValue,
  findSrAnswer,
  assertSrNumberAvailable,
  assertStoredSrNumberUnique,
};
