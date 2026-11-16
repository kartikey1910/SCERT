const ExcelJS = require("exceljs");

/**
 * Streams a columns+rows table as an .xlsx download. Mirrors the shape of
 * pdfTable.util.js's sendTablePdf so the same { columns, rows } the caller
 * builds for the PDF can be reused for the spreadsheet.
 *
 * @param {object} opts
 * @param {string} opts.filename
 * @param {string} opts.sheetName
 * @param {{key:string, label:string, width?:number}[]} opts.columns - width
 *   here is in Excel character-width units, not PDF points.
 * @param {object[]} opts.rows
 * @param {string} [opts.titleRow] - optional banner merged across every
 *   column above the header, as the department's published templates use.
 *   Unicode (including Devanagari) needs no special handling here: XLSX
 *   stores text directly, unlike PDF which must embed a matching font.
 */
function buildWorkbook({ sheetName = "Sheet1", columns, rows, titleRow = null }) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));

  worksheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width || 16,
  }));

  // Setting `columns` puts headers on row 1. A title has to sit above
  // them, so it is spliced in and the header row shifts down to row 2.
  const headerRowNumber = titleRow ? 2 : 1;
  if (titleRow) {
    worksheet.spliceRows(1, 0, []);
    const banner = worksheet.getRow(1);
    banner.getCell(1).value = titleRow;
    worksheet.mergeCells(1, 1, 1, columns.length);
    banner.font = { bold: true, size: 13 };
    banner.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    banner.height = 34;
  }

  worksheet.getRow(headerRowNumber).font = { bold: true };
  worksheet.getRow(headerRowNumber).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  worksheet.views = [{ state: "frozen", ySplit: headerRowNumber }];

  for (const row of rows || []) {
    worksheet.addRow(row);
  }

  return workbook;
}

async function sendTableXlsx(res, { filename, sheetName = "Sheet1", columns, rows, titleRow = null }) {
  const workbook = buildWorkbook({ sheetName, columns, rows, titleRow });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

  await workbook.xlsx.write(res);
  res.end();
}

/**
 * Renders the workbook to a Buffer rather than streaming it, so the
 * caller can cache the bytes and serve repeat downloads without
 * rebuilding the spreadsheet.
 */
async function renderTableXlsxBuffer({ sheetName = "Sheet1", columns, rows, titleRow = null }) {
  const workbook = buildWorkbook({ sheetName, columns, rows, titleRow });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { sendTableXlsx, renderTableXlsxBuffer };
