const PDFDocument = require("pdfkit");

function safeText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function computeXPositions(startX, columns) {
  const xs = [startX];
  for (const c of columns) {
    xs.push(xs[xs.length - 1] + c.width);
  }
  return xs;
}

function drawCell(doc, { x, y, w, h, text, align = "left", bold = false }) {
  const padX = 4;
  const padY = 6;

  doc.rect(x, y, w, h).stroke();

  doc.save();
  doc.rect(x, y, w, h).clip();
  doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  doc.text(safeText(text), x + padX, y + padY, {
    width: Math.max(0, w - padX * 2),
    align,
    lineBreak: true,
  });
  doc.restore();
}

function getRowHeight(doc, { columns, row, bold = false, minHeight = 22 }) {
  const padX = 4;
  const padY = 6;
  const originalFont = bold ? "Helvetica-Bold" : "Helvetica";
  doc.font(originalFont);

  let maxHeight = minHeight;
  for (const c of columns || []) {
    const text = safeText(row?.[c.key] ?? "");
    const textHeight = doc.heightOfString(text, {
      width: Math.max(0, Number(c.width || 0) - padX * 2),
      align: c.align || "left",
      lineBreak: true,
    });
    const cellHeight = Math.ceil(textHeight + padY * 2);
    if (cellHeight > maxHeight) maxHeight = cellHeight;
  }

  return maxHeight;
}

function drawRow(doc, { x, y, columns, row, height, bold = false, fill = null }) {
  const xs = computeXPositions(x, columns);

  if (fill) {
    doc.save();
    doc.fillColor(fill);
    doc.rect(x, y, xs[xs.length - 1] - x, height).fill();
    doc.restore();
  }

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const cellX = xs[i];
    const cellW = c.width;

    drawCell(doc, {
      x: cellX,
      y,
      w: cellW,
      h: height,
      text: row?.[c.key] ?? "",
      align: c.align || "left",
      bold,
    });
  }
}

/**
 * Hands control back to the event loop.
 *
 * PDFKit draws synchronously, so rendering a few thousand rows occupies
 * the worker's single JS thread from start to finish — measured at 764 ms
 * for a 3,468-row export, during which every other request on that worker
 * is frozen. Awaiting setImmediate lets queued I/O callbacks run between
 * batches, so the same work interleaves with normal traffic instead of
 * blocking it. Total render time is unchanged; the freeze is what goes.
 */
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/** Rows drawn between yields. Large enough that the yield overhead stays
 *  negligible, small enough that no single burst is noticeable. */
const ROWS_PER_YIELD = 100;

/**
 * `groups` ([{ rows, totalLabel }]) draws the rows as separate sections
 * instead of one run: each section after the first starts on a new page
 * under a fresh header, and `totalLabel` closes a section with a bold bar
 * the width of the table. Without it the table is one run, as before.
 */
async function drawTable(doc, { columns, rows, totalsRow, groups = null, startX, startY, pageOptions }) {
  const minRowH = 22;
  const minHeaderH = 24;

  let x = startX;
  let y = startY;

  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  const headerRow = {};
  for (const c of columns) headerRow[c.key] = c.label;
  const headerH = getRowHeight(doc, {
    columns,
    row: headerRow,
    bold: true,
    minHeight: minHeaderH,
  });

  const newPage = () => {
    // Always spell out the page setup. A bare addPage() re-uses the
    // options the *document* was created with, so a landscape table
    // whose first page was added explicitly would silently flip back to
    // portrait on the very first page break.
    doc.addPage(pageOptions);
    y = doc.page.margins.top;
    drawRow(doc, { x, y, columns, row: headerRow, height: headerH, bold: true, fill: "#f2f2f2" });
    y += headerH;
  };

  const ensureSpace = (neededHeight) => {
    if (y + neededHeight <= pageBottom()) return;
    newPage();
  };

  const drawDataRows = async (dataRows) => {
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const rowH = getRowHeight(doc, { columns, row: r, bold: false, minHeight: minRowH });
      ensureSpace(rowH);
      drawRow(doc, { x, y, columns, row: r, height: rowH, bold: false });
      y += rowH;

      if ((i + 1) % ROWS_PER_YIELD === 0) await yieldToEventLoop();
    }
  };

  // Header
  drawRow(doc, { x, y, columns, row: headerRow, height: headerH, bold: true, fill: "#f2f2f2" });
  y += headerH;

  if (groups) {
    const tableWidth = columns.reduce((sum, c) => sum + Number(c.width || 0), 0);
    const barColumns = [{ key: "label", width: tableWidth, align: "left" }];
    for (let g = 0; g < groups.length; g++) {
      if (g > 0) newPage();
      await drawDataRows(groups[g].rows || []);
      if (groups[g].totalLabel) {
        const barRow = { label: groups[g].totalLabel };
        const barH = getRowHeight(doc, { columns: barColumns, row: barRow, bold: true, minHeight: minRowH });
        ensureSpace(barH);
        drawRow(doc, { x, y, columns: barColumns, row: barRow, height: barH, bold: true, fill: "#e8e8e8" });
        y += barH;
      }
      await yieldToEventLoop();
    }
    return y;
  }

  // Data rows
  await drawDataRows(rows || []);

  // Totals row
  if (totalsRow) {
    const totalsH = getRowHeight(doc, {
      columns,
      row: totalsRow,
      bold: true,
      minHeight: minRowH,
    });
    ensureSpace(totalsH);
    drawRow(doc, { x, y, columns, row: totalsRow, height: totalsH, bold: true, fill: "#fafafa" });
    y += totalsH;
  }

  return y;
}

/**
 * Renders the table to a Buffer instead of streaming it straight at the
 * response. Having the finished bytes in hand is what lets the caller
 * cache the file and serve repeat downloads without re-rendering.
 */
async function renderTablePdfBuffer(
  { title, metaLines = [], columns, rows, totalsRow, layout = "landscape", bodyFontSize = 10, margin = 36 }
) {
  const pageOptions = { size: "A4", layout, margin };
  const doc = new PDFDocument(pageOptions);

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  await writeDocument(doc, { title, metaLines, columns, rows, totalsRow, bodyFontSize, pageOptions });
  doc.end();
  return finished;
}

/**
 * `prepareDoc` runs immediately after the document is created — the place
 * to registerFont() a Unicode face before anything is drawn.
 *
 * `coverPage` draws a standalone first page (a letterhead/title page);
 * the table then starts on a fresh page after it. The cover can use its
 * own orientation via `coverLayout`, which is how a portrait cover sits
 * in front of a landscape table.
 */
async function sendTablePdf(
  res,
  {
    filename, title, metaLines = [], columns, rows, totalsRow, groups = null,
    layout = "landscape", bodyFontSize = 10, margin = 36,
    prepareDoc = null, coverPage = null, coverLayout = null, titleFont = null,
  }
) {
  // Every table page uses these; the cover is the only page allowed a
  // different orientation, and only when the caller asks for one.
  const pageOptions = { size: "A4", layout, margin };
  const doc = new PDFDocument({
    ...pageOptions,
    layout: coverPage ? (coverLayout || layout) : layout,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

  doc.pipe(res);

  if (prepareDoc) prepareDoc(doc);
  if (coverPage) {
    coverPage(doc);
    doc.addPage(pageOptions);
  }

  await writeDocument(doc, { title, metaLines, columns, rows, totalsRow, groups, bodyFontSize, titleFont, pageOptions });
  doc.end();
}

/** Shared body-drawing used by both the streaming and buffered variants. */
async function writeDocument(
  doc,
  { title, metaLines = [], columns, rows, totalsRow, groups = null, bodyFontSize = 10, titleFont = null, pageOptions = null }
) {
  // Title. `titleFont` names a face registered by the caller — required
  // for a Devanagari title, since the built-in fonts are Latin-only.
  doc.font(titleFont || "Helvetica-Bold").fontSize(14).text(safeText(title), { align: "center" });
  doc.moveDown(0.4);

  // Metadata
  doc.font("Helvetica").fontSize(10);
  for (const line of metaLines) {
    if (!line) continue;
    doc.text(safeText(line), { align: "center" });
  }

  doc.moveDown(0.8);
  // Wide tables (many columns) need a smaller body font to stay legible —
  // this only affects table cells, not the title/metadata already drawn.
  doc.fontSize(bodyFontSize);

  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWidth = (columns || []).reduce(
    (sum, c) => sum + Number(c?.width || 0),
    0
  );
  const normalizedColumns =
    totalWidth > contentWidth && totalWidth > 0
      ? columns.map((c) => ({
          ...c,
          width: (Number(c.width || 0) / totalWidth) * contentWidth,
        }))
      : columns;

  await drawTable(doc, {
    columns: normalizedColumns,
    rows,
    totalsRow,
    groups,
    startX: doc.page.margins.left,
    startY: doc.y,
    pageOptions,
  });
}

module.exports = { sendTablePdf, renderTablePdfBuffer };
