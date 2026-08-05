// EAN-13 / UPC-A barcode reading, from scratch and offline.
//
// Why not a library? The one thing the shelf photo needs — "give me *every*
// barcode in this picture" — is the one thing the browser barcode libraries
// don't offer: they decode an image and hand back a single result, so a photo
// of eight books adds one book. Scanning line by line and collecting every
// code we cross is both simpler and strictly better here, and it keeps the app
// dependency-free and working with no connection.
//
// The reader is deliberately narrow: EAN-13 and UPC-A, which is what a book's
// barcode is (ISBNs are EAN-13s starting 978/979). It does not do QR.

// Run lengths, in modules, of the four bars making up a left-hand ("L") digit.
// L-codes start on a space, so these read space-bar-space-bar.
const L_PATTERNS = [
  [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
  [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2],
];
// A G-code is its L-code mirrored, and an R-code is its L-code inverted —
// which leaves the run lengths untouched, so the right-hand half matches
// against L_PATTERNS too (just starting on a bar instead of a space).
const G_PATTERNS = L_PATTERNS.map((p) => [...p].reverse());
const LG_PATTERNS = [...L_PATTERNS, ...G_PATTERNS];

// Which digits of the left half are G-coded encodes the 13th (leading) digit.
// Bit 5 is the first digit of the half; a set bit means G.
const FIRST_DIGIT_PARITY = [0x00, 0x0b, 0x0d, 0x0e, 0x13, 0x19, 0x1c, 0x15, 0x16, 0x1a];

// A symbol is 59 runs: guard 3 + six digits 24 + centre 5 + six digits 24 + guard 3.
const SYMBOL_RUNS = 59;
const GUARD = [1, 1, 1];
const CENTRE = [1, 1, 1, 1, 1];

// Tolerances borrowed from long experience in the field (ZXing's): a single
// bar may be up to 0.7 modules off, and the symbol's average error must stay
// under 0.48. Loose enough for a phone photo, tight enough that noise doesn't
// checksum its way into your library.
const MAX_INDIVIDUAL_VARIANCE = 0.7;
const MAX_AVG_VARIANCE = 0.48;

// How closely a run of bars matches a pattern, in modules of average error.
// Infinity means "not this pattern".
function patternVariance(counts, at, pattern, dir) {
  let total = 0;
  for (let i = 0; i < pattern.length; i++) total += counts[at + i * dir];
  const patternTotal = pattern.reduce((a, b) => a + b, 0);
  if (total < patternTotal) return Infinity; // fewer pixels than modules
  const unit = total / patternTotal;
  const maxIndividual = unit * MAX_INDIVIDUAL_VARIANCE;
  let variance = 0;
  for (let i = 0; i < pattern.length; i++) {
    const diff = Math.abs(counts[at + i * dir] - pattern[i] * unit);
    if (diff > maxIndividual) return Infinity;
    variance += diff;
  }
  return variance / total;
}

function bestDigit(counts, at, patterns, dir) {
  let best = -1;
  let bestVariance = MAX_AVG_VARIANCE;
  for (let d = 0; d < patterns.length; d++) {
    const v = patternVariance(counts, at, patterns[d], dir);
    if (v < bestVariance) {
      bestVariance = v;
      best = d;
    }
  }
  return best;
}

export function ean13Checksum(digits) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

// Try to read one symbol out of `counts` (run lengths, alternating colour),
// starting at run `start`. `dir` is +1 to read forwards or -1 to read the same
// 59 runs backwards — which is how an upside-down book still scans.
function decodeSymbol(counts, start, dir) {
  const at = dir > 0 ? start : start + SYMBOL_RUNS - 1;
  const step = (k) => at + k * dir;

  if (patternVariance(counts, step(0), GUARD, dir) === Infinity) return null;

  const digits = [];
  let parity = 0;
  for (let i = 0; i < 6; i++) {
    const d = bestDigit(counts, step(3 + i * 4), LG_PATTERNS, dir);
    if (d < 0) return null;
    digits.push(d % 10);
    if (d >= 10) parity |= 1 << (5 - i); // G-coded
  }

  if (patternVariance(counts, step(27), CENTRE, dir) === Infinity) return null;

  for (let i = 0; i < 6; i++) {
    const d = bestDigit(counts, step(32 + i * 4), L_PATTERNS, dir);
    if (d < 0) return null;
    digits.push(d);
  }

  if (patternVariance(counts, step(56), GUARD, dir) === Infinity) return null;

  const first = FIRST_DIGIT_PARITY.indexOf(parity);
  if (first < 0) return null; // not a left-half parity — wrong way round
  const all = [first, ...digits];
  if (ean13Checksum(all) !== all[12]) return null;
  return all.join("");
}

// Walk a line of run lengths, reading *every* symbol on it rather than
// stopping at the first — which is the whole point: one line across a photo
// of a shelf crosses several books. Candidate positions step by two so we
// only ever start on a dark run; a symbol always opens on a bar.
function decodeLine(counts, firstIsDark, out) {
  const limit = counts.length - SYMBOL_RUNS;
  for (let i = firstIsDark ? 0 : 1; i <= limit; i += 2) {
    for (const dir of [1, -1]) {
      const code = decodeSymbol(counts, i, dir);
      if (code) {
        out.set(code, (out.get(code) ?? 0) + 1);
        // Step over the symbol we just read to the next dark run. It has to
        // be an even number of runs or the loop lands on spaces from here on
        // and every later barcode on this line is invisible.
        i += SYMBOL_RUNS - 1;
        break;
      }
    }
  }
}

// A patch of the picture is "flat" — paper, a shelf, a wall — unless something
// in it is markedly darker than the rest. Below this, we don't look for bars.
const MIN_CONTRAST = 24;

// Turn a line of grey samples into run lengths.
//
// The threshold tracks the local midpoint between the darkest and lightest
// pixel nearby, not the local *average*. That distinction is what makes a
// slightly soft photo readable: a run of four white modules next to one black
// one drags the average bright, and a narrow bar — already washed out by being
// out of focus — then never crosses it and simply disappears, taking the whole
// symbol with it. Halfway between black and white has no such bias.
//
// Extremes come from coarse blocks rather than a true sliding window: it costs
// one pass instead of a deque per pixel, and a threshold that steps every few
// dozen pixels is plenty when what it's tracking is the lighting.
function runLengths(line, len) {
  const block = Math.min(Math.max(Math.round(len / 64), 8), 40);
  const blocks = Math.ceil(len / block);
  const lo = new Uint8Array(blocks);
  const hi = new Uint8Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let min = 255;
    let max = 0;
    const end = Math.min(len, (b + 1) * block);
    for (let i = b * block; i < end; i++) {
      const v = line[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo[b] = min;
    hi[b] = max;
  }

  const counts = [];
  let dark = -1;
  let runStart = 0;
  let firstIsDark = false;

  for (let i = 0; i < len; i++) {
    // Widen to the neighbouring blocks so the window always spans enough bars
    // to have seen both a black one and a white one.
    const b = (i / block) | 0;
    let min = 255;
    let max = 0;
    for (let k = Math.max(0, b - 1); k <= Math.min(blocks - 1, b + 1); k++) {
      if (lo[k] < min) min = lo[k];
      if (hi[k] > max) max = hi[k];
    }

    let isDark;
    if (max - min < MIN_CONTRAST) {
      isDark = false; // nothing here worth calling a bar
    } else {
      const mid = (min + max) / 2;
      const slack = (max - min) / 16; // hysteresis, so noise can't chatter
      if (line[i] < mid - slack) isDark = true;
      else if (line[i] > mid + slack) isDark = false;
      else isDark = dark === 1;
    }

    if (dark === -1) {
      dark = isDark ? 1 : 0;
      firstIsDark = isDark;
    } else if (isDark !== (dark === 1)) {
      counts.push(i - runStart);
      runStart = i;
      dark = isDark ? 1 : 0;
    }
  }
  counts.push(len - runStart);
  return { counts, firstIsDark };
}

// Sample a straight line across the image and read it. Angle is in radians;
// (ox, oy) is where the line starts and it runs until it leaves the frame.
function scanRay(grey, width, height, ox, oy, dx, dy, line, out) {
  let n = 0;
  let x = ox;
  let y = oy;
  while (x >= 0 && y >= 0 && x < width && y < height) {
    line[n++] = grey[(y | 0) * width + (x | 0)];
    x += dx;
    y += dy;
  }
  if (n < SYMBOL_RUNS) return;
  const { counts, firstIsDark } = runLengths(line, n);
  if (counts.length >= SYMBOL_RUNS) decodeLine(counts, firstIsDark, out);
}

// Read every barcode crossed by a family of parallel lines at `angle`.
function scanAngle(grey, width, height, angle, spacing, out) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const line = new Uint8Array(Math.ceil(Math.hypot(width, height)) + 2);
  // Step perpendicular to the scan direction, sweeping the whole frame.
  const px = -dy;
  const py = dx;
  // How far the sweep has to travel to cover the frame: the image's extent
  // measured along the perpendicular, not along the scan direction.
  const reach = Math.abs(width * px) + Math.abs(height * py);
  for (let t = -reach / 2; t <= reach / 2; t += spacing) {
    // Start each line off the edge of the frame and walk it in.
    const cx = width / 2 + px * t - dx * width;
    const cy = height / 2 + py * t - dy * height;
    let sx = cx;
    let sy = cy;
    // Advance to the first sample inside the frame.
    let guard = 0;
    while ((sx < 0 || sy < 0 || sx >= width || sy >= height) && guard++ < 4 * (width + height)) {
      sx += dx;
      sy += dy;
    }
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    scanRay(grey, width, height, sx, sy, dx, dy, line, out);
  }
}

/**
 * Read every EAN-13 / UPC-A barcode in a greyscale image.
 *
 * @param {Uint8Array} grey  one byte per pixel, row-major
 * @param {number} width
 * @param {number} height
 * @param {{minHits?: number, angles?: number[], spacing?: number}} [opts]
 *   minHits — how many separate scan lines must agree before a code counts.
 *   Barcodes are tall, so a real one is crossed many times; requiring two
 *   throws away the occasional checksum-passing coincidence.
 * @returns {string[]} the codes found, most-confidently-read first
 */
export function readBarcodes(grey, width, height, opts = {}) {
  const {
    minHits = 2,
    // Upright covers first, then sideways. A tilted barcode still reads on a
    // straight line — the line just crosses the bars at a slant — so the
    // diagonals only need to cover the middle of the range.
    angles = [0, 90, 45, -45],
    spacing = Math.max(2, Math.round(Math.min(width, height) / 220)),
  } = opts;

  const hits = new Map();
  for (const deg of angles) {
    scanAngle(grey, width, height, (deg * Math.PI) / 180, spacing, hits);
  }
  return [...hits.entries()]
    .filter(([, n]) => n >= minHits)
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}

/**
 * Unsharp mask, for photos that are slightly out of focus — which a phone
 * held over a pile of books very often is. Softness costs the narrow bars
 * their contrast first, so they threshold away and the symbol is lost;
 * putting the edges back recovers barcodes that are otherwise unreadable
 * (measurably: a mildly soft eight-book shot goes from one book to eight).
 *
 * Implemented as a separable box blur subtracted from the original, which is
 * two linear passes over the image rather than a convolution per pixel.
 */
export function sharpen(grey, width, height, amount = 1.5, radius = 2) {
  const tmp = new Uint8Array(grey.length);
  const out = new Uint8Array(grey.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x < Math.min(radius, width); x++) sum += grey[row + x];
    for (let x = 0; x < width; x++) {
      const add = x + radius;
      const drop = x - radius - 1;
      if (add < width) sum += grey[row + add];
      if (drop >= 0) sum -= grey[row + drop];
      const n = Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1;
      tmp[row + x] = sum / n;
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(radius, height); y++) sum += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      const add = y + radius;
      const drop = y - radius - 1;
      if (add < height) sum += tmp[add * width + x];
      if (drop >= 0) sum -= tmp[drop * width + x];
      const n = Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1;
      const i = y * width + x;
      const v = grey[i] + amount * (grey[i] - sum / n);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/** Pull a greyscale buffer out of anything drawable, capped at `maxEdge`. */
export function greyscaleFrom(source, maxEdge = 2400) {
  // A <video> reports its *frame* size as videoWidth — plain `width` is the
  // layout attribute and is usually 0, which would silently scan a 1px image.
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error("nothing to scan");
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const grey = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    // Luma. Integer weights so this stays fast on a phone.
    grey[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return { grey, width, height };
}
