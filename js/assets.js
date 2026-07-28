// Optional artwork.
//
// Drop a file into assets/ with one of the names below and it appears in the
// app. Nothing needs editing, and nothing breaks when a file isn't there —
// each slot is checked and simply skipped if it's missing, so the stock look
// is always the fallback.
//
// Checking for the files (rather than pointing CSS straight at the paths)
// keeps a missing file from showing as a broken image, and lets a slot carry
// a layout change too — a logo image needs the emoji hidden, for instance.
//
// What was found last time is remembered, so artwork paints immediately on
// launch rather than popping in a moment later — and so the app isn't asking
// the server for five files that aren't there on every single launch. The
// folder is re-checked twice a day, or on demand from Settings when you've
// just added something.

const MEMO_KEY = "shelfie.assets.v1";
const RECHECK_MS = 12 * 3600 * 1000;

const SLOTS = [
  {
    // Your own mark in the top bar, in place of the 📚 emoji.
    // Square-ish works best; a PNG with a transparent background looks
    // sharpest against the dark header.
    key: "logo",
    files: ["assets/logo.png", "assets/logo.svg", "assets/logo.jpg"],
    cssVar: "--logo-url",
    bodyClass: "has-logo",
  },
  {
    // A texture or photo across the top bar. It sits over the header colour,
    // so something subtle reads best — linen, marbled paper, a wood photo.
    key: "header",
    files: ["assets/header.png", "assets/header.jpg", "assets/header.webp"],
    cssVar: "--header-image",
    bodyClass: "has-header-image",
  },
  {
    // The ledge each row of books sits on. A narrow strip that tiles
    // left-to-right (around 200×24) works best.
    key: "shelf",
    files: ["assets/shelf.png", "assets/shelf.jpg"],
    cssVar: "--shelf-image",
    bodyClass: "has-shelf-image",
  },
  {
    // Paper texture behind the whole page. Should tile seamlessly.
    key: "paper",
    files: ["assets/paper.png", "assets/paper.jpg"],
    cssVar: "--page-texture",
  },
  {
    // The picture on an empty shelf, in place of the 📚 emoji.
    key: "empty",
    files: ["assets/empty.png", "assets/empty.svg", "assets/empty.jpg"],
    cssVar: "--empty-url",
    bodyClass: "has-empty-art",
  },
];

function apply(slot, url) {
  document.documentElement.style.setProperty(slot.cssVar, `url("${url}")`);
  if (slot.bodyClass) document.body.classList.add(slot.bodyClass);
}

function clear(slot) {
  document.documentElement.style.removeProperty(slot.cssVar);
  if (slot.bodyClass) document.body.classList.remove(slot.bodyClass);
}

function exists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

// First name that resolves wins, so logo.png beats logo.svg if both exist.
async function firstPresent(files) {
  for (const f of files) {
    if (await exists(f)) return f;
  }
  return null;
}

export async function applyCustomAssets({ force = false } = {}) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(MEMO_KEY));
  } catch { /* first run, or storage cleared */ }
  const memo = saved?.found ?? {};

  // Paint what was there last time straight away — no flash of the default.
  const remembered = SLOTS.filter((slot) => memo[slot.key]);
  remembered.forEach((slot) => apply(slot, memo[slot.key]));

  // Confirm those few are still there. The browser is fetching them to paint
  // anyway, so this is effectively free — and it means deleting a file takes
  // effect on the very next launch instead of waiting for the recheck.
  let missing = false;
  await Promise.all(
    remembered.map(async (slot) => {
      if (await exists(memo[slot.key])) return;
      clear(slot);
      missing = true;
    })
  );

  const fresh = saved && Date.now() - (saved.at ?? 0) < RECHECK_MS;
  if (fresh && !force && !missing) return;

  // Check what's actually in the folder, so files added or removed take
  // effect.
  const found = {};
  await Promise.all(
    SLOTS.map(async (slot) => {
      const file = await firstPresent(slot.files);
      if (file) {
        found[slot.key] = file;
        if (memo[slot.key] !== file) apply(slot, file);
      } else if (memo[slot.key]) {
        clear(slot);
      }
    })
  );

  try {
    localStorage.setItem(MEMO_KEY, JSON.stringify({ at: Date.now(), found }));
  } catch { /* storage full — the artwork just re-checks next launch */ }
  return found;
}

// Settings → "check for changes", for right after you've added a file.
export function refreshCustomAssets() {
  return applyCustomAssets({ force: true });
}
