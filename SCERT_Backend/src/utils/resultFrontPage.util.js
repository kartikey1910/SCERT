/**
 * Cover page for the Selected Students PDF.
 *
 * Reproduces `Front Page for Result pdf cm 2026.docx`: the SCERT emblem
 * and Uttarakhand state logo side by side, the scheme name in Hindi and
 * English, the level, "परीक्षाफल (Result)", the exam date and the issuing
 * office.
 *
 * DEVANAGARI: PDFKit's built-in fonts are Latin-only — Hindi drawn with
 * them comes out as blank boxes. A Unicode Devanagari font therefore has
 * to be shipped with the app. Drop an OFL-licensed TTF (Noto Sans
 * Devanagari is the usual choice) at the path below and every Hindi line
 * renders; without it the page falls back to English-only wording rather
 * than printing garbage, so the export keeps working either way.
 *
 *   src/assets/fonts/NotoSansDevanagari-Regular.ttf
 *
 * The same applies to the Hindi title row inside the table; the Excel
 * export has no such limitation, since XLSX stores Unicode text directly.
 */

const path = require("path");
const fs = require("fs");

const ASSETS = path.join(__dirname, "..", "assets");
const SCERT_LOGO = path.join(ASSETS, "scert-emblem-front.png");
const STATE_LOGO = path.join(ASSETS, "uk-state-logo.png");
const DEVANAGARI_FONT = path.join(ASSETS, "fonts", "NotoSansDevanagari-Regular.ttf");

const HINDI_FONT_KEY = "Devanagari";

/**
 * Whether the Devanagari TTF is present, without needing a document.
 * Callers decide the title text before the PDF exists, so the check and
 * the registration are separate steps.
 */
function isDevanagariAvailable() {
  return fs.existsSync(DEVANAGARI_FONT);
}

/** Registers the face on a document. Safe to call when the font is absent. */
function registerDevanagari(doc) {
  if (!isDevanagariAvailable()) return false;
  try {
    doc.registerFont(HINDI_FONT_KEY, DEVANAGARI_FONT);
    return true;
  } catch {
    return false;
  }
}

/**
 * Draws the cover page into the current page of `doc`.
 *
 * @param {object} opts
 * @param {string} opts.classValue      "6" or "9"
 * @param {string} [opts.sessionName]   e.g. "2026-27"
 * @param {string} [opts.examDate]      e.g. "7 July 2026"
 * @param {boolean} [opts.hindiAvailable]  result of registerDevanagari()
 */
function drawFrontPage(doc, { classValue, sessionName, examDate, hindiAvailable }) {
  const left = doc.page.margins.left;
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const centre = { width: contentW, align: "center" };

  const isNine = String(classValue) === "9";
  const levelHi = isNine ? "माध्यमिक स्तर (कक्षा-9)" : "जूनियर स्तर (कक्षा-6)";
  // The source document labels the class-6 page "Junior Level (Class-9)";
  // that is a typo in the template, so the class number is derived here.
  const levelEn = isNine ? "Secondary Level (Class-9)" : "Junior Level (Class-6)";

  let y = doc.page.margins.top + 20;

  // ---- Logos, side by side ----
  const logoH = 86;
  const gap = 70;
  const scertW = 78;
  const stateW = 92;
  const pairW = scertW + gap + stateW;
  const pairX = left + (contentW - pairW) / 2;

  for (const [file, x, w] of [
    [SCERT_LOGO, pairX, scertW],
    [STATE_LOGO, pairX + scertW + gap, stateW],
  ]) {
    if (!fs.existsSync(file)) continue;
    try {
      doc.image(file, x, y, { fit: [w, logoH], align: "center" });
    } catch {
      /* a missing or unreadable logo must not fail the download */
    }
  }
  y += logoH + 40;

  const hindiLine = (text, size) => {
    if (!hindiAvailable) return;
    doc.font(HINDI_FONT_KEY).fontSize(size).fillColor("#0f172a").text(text, left, y, centre);
    y = doc.y + 6;
  };
  const latinLine = (text, size, bold = true) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor("#0f172a")
      .text(text, left, y, centre);
    y = doc.y + 6;
  };

  hindiLine("मुख्यमंत्री मेधावी छात्र प्रोत्साहन छात्रवृति योजना", 20);
  hindiLine(levelHi, 16);
  y += 6;

  latinLine("Chief Minister Meritorious Student Incentive Scholarship Scheme", 15);
  latinLine(levelEn, 13);
  y += 26;

  // ---- Result banner ----
  if (hindiAvailable) {
    hindiLine(`परीक्षाफल (Result) - ${sessionName || ""}`.trim(), 18);
  } else {
    latinLine(`Result - ${sessionName || ""}`.trim(), 17);
  }
  y += 10;

  if (examDate) latinLine(`Exam held on ${examDate}`, 12, false);

  // ---- Issuing office, near the foot ----
  const footY = doc.page.height - doc.page.margins.bottom - 70;
  y = Math.max(y + 40, footY);
  latinLine("Scholarship Cell, SCERT Uttarakhand", 13);
  latinLine("Nanoorkheda, Dehradun", 12, false);
}

module.exports = {
  drawFrontPage,
  registerDevanagari,
  isDevanagariAvailable,
  HINDI_FONT_KEY,
  DEVANAGARI_FONT,
};
