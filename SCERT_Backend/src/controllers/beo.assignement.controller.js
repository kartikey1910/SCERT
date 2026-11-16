const pool = require("../config/db");

const isCmScheme = (scholarshipId, scholarshipName) => {
  const scholarshipNameLower = String(scholarshipName || "").toLowerCase();
  return (
    Number(scholarshipId) === 3 ||
    /\bcm\b/i.test(scholarshipNameLower) ||
    /chief\s*minister/i.test(scholarshipNameLower)
  );
};

/**
 * ASSIGN CENTER + SUBMIT APPLICATIONS (BEO → SCERT)
 * POST /beo/applications/assign-center-submit
 */
exports.assignCenterAndSubmitApplications = async (req, res) => {
  const roleId = req.user.role_id;
  const beoUserId = req.user.user_id;
  const { session_id, is_active } = req.session;
  const { scholarship_id, center_id, applications } = req.body;

  if (roleId !== 3) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  if (!is_active) {
    return res.status(403).json({ message: "Past session data is read-only" });
  }

  if (!scholarship_id || !center_id || !Array.isArray(applications) || applications.length === 0) {
    return res.status(400).json({
      message: "scholarship_id, center_id and applications[] are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* 1️⃣ Get BEO block */
    const beoRes = await client.query(
      `SELECT block_code FROM scert_db.beo_profiles WHERE user_id = $1`,
      [beoUserId]
    );

    if (beoRes.rows.length === 0) {
      throw new Error("BEO profile not found");
    }

    const blockCode = beoRes.rows[0].block_code;

    const scholarshipMetaRes = await client.query(
      `
      SELECT scholarship_name
      FROM scert_db.scholarships
      WHERE scholarship_id = $1
      LIMIT 1
      `,
      [scholarship_id]
    );
    const scholarshipName = scholarshipMetaRes.rows[0]?.scholarship_name || "";

    const applicationIds = applications.map((app) => Number(app.application_id || app));
    const isClassScopedSerial = isCmScheme(scholarship_id, scholarshipName);

    // Lock target applications first (ensures stable class/status while assigning).
    const targetAppsRes = await client.query(
      `
      SELECT application_id, class, app_serial_no
      FROM scert_db.scholarship_applications
      WHERE application_id = ANY($1::int[])
        AND scholarship_id = $2
        AND session_id = $3
        AND current_stage = 'BEO'
        AND status IN ('SUBMITTED', 'RETURNED')
      FOR UPDATE
      `,
      [applicationIds, scholarship_id, session_id]
    );

    if (targetAppsRes.rows.length !== applicationIds.length) {
      throw new Error("One or more applications are invalid or already processed");
    }

    const appMeta = new Map(
      targetAppsRes.rows.map((r) => [
        Number(r.application_id),
        { classValue: r.class === null ? null : Number(r.class), appSerialNo: r.app_serial_no },
      ])
    );

    // Scholarship 3 only: validate class and separate serial streams by class.
    let scopedClasses = [];
    if (isClassScopedSerial) {
      scopedClasses = Array.from(
        new Set(
          targetAppsRes.rows.map((r) => Number(r.class))
        )
      );
      if (!scopedClasses.every((c) => [6, 9].includes(c))) {
        throw new Error("For scholarship 3, application class must be 6 or 9");
      }
    }

    // Lock existing serial rows for the same scope before MAX() read (transaction-safe).
    if (isClassScopedSerial) {
      await client.query(
        `
        SELECT application_id
        FROM scert_db.scholarship_applications
        WHERE scholarship_id = $1
          AND session_id = $2
          AND block_code = $3
          AND class = ANY($4::int[])
          AND app_serial_no IS NOT NULL
        FOR UPDATE
        `,
        [scholarship_id, session_id, blockCode, scopedClasses]
      );
    } else {
      await client.query(
        `
        SELECT application_id
        FROM scert_db.scholarship_applications
        WHERE scholarship_id = $1
          AND session_id = $2
          AND block_code = $3
          AND app_serial_no IS NOT NULL
        FOR UPDATE
        `,
        [scholarship_id, session_id, blockCode]
      );
    }

    // Compute next serial(s).
    const nextSerialByClass = new Map();
    let nextSerial = 1;

    if (isClassScopedSerial) {
      const maxByClassRes = await client.query(
        `
        SELECT class, COALESCE(MAX(app_serial_no), 0) AS max_serial
        FROM scert_db.scholarship_applications
        WHERE scholarship_id = $1
          AND session_id = $2
          AND block_code = $3
          AND class = ANY($4::int[])
          AND app_serial_no IS NOT NULL
        GROUP BY class
        `,
        [scholarship_id, session_id, blockCode, scopedClasses]
      );

      for (const c of scopedClasses) {
        nextSerialByClass.set(c, 1);
      }
      for (const row of maxByClassRes.rows) {
        nextSerialByClass.set(Number(row.class), Number(row.max_serial) + 1);
      }
    } else {
      const lastSerialRes = await client.query(
        `
        SELECT COALESCE(MAX(app_serial_no), 0) AS max_serial
        FROM scert_db.scholarship_applications
        WHERE scholarship_id = $1
          AND session_id = $2
          AND block_code = $3
          AND app_serial_no IS NOT NULL
        `,
        [scholarship_id, session_id, blockCode]
      );
      nextSerial = Number(lastSerialRes.rows[0].max_serial) + 1;
    }

    /* 3️⃣ Assign applications */
    for (const app of applications) {
      const application_id = Number(app.application_id || app);
      const meta = appMeta.get(application_id);

      const proposedSerial = isClassScopedSerial
        ? nextSerialByClass.get(meta.classValue)
        : nextSerial;

      const updateRes = await client.query(
        `
        UPDATE scert_db.scholarship_applications
        SET
          center_id = $1,
          block_code = COALESCE(block_code, $2),
          app_serial_no = COALESCE(app_serial_no, $3),
          status = 'SUBMITTED',
          current_stage = 'SCERT',
          updated_at = CURRENT_TIMESTAMP
        WHERE application_id = $4
          AND scholarship_id = $5
          AND session_id = $6
          AND current_stage = 'BEO'
          AND status IN ('SUBMITTED', 'RETURNED')
        RETURNING app_serial_no;
        `,
        [
          center_id,
          blockCode,
          proposedSerial,
          application_id,
          scholarship_id,
          session_id,
        ]
      );

      if (updateRes.rows.length === 0) {
        throw new Error(`Application ${application_id} is invalid or already processed`);
      }

      // Increment only if a fresh serial was assigned by this update.
      if (Number(updateRes.rows[0].app_serial_no) === Number(proposedSerial)) {
        if (isClassScopedSerial) {
          nextSerialByClass.set(meta.classValue, proposedSerial + 1);
        } else {
          nextSerial++;
        }
      }
    }

    await client.query("COMMIT");
    // A status change moves the registration counts; drop the cached SCERT tables.
    await require("./scert.progressReport.controller").invalidateProgressReportCacheForApplications(applications.map((a) => a.application_id || a));

    res.json({
      message: "Applications assigned to center and submitted to SCERT",
      assigned_count: applications.length,
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Assign center + submit error:", err);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
};
