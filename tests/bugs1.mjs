// Round 1 — hostile data. Books that are missing fields, malformed, hostile,
// or absurd. Nothing here should throw, blank the shelf, or execute.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
});
page.on("dialog", async (d) => { errors.push("XSS DIALOG: " + d.message()); await d.dismiss(); });
await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());

const nasty = [
  // 0: everything missing except an id
  { id: "n0" },
  // 1: nulls where strings are expected
  { id: "n1", title: null, authors: null, shelf: "owned", pageCount: null, series: null },
  // 2: wrong types
  { id: "n2", title: 12345, authors: "Not An Array", shelf: "owned", pageCount: "many",
    series: "The Series", ratings: "nope", subjects: "fantasy" },
  // 3: script injection in every text field
  { id: "n3", title: `<img src=x onerror="alert('title')">`, shelf: "owned", owned: true,
    authors: [`<script>alert('author')</script>`],
    series: { name: `<svg onload=alert('series')>`, position: 1 },
    subjects: [`<b onmouseover=alert(1)>fantasy</b>`],
    reviews: { Zach: { text: `<iframe src="javascript:alert('review')"></iframe>` } },
    publisher: `<img src=x onerror=alert('pub')>`, isbn13: `"><script>alert(9)</script>`,
    addedAt: "2026-01-01T00:00:00Z" },
  // 4: absurd lengths
  { id: "n4", title: "Ω".repeat(600), authors: ["A".repeat(400)], shelf: "owned", owned: true,
    pageCount: 99999999, addedAt: "2026-01-02T00:00:00Z" },
  // 5: unknown shelf value
  { id: "n5", title: "Ghost Shelf", shelf: "somewhere-else", owned: true, addedAt: "2026-01-03T00:00:00Z" },
  // 6: bad dates
  { id: "n6", title: "Bad Dates", shelf: "completed", owned: true,
    addedAt: "not-a-date", finishedAt: "13/45/2099", publishDate: "yesterday" },
  // 7: future finish date
  { id: "n7", title: "From The Future", shelf: "completed", owned: true,
    finishedAt: "2099-12-31T00:00:00Z", addedAt: "2026-01-04T00:00:00Z", ratings: { Zach: 5 } },
  // 8: out-of-range rating & spice
  { id: "n8", title: "Over Rated", shelf: "completed", owned: true,
    ratings: { Zach: 99 }, spice: -3, content: "made-up", addedAt: "2026-01-05T00:00:00Z" },
  // 9: negative / zero series position
  { id: "n9", title: "Book Zero", shelf: "owned", owned: true,
    series: { name: "Numbered", position: 0 }, addedAt: "2026-01-06T00:00:00Z" },
  { id: "n10", title: "Book Minus", shelf: "owned", owned: true,
    series: { name: "Numbered", position: -4 }, addedAt: "2026-01-07T00:00:00Z" },
  // 11: duplicate id (db should tolerate)
  { id: "n9", title: "Duplicate Id", shelf: "owned", owned: true, addedAt: "2026-01-08T00:00:00Z" },
  // 12: emoji-only title, RTL text
  { id: "n12", title: "📚🔥", authors: ["مؤلف عربي"], shelf: "owned", owned: true, addedAt: "2026-01-09T00:00:00Z" },
  // 13: series with no name
  { id: "n13", title: "Nameless Series", shelf: "owned", owned: true,
    series: { position: 3 }, addedAt: "2026-01-10T00:00:00Z" },
];

await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, nasty);

await page.goto("http://localhost:8765/");
await page.waitForTimeout(800);

const cards = () => page.$$eval(".grid-book", (e) => e.length);
console.log("1. app rendered at all, cards:", await cards());
console.log("2. no white screen:", await page.isVisible(".bottom-nav"));

// every sort order, on garbage
for (const s of ["added", "series", "title", "author", "newest", "oldest", "longest", "shortest", "rating"]) {
  await page.click("#filter-toggle");
  await page.waitForTimeout(120);
  await page.click(`#filter-panel [data-sort="${s}"]`);
  await page.waitForTimeout(200);
  await page.click("#filter-toggle");
  await page.waitForTimeout(120);
  process.stdout.write(`   sort ${s}: ${await cards()} cards  `);
}
console.log("\n3. all sorts survived garbage data");

// grouped view of malformed series
await page.click("#filter-toggle");
await page.click('#filter-panel [data-sort="series"]');
await page.waitForTimeout(300);
await page.click("#filter-toggle");
const heads = await page.$$eval(".group-head span:first-child", (e) => e.map((x) => x.textContent));
console.log("4. group headings from bad series:", JSON.stringify(heads));

// every shelf tab
for (const s of ["owned", "tbr", "completed", "wishlist"]) {
  await page.click(`[data-shelf="${s}"]`);
  await page.waitForTimeout(250);
  process.stdout.write(`   ${s}: ${await cards()}  `);
}
console.log("\n5. all shelves rendered");

// every filter chip, one at a time, on garbage
await page.click('[data-shelf="owned"]');
await page.click("#filter-toggle");
await page.waitForTimeout(200);
const chipCount = await page.$$eval("#filter-panel .filter-chip:not(.sort-chip)", (e) => e.length);
for (let i = 0; i < chipCount; i++) {
  const chip = (await page.$$("#filter-panel .filter-chip:not(.sort-chip)"))[i];
  if (!chip) continue;
  await chip.click().catch(() => {});
  await page.waitForTimeout(120);
  await chip.click().catch(() => {}); // toggle back off
  await page.waitForTimeout(80);
}
console.log("6. cycled", chipCount, "filter chips, cards now:", await cards());
await page.click("text=Clear all filters");
await page.click("#filter-toggle");
await page.waitForTimeout(200);

// open the detail sheet on each nasty book
let opened = 0;
const ids = await page.$$eval(".grid-book", (e) => e.map((x) => x.dataset.id));
for (const id of ids) {
  await page.click(`.grid-book[data-id="${id}"]`).catch(() => {});
  await page.waitForTimeout(250);
  if (await page.isVisible("#detail-modal")) {
    opened++;
    await page.click('[data-close="detail-modal"]').catch(() => {});
    await page.waitForTimeout(150);
  }
}
console.log("7. detail sheet opened for", opened, "of", ids.length, "hostile books");

// stats + export with garbage
await page.click("#shelf-hero");
await page.waitForTimeout(500);
console.log("8. stats screen:", await page.$eval(".screen.active", (e) => e.id),
  "| tiles:", (await page.$$eval(".stat-tile", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()))).join(" | "));
await page.click("#screen-stats .back-btn");
await page.waitForTimeout(300);
await page.click("#export-btn");
await page.waitForTimeout(500);
console.log("9. export preview:", (await page.textContent("#export-content")).replace(/\s+/g, " ").trim().slice(0, 90));
await page.click("#nav-shelves");
await page.waitForTimeout(300);

// search with regex-special and unicode queries
for (const q of ["(", "[a-z", "\\", ".*", "📚", "Ω", "<img", "  "]) {
  await page.fill("#list-search", q);
  await page.waitForTimeout(200);
  process.stdout.write(`   "${q}"→${await cards()}  `);
}
await page.fill("#list-search", "");
console.log("\n10. hostile search queries survived");

// nothing injected ran, and hostile text is shown as text
const bodyHtml = await page.content();
console.log("11. no live <script>/<iframe>/onerror in DOM:",
  !/<script>alert|<iframe src="javascript|onerror="alert/.test(bodyHtml));
console.log("12. hostile title is displayed as literal text:",
  (await page.textContent("body")).includes("<img src=x onerror="));

// corrupt localStorage entirely
await page.evaluate(() => localStorage.setItem("shelfie.library.v1", "{not json at all"));
await page.reload();
await page.waitForTimeout(700);
console.log("13. survives corrupt library JSON:", await page.isVisible(".bottom-nav"),
  "| cards:", await cards());

await page.evaluate(() => localStorage.setItem("shelfie.library.v1", JSON.stringify({ not: "an array" })));
await page.reload();
await page.waitForTimeout(700);
console.log("14. survives non-array library:", await page.isVisible(".bottom-nav"),
  "| cards:", await cards());

await page.evaluate(() => {
  localStorage.setItem("shelfie.library.v1", "[]");
  localStorage.setItem("shelfie.shelfSort.v1", "totally-bogus-sort");
});
await page.reload();
await page.waitForTimeout(700);
console.log("15. survives bogus saved sort:", await page.isVisible(".bottom-nav"));
await page.click("#filter-toggle");
await page.waitForTimeout(200);
console.log("16. panel still renders with bogus sort:",
  (await page.$$("#filter-panel .sort-chip")).length, "chips,",
  (await page.$$("#filter-panel .sort-chip.active")).length, "active");

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
