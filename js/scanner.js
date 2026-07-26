// Barcode scanning: reads EAN-13 ISBN barcodes from a live camera feed or
// from a still photo. Uses the native BarcodeDetector API where available
// (Chrome, Edge, Android) and falls back to the ZXing library (loaded on
// demand from a CDN) elsewhere (Firefox, Safari).

const ISBN_FORMATS = ["ean_13", "ean_8", "upc_a"];

let zxingReaderPromise = null;

function nativeDetectorSupported() {
  return "BarcodeDetector" in window;
}

async function getZxingReader() {
  if (!zxingReaderPromise) {
    zxingReaderPromise = import(
      "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm"
    ).then((mod) => new mod.BrowserMultiFormatReader());
  }
  return zxingReaderPromise;
}

function looksLikeIsbn(code) {
  return /^97[89]\d{10}$/.test(code) || /^\d{9}[\dX]$/.test(code);
}

// ---------- Still photo ----------

// Detect every ISBN barcode in an image file. Returns unique ISBN strings.
// A photo of a stack of books can yield several.
export async function scanImageFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    if (nativeDetectorSupported()) {
      const detector = new BarcodeDetector({ formats: ISBN_FORMATS });
      const results = await detector.detect(bitmap);
      const codes = results.map((r) => r.rawValue).filter(looksLikeIsbn);
      if (codes.length) return [...new Set(codes)];
    }
  } catch { /* fall through to ZXing */ }

  // ZXing decodes one code per image; try the full frame, then halves,
  // so a two-book photo still has a chance.
  const found = new Set();
  const reader = await getZxingReader();
  for (const region of imageRegions(bitmap)) {
    try {
      const result = await reader.decodeFromCanvas(region);
      const code = result?.getText?.();
      if (code && looksLikeIsbn(code)) found.add(code);
    } catch { /* no code in this region */ }
  }
  return [...found];
}

function* imageRegions(bitmap) {
  const full = document.createElement("canvas");
  full.width = bitmap.width;
  full.height = bitmap.height;
  full.getContext("2d").drawImage(bitmap, 0, 0);
  yield full;

  for (const [sx, sy, sw, sh] of [
    [0, 0, bitmap.width, bitmap.height / 2],
    [0, bitmap.height / 2, bitmap.width, bitmap.height / 2],
    [0, 0, bitmap.width / 2, bitmap.height],
    [bitmap.width / 2, 0, bitmap.width / 2, bitmap.height],
  ]) {
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    yield c;
  }
}

// ---------- Live camera ----------

let activeStream = null;
let scanLoopId = null;
let zxingControls = null;

// Start a live scan on the given <video>. Calls onCode(isbn) once per
// detected code. Returns a stop() function.
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
    if (nativeDetectorSupported()) {
      activeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      videoEl.srcObject = activeStream;
      await videoEl.play();

      const detector = new BarcodeDetector({ formats: ISBN_FORMATS });
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
      const reader = await getZxingReader();
      zxingControls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
        if (result) report(result.getText());
      });
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
  if (zxingControls) {
    zxingControls.stop();
    zxingControls = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
  if (videoEl) videoEl.srcObject = null;
}
