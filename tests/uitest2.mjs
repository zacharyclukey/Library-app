import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });

await page.route(/openlibrary\.org\/works\/.*\.json/, (r) => r.fulfill({ json: { subjects: ["Fantasy fiction"] } }));
await page.route(/openlibrary\.org\/search\.json/, (r) => r.fulfill({ json: { docs: [] } }));
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());

const lib = [
  { id: "isbn:1", title: "Harry Potter and the Chamber of Secrets", authors: ["J. K. Rowling"],
    isbn13: "9780439064873", isbn10: "0439064872", publisher: "Scholastic", publishDate: "1999",
    pageCount: 341, format: "Paperback", shelf: "owned", owned: true, coverUrl: null,
    series: { name: "Harry Potter", position: 2 }, ratings: { Zach: 5, Amy: 4 },
    subjects: ["Fantasy fiction"], addedAt: "2026-01-05T00:00:00Z", profile: null },
  { id: "isbn:2", title: "The Way of Kings", authors: ["Brandon Sanderson"], isbn13: "9780765326355",
    publisher: "Tor", publishDate: "2010", pageCount: 1007, format: "Hardcover",
    shelf: "owned", owned: true, coverUrl: null, series: { name: "The Stormlight Archive", position: 1 },
    ratings: { Zach: 4 }, addedAt: "2026-01-06T00:00:00Z" },
  { id: "isbn:3", title: "Project Hail Mary", authors: ["Andy Weir"], isbn13: "9780593135204",
    publisher: "Ballantine", publishDate: "2021", pageCount: 476, shelf: "owned", owned: true,
    coverUrl: null, addedAt: "2026-01-07T00:00:00Z" },
  { id: "isbn:4", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "tbr", owned: true,
    coverUrl: null, pageCount: 245, publishDate: "2020", profile: "Zach", addedAt: "2026-01-08T00:00:00Z" },
  { id: "isbn:5", title: "Circe", authors: ["Madeline Miller"], shelf: "wishlist", owned: false,
    coverUrl: null, publishDate: "2018", profile: "Amy", addedAt: "2026-01-09T00:00:00Z" },
];
await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, lib);

await page.goto("http://localhost:8765/");
await page.waitForTimeout(600);

console.log("profile chip:", (await page.textContent("#profile-chip")).replace(/\s+/g, " ").trim());
console.log("summary:", await page.textContent("#shelf-summary"));
console.log("grid cards:", (await page.$$(".grid-book")).length);
console.log("cover fallbacks rendered:", (await page.$$(".cover-fallback")).length);
await page.screenshot({ path: "v2-grid.png" });

// List view
await page.click("#view-toggle");
await page.waitForTimeout(300);
console.log("list cards:", (await page.$$(".book-card")).length);
await page.screenshot({ path: "v2-list.png" });
await page.click("#view-toggle"); // back to grid
await page.waitForTimeout(200);

// Persistence of view
const stored = await page.evaluate(() => localStorage.getItem("shelfie.view.v1"));
console.log("view persisted:", stored);

// Export modal
await page.click("#export-btn");
await page.waitForTimeout(300);
console.log("export scopes:", await page.$$eval("[data-scope]", (e) => e.map((x) => x.textContent.trim())));
console.log("export preview:", (await page.textContent(".export-preview")).replace(/\s+/g, " ").trim());
await page.screenshot({ path: "v2-export.png" });

// Printable page export opens a new tab
const [tab] = await Promise.all([
  ctx.waitForEvent("page"),
  page.click('[data-format="page"]'),
]);
await tab.waitForLoadState("domcontentloaded");
console.log("printable title:", await tab.title());
console.log("printable books:", (await tab.$$(".bk")).length);
console.log("printable stats:", (await tab.textContent(".stats")).replace(/\s+/g, " ").trim());
await tab.setViewportSize({ width: 800, height: 900 });
await tab.screenshot({ path: "v2-print.png" });
await tab.close();

// CSV + text formats
const csvDownload = page.waitForEvent("download");
await page.click('[data-format="csv"]');
const dl = await csvDownload;
console.log("csv filename:", dl.suggestedFilename());
await page.click('[data-format="text"]');
await page.waitForTimeout(300);
console.log("text status:", await page.textContent("#export-status"));
await page.click('#nav-shelves');

// Settings + dark mode
await page.click("#settings-btn");
await page.waitForTimeout(300);
console.log("settings rows:", await page.$$eval(".settings-row", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim())));
await page.click('[data-go="appearance"]');
await page.waitForTimeout(300);
await page.click('[data-mode="dark"]');
await page.waitForTimeout(300);
console.log("theme attr:", await page.getAttribute("html", "data-mode"));
await page.screenshot({ path: "v2-settings-dark.png" });
await page.click('#nav-shelves');
await page.waitForTimeout(200);
await page.screenshot({ path: "v2-dark-grid.png" });
await page.click("#settings-btn");
await page.waitForTimeout(300);
await page.click('[data-go="appearance"]');
await page.waitForTimeout(300);
await page.click('[data-mode="auto"]');
await page.click('#nav-shelves');

// Detail modal still fine
await page.click(".grid-book");
await page.waitForTimeout(400);
console.log("detail has cover-wrap:", (await page.$$("#detail-content .cover-wrap")).length);
console.log("detail stars filled:", (await page.$$("#detail-modal .star-btn.filled")).length);
await page.screenshot({ path: "v2-detail.png" });
await page.click('[data-close="detail-modal"]');

// Empty state on a shelf with nothing
await page.click('[data-shelf="completed"]');
await page.waitForTimeout(300);
console.log("empty text:", await page.textContent("#empty-text"));
console.log("empty action:", await page.textContent("#empty-action"));

// Filters still work after redesign
await page.click('[data-shelf="owned"]');
await page.click("#filter-toggle");
await page.waitForTimeout(200);
await page.$eval('#filter-panel .range-min', (el) => { el.value = 500; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); });
await page.waitForTimeout(200);
console.log("long books:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));
console.log("filter badge:", await page.textContent("#filter-count"));
await page.click("text=Clear all filters");
await page.click("#filter-toggle");

console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
