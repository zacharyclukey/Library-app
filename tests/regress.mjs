import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });

// --- mocked Open Library ---
await page.route(/openlibrary\.org\/isbn\/9780439064873\.json/, (r) =>
  r.fulfill({ json: {
    title: "Harry Potter and the Chamber of Secrets", authors: [{ key: "/authors/OL23919A" }],
    publishers: ["Scholastic"], publish_date: "1999", number_of_pages: 341,
    physical_format: "Paperback", isbn_10: ["0439064872"], isbn_13: ["9780439064873"],
    key: "/books/OL22856696M", works: [{ key: "/works/OL16313124W" }], series: ["Harry Potter (2)"],
  } })
);
await page.route(/openlibrary\.org\/authors\/.*\.json/, (r) => r.fulfill({ json: { name: "J. K. Rowling" } }));
await page.route(/openlibrary\.org\/works\/.*\/editions\.json/, (r) => r.fulfill({ json: { entries: [] } }));
await page.route(/openlibrary\.org\/works\/.*\.json/, (r) => r.fulfill({ json: { subjects: ["Fantasy fiction", "Magic"] } }));
await page.route(/openlibrary\.org\/search\.json/, (r) =>
  r.fulfill({ json: { docs: [
    { key: "/works/OLa1W", title: "Harry Potter and the Philosopher's Stone", author_name: ["J. K. Rowling"], first_publish_year: 1997, ratings_average: 4.5, ratings_count: 900, number_of_pages_median: 320 },
    { key: "/works/OLa2W", title: "Harry Potter and the Chamber of Secrets", author_name: ["J. K. Rowling"], first_publish_year: 1998, ratings_average: 4.3, ratings_count: 800, number_of_pages_median: 341 },
  ] } })
);
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "isbn:9", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "tbr", owned: true,
      coverUrl: null, pageCount: 245, publishDate: "2020", profile: "Zach", addedAt: "2026-01-02T00:00:00Z" },
    { id: "isbn:8", title: "Circe", authors: ["Madeline Miller"], shelf: "tbr", owned: true,
      coverUrl: null, publishDate: "2018", profile: "Amy", addedAt: "2026-01-03T00:00:00Z" },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(500);

// 1. Add flow: manual ISBN -> confirm -> pick shelf
await page.click("#add-book-btn");
await page.fill("#isbn-input", "9780439064873");
await page.click('#isbn-form button[type="submit"]');
await page.waitForTimeout(700);
console.log("confirm shows:", (await page.textContent("#confirm-book")).includes("Chamber of Secrets"));
console.log("confirm cover fallback:", (await page.$$("#confirm-book .cover-wrap")).length);
await page.click('[data-add-shelf="owned"]');
await page.waitForTimeout(400);
await page.click('[data-close="add-modal"]');
await page.waitForTimeout(200);
console.log("owned count:", await page.textContent("#count-owned"));

// 2. Detail modal + series section + rating
await page.click(".grid-book");
await page.waitForTimeout(900);
const detail = await page.textContent("#detail-content");
console.log("detail has ISBN:", detail.includes("9780439064873"));
console.log("series section:", (await page.textContent("#series-section")).replace(/\s+/g, " ").slice(0, 80));
await page.click('[data-rate="4"]');
await page.waitForTimeout(300);
console.log("stars after rate:", (await page.$$("#detail-modal .star-btn.filled")).length);
console.log("store links:", (await page.$$(".store-link")).length);
await page.click('[data-close="detail-modal"]');

// 3. Personal shelf profile filters
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(300);
console.log("tbr mine:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));
await page.click('[data-filter="all"]');
await page.waitForTimeout(200);
console.log("tbr everyone:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));

// 4. Discover
await page.click("#discover-btn");
await page.waitForTimeout(900);
console.log("discover recs:", await page.$$eval("#discover-content .series-title strong", (e) => e.map((x) => x.textContent)));
await page.click('#discover-content .filter-chip:has-text("Fantasy")');
await page.waitForTimeout(800);
const recCount = (await page.$$("#discover-content .series-title")).length;
console.log("recs with genre filter:", recCount);
// wishlist one from discover
if (recCount) {
  await page.click('[data-rec-idx="0"]');
  await page.waitForTimeout(300);
  console.log("wishlist count:", await page.textContent("#count-wishlist"));
}
await page.click('#nav-shelves');

// 5. Export "Everything" scope
await page.click("#export-btn");
await page.waitForTimeout(300);
await page.click('[data-scope="all"]');
await page.waitForTimeout(200);
console.log("export all:", (await page.textContent(".export-preview")).replace(/\s+/g, " ").trim());
await page.click('#nav-shelves');

console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
