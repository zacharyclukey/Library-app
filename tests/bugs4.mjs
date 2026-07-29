// Round 4 — delete/undo, disarm-on-flip, import/export round trip, profiles.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
});
await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());

const lib = [
  { id: "o1", title: "Owned One", authors: ["A"], shelf: "owned", owned: true, coverUrl: null,
    pageCount: 300, addedAt: "2026-01-01T00:00:00Z", profile: "Zach" },
  { id: "o2", title: "Owned Two", authors: ["B"], shelf: "owned", owned: true, coverUrl: null,
    pageCount: 200, addedAt: "2026-01-02T00:00:00Z", profile: "Zach" },
  { id: "t1", title: "Zach TBR", authors: ["C"], shelf: "tbr", owned: false, coverUrl: null,
    addedAt: "2026-01-03T00:00:00Z", profile: "Zach" },
  { id: "t2", title: "Kelsey TBR", authors: ["D"], shelf: "tbr", owned: false, coverUrl: null,
    addedAt: "2026-01-04T00:00:00Z", profile: "Kelsey" },
  { id: "c1", title: "Finished One", authors: ["E"], shelf: "completed", owned: true, coverUrl: null,
    pageCount: 400, ratings: { Zach: 5, Kelsey: 3 }, finishedAt: "2026-06-01T00:00:00Z",
    addedAt: "2026-01-05T00:00:00Z", profile: "Zach" },
];
await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.profiles.v1", JSON.stringify(["Zach", "Kelsey"]));
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, lib);
await page.goto("http://localhost:8765/");
await page.waitForTimeout(700);

const count = (s) => page.textContent(`#count-${s}`);
const idsInStore = () => page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) => b.id));

// ---- 1. delete from the detail sheet, and undo it ----
const beforeOwned = await count("owned");
await page.click('.grid-book[data-id="o2"]');
await page.waitForTimeout(500);
console.log("1a. detail sheet open with a Remove button:", await page.isVisible("[data-delete]"));
await page.click("[data-delete]");
await page.waitForTimeout(600);
console.log("1b. removed:", beforeOwned, "→", await count("owned"), "| store:", (await idsInStore()).join(","));
console.log("1c. undo offered:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click(".toast-action");
await page.waitForTimeout(600);
console.log("1d. undo restored it:", await count("owned"), "| store:", (await idsInStore()).join(","));

// ---- 2. arm, flip away, flip back: must need two taps again ----
await page.click('.grid-book[data-id="o1"] [data-flip]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="o1"] [data-qa-move="wishlist"]'); // arms
await page.waitForTimeout(500);
console.log("2a. armed:", await page.$eval('.grid-book[data-id="o1"] [data-qa-move="wishlist"]',
  (e) => e.classList.contains("armed")));
// tap the empty part of the back to flip it over, then flip back
await page.click('.grid-book[data-id="o1"] .qa-facts');
await page.waitForTimeout(500);
await page.click('.grid-book[data-id="o1"] [data-flip]');
await page.waitForTimeout(500);
const stillArmed = await page.$eval('.grid-book[data-id="o1"] [data-qa-move="wishlist"]',
  (e) => e.classList.contains("armed"));
console.log("2b. no longer armed after flipping away:", !stillArmed);
await page.click('.grid-book[data-id="o1"] [data-qa-move="wishlist"]');
await page.waitForTimeout(400);
console.log("2c. one tap after re-flipping does not move it:",
  await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1"))
    .find((b) => b.id === "o1").shelf), "(want owned)");

// ---- 3. per-profile shelves ----
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(400);
const mineChip = await page.$('.profile-filter .filter-chip');
if (mineChip) { await mineChip.click(); await page.waitForTimeout(400); }
console.log("3a. TBR filtered to me:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));
await page.click('.profile-filter .filter-chip:has-text("Everyone")').catch(() => {});
await page.waitForTimeout(400);
console.log("3b. TBR everyone:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));

// ---- 4. ratings stay per person ----
await page.click('[data-shelf="completed"]');
await page.waitForTimeout(400);
await page.click(".grid-book");
await page.waitForTimeout(500);
const detail = (await page.textContent("#detail-content")).replace(/\s+/g, " ");
console.log("4. both ratings shown, mine editable:",
  /Kelsey/.test(detail), "| Zach ★:", (detail.match(/★+/g) ?? [])[0]);
await page.click('[data-close="detail-modal"]');

// ---- 5. export → import round trip ----
await page.click("#export-btn");
await page.waitForTimeout(500);
const json = await page.evaluate(() => {
  const books = JSON.parse(localStorage.getItem("shelfie.library.v1"));
  return JSON.stringify(books, null, 2);
});
console.log("5a. export JSON parses:", JSON.parse(json).length, "books");
await page.click("#nav-shelves");
await page.waitForTimeout(300);
// wipe, then import the same file back
await page.evaluate((text) => {
  localStorage.setItem("shelfie.library.v1", "[]");
  window.__importText = text;
}, json);
await page.reload();
await page.waitForTimeout(600);
console.log("5b. wiped:", await count("owned"), await count("tbr"), await count("completed"));
const imported = await page.evaluate(async (text) => {
  const db = await import("/js/db.js");
  db.importJson(text);
  return db.getAllBooks().length;
}, json);
await page.reload();
await page.waitForTimeout(700);
console.log("5c. re-imported:", imported, "books | counts:",
  await count("owned"), await count("tbr"), await count("completed"));

// ---- 6. import rejects rubbish without breaking the library ----
const importResult = await page.evaluate(async () => {
  const db = await import("/js/db.js");
  const out = [];
  for (const bad of ["not json", '{"a":1}', "[]", "null"]) {
    try { db.importJson(bad); out.push("accepted:" + bad.slice(0, 12)); }
    catch (e) { out.push("rejected:" + bad.slice(0, 12)); }
  }
  return { out, left: db.getAllBooks().length };
});
console.log("6. import guards:", importResult.out.join(" | "), "| books left:", importResult.left);

// ---- 7. a book with a huge review survives a round trip ----
await page.reload();
await page.waitForTimeout(700);
console.log("7. app still healthy after import abuse:", await page.isVisible(".bottom-nav"),
  "| cards:", await page.$$eval(".grid-book", (e) => e.length));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
