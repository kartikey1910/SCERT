const crypto = require("crypto");
const QRCode = require("qrcode");

const ADMIT_QR_TOKEN_VERSION = 1;

const base64UrlEncode = (value) =>
  Buffer.from(value, "utf8").toString("base64url");

const base64UrlDecode = (value) =>
  Buffer.from(value, "base64url").toString("utf8");

const getQrSecret = () => {
  const secret =
    process.env.ADMIT_CARD_QR_SECRET ||
    process.env.JWT_SECRET ||
    "";
  if (!secret) {
    throw new Error("QR secret is not configured");
  }
  return secret;
};

const sign = (payloadEncoded) =>
  crypto
    .createHmac("sha256", getQrSecret())
    .update(payloadEncoded)
    .digest("base64url");

const createAdmitCardQrToken = ({ applicationId, rollNumber }) => {
  const payload = {
    v: ADMIT_QR_TOKEN_VERSION,
    a: String(applicationId),
    r: String(rollNumber || ""),
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
};

const verifyAdmitCardQrToken = ({ token, applicationId, rollNumber }) => {
  if (!token || typeof token !== "string") return false;

  const [payloadEncoded, providedSignature] = token.split(".");
  if (!payloadEncoded || !providedSignature) return false;

  const expectedSignature = sign(payloadEncoded);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return false;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded));
  } catch {
    return false;
  }

  if (Number(payload?.v) !== ADMIT_QR_TOKEN_VERSION) return false;
  if (String(payload?.a) !== String(applicationId)) return false;
  if (String(payload?.r || "") !== String(rollNumber || "")) return false;
  return true;
};

const resolveBaseUrl = (req) => {
  const configured = String(process.env.APP_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (!req) return "http://localhost:4000";
  const proto =
    (req.headers["x-forwarded-proto"] || req.protocol || "http")
      .toString()
      .split(",")[0]
      .trim();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
};

const buildPublicAdmitCardUrl = ({ baseUrl, applicationId, token }) => {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  const qs = new URLSearchParams({ token });
  return `${root}/api/public/admit-cards/${applicationId}/pdf?${qs.toString()}`;
};

const generateQrCodeBuffer = async (publicUrl, size = 180) =>
  QRCode.toBuffer(String(publicUrl || ""), {
    type: "png",
    width: size,
    margin: 0,
    errorCorrectionLevel: "M",
  });

module.exports = {
  createAdmitCardQrToken,
  verifyAdmitCardQrToken,
  resolveBaseUrl,
  buildPublicAdmitCardUrl,
  generateQrCodeBuffer,
};
