/**
 * Phone cameras produce 3-12 MB photos, and the upload endpoint refuses
 * anything over 5 MB - so a photo taken on a mobile, or a certificate
 * photographed with one, could not be uploaded at all.
 *
 * Large images are re-encoded here as a JPEG no bigger than `maxDimension`
 * on the long side before they are sent. PDFs, small images and anything the
 * browser cannot decode pass through untouched, so the server's own checks
 * still decide those.
 */

const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const UPLOADABLE_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Applies the camera's EXIF rotation, so portrait photos stay upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to <img>, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkImageForUpload(file, { maxDimension = 2000, quality = 0.85 } = {}) {
  if (!(file instanceof Blob)) return file;
  const type = String(file.type || '').toLowerCase();
  if (!type.startsWith('image/')) return file;
  const uploadable = UPLOADABLE_IMAGE_TYPES.includes(type);
  if (uploadable && file.size <= SHRINK_ABOVE_BYTES) return file;

  try {
    const image = await decodeImage(file);
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) return file;

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency: a signature PNG would otherwise turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (typeof image.close === 'function') image.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    if (uploadable && blob.size >= file.size) return file;

    const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** Long-side limits: photo and signature are shown small; certificates must stay readable. */
export const PHOTO_MAX_DIMENSION = 1200;
export const DOCUMENT_MAX_DIMENSION = 2000;
