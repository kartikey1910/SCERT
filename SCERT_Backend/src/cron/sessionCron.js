const cron = require("node-cron");
const pool = require("../config/db");

async function cloneScholarshipsForNewSession(client, oldSessionId, newSessionId) {
  const scholarshipsRes = await client.query(
    `
    SELECT
      scholarship_id,
      scholarship_name,
      scholarship_details,
      eligibility,
      last_date,
      circular_file_path,
      circular_original_name,
      created_by,
      status,
      exam_date,
      mat_start_time,
      mat_end_time,
      sat_start_time,
      sat_end_time,
      exam_instructions
    FROM scert_db.scholarships
    WHERE session_id = $1
    ORDER BY scholarship_id ASC
    `,
    [oldSessionId]
  );

  let clonedScholarships = 0;

  for (const oldScholarship of scholarshipsRes.rows) {
    const newScholarshipRes = await client.query(
      `
      INSERT INTO scert_db.scholarships (
        scholarship_name,
        scholarship_details,
        eligibility,
        last_date,
        circular_file_path,
        circular_original_name,
        created_by,
        status,
        exam_date,
        session_id,
        mat_start_time,
        mat_end_time,
        sat_start_time,
        sat_end_time,
        exam_instructions
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING scholarship_id
      `,
      [
        oldScholarship.scholarship_name,
        oldScholarship.scholarship_details,
        oldScholarship.eligibility,
        oldScholarship.last_date,
        oldScholarship.circular_file_path,
        oldScholarship.circular_original_name,
        oldScholarship.created_by,
        oldScholarship.status,
        oldScholarship.exam_date,
        newSessionId,
        oldScholarship.mat_start_time,
        oldScholarship.mat_end_time,
        oldScholarship.sat_start_time,
        oldScholarship.sat_end_time,
        oldScholarship.exam_instructions,
      ]
    );

    const newScholarshipId = newScholarshipRes.rows[0].scholarship_id;

    const fieldsRes = await client.query(
      `
      SELECT
        field_id,
        field_label,
        field_key,
        field_type,
        is_required,
        sort_order,
        is_active
      FROM scert_db.scholarship_form_fields
      WHERE scholarship_id = $1
      ORDER BY sort_order ASC, field_id ASC
      `,
      [oldScholarship.scholarship_id]
    );

    const newFieldIdByOldFieldId = new Map();

    for (const field of fieldsRes.rows) {
      const newFieldRes = await client.query(
        `
        INSERT INTO scert_db.scholarship_form_fields (
          scholarship_id,
          field_label,
          field_key,
          field_type,
          is_required,
          sort_order,
          is_active
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING field_id
        `,
        [
          newScholarshipId,
          field.field_label,
          field.field_key,
          field.field_type,
          field.is_required,
          field.sort_order,
          field.is_active,
        ]
      );

      newFieldIdByOldFieldId.set(String(field.field_id), newFieldRes.rows[0].field_id);
    }

    if (fieldsRes.rows.length > 0) {
      const oldFieldIds = fieldsRes.rows.map((f) => f.field_id);

      const optionsRes = await client.query(
        `
        SELECT
          field_id,
          option_label,
          option_value,
          sort_order,
          is_active
        FROM scert_db.scholarship_form_field_options
        WHERE field_id = ANY($1::bigint[])
        ORDER BY field_id ASC, sort_order ASC, option_id ASC
        `,
        [oldFieldIds]
      );

      for (const option of optionsRes.rows) {
        const mappedFieldId = newFieldIdByOldFieldId.get(String(option.field_id));
        if (!mappedFieldId) continue;

        await client.query(
          `
          INSERT INTO scert_db.scholarship_form_field_options (
            field_id,
            option_label,
            option_value,
            sort_order,
            is_active
          )
          VALUES ($1,$2,$3,$4,$5)
          `,
          [
            mappedFieldId,
            option.option_label,
            option.option_value,
            option.sort_order,
            option.is_active,
          ]
        );
      }
    }

    clonedScholarships += 1;
  }

  return clonedScholarships;
}

cron.schedule("5 0 * * *", async () => {
  console.log("Academic session cron started");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const activeRes = await client.query(
      `
      SELECT session_id, session_name, start_date, end_date
      FROM scert_db.academic_sessions
      WHERE is_active = true
      FOR UPDATE
      LIMIT 1
      `
    );

    if (activeRes.rows.length === 0) {
      console.log("No active academic session found");
      try { await client.query("ROLLBACK"); } catch (_) {}
      return;
    }

    const activeSession = activeRes.rows[0];

    const today = new Date();
    const endDate = new Date(activeSession.end_date);

    if (today <= endDate) {
      console.log("Academic session still active:", activeSession.session_name);
      try { await client.query("ROLLBACK"); } catch (_) {}
      return;
    }

    await client.query(
      `
      UPDATE scert_db.academic_sessions
      SET is_active = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE session_id = $1
      `,
      [activeSession.session_id]
    );

    const prevEndDate = new Date(activeSession.end_date);
    const newStartDate = new Date(prevEndDate);
    newStartDate.setDate(newStartDate.getDate() + 1);

    const newEndDate = new Date(newStartDate.getFullYear() + 1, 2, 31);

    const startYear = newStartDate.getFullYear();
    const endYearShort = String(newEndDate.getFullYear()).slice(-2);
    const newSessionName = `${startYear}-${endYearShort}`;

    const newSessionRes = await client.query(
      `
      INSERT INTO scert_db.academic_sessions
      (session_name, start_date, end_date, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING session_id
      `,
      [newSessionName, newStartDate, newEndDate]
    );

    const newSessionId = newSessionRes.rows[0].session_id;

    const clonedCount = await cloneScholarshipsForNewSession(
      client,
      activeSession.session_id,
      newSessionId
    );

    await client.query("COMMIT");

    console.log(`Academic session rotated to ${newSessionName}`);
    console.log(`Cloned ${clonedCount} scholarship(s) into session ${newSessionName}`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Academic session cron error:", err);
  } finally {
    client.release();
  }
});
