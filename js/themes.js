// Aesthetic themes ("skins") and light/dark mode.
//
// A skin is a palette + type choice defined entirely in CSS under
// `[data-skin="<id>"]` (light) and `[data-skin="<id>"][data-mode="dark"]`.
// Adding a new aesthetic means adding those two CSS blocks plus one entry
// here — no other code changes.
//
// The effective mode is resolved in JS (never with a CSS media query) so
// every skin needs only one dark block, and an inline script in index.html
// applies the stored choice before first paint.

const SKIN_KEY = "shelfie.skin.v1";
const MODE_KEY = "shelfie.mode.v1";
const LEGACY_MODE_KEY = "shelfie.theme.v1"; // pre-skin auto/light/dark setting

export const THEMES = [
  {
    id: "reading-room",
    name: "Reading Room",
    blurb: "Walnut shelves, parchment pages, brass lamplight.",
    swatch: ["#4c3624", "#f5eddf", "#bf8a2a"],
  },
  {
    id: "cottage",
    name: "Cottage Garden",
    blurb: "Sage green, warm cream, pressed-flower rose.",
    swatch: ["#4a6350", "#f4f2e6", "#c97b84"],
  },
  {
    id: "dark-academia",
    name: "Dark Academia",
    blurb: "Oxblood leather, aged paper, candle gold.",
    swatch: ["#5b2333", "#ede4d3", "#9c7c1f"],
  },
  {
    id: "modern",
    name: "Modern",
    blurb: "Crisp navy and white, clean sans-serif.",
    swatch: ["#22304d", "#f4f6fa", "#d99b1e"],
  },
  {
    // Palette lives in css/custom.css, which is the user's own file — see
    // DESIGN.md. Ships as a soft neutral so it's usable before it's edited.
    id: "custom",
    name: "Yours",
    blurb: "Your own colours — edit css/custom.css.",
    swatch: ["#453b31", "#f2eee9", "#b8892f"],
  },
];

export const MODES = [
  ["auto", "Auto"],
  ["light", "Light"],
  ["dark", "Dark"],
];

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function currentSkin() {
  const stored = localStorage.getItem(SKIN_KEY);
  return THEMES.some((t) => t.id === stored) ? stored : THEMES[0].id;
}

export function currentMode() {
  const stored = localStorage.getItem(MODE_KEY) ?? localStorage.getItem(LEGACY_MODE_KEY);
  return ["auto", "light", "dark"].includes(stored) ? stored : "auto";
}

export function effectiveMode(mode = currentMode()) {
  return mode === "auto" ? (darkQuery.matches ? "dark" : "light") : mode;
}

export function themeName(id = currentSkin()) {
  return THEMES.find((t) => t.id === id)?.name ?? id;
}

export function setSkin(id) {
  localStorage.setItem(SKIN_KEY, id);
  apply();
}

export function setMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
  apply();
}

export function apply() {
  const root = document.documentElement;
  root.setAttribute("data-skin", currentSkin());
  root.setAttribute("data-mode", effectiveMode());
  syncBrowserChrome();
}

// Keep the phone's status/URL bar colour matching the app header.
function syncBrowserChrome() {
  const solid = getComputedStyle(document.documentElement)
    .getPropertyValue("--header-solid")
    .trim();
  if (solid) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", solid);
  }
}

// Follow the system when the user is on Auto.
export function watchSystem(onChange) {
  darkQuery.addEventListener("change", () => {
    if (currentMode() === "auto") {
      apply();
      onChange?.();
    }
  });
}
