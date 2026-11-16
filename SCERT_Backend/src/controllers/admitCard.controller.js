const { getAdmitCardData } = require("../services/admitCard.service");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const {
  createAdmitCardQrToken,
  verifyAdmitCardQrToken,
  resolveBaseUrl,
  buildPublicAdmitCardUrl,
  generateQrCodeBuffer,
} = require("../utils/admitCardQr.util");
const { resolveFileDiskPath } = require("../utils/fileUrl.util");

// The SCERT emblem and name printed at the top of every admit card.
const SCERT_EMBLEM_PATH = path.join(__dirname, "..", "assets", "scert-emblem-front.png");
const SCERT_AUTHORITY_NAME = "State Council for Educational Research and Training, Uttarakhand";

const INSTRUCTION_FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/NotoSansDevanagari-Regular.ttf",
  "/System/Library/Fonts/Supplemental/KohinoorDevanagari-Regular.otf",
  "/System/Library/Fonts/Supplemental/Mangal.ttf",
];

const applyInstructionFont = (doc) => {
  for (const fontPath of INSTRUCTION_FONT_CANDIDATES) {
    try {
      if (fs.existsSync(fontPath)) {
        doc.font(fontPath);
        return true;
      }
    } catch {
      // Try next candidate.
    }
  }
  doc.font("Helvetica");
  return false;
};

const buildQrMeta = (req, applicationId, rollNumber) => {
  const token = createAdmitCardQrToken({ applicationId, rollNumber });
  const publicUrl = buildPublicAdmitCardUrl({
    baseUrl: resolveBaseUrl(req),
    applicationId,
    token,
  });
  return { token, publicUrl };
};

const drawQrBlock = async (doc, qrMeta, x, y, size = 100) => {
  doc.rect(x, y, size, size).stroke();
  try {
    const qrBuffer = await generateQrCodeBuffer(qrMeta.publicUrl, size);
    doc.image(qrBuffer, x, y, { fit: [size, size], width: size, height: size });
  } catch {
    doc.fontSize(8).text("QR Unavailable", x, y + size / 2 - 4, {
      width: size,
      align: "center",
    });
  }

  doc.fontSize(8).text("Scan to view", x, y + size + 4, { width: size, align: "center" });
};

const formatDate = (value) => {
  if (!value) return "Not Available";
  const raw = String(value).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
};

const formatDateWithDay = (value) => {
  if (!value) return "Not Available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const datePart = date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const dayPart = date.toLocaleDateString("en-US", { weekday: "long" });
  return `${datePart} (${dayPart})`;
};

const drawKeyValueRow = (doc, {
  x,
  y,
  w,
  h,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  leftValueBold = false,
  rightValueBold = false,
  labelRatio = 0.38,
}) => {
  const halfW = w / 2;
  const labelW = Math.floor(halfW * labelRatio);
  const leftValueW = halfW - labelW;
  const rightValueW = halfW - labelW;

  doc.rect(x, y, w, h).stroke();
  doc.moveTo(x + halfW, y).lineTo(x + halfW, y + h).stroke();
  doc.moveTo(x + labelW, y).lineTo(x + labelW, y + h).stroke();
  doc.moveTo(x + halfW + labelW, y).lineTo(x + halfW + labelW, y + h).stroke();

  doc.font("Helvetica-Bold").fontSize(9).text(leftLabel, x + 4, y + 7, {
    width: labelW - 8,
    align: "left",
  });
  doc.font(leftValueBold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).text(leftValue, x + labelW + 4, y + 7, {
    width: leftValueW - 8,
    align: "left",
  });

  doc.font("Helvetica-Bold").fontSize(9).text(rightLabel, x + halfW + 4, y + 7, {
    width: labelW - 8,
    align: "left",
  });
  doc.font(rightValueBold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).text(rightValue, x + halfW + labelW + 4, y + 7, {
    width: rightValueW - 8,
    align: "left",
  });
};

const renderAdmitCardTemplate = async (doc, data, qrMeta) => {
  const pageWidth = doc.page.width;
  const margin = 28;
  const contentW = pageWidth - margin * 2;
  let y = margin;

  const scholarshipName = String(data.scholarship_name || "").trim();
  const examDateFormatted = formatDate(data?.exam?.date);
  const examDateWithDay = formatDateWithDay(data?.exam?.date);
  const sessionLabel = String(data.session_name || "").trim() || "N/A";
  const studentClass = String(data.student_class || "").trim() || "N/A";
  const scholarshipNameLower = scholarshipName.toLowerCase();
  const isNmmss =
    scholarshipNameLower.includes("nmmss") ||
    scholarshipNameLower.includes("snss") ||
    scholarshipNameLower.includes("ssss");

  // Letterhead: the SCERT name across the top, the emblem at the left. The
  // emblem sits beside the heading lines below, so the rest of the card - which
  // is laid out to fill the page down to the instructions - moves by one line only.
  const emblemSize = 54;
  const emblemGutter = emblemSize + 8;
  if (fs.existsSync(SCERT_EMBLEM_PATH)) {
    try {
      doc.image(SCERT_EMBLEM_PATH, margin, y, { fit: [emblemSize, emblemSize] });
    } catch {
      /* a missing or unreadable emblem must not fail the download */
    }
  }
  doc.font("Helvetica-Bold").fontSize(10.5).text(SCERT_AUTHORITY_NAME, margin, y + 2, {
    width: contentW,
    align: "center",
  });
  y += 16;

  // The scholarship name stays clear of the emblem: it shrinks (to 11pt at
  // most) rather than wrapping, since the lines below are placed by fixed steps.
  const headingW = contentW - emblemGutter * 2;
  let headingSize = 16;
  doc.font("Helvetica-Bold").fontSize(headingSize);
  while (headingSize > 11 && doc.widthOfString(scholarshipName) > headingW) {
    headingSize -= 0.5;
    doc.fontSize(headingSize);
  }
  doc.font("Helvetica-Bold").fontSize(headingSize).text(scholarshipName, margin + emblemGutter, y, {
    width: headingW,
    align: "center",
    lineBreak: false,
  });
  y += 20;
  doc.font("Helvetica").fontSize(11).text(`Admit Card`, margin, y, {
    width: contentW,
    align: "center",
  });
  y += 15;
  const metaLine = isNmmss
    ? `Session: ${sessionLabel}  |  Exam Date: ${examDateFormatted}`
    : `Session: ${sessionLabel}  |  Class: ${studentClass}  |  Exam Date: ${examDateFormatted}`;
  doc.font("Helvetica").fontSize(10).text(metaLine, margin, y, {
    width: contentW,
    align: "center",
  });
  y += 18;

  const infoTableX = margin;
  const infoTableW = contentW - 120;
  const photoPanelW = 120;
  const infoRowH = 24;

  const infoRows = [
    ["Roll Number", String(data.roll_number || "Not Assigned"), "Application ID", String(data.application_display_id || "Not Available")],
    ["Candidate Name", String(data.student?.name || "Not Available"), "Father's Name", String(data.student?.father_name || "Not Available")],
    ["Gender", String(data.student?.sex || "Not Available"), "Date of Birth", formatDate(data.student?.date_of_birth)],
    [
      "Category",
      String(data.student?.caste_category || "Not Available"),
      data.eligibility ? "Eligibility" : "",
      data.eligibility ? String(data.eligibility) : "",
    ],
  ];

  infoRows.forEach((row, idx) => {
    const isRollNumberRow = String(row[0]) === "Roll Number";
    drawKeyValueRow(doc, {
      x: infoTableX,
      y: y + idx * infoRowH,
      w: infoTableW,
      h: infoRowH,
      leftLabel: row[0],
      leftValue: row[1],
      rightLabel: row[2],
      rightValue: row[3],
      leftValueBold: isRollNumberRow,
    });
  });

  const photoX = infoTableX + infoTableW;
  const photoY = y;
  const photoH = infoRowH * infoRows.length;
  doc.rect(photoX, photoY, photoPanelW, photoH).stroke();
  doc.font("Helvetica-Bold").fontSize(9).text("Photograph", photoX, photoY + 5, {
    width: photoPanelW,
    align: "center",
  });

  if (data.student?.photo_disk_path && fs.existsSync(data.student.photo_disk_path)) {
    try {
      doc.image(data.student.photo_disk_path, photoX + 10, photoY + 22, {
        fit: [photoPanelW - 20, photoH - 30],
        width: photoPanelW - 20,
        height: photoH - 30,
        align: "center",
        valign: "center",
      });
    } catch {
      doc.font("Helvetica").fontSize(8).text("Photo unavailable", photoX, photoY + photoH / 2, {
        width: photoPanelW,
        align: "center",
      });
    }
  } else {
    doc.font("Helvetica").fontSize(8).text("Photo unavailable", photoX, photoY + photoH / 2, {
      width: photoPanelW,
      align: "center",
    });
  }

  y += photoH + 10;

  const schoolRowH = 22;
  doc.rect(margin, y, contentW, schoolRowH).stroke();
  doc.moveTo(margin + 170, y).lineTo(margin + 170, y + schoolRowH).stroke();
  doc.font("Helvetica-Bold").fontSize(9).text("School", margin + 5, y + 6, { width: 160 });
  doc.font("Helvetica").fontSize(9).text(String(data.school?.name || "Not Available"), margin + 175, y + 6, {
    width: contentW - 180,
  });
  y += schoolRowH + 10;

  const qrSize = 65;
  const qrPanelW = 170;
  const leftTableW = contentW - qrPanelW;
  const qrX = margin + leftTableW + (qrPanelW - qrSize) / 2;
  const qrY = y + 8;

  const detailRows = [
    ["District", String(data.school?.district || "Not Available")],
    ["Block", String(data.school?.block || "Not Available")],
    // ["paper I - MAT", String(data.exam?.mat_time || "Not Available")],
    // ["paper II - SAT", String(data.exam?.sat_time || "Not Available")],
    ["Examination Centre Name", String(data.center?.name || "Not Available")],
    ["Center Address", String(data.center?.address || "Not Available")],
  ];

  const detailStartY = y;
  const qrSpanRows = 4;

  detailRows.forEach(([label, value], rowIndex) => {
    const rowH = 22;
    const labelW = 170;
    const hasQrColumn = rowIndex < qrSpanRows;
    doc.rect(margin, y, hasQrColumn ? contentW : leftTableW, rowH).stroke();
    doc.moveTo(margin + labelW, y).lineTo(margin + labelW, y + rowH).stroke();
    if (hasQrColumn) {
      doc.moveTo(margin + leftTableW, y).lineTo(margin + leftTableW, y + rowH).stroke();
    }
    const isExamCenterNameRow = String(label) === "Examination Centre Name";
    doc.font("Helvetica-Bold").fontSize(9).text(label, margin + 5, y + 6, { width: labelW - 10 });
    doc.font(isExamCenterNameRow ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(value, margin + labelW + 5, y + 6, {
      width: leftTableW - labelW - 10,
    });
    y += rowH;
  });

  // Merge QR into the table as a dedicated cell spanning top detail rows.
  const qrCellX = margin + leftTableW;
  const qrCellY = detailStartY;
  const qrCellH = 22 * qrSpanRows;
  doc.rect(qrCellX + 1, qrCellY + 1, qrPanelW - 2, qrCellH - 2).fill("#ffffff");
  doc.fill("#000000");
  doc.rect(qrCellX, qrCellY, qrPanelW, qrCellH).stroke();

  try {
    const qrBuffer = await generateQrCodeBuffer(qrMeta.publicUrl, qrSize);
    doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize], width: qrSize, height: qrSize });
  } catch {
    doc.fontSize(8).text("QR Unavailable", qrX, qrY + qrSize / 2 - 4, {
      width: qrSize,
      align: "center",
    });
  }
  doc.fontSize(8).text("Scan to view", qrCellX, qrCellY + qrCellH - 12, {
    width: qrPanelW,
    align: "center",
  });

  y += 24;
  doc.font("Helvetica-Bold").fontSize(10).text("Sd/-\nExam Controller\nSCERT Uttarakhand", margin, y, {
    width: contentW,
    align: "right",
  });
  y += 45;

  doc.font("Helvetica-Oblique").fontSize(9).text("Note: The admit card has been generated electronically, hence does not require any signature.", margin, y, {
    width: contentW,
    align: "center",
  });
  y += 18;

  const instructionsText = String(data?.exam?.instructions || "").trim();
  if (instructionsText) {
    if (y + 80 > doc.page.height - margin) {
      doc.addPage();
      y = margin;
    }
    
    // Support image upload for instructions to perfectly preserve Hindi & Figures
    if (instructionsText.startsWith("/api/uploads/") || instructionsText.startsWith("/uploads/") || instructionsText.startsWith("cms-private/")) {
      
      const imagePaths = instructionsText.split(',').map(p => p.trim()).filter(Boolean);


      
      for (let i = 0; i < imagePaths.length; i++) {
        const diskPath = resolveFileDiskPath(imagePaths[i]);
        let imgObj = null;
        
        if (diskPath && fs.existsSync(diskPath)) {
          try {
            imgObj = doc.openImage(diskPath);
          } catch (err) {
            // invalid image
          }
        }

        if (imgObj) {
           if (i === 0) {
             const availableHeight = doc.page.height - margin - y - 10;
             try {
               doc.image(imgObj, margin, y, {
                 width: contentW,
                 height: availableHeight > 50 ? availableHeight : 50,
                 align: "center"
               });
             } catch(err) {}
           } else {
             // Subsequent images go on fresh pages and expand to fit the full page size
             doc.addPage();
             const newPageAvailableHeight = doc.page.height - 2 * margin;
             try {
               doc.image(imgObj, margin, margin, {
                 fit: [contentW, newPageAvailableHeight],
                 align: "center",
                 valign: "top"
               });
             } catch(err) {}
           }
        }
      }
    } else {
      applyInstructionFont(doc);

      doc.fontSize(9).text(instructionsText, margin, y, {
        width: contentW,
        lineGap: 2,
        align: "left",
      });
    }
  }
};

/**
 * 🎟️ GET ADMIT CARD (JSON)
 */
exports.getAdmitCard = async (req, res) => {
  try {
    const data = await getAdmitCardData(
      req.params.application_id,
      req.user
    );

    const qrMeta = buildQrMeta(req, req.params.application_id, data.roll_number);

    res.json({
      ...data,
      qr_url: qrMeta.publicUrl,
      qr_token: qrMeta.token,
    });
  } catch (err) {
    if (err.message === "Forbidden") {
      return res.status(403).json({ message: "Access denied" });
    }
    res.status(400).json({ message: err.message });
  }
};

/**
 * 📄 GET ADMIT CARD (PDF)
 */
exports.getAdmitCardPdf = async (req, res) => {
  try {
    const applicationId = req.params.application_id;
    const data = await getAdmitCardData(
      req.params.application_id,
      req.user
    );
    const qrMeta = buildQrMeta(req, applicationId, data.roll_number);

    const doc = new PDFDocument({ size: "A4", margin: 24 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=admit_card_${data.roll_number}.pdf`
    );

    doc.pipe(res);
    await renderAdmitCardTemplate(doc, data, qrMeta);
    doc.end();
  } catch (err) {
    if (err.message === "Forbidden") {
      return res.status(403).json({ message: "Access denied" });
    }
    res.status(400).json({ message: err.message });
  }
};




/**
 * 📄 DOWNLOAD ADMIT CARD (PDF)
 */
exports.downloadAdmitCard = async (req, res) => {
  try {
    const applicationId = req.params.application_id;
    const data = await getAdmitCardData(applicationId, req.user);
    const qrMeta = buildQrMeta(req, applicationId, data.roll_number);
    const doc = new PDFDocument({ size: "A4", margin: 24 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=admit_card_${data.roll_number}.pdf`
    );

    const stream = doc.pipe(res);
    stream.on("error", (err) => {
      console.error("Stream error:", err);
    });
    await renderAdmitCardTemplate(doc, data, qrMeta);
    doc.end();
  } catch (err) {
    console.error("Admit card download error:", err);

    if (!res.headersSent) {
      if (err.message === "Forbidden") {
        return res.status(403).json({ message: "Access denied" });
      }
      return res.status(400).json({ message: err.message });
    }
  }
};

/**
 * 🌐 PUBLIC ADMIT CARD (token verified for QR scan)
 */
exports.getPublicAdmitCardPdf = async (req, res) => {
  try {
    const applicationId = req.params.application_id;
    const token = String(req.query?.token || "");

    const data = await getAdmitCardData(
      applicationId,
      { role_id: 5, user_id: 0 },
      { skipAccessCheck: true }
    );

    const valid = verifyAdmitCardQrToken({
      token,
      applicationId,
      rollNumber: data.roll_number,
    });
    if (!valid) {
      return res.status(401).json({ message: "Invalid QR token" });
    }

    const doc = new PDFDocument({ size: "A4", margin: 24 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=admit_card_${data.roll_number}.pdf`
    );
    doc.pipe(res);
    const qrMeta = buildQrMeta(req, applicationId, data.roll_number);
    await renderAdmitCardTemplate(doc, data, qrMeta);
    doc.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(400).json({ message: err.message });
    }
  }
};
