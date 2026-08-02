// The icon set's contract.
//
// Two of these checks exist because the bugs happened. A second `flame:` was
// added to PATHS months after the first and silently replaced it — an object
// literal accepts a repeated key without a word. And a medium badge printed
// the literal text "tablet" on the card, because the name of an icon was
// interpolated where the drawing should have been. Both are invisible in a
// diff and obvious in a screenshot, which is the worst combination.

import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const ROOT = join(import.meta.dirname, "..");
const problems = [];

// The swap-in is exercised with a real file rather than a mocked response.
// The service worker answers same-origin requests once it's running, and
// those never come back through page.route — so a mock would appear to work
// on first load and then quietly stop, which is worse than not testing it.
const DROP_IN = join(ROOT, "assets/icons/flame.svg");
mkdirSync(join(ROOT, "assets/icons"), { recursive: true });
writeFileSync(DROP_IN, '<svg viewBox="0 0 40 40"><path id="swapped-in" d="M2 2h36v36H2z"/></svg>');
const cleanUp = () => rmSync(DROP_IN, { force: true });
process.on("exit", cleanUp);
process.on("SIGINT", () => { cleanUp(); process.exit(1); });

// --- 1. no name defined twice ---
const src = readFileSync(join(ROOT, "js/icons.js"), "utf8");
const body = src.slice(src.indexOf("const PATHS = {"), src.indexOf("\n};"));
const names = [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
console.log("1. icons defined:", names.length, "— defined twice:", dupes.length ? dupes : "none");
if (dupes.length) problems.push(`duplicate icon names: ${dupes.join(", ")}`);

// --- 2. every icon name referenced in the app actually exists ---
const referenced = new Set();
for (const file of ["js/app.js", "js/filters.js"]) {
  const text = readFileSync(join(ROOT, file), "utf8");
  for (const m of text.matchAll(/\bicon\(\s*"([a-zA-Z][a-zA-Z0-9]*)"/g)) referenced.add(m[1]);
}
// The markup names icons by attribute, filled in at startup — a typo there
// leaves a blank space rather than throwing.
const html = readFileSync(join(ROOT, "index.html"), "utf8");
for (const m of html.matchAll(/data-ico="([a-zA-Z][a-zA-Z0-9]*)"/g)) referenced.add(m[1]);
// The tables that map a value to an icon name — their values are looked up in
// PATHS at render time, so a typo there is a silently missing drawing.
const tables = readFileSync(join(ROOT, "js/filters.js"), "utf8");
for (const m of tables.matchAll(/^\s*(?:\[[^\]]*,\s*)?"?[a-z0-9]+"?:?\s*,?\s*"([a-z][a-zA-Z]*)"\s*[,\]]/gm)) {
  if (names.includes(m[1])) referenced.add(m[1]);
}
const missing = [...referenced].filter((n) => !names.includes(n));
console.log("2. names referenced:", referenced.size, "— with no drawing:", missing.length ? missing : "none");
if (missing.length) problems.push(`referenced but undrawn: ${missing.join(", ")}`);

// --- 3. nothing renders an icon name as text ---
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.route(/googleapis|gstatic|covers\.openlibrary|openlibrary\.org/, (r) => r.abort());
await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.trackMedium.v1", "1");
  localStorage.setItem("shelfie.trackContent.v1", "1");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "a", title: "Circe", authors: ["Madeline Miller"], shelf: "owned", owned: true,
      medium: "audio", content: "kids", addedAt: "2025-01-01T00:00:00Z" },
    { id: "b", title: "The Ritual", authors: ["Shantel Tessier"], shelf: "owned", owned: true,
      medium: "ebook", content: "explicit", spice: 4, reading: true, addedAt: "2025-01-02T00:00:00Z" },
  ]));
});
await page.goto("http://localhost:8765/");
await page.waitForTimeout(700);

// Open the filter sheet too, so the chips are on the page as well as the cards.
await page.click("#filter-toggle").catch(() => {});
await page.waitForTimeout(400);

const strays = await page.evaluate((all) => {
  const found = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.nodeValue.trim();
    // An icon name standing alone as its own text node is the tell — a word
    // like "print" inside a sentence is just a word.
    if (all.includes(text)) found.add(text);
  }
  return [...found];
}, names);
console.log("3. icon names showing as text:", strays.length ? strays : "none");
if (strays.length) problems.push(`rendered as text: ${strays.join(", ")}`);

// --- 4. every drawing the browser paints has something in it ---
// A malformed path string parses without complaint and leaves an empty <svg>,
// which looks like a missing icon rather than an error.
const painted = await page.evaluate(() => {
  const all = [...document.querySelectorAll("svg.ico")];
  return { total: all.length, empty: all.filter((s) => s.children.length === 0).length };
});
console.log("4. icons on screen:", painted.total, "— empty:", painted.empty);
if (painted.empty) problems.push(`${painted.empty} icons rendered with nothing inside`);
if (!painted.total) problems.push("no icons rendered at all");

// --- 5. a dropped-in file replaces the built-in drawing ---
const swapped = await page.evaluate(async () => {
  const mod = await import("/js/icons.js");
  await mod.refreshIconOverrides();
  return mod.icon("flame");
});
console.log("5. dropped-in file wins:", swapped.includes("swapped-in"), "— viewBox kept:", swapped.includes('viewBox="0 0 40 40"'));
if (!swapped.includes("swapped-in")) problems.push("assets/icons/<name>.svg did not replace the built-in");

// --- 6. a drop-in that colours itself keeps its own colours ---
// The app paints built-ins with currentColor strokes. Applying that to
// someone's finished artwork would flatten it, so a file that states colours
// opts out.
writeFileSync(DROP_IN, '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#e0245e"/></svg>');
const painting = await page.evaluate(async () => {
  const mod = await import("/js/icons.js");
  await mod.refreshIconOverrides();
  document.body.insertAdjacentHTML("beforeend", `<span id="probe">${mod.icon("flame")}</span>`);
  const el = document.querySelector("#probe circle");
  return { fill: getComputedStyle(el).fill, stroke: getComputedStyle(el).stroke };
});
const kept = painting.fill.replace(/\s/g, "") === "rgb(224,36,94)";
console.log("6. a coloured drop-in keeps its colours:", kept, "— got", painting.fill);
if (!kept) problems.push(`a coloured drop-in was repainted (fill came out ${painting.fill})`);

// --- 7. deleting the file brings the built-in back ---
cleanUp();
const restored = await page.evaluate(async () => {
  const mod = await import("/js/icons.js");
  await mod.refreshIconOverrides();
  return mod.icon("flame");
});
console.log("7. deleting the file restores the built-in:", !restored.includes("swapped-in"));
if (restored.includes("swapped-in")) problems.push("removing the file left the override in place");

await browser.close();
console.log("errors:", [...errors, ...problems]);
