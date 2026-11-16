import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/**
 * Reads a File (PDF) and returns a JPEG Blob of its first page.
 * @param {File} file - The PDF file
 * @returns {Promise<Blob|null>} - The thumbnail image blob
 */
export async function generatePdfThumbnail(file) {
  if (file.type !== 'application/pdf') return null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    
    // Set scale to get a decently sized thumbnail (around ~600px width typically)
    const viewport = page.getViewport({ scale: 1.0 });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    // Convert to Blob
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob failed'));
        }
      }, 'image/jpeg', 0.85);
    });
  } catch (error) {
    console.error('Error generating PDF thumbnail:', error);
    return null;
  }
}
