import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
const errors = [];
const searchQueries = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });

await page.route(/openlibrary\.org\/works\/.*\.json/, (r) =>
  r.fulfill({ json: { subjects: ["Fantasy fiction", "Magic"] } })
);
await page.route(/openlibrary\.org\/search\.json/, (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get("q"));
  searchQueries.push(q);
  r.fulfill({
    json: {
      docs: [
        { key: "/works/OLr1W", title: "Long Old Fantasy", author_name: ["A"], first_publish_year: 1990, ratings_average: 4.5, ratings_count: 500, number_of_pages_median: 700 },
        { key: "/works/OLr2W", title: "Short New Fantasy", author_name: ["B"], first_publish_year: 2025, ratings_average: 4.2, ratings_count: 300, number_of_pages_median: 250 },
      ],
    },
  });
});
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "isbn:1", title: "Epic Quest", authors: ["Fanta Author"], shelf: "owned", owned: true,
      subjects: ["Fantasy fiction", "Magic"], pageCount: 650, publishDate: "1998",
      series: { name: "Quest", position: 1 }, workKey: "/works/OLq1W", coverUrl: null,
      ratings: { Zach: 5 }, addedAt: "2026-01-02T00:00:00Z", format: "Hardcover" },
    { id: "isbn:2", title: "Space Case", authors: ["Sci Author"], shelf: "owned", owned: true,
      subjects: ["Science fiction"], pageCount: 280, publishDate: "2025",
      series: null, workKey: "/works/OLs1W", coverUrl: null,
      addedAt: "2026-01-03T00:00:00Z", format: "Paperback" },
    { id: "isbn:3", title: "Murder Manor", authors: ["Mys Author"], shelf: "owned", owned: true,
      subjects: ["Detective and mystery stories"], pageCount: 400, publishDate: "2016",
      series: null, coverUrl: null, addedAt: "2026-01-01T00:00:00Z" },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(500);

const titles = () => page.$$eval(".grid-title", (els) => els.map((e) => e.textContent));

// Open filter panel
await page.click("#filter-toggle");
await page.waitForTimeout(200);
const labels = await page.$$eval("#filter-panel .filter-label", (els) => els.map((e) => e.textContent));
console.log("filter groups:", labels.map((l) => l.split(" ")[0]).join(", "));
const genreChips = await page.$$eval("#filter-panel .filter-group:first-child .filter-chip", (els) => els.map((e) => e.textContent));
console.log("genre chips:", genreChips.join(", "));

// Genre filter: Fantasy -> Epic Quest only
await page.click('#filter-panel .filter-chip:has-text("Fantasy")');
await page.waitForTimeout(200);
console.log("genre=Fantasy:", await titles());
console.log("badge:", await page.textContent("#filter-count"));

// Clear, then length filter short -> Space Case
await page.click('text=Clear all filters');
await page.waitForTimeout(200);
await page.$eval('#filter-panel .range-max', (el) => { el.value = 300; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); });
await page.waitForTimeout(200);
console.log("length=short:", await titles());
await page.click('text=Clear all filters');

// Series filter
await page.click('#filter-panel .filter-chip:has-text("In a series")');
await page.waitForTimeout(150);
console.log("series:", await titles());
await page.click('#filter-panel .filter-chip:has-text("Standalone")');
await page.waitForTimeout(150);
console.log("standalone:", await titles());
await page.click('text=Clear all filters');

// Age filter: 20+ yrs -> Epic Quest (1998)
await page.click('#filter-panel .filter-chip:has-text("20+ yrs old")');
await page.waitForTimeout(150);
console.log("classic:", await titles());
await page.click('text=Clear all filters');

// Sort: shortest first
await page.click('#filter-panel [data-sort="shortest"]');
await page.waitForTimeout(150);
console.log("sort shortest:", await titles());
await page.click('#filter-panel [data-sort="title"]');
await page.waitForTimeout(150);
console.log("sort title:", await titles());
await page.click('text=Clear all filters');
await page.click("#filter-toggle"); // close panel

// ---- Discover with filters ----
await page.click("#discover-btn");
await page.waitForTimeout(700);
console.log("recs unfiltered:", await page.$$eval("#discover-content .series-title strong", (els) => els.map((e) => e.textContent)));

searchQueries.length = 0;
await page.click('#discover-content .filter-chip:has-text("Fantasy")');
await page.waitForTimeout(700);
console.log("genre queries include subject:", searchQueries.every((q) => q.includes('subject:"fantasy"')));
console.log("sample query:", searchQueries[0]);

// Add length filter: short -> only the 250-page rec should remain
await page.$eval('#discover-content .range-max', (el) => { el.value = 300; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); });
await page.waitForTimeout(700);
console.log("recs short+fantasy:", await page.$$eval("#discover-content .series-title strong", (els) => els.map((e) => e.textContent)));

await page.screenshot({ path: "filters.png" });
console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
