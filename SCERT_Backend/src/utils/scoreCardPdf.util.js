/**
 * Renders one student's official score card as a PDF.
 *
 * Layout follows CM Scholarship Result-Format.docx exactly — the same
 * document the public View Result page reproduces in HTML: letterhead with
 * the SCERT emblem, the District/Block/School/Roll line, a six-row
 * candidate table, the SCORE CARD marks table carrying the per-paper
 * SC/ST weightage column, the Result line, and the electronically-generated
 * footer.
 *
 * A4 portrait, one card per page.
 */

const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const EMBLEM_PATH = path.join(__dirname, "..", "assets", "scert-emblem.png");

/**
 * PDFKit's built-in fonts are Latin-only, so the Devanagari exam title
 * cannot be drawn without shipping a Unicode font. The English title
 * directly beneath it carries the same information, so the Hindi line is
 * omitted here rather than rendered as boxes. (Dropping in a Devanagari
 * TTF and setting it for that one line is all it would take to restore it.)
 */
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

function formatDob(value) {
  if (!value) return "—";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

/** Draws one bordered table given column widths and rows of cell text. */
function drawTable(doc, { x, y, widths, rows, headerRow = false, rowHeight = 22, fontSize = 9.5 }) {
  let cursorY = y;

  rows.forEach((row, rowIndex) => {
    const isHeader = headerRow && rowIndex === 0;
    let cursorX = x;

    if (isHeader) {
      const total = widths.reduce((a, b) => a + b, 0);
      doc.save().rect(x, cursorY, total, rowHeight).fill("#f1f5f9").restore();
    }

    row.forEach((cell, colIndex) => {
      const w = widths[colIndex];
      doc.rect(cursorX, cursorY, w, rowHeight).stroke("#0f172a");

      const align = cell && typeof cell === "object" ? cell.align || "left" : "left";
      const text = cell && typeof cell === "object" ? cell.text : cell;
      const bold = isHeader || (cell && typeof cell === "object" && cell.bold);

      // An explicit empty string means "intentionally blank" (the Paper
      // column on the Total row), as opposed to missing data — so it stays
      // empty instead of being rendered as a dash.
      const display = text === "" ? "" : dash(text);

      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fontSize)
        .fillColor("#0f172a")
        .text(display, cursorX + 5, cursorY + (rowHeight - fontSize) / 2 - 1, {
          width: w - 10,
          align,
          lineBreak: false,
          ellipsis: true,
        });

      cursorX += w;
    });

    cursorY += rowHeight;
  });

  return cursorY;
}

/**
 * Writes a single score card into an existing document, starting at the
 * current page. Kept separate from the document lifecycle so a caller can
 * later render many cards into one PDF (one page each) if needed.
 */
function writeScoreCard(doc, card) {
  const { header, identity, candidate, score_card: sc, footer } = card;
  const left = doc.page.margins.left;
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const sessionSuffix = header?.session_name ? ` ${header.session_name}` : "";

  // ---- Letterhead ----
  let y = doc.y;
  if (fs.existsSync(EMBLEM_PATH)) {
    try {
      doc.image(EMBLEM_PATH, left, y, { fit: [56, 56] });
    } catch {
      /* a missing or unreadable emblem must not fail the download */
    }
  }

  doc
    .font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
    .text(header?.authority || "", left + 64, y + 2, { width: contentW - 64, align: "center" });
  doc
    .font("Helvetica-Bold").fontSize(11)
    .text(`(${header?.exam_title_en || ""}${sessionSuffix})`, left + 64, doc.y + 3, {
      width: contentW - 64, align: "center",
    });
  doc
    .font("Helvetica-Bold").fontSize(10.5)
    .text(header?.level_label || "", left + 64, doc.y + 5, { width: contentW - 64, align: "center", underline: true });

  y = Math.max(doc.y + 10, y + 66);
  doc.moveTo(left, y).lineTo(left + contentW, y).lineWidth(1.4).stroke("#0f172a");
  y += 14;

  // ---- District / Block / School / Roll ----
  doc.lineWidth(1);
  const half = contentW / 2;
  const metaLine = (label, value, x, lineY, width) => {
    doc.font("Helvetica-Bold").fontSize(9.5).text(`${label} `, x, lineY, { continued: true, width });
    doc.font("Helvetica").text(dash(value));
  };
  metaLine("District:", identity?.district, left, y, half);
  metaLine("Block:", identity?.block, left + half, y, half);
  y += 16;
  metaLine("Name of School:", identity?.school_name, left, y, half + 40);
  metaLine("Roll No.:", identity?.roll_number, left + half + 40, y, half - 40);
  y += 22;

  // ---- Candidate details ----
  y = drawTable(doc, {
    x: left,
    y,
    widths: [46, contentW * 0.36, contentW - 46 - contentW * 0.36],
    headerRow: true,
    rows: [
      ["S. No.", "Description", "Detail"],
      ["1.", "Candidate's Name", { text: candidate?.candidate_name, bold: true }],
      ["2.", "Father's Name", { text: candidate?.father_name, bold: true }],
      ["3.", "Mother's Name", { text: candidate?.mother_name, bold: true }],
      ["4.", "Date of Birth", { text: formatDob(candidate?.date_of_birth), bold: true }],
      ["5.", "Sex", { text: candidate?.sex, bold: true }],
      ["6.", "Caste", { text: candidate?.caste, bold: true }],
    ],
  });

  // ---- SCORE CARD ----
  y += 16;
  doc.font("Helvetica-Bold").fontSize(11.5)
    .text("SCORE CARD", left, y, { width: contentW, align: "center", underline: true });
  y = doc.y + 8;

  const papers = sc?.papers || [];
  const totals = sc?.totals || {};
  const marksWidths = [40, contentW - 40 - 78 - 86 - 82 - 60, 78, 86, 82, 60];

  y = drawTable(doc, {
    x: left,
    y,
    widths: marksWidths,
    headerRow: true,
    rowHeight: 26,
    fontSize: 9,
    rows: [
      ["S. No.", "Paper", "Maximum Marks", "Weightage (SC/ST only)", "Marks Obtained", "Total"],
      ...papers.map((p) => [
        String(p.sr_no),
        p.paper,
        { text: p.maximum_marks, align: "center" },
        { text: p.weightage, align: "center" },
        { text: p.marks_obtained, align: "center" },
        { text: p.total, align: "center", bold: true },
      ]),
      [
        { text: "Total", align: "right", bold: true },
        "",
        { text: totals.maximum_marks, align: "center", bold: true },
        { text: totals.weightage, align: "center", bold: true },
        { text: totals.marks_obtained, align: "center", bold: true },
        { text: totals.total, align: "center", bold: true },
      ],
    ],
  });

  // ---- Result ----
  y += 18;
  doc.font("Helvetica-Bold").fontSize(11).text("Result: ", left, y, { continued: true });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(
    card.result === "Selected" ? "#15803d" : card.result === "Absent" ? "#a16207" : "#b91c1c"
  ).text(dash(card.result));
  doc.fillColor("#0f172a");

  // ---- Signature + notes ----
  y += 34;
  doc.font("Helvetica-Bold").fontSize(9.5).text("Sd/-", left, y, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(9.5).text(footer?.signatory || "", left, doc.y + 2, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(9.5).text(footer?.authority || "", left, doc.y + 2, { width: contentW, align: "right" });

  y = doc.y + 18;
  doc.moveTo(left, y).lineTo(left + contentW, y).dash(2, { space: 2 }).stroke("#cbd5e1").undash();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("Note: ", left, y, { continued: true });
  doc.font("Helvetica").fontSize(8).text(footer?.note || "");
  if (footer?.validity) doc.font("Helvetica").fontSize(8).text(footer.validity, left, doc.y + 2);
  doc.fillColor("#0f172a");
}

/** Renders one score card to a Buffer. */
async function renderScoreCardPdfBuffer(card) {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 40 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  writeScoreCard(doc, card);
  doc.end();
  return done;
}

module.exports = { renderScoreCardPdfBuffer, writeScoreCard };
