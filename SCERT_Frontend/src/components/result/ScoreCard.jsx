/**
 * Official score card, laid out to match CM Scholarship Result-Format.docx
 * exactly: letterhead, candidate-details table, SCORE CARD table with the
 * per-paper weightage column, result line, and the electronic-generation
 * footer.
 *
 * Rendered both in the SCERT publish preview (with sample data) and on the
 * public result page (with the student's real card), so the two can never
 * drift apart.
 */

const dash = (value) =>
  value === null || value === undefined || value === '' ? '—' : value;

/** Stored as YYYY-MM-DD; the printed format uses DD/MM/YYYY. */
function formatDob(value) {
  if (!value) return '—';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

function resultToneClass(result) {
  if (result === 'Selected') return 'scorecard-result-value scorecard-result-selected';
  if (result === 'Absent') return 'scorecard-result-value scorecard-result-absent';
  return 'scorecard-result-value scorecard-result-notselected';
}

export function ScoreCard({ card, watermark = null }) {
  if (!card) return null;

  const { header, identity, candidate, score_card: scoreCard, footer } = card;
  const sessionSuffix = header?.session_name ? ` ${header.session_name}` : '';

  return (
    <div className="scorecard-sheet">
      {watermark && <div className="scorecard-watermark">{watermark}</div>}

      {/* ---- Letterhead ---- */}
      <div className="scorecard-letterhead">
        {/* The square SCERT emblem taken from the official format
            document — not the wide portal banner, which letterboxes
            into an unreadable strip at this size. */}
        <img src="/scert-emblem.png" alt="SCERT Uttarakhand" className="scorecard-logo" />
        <div className="scorecard-letterhead-text">
          <div className="scorecard-authority">{header?.authority}</div>
          <div className="scorecard-exam-hi">
            {header?.exam_title_hi}{sessionSuffix}
          </div>
          <div className="scorecard-exam-en">
            ({header?.exam_title_en}{sessionSuffix})
          </div>
          <div className="scorecard-level">{header?.level_label}</div>
        </div>
      </div>

      {/* ---- District / Block / School / Roll ---- */}
      <div className="scorecard-meta">
        <div className="scorecard-meta-row">
          <span className="scorecard-meta-item">
            <span className="scorecard-meta-label">District:</span>
            <span className="scorecard-meta-value">{dash(identity?.district)}</span>
          </span>
          <span className="scorecard-meta-item">
            <span className="scorecard-meta-label">Block:</span>
            <span className="scorecard-meta-value">{dash(identity?.block)}</span>
          </span>
        </div>
        <div className="scorecard-meta-row">
          <span className="scorecard-meta-item scorecard-meta-item--wide">
            <span className="scorecard-meta-label">Name of School:</span>
            <span className="scorecard-meta-value">{dash(identity?.school_name)}</span>
          </span>
          <span className="scorecard-meta-item">
            <span className="scorecard-meta-label">Roll No.:</span>
            <span className="scorecard-meta-value scorecard-meta-value--strong">
              {dash(identity?.roll_number)}
            </span>
          </span>
        </div>
      </div>

      {/* ---- Candidate details ---- */}
      <div className="scorecard-table-scroll">
        <table className="scorecard-table scorecard-table--details">
          <thead>
            <tr>
              <th className="scorecard-col-sn">S. No.</th>
              <th>Description</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1.</td><td>Candidate’s Name</td>
              <td className="scorecard-detail-value">{dash(candidate?.candidate_name)}</td>
            </tr>
            <tr>
              <td>2.</td><td>Father’s Name</td>
              <td className="scorecard-detail-value">{dash(candidate?.father_name)}</td>
            </tr>
            <tr>
              <td>3.</td><td>Mother’s Name</td>
              <td className="scorecard-detail-value">{dash(candidate?.mother_name)}</td>
            </tr>
            <tr>
              <td>4.</td><td>Date of Birth</td>
              <td className="scorecard-detail-value">{formatDob(candidate?.date_of_birth)}</td>
            </tr>
            <tr>
              <td>5.</td><td>Sex</td>
              <td className="scorecard-detail-value">{dash(candidate?.sex)}</td>
            </tr>
            <tr>
              <td>6.</td><td>Caste</td>
              <td className="scorecard-detail-value">{dash(candidate?.caste)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- Score card ---- */}
      <div className="scorecard-section-title">SCORE CARD</div>

      <div className="scorecard-table-scroll">
        <table className="scorecard-table scorecard-table--marks">
          <thead>
            <tr>
              <th className="scorecard-col-sn">S. No.</th>
              <th className="scorecard-col-paper">Paper</th>
              <th>Maximum Marks</th>
              <th>Weightage<span className="scorecard-th-sub">(for SC/ST only)</span></th>
              <th>Marks Obtained</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(scoreCard?.papers || []).map((paper) => (
              <tr key={paper.sr_no}>
                <td>{paper.sr_no}</td>
                <td className="scorecard-col-paper">{paper.paper}</td>
                <td>{dash(paper.maximum_marks)}</td>
                <td>{dash(paper.weightage)}</td>
                <td>{dash(paper.marks_obtained)}</td>
                <td className="scorecard-cell-strong">{dash(paper.total)}</td>
              </tr>
            ))}
            <tr className="scorecard-total-row">
              <td colSpan={2}>Total</td>
              <td>{dash(scoreCard?.totals?.maximum_marks)}</td>
              <td>{dash(scoreCard?.totals?.weightage)}</td>
              <td>{dash(scoreCard?.totals?.marks_obtained)}</td>
              <td className="scorecard-cell-strong">{dash(scoreCard?.totals?.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- Result ---- */}
      <div className="scorecard-result">
        <span className="scorecard-result-label">Result:</span>
        <span className={resultToneClass(card.result)}>{dash(card.result)}</span>
      </div>

      {/* ---- Footer ---- */}
      <div className="scorecard-footer">
        <div className="scorecard-signature">
          <div className="scorecard-sd">Sd/-</div>
          <div className="scorecard-signatory">{footer?.signatory}</div>
          <div className="scorecard-signatory">{footer?.authority}</div>
        </div>
      </div>

      <div className="scorecard-notes">
        <div className="scorecard-note">
          <strong>Note:</strong> {footer?.note}
        </div>
        {footer?.validity && <div className="scorecard-note">{footer.validity}</div>}
      </div>
    </div>
  );
}

export default ScoreCard;
