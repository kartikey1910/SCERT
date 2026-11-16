/**
 * NMMSS "Number of Students" table and the school's contact details, shown
 * on the school dashboard while the NMMSS scholarship is selected.
 *
 * The figures come ready-made from GET /api/school/dashboard/nmmss-summary;
 * this component only lays them out. Rows the backend reports as
 * unavailable (everything that needs NMMSS results) are shown as such rather
 * than as zeros - "0 selected" would state something nobody has checked.
 */

const CATEGORY_LABELS = { GEN: 'General', SC: 'SC', ST: 'ST', OBC: 'OBC' };

const ROW_LABELS = {
  enrollment: 'Class 8 Enrollment',
  registered: 'Registered for the Scholarship Exam',
  appeared: 'Appeared in the Scholarship Exam',
  qualified: 'Qualified in the Scholarship Exam',
  selected_nmmss: 'Selected for the National Means-cum-Merit Scholarship Scheme',
  selected_snss: 'Selected for the Sivanand Nautiyal Scholarship Scheme (SNSS)',
  selected_ssss: 'Selected for the Sridev Suman Scholarship Scheme (SSSS)',
};

// The three "Selected for ..." rows carry the green highlight on the sheet.
const GREEN_ROWS = new Set(['selected_nmmss', 'selected_snss', 'selected_ssss']);

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function Cell({ value }) {
  return <td className="school-nmmss-num school-nmmss-count">{fmt(value)}</td>;
}

function SummaryRow({ row, categories }) {
  const label = ROW_LABELS[row.key] || row.key;
  const className = GREEN_ROWS.has(row.key) ? 'school-nmmss-row-green' : undefined;
  // 2 columns per category + the 2 Total columns + Grand Total
  const span = categories.length * 2 + 3;

  if (!row.available) {
    return (
      <tr className={className}>
        <th scope="row" className="school-nmmss-rowhead">{label}</th>
        <td colSpan={span} className="school-nmmss-unavailable">
          Available once results are declared
        </td>
      </tr>
    );
  }

  return (
    <tr className={className}>
      <th scope="row" className="school-nmmss-rowhead">{label}</th>
      {categories.map((cat) => (
        <FragmentCells key={cat} cells={row.cells[cat]} />
      ))}
      <Cell value={row.total.boys} />
      <Cell value={row.total.girls} />
      <td className="school-nmmss-num school-nmmss-grand">{fmt(row.grand_total)}</td>
    </tr>
  );
}

function FragmentCells({ cells }) {
  return (
    <>
      <Cell value={cells.boys} />
      <Cell value={cells.girls} />
    </>
  );
}

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

export function SchoolNmmssSummary({ summary }) {
  const categories = summary?.categories || ['GEN', 'SC', 'ST', 'OBC'];
  const rows = summary?.rows || [];
  const profile = summary?.profile || {};
  const unclassified = Number(summary?.unclassified?.registered || 0);

  return (
    <section className="school-nmmss-summary" aria-label="Number of students">
      <div className="school-nmmss-scroll">
        <table className="school-nmmss-table">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="school-nmmss-corner">Number of Students</th>
              {categories.map((cat) => (
                <th key={cat} colSpan={2} scope="colgroup">{CATEGORY_LABELS[cat] || cat}</th>
              ))}
              <th colSpan={2} scope="colgroup">Total</th>
              <th rowSpan={2} scope="col" className="school-nmmss-grand-head">Grand Total</th>
            </tr>
            <tr>
              {[...categories, 'TOTAL'].map((key) => (
                <FragmentHeads key={key} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SummaryRow key={row.key} row={row} categories={categories} />
            ))}
          </tbody>
        </table>
      </div>

      {unclassified > 0 && (
        <p className="school-nmmss-note" role="note">
          {fmt(unclassified)} registered student{unclassified !== 1 ? 's' : ''} whose gender is not
          Male or Female {unclassified !== 1 ? 'are' : 'is'} not counted in the Boy / Girl columns above.
        </p>
      )}

      <div className="school-nmmss-contact">
        <ContactItem label="School Email ID" value={profile.email} />
        <ContactItem label="School Contact No." value={profile.contact_number} />
        <ContactItem label="Name of Head of Institution" value={profile.head_of_institution_name} />
        <ContactItem label="Head of Institution Contact No." value={profile.head_of_institution_mobile} />
      </div>
    </section>
  );
}

function FragmentHeads() {
  return (
    <>
      <th scope="col" className="school-nmmss-sub">Boy</th>
      <th scope="col" className="school-nmmss-sub">Girl</th>
    </>
  );
}
