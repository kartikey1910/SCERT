function generateRollNumber({
  scholarship_id,
  scholarship_name,
  exam_code,
  classValue,
  district_code,
  block_code,
  center_order,
  app_serial_no,
}) {
  const scholarshipNameLower = String(scholarship_name || "").toLowerCase();
  const isNmmssScheme =
    Number(scholarship_id) === 6 ||
    /\bnmmss\b/i.test(scholarshipNameLower) ||
    /\bnmms\b/i.test(scholarshipNameLower) ||
    /snss/i.test(scholarshipNameLower) ||
    /ssss/i.test(scholarshipNameLower);

  let firstDigit;

  if (isNmmssScheme) {
    const normalizedExamCode = Number(exam_code);
    if (!Number.isFinite(normalizedExamCode) || ![1, 2].includes(normalizedExamCode)) {
      throw new Error("Invalid exam code for NMMSS scheme");
    }
    firstDigit = normalizedExamCode;
  } else {
    firstDigit = classValue;
  }

  const rollNumber =
    String(firstDigit) +
    String(district_code).padStart(2, "0") +
    String(block_code).padStart(2, "0") +
    String(center_order) +
    String(app_serial_no).padStart(4, "0");

  if (rollNumber.length !== 10) {
    throw new Error("Invalid roll number generated");
  }

  return rollNumber;
}

module.exports = { generateRollNumber };
