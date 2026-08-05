// Barcode scanning: reads EAN-13 ISBN barcodes from a still photo or a live
// camera feed.
//
// Two readers, used together rather than one as a fallback for the other:
//
//   · The platform's own BarcodeDetector (Chrome, Edge, Android), where it
//     exists. Fast and well tuned, but it reports what it happens to see in
//     one look — on a photo of a whole pile it typically returns two or three.
//   · Our own reader in ean13.js, which sweeps the picture line by line and
//     collects *every* barcode it crosses.
//
// The photo path runs both and merges the results, so a shot of eight books
// adds eight books. Nothing is fetched from a CDN: the app keeps working with
// no connection, which matters for a scanner you might be using in a room with
// bad signal, and it costs nothing to run.

import { readBarcodes, greyscaleFrom, sharpen } from "./ean13.js";

const ISBN_FORMATS = ["ean_13", "ean_8", "upc_a"];

// Phone photos are big; this is the working size for the still-photo pass.
// Book barcodes are physically small, so a shelf shot can put a whole symbol
// in a couple of hundred pixels — throwing resolution away loses books.
const MAX_WORKING_EDGE = 4000;

function looksLikeIsbn(code) {
  return /^97[89]\d{10}$/.test(code) || /^\d{9}[\dX]$/.test(code);
}

let nativeDetector; // undefined = untried, null = unavailable

async function getNativeDetector() {
  if (nativeDetector !== undefined) return nativeDetector;
  nativeDetector = null;
  try {
    if ("BarcodeDetector" in window) {
      // Having the constructor doesn't mean having these formats.
      const supported = await BarcodeDetector.getSupportedFormats();
      const formats = ISBN_FORMATS.filter((f) => supported.includes(f));
      if (formats.length) nativeDetector = new BarcodeDetector({ formats });
    }
  } catch {
    nativeDetector = null;
  }
  return nativeDetector;
}

async function nativeCodes(source) {
  try {
    const detector = await getNativeDetector();
    if (!detector) return [];
    const results = await detector.detect(source);
    return results.map((r) => r.rawValue).filter(looksLikeIsbn);
  } catch {
    return []; // unsupported source, or the frame wasn't ready
  }
}

// ---------- Still photo ----------

// Browsers disagree about what they can turn into an ImageBitmap — Safari has
// historically balked at HEIC, which is exactly what an iPhone hands over. An
// <img> decodes anything the browser can display, so fall back to that rather
// than telling someone their own camera roll is unreadable.
async function loadImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, release: () => bitmap.close?.() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, release: () => URL.revokeObjectURL(url) };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }
}

/**
 * Find every ISBN barcode in an image file. Returns unique ISBN strings — a
 * photo of a stack of books yields one per book.
 */
export async function scanImageFile(file) {
  const { source, release } = await loadImage(file);
  try {
    const found = new Set();
    const add = (codes) => codes.forEach((c) => found.add(c));

    add(await nativeCodes(source));

    const { grey, width, height } = greyscaleFrom(source, MAX_WORKING_EDGE);
    add(readBarcodes(grey, width, height));

    // A softly focused photo loses its narrow bars to blur. Sharpening brings
    // them back, and it finds books the first pass missed often enough to be
    // worth running every time rather than only as a rescue.
    add(readBarcodes(sharpen(grey, width, height, 1.5), width, height));

    // Nothing at all? One more go, harder, before giving up on the picture.
    if (!found.size) add(readBarcodes(sharpen(grey, width, height, 2.6), width, height));

    return [...found];
  } finally {
    release();
  }
}

// ---------- Live camera ----------

let activeStream = null;
let scanLoopId = null;
let scanTimerId = null;

/**
 * Start a live scan on the given <video>. Calls onCode(isbn) once per distinct
 * code seen. Returns a stop() function.
 */
export async function startLiveScan(videoEl, onCode, onError) {
  stopLiveScan(videoEl);
  const reported = new Set();
  const report = (code) => {
    if (code && looksLikeIsbn(code) && !reported.has(code)) {
      reported.add(code);
      onCode(code);
    }
  };

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = activeStream;
    await videoEl.play();

    const detector = await getNativeDetector();

    if (detector) {
      const tick = async () => {
        if (!activeStream) return;
        try {
          const results = await detector.detect(videoEl);
          results.forEach((r) => report(r.rawValue));
        } catch { /* frame not ready */ }
        scanLoopId = requestAnimationFrame(tick);
      };
      scanLoopId = requestAnimationFrame(tick);
    } else {
      // Our own reader, on a timer rather than every frame: a pass costs a few
      // milliseconds at video size, and there's no point scanning faster than
      // a hand can hold a book still.
      const tick = () => {
        if (!activeStream) return;
        if (videoEl.readyState >= 2) {
          try {
            const { grey, width, height } = greyscaleFrom(videoEl, 1280);
            readBarcodes(grey, width, height, { angles: [0, 90] }).forEach(report);
          } catch { /* frame not ready */ }
        }
        scanTimerId = setTimeout(tick, 120);
      };
      scanTimerId = setTimeout(tick, 120);
    }
  } catch (err) {
    onError?.(err);
  }

  return () => stopLiveScan(videoEl);
}

export function stopLiveScan(videoEl) {
  if (scanLoopId) {
    cancelAnimationFrame(scanLoopId);
    scanLoopId = null;
  }
  if (scanTimerId) {
    clearTimeout(scanTimerId);
    scanTimerId = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
  if (videoEl) videoEl.srcObject = null;
}
