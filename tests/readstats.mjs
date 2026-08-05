// "Books finished this year" should count reading, not cataloguing.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
});
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));

const Y = new Date().getFullYear();
const lib = [
  // Backfill: logged straight onto Finished, dated this year.
  { id: "old1", title: "Prior Read One", authors: ["A"], shelf: "completed", owned: true,
    coverUrl: null, pageCount: 300, finishedAt: `${Y}-02-01T00:00:00Z`, addedAt: `${Y}-01-01T00:00:00Z` },
  { id: "old2", title: "Prior Read Two", authors: ["B"], shelf: "completed", owned: true,
    coverUrl: null, pageCount: 250, finishedAt: `${Y}-03-01T00:00:00Z`, addedAt: `${Y}-01-02T00:00:00Z` },
  // On To Read — will be finished during the test.
  { id: "tbr1", title: "Waiting To Read", authors: ["C"], shelf: "tbr", owned: true,
    coverUrl: null, pageCount: 400, addedAt: `${Y}-01-03T00:00:00Z` },
  // Owned and flagged as currently reading.
  { id: "rd1", title: "Reading Now", authors: ["D"], shelf: "owned", owned: true, reading: true,
    coverUrl: null, pageCount: 500, addedAt: `${Y}-01-04T00:00:00Z` },
  // Owned, never queued or flagged — the bulk-catalogue case.
  { id: "own1", title: "Just Owned", authors: ["E"], shelf: "owned", owned: true,
    coverUrl: null, pageCount: 200, addedAt: `${Y}-01-05T00:00:00Z` },
];
await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, lib);
await page.goto("http://localhost:8765/");
await page.waitForTimeout(800);

const stats = async () => {
  await page.click("#shelf-hero");
  await page.waitForTimeout(700);
  const tiles = await page.$$eval(".stat-tile", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const line = (await page.textContent(".stat-line")).replace(/\s+/g, " ").trim();
  const bars = await page.$$eval(".month i", (e) => e.map((x) => x.style.height));
  await page.click("#screen-stats .back-btn");
  await page.waitForTimeout(400);
  return { tiles: tiles.join(" | "), line, months: bars.filter((h) => h !== "4%").length };
};

console.log("1. two prior reads logged straight onto Finished:");
let s = await stats();
console.log("   tiles:", s.tiles);
console.log("   this year:", s.line, "| months with bars:", s.months);

// Finishing a book you were reading now offers the "what next" sheet
// (js/app.js, offerSunset). It's a moment, not a step in this suite — close it
// and carry on.
async function dismissSunset() {
  if (await page.evaluate(() => document.querySelector("#sunset-modal")?.open === true)) {
    await page.evaluate(() => document.querySelector("#sunset-modal").close());
    await page.waitForTimeout(150);
  }
}

// Finish the To Read book from its card.
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="tbr1"] [data-flip]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="tbr1"] [data-qa-move="completed"]');
await page.waitForTimeout(500);
await page.click('.grid-book[data-id="tbr1"] [data-qa-move="completed"]');
await page.waitForTimeout(1200);
await dismissSunset();
console.log("2. after finishing a To Read book:");
s = await stats();
console.log("   this year:", s.line, "| months with bars:", s.months);

// Finish the currently-reading book from its detail sheet.
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="rd1"]');
await page.waitForTimeout(700);
await page.click('[data-move="completed"]');
await page.waitForTimeout(1200);
await dismissSunset();
console.log("3. after finishing a currently-reading book:");
s = await stats();
console.log("   this year:", s.line, "| months with bars:", s.months);

// Mark an owned book finished that was never queued or flagged.
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="own1"]');
await page.waitForTimeout(700);
await page.click('[data-move="completed"]');
await page.waitForTimeout(700);
console.log("4. after bulk-marking an owned book finished (cataloguing):");
s = await stats();
console.log("   tiles:", s.tiles);
console.log("   this year:", s.line, "(should be unchanged from step 3)");

console.log("5. flags on disk:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1"))
    .map((b) => `${b.id}:${b.readHere ? "counts" : "-"}`).join(" ")));

// Undo must take the flag with it.
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(300);
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(300);
await page.click('.grid-book[data-id="tbr1"]');
await page.waitForTimeout(700);
await page.click('[data-move="tbr"]');
await page.waitForTimeout(600);
await page.click('.grid-book[data-id="tbr1"] [data-flip]').catch(() => {});
await page.waitForTimeout(300);
console.log("6. moving a counted book back to To Read leaves the flag set:",
  await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1"))
    .find((b) => b.id === "tbr1")?.readHere ?? null),
  "— but it's off the Finished shelf so it no longer counts:");
s = await stats();
console.log("   this year:", s.line);

console.log("\n7. the note explains the rule:",
  JSON.stringify(await page.evaluate(async () => {
    document.querySelector("#shelf-hero").click();
    await new Promise((r) => setTimeout(r, 500));
    return document.querySelector(".stat-note")?.textContent.replace(/\s+/g, " ").trim();
  })));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
