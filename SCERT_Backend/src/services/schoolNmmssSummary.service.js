/**
 * NMMSS summary for the School dashboard: the "Number of Students" table
 * (category x gender) and the school's contact details.
 *
 * WHERE EACH ROW COMES FROM
 *
 *   Class 8 Enrollment   school_student_strength - what the school entered in
 *                        its profile, per class, per category, boys/girls.
 *   Registered           every application this school has submitted for the
 *                        scholarship: any status other than DRAFT or REJECTED.
 *                        It counts from the moment the application is
 *                        submitted and does not move again when it is
 *                        forwarded or approved - the same rule as the
 *                        Progress Report, so the two always agree.
 *   Appeared             registered students marked PRESENT in either paper.
 *                        Attendance exists only once the BEO has uploaded
 *                        Absentee After Exam, so this stays 0 until then.
 *                        Always a subset of Registered.
 *   Qualified, Selected  NOT AVAILABLE YET. They come from NMMSS results, and
 *   (NMMSS/SNSS/SSSS)    the result module is CM-only: it has no NMMSS upload,
 *                        no "qualified" flag, and nothing that tells the
 *                        three schemes apart. These rows are reported as
 *                        unavailable rather than as zero, because "0
 *                        selected" would be a claim nobody has checked.
 *
 * Category and gender of a student are read from that student's own
 * application answers (caste_category, sex), so the table needs no join
 * against the profile tables and works for school-created and
 * student-created applications alike.
 */

const CATEGORIES = ["GEN", "SC", "ST", "OBC"];
const NMMSS_CLASS = 8;
// Registered = every application that has been submitted: anything that is not
// still a draft and has not been rejected (the Progress Report's rule).
const NOT_REGISTERED_STATUSES = ["DRAFT", "REJECTED"];
const NMMSS_NAME_PATTERN = /\bnmmss\b|\bnmms\b|snss|ssss/i;

/** Rows that need results the system does not hold yet. */
const RESULT_ROWS = ["qualified", "selected_nmmss", "selected_snss", "selected_ssss"];

const emptyCells = () =>
  Object.fromEntries(CATEGORIES.map((c) => [c, { boys: 0, girls: 0 }]));

function normaliseCategory(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "GENERAL") return "GEN";
  return CATEGORIES.includes(v) ? v : null;
}

function normaliseGender(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "male" || v === "m" || v === "boy") return "boys";
  if (v === "female" || v === "f" || v === "girl") return "girls";
  return null;
}

/** Adds the Total (all categories) column and the Grand Total. */
function withTotals(cells) {
  let boys = 0;
  let girls = 0;
  for (const c of CATEGORIES) {
    boys += cells[c].boys;
    girls += cells[c].girls;
  }
  return { cells, total: { boys, girls }, grand_total: boys + girls };
}

const unavailableRow = (key) => ({ key, available: false });

async function assertNmmss(db, scholarshipId) {
  const res = await db.query(
    `SELECT scholarship_name FROM scert_db.scholarships WHERE scholarship_id = $1`,
    [scholarshipId]
  );
  if (!res.rows.length) {
    const err = new Error("Scholarship not found");
    err.statusCode = 404;
    throw err;
  }
  if (!NMMSS_NAME_PATTERN.test(String(res.rows[0].scholarship_name || ""))) {
    const err = new Error("This summary is only available for the NMMSS scholarship");
    err.statusCode = 400;
    throw err;
  }
}

async function loadEnrollment(db, schoolUserId) {
  const res = await db.query(
    `SELECT category::text AS category,
            COALESCE(SUM(boys_count), 0)::int  AS boys,
            COALESCE(SUM(girls_count), 0)::int AS girls
       FROM scert_db.school_student_strength
      WHERE school_user_id = $1 AND class_level = $2
      GROUP BY category`,
    [schoolUserId, NMMSS_CLASS]
  );
  const cells = emptyCells();
  for (const r of res.rows) {
    const cat = normaliseCategory(r.category);
    if (cat) {
      cells[cat].boys += r.boys;
      cells[cat].girls += r.girls;
    }
  }
  return cells;
}

async function loadRegisteredAndAppeared(db, { schoolUserId, sessionId, scholarshipId }) {
  const res = await db.query(
    `WITH mine AS (
       SELECT sa.application_id
         FROM scert_db.scholarship_applications sa
        WHERE sa.session_id = $2
          AND sa.scholarship_id = $3
          AND sa.status::text <> ALL($4::text[])
          AND (
            sa.created_by_school_user_id = $1
            OR EXISTS (
              SELECT 1
                FROM scert_db.student_profiles sp
                JOIN scert_db.school_profiles sc ON sc.udise_code = sp.udise_code
               WHERE sp.user_id = sa.student_user_id AND sc.user_id = $1
            )
          )
     ),
     attrs AS (
       SELECT aa.application_id,
              -- whitespace-insensitive: some NMMSS field keys end in a newline
              MAX(CASE WHEN LOWER(REGEXP_REPLACE(ff.field_key, '\\s', '', 'g'))
                            IN ('caste_category', 'category')
                       THEN aa.value_text END) AS category,
              MAX(CASE WHEN LOWER(REGEXP_REPLACE(ff.field_key, '\\s', '', 'g'))
                            IN ('sex', 'gender')
                       THEN aa.value_text END) AS gender
         FROM mine m
         JOIN scert_db.scholarship_application_answers aa ON aa.application_id = m.application_id
         JOIN scert_db.scholarship_form_fields ff ON ff.field_id = aa.field_id
        WHERE LOWER(REGEXP_REPLACE(ff.field_key, '\\s', '', 'g'))
              IN ('caste_category', 'category', 'sex', 'gender')
        GROUP BY aa.application_id
     )
     SELECT a.category,
            a.gender,
            COUNT(*)::int AS registered,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1
                FROM scert_db.center_exam_student_attendance x
               WHERE x.application_id = m.application_id
                 AND (x.mat_status = 'PRESENT' OR x.sat_status = 'PRESENT')
            ))::int AS appeared
       FROM mine m
       LEFT JOIN attrs a ON a.application_id = m.application_id
      GROUP BY a.category, a.gender`,
    [schoolUserId, sessionId, scholarshipId, NOT_REGISTERED_STATUSES]
  );

  const registered = emptyCells();
  const appeared = emptyCells();
  const unclassified = { registered: 0, appeared: 0 };

  for (const r of res.rows) {
    const cat = normaliseCategory(r.category);
    const gender = normaliseGender(r.gender);
    if (cat && gender) {
      registered[cat][gender] += r.registered;
      appeared[cat][gender] += r.appeared;
    } else {
      // A student whose gender is blank or "Others" fits neither Boy nor
      // Girl. They are counted here so the table can say how many are not
      // shown instead of quietly disagreeing with the status cards.
      unclassified.registered += r.registered;
      unclassified.appeared += r.appeared;
    }
  }
  return { registered, appeared, unclassified };
}

async function loadProfile(db, schoolUserId) {
  const res = await db.query(
    `SELECT school_name, email, contact_number,
            head_of_institution_name, head_of_institution_mobile
       FROM scert_db.school_profiles
      WHERE user_id = $1`,
    [schoolUserId]
  );
  const p = res.rows[0] || {};
  const clean = (v) => (v == null ? "" : String(v).trim());
  return {
    school_name: clean(p.school_name),
    email: clean(p.email),
    contact_number: clean(p.contact_number),
    head_of_institution_name: clean(p.head_of_institution_name),
    head_of_institution_mobile: clean(p.head_of_institution_mobile),
  };
}

/**
 * @param db  anything with .query(text, params) - the pool in production, a
 *            transaction client in tests.
 */
async function getNmmssSummary(db, { schoolUserId, sessionId, scholarshipId }) {
  await assertNmmss(db, scholarshipId);

  const [enrollment, counts, profile] = await Promise.all([
    loadEnrollment(db, schoolUserId),
    loadRegisteredAndAppeared(db, { schoolUserId, sessionId, scholarshipId }),
    loadProfile(db, schoolUserId),
  ]);

  const enrollmentRow = withTotals(enrollment);

  // What the dashboard nudges the school to complete: the contact details it
  // prints, and the Class 8 enrollment the first row of the table reads.
  const missing = [];
  if (!profile.email) missing.push("email");
  if (!profile.contact_number) missing.push("contact_number");
  if (!profile.head_of_institution_name) missing.push("head_of_institution_name");
  if (!profile.head_of_institution_mobile) missing.push("head_of_institution_mobile");
  if (enrollmentRow.grand_total === 0) missing.push("class_8_enrollment");

  return {
    class_level: NMMSS_CLASS,
    categories: CATEGORIES,
    rows: [
      { key: "enrollment", available: true, ...enrollmentRow },
      { key: "registered", available: true, ...withTotals(counts.registered) },
      { key: "appeared", available: true, ...withTotals(counts.appeared) },
      ...RESULT_ROWS.map(unavailableRow),
    ],
    unclassified: counts.unclassified,
    profile,
    profile_incomplete: missing.length > 0,
    profile_missing: missing,
  };
}

module.exports = {
  getNmmssSummary,
  assertNmmss,
  CATEGORIES,
  NOT_REGISTERED_STATUSES,
  NMMSS_CLASS,
  RESULT_ROWS,
};
