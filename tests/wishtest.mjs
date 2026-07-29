import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 850 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });
await page.route(/openlibrary|googleapis|gstatic/, (r) => r.abort());

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    {
      id: "isbn:9780439064873",
      title: "Harry Potter and the Chamber of Secrets",
      authors: ["J. K. Rowling"], isbn13: "9780439064873", isbn10: "0439064872",
      publisher: "Scholastic", publishDate: "1999", format: "Paperback",
      workKey: "/works/OL16313124W", coverUrl: null, shelf: "owned", owned: true,
      series: { name: "Harry Potter", position: 2 }, rating: 4,
    },
    {
      id: "ol:OL82563W", title: "Harry Potter and the Philosopher's Stone",
      authors: ["J. K. Rowling"], workKey: "/works/OL82563W",
      shelf: "wishlist", owned: false, coverUrl: null,
      series: { name: "Harry Potter", position: 1 },
    },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(500);

// Four tabs with counts
for (const s of ["owned", "tbr", "completed", "wishlist"]) {
  console.log(s, "count:", await page.textContent(`#count-${s}`));
}
// Rating stars on card
console.log("card stars:", await page.textContent(".grid-rating"));

// Wishlist tab shows the wishlisted book
await page.click('[data-shelf="wishlist"]');
await page.waitForTimeout(200);
console.log("wishlist book:", await page.textContent(".grid-title"));

// Open its detail: Amazon link should be a search link (no ISBN)
await page.click(".grid-book");
await page.waitForTimeout(300);
await page.click("#detail-content .d-section summary:has-text('Find a copy')");
await page.waitForTimeout(200);
console.log("amazon (no isbn):", await page.getAttribute(".store-link", "href"));
console.log("move buttons:", (await page.$$eval("[data-move]", (els) => els.map((e) => e.dataset.move))).join(","));

// Rate it 5 stars
await page.click('[data-rate="5"]');
await page.waitForTimeout(200);
console.log("stars after rating:", (await page.$$eval(".star-btn.filled", (els) => els.length)));

// Move to Owned (bought it) — owned flag should flip
await page.click('[data-move="owned"]');
await page.waitForTimeout(200);
const lib = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")));
const moved = lib.find((b) => b.id === "ol:OL82563W");
console.log("moved:", moved.shelf, "owned:", moved.owned, "rating:", moved.rating);

// Owned book detail: direct Amazon dp link via ISBN-10
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(200);
await page.click(".grid-book"); // first card
await page.waitForTimeout(300);
await page.click("#detail-content .d-section summary:has-text('Find a copy')");
await page.waitForTimeout(200);
const href = await page.getAttribute(".store-link", "href");
console.log("amazon (isbn10):", href);

// Confirm-modal shelf choices include wishlist
await page.click('[data-close="detail-modal"]');
console.log("wishlist add btn exists:", !!(await page.$('[data-add-shelf="wishlist"]')));

await page.screenshot({ path: "/tmp/claude-0/-home-user-Library-app/053665e6-83c2-568b-bd49-b069416722f6/scratchpad/wish.png" });
console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
