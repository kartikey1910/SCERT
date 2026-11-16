/**
 * NMMSS school-wise table and the BEO's contact strip, shown on the BEO
 * dashboard while the NMMSS scholarship is selected.
 *
 * The figures come ready-made from GET /api/beo/dashboard/nmmss-summary; this
 * component only lays them out, following the dashboard sheet: one row per
 * school in the block, grouped Registered / Selected headers, a Total row.
 *
 * Qualified and Selected need NMMSS results, which the system does not hold
 * yet. Those columns show a dash rather than 0 - "0 selected" would state
 * something nobody has checked - and a note says why.
 */

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function ContactItem({ label, value }) {
  return (
    <div className="school-nmmss-contact-item">
      <span className="school-nmmss-contact-label">{label}</span>
      {value ? (
        <span className="school-nmmss-contact-value">{value}</span>
      ) : (
        <span className="school-nmmss-contact-missing">Not provided</span>
      )}
    </div>
  );
}

/** A cell for a figure that will exist once results are declared. */
function PendingCells({ count }) {
  return Array.from({ length: count }, (_, i) => (
    <td
      key={i}
      className="school-nmmss-num beo-nmmss-pending"
      title="Available once results are declared"
    >
      &mdash;
    </td>
  ));
}

export function BeoNmmssContact({ profile }) {
  return (
    <div className="school-nmmss-contact beo-nmmss-contact">
      <ContactItem label="Name of BEO" value={profile?.beo_name} />
      <ContactItem label="Mobile No." value={profile?.mobile} />
      <ContactItem label="Office Email ID" value={profile?.email} />
    </div>
  );
}

export function BeoNmmssSummary({ summary }) {
  const rows = summary?.rows || [];
  const totals = summary?.totals || {};
  const otherRegistered = Number(totals.registered_other || 0);

  return (
    <section className="school-nmmss-summary beo-nmmss-summary" aria-label="School-wise students">
      <div className="school-nmmss-scroll">
        <table className="school-nmmss-table beo-nmmss-table">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="beo-nmmss-sno">S.No</th>
              <th rowSpan={2} scope="col" className="beo-nmmss-school-head">Schools Name</th>
              <th rowSpan={2} scope="col">Enrolled Students in Class 8</th>
              <th colSpan={3} scope="colgroup">Registered</th>
              <th rowSpan={2} scope="col">Appeared in Exam</th>
              <th rowSpan={2} scope="col">Qualified Students</th>
              <th colSpan={4} scope="colgroup">Selected Students</th>
            </tr>
            <tr>
              <th scope="col" className="school-nmmss-sub">NMMSS (Code 1)</th>
              <th scope="col" className="school-nmmss-sub">SNSS and SSSS (Code 2)</th>
              <th scope="col" className="school-nmmss-sub">Total</th>
              <th scope="col" className="school-nmmss-sub">NMMSS</th>
              <th scope="col" className="school-nmmss-sub">SNSS</th>
              <th scope="col" className="school-nmmss-sub">SSSS</th>
              <th scope="col" className="school-nmmss-sub">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="school-nmmss-unavailable">
                  No schools found for your block.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={String(row.school_user_id)}>
                  <td className="school-nmmss-num beo-nmmss-sno">{idx + 1}</td>
                  <th scope="row" className="beo-nmmss-school">{row.school_name || '—'}</th>
                  <td className="school-nmmss-num beo-nmmss-count">{fmt(row.enrolled)}</td>
                  <td className="school-nmmss-num beo-nmmss-count">{fmt(row.registered_nmmss)}</td>
                  <td className="school-nmmss-num beo-nmmss-count">{fmt(row.registered_snss_ssss)}</td>
                  <td className="school-nmmss-num beo-nmmss-count school-nmmss-grand">{fmt(row.registered_total)}</td>
                  <td className="school-nmmss-num beo-nmmss-count">{fmt(row.appeared)}</td>
                  <PendingCells count={5} />
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="beo-nmmss-total-row">
                <th colSpan={2} scope="row" className="beo-nmmss-total-label">Total</th>
                <td className="school-nmmss-num beo-nmmss-count">{fmt(totals.enrolled)}</td>
                <td className="school-nmmss-num beo-nmmss-count">{fmt(totals.registered_nmmss)}</td>
                <td className="school-nmmss-num beo-nmmss-count">{fmt(totals.registered_snss_ssss)}</td>
                <td className="school-nmmss-num beo-nmmss-count school-nmmss-grand">{fmt(totals.registered_total)}</td>
                <td className="school-nmmss-num beo-nmmss-count">{fmt(totals.appeared)}</td>
                <PendingCells count={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="school-nmmss-note beo-nmmss-note" role="note">
        Qualified and Selected figures will appear once the NMMSS results are declared.
        {otherRegistered > 0 && (
          <>
            {' '}
            {fmt(otherRegistered)} registered student{otherRegistered !== 1 ? 's' : ''} without an
            exam code (1 or 2) {otherRegistered !== 1 ? 'are' : 'is'} not counted in the Registered columns.
          </>
        )}
      </p>
    </section>
  );
}
