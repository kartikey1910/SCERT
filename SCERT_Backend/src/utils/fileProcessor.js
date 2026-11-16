const jimpModule = require("jimp");
const { PDFDocument } = require("pdf-lib");

const Jimp = jimpModule.Jimp || jimpModule;

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB

function getImageWidth(image) {
  return image?.bitmap?.width || image?.getWidth?.() || 0;
}

function getImageHeight(image) {
  return image?.bitmap?.height || image?.getHeight?.() || 0;
}

function resizeImage(image, maxWidth) {
  const width = getImageWidth(image);
  const height = getImageHeight(image);

  if (!width || !height || width <= maxWidth) {
    return image;
  }

  const ratio = maxWidth / width;
  const nextHeight = Math.max(1, Math.round(height * ratio));

  if (typeof image.resize === "function") {
    const resized = image.resize({ w: maxWidth, h: nextHeight });
    return resized || image;
  }

  return image;
}

function getBuffer(image, mimeType) {
  if (typeof image.getBufferAsync === "function") {
    return image.getBufferAsync(mimeType);
  }

  return new Promise((resolve, reject) => {
    image.getBuffer(mimeType, (err, output) => {
      if (err) return reject(err);
      resolve(output);
    });
  });
}

async function processImage(buffer, mimeType) {
  const input = await Jimp.read(buffer);
  const isPng = mimeType.includes("png");
  const outputMime = isPng ? "image/png" : "image/jpeg";
  const initialWidth = Math.min(getImageWidth(input) || 2000, 2000);
  let width = initialWidth;
  let quality = 80;
  let attempts = 0;
  let outputBuffer = buffer;

  while (outputBuffer.length > MAX_FILE_SIZE && attempts < 8) {
    const working = input.clone();
    resizeImage(working, width);

    if (!isPng && typeof working.quality === "function") {
      working.quality(quality);
    }

    if (isPng && typeof working.deflateLevel === "function") {
      working.deflateLevel(9);
    }

    outputBuffer = await getBuffer(working, outputMime);

    if (!isPng && quality > 40) {
      quality -= 10;
    } else {
      width = Math.max(640, Math.floor(width * 0.85));
    }

    attempts += 1;
  }

  return outputBuffer;
}

async function processPdf(buffer) {
  const pdfDoc = await PDFDocument.load(buffer);

  const compressed = await pdfDoc.save({
    useObjectStreams: true,
    compress: true,
  });

  return Buffer.from(compressed);
}

async function normalizeFile(buffer, mimeType) {
  if (buffer.length <= MAX_FILE_SIZE) {
    return buffer;
  }

  if (mimeType.startsWith("image/")) {
    return await processImage(buffer, mimeType);
  }

  if (mimeType === "application/pdf") {
    return await processPdf(buffer);
  }

  throw new Error("Unsupported file type for compression");
}

module.exports = {
  normalizeFile,
  MAX_FILE_SIZE,
};
