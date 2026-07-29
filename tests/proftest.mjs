import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });

// Mock Open Library for the Discover flow; block everything else external.
await page.route(/openlibrary\.org\/works\/.*\.json/, (r) =>
  r.fulfill({ json: { subjects: ["Fantasy fiction", "Magic", "Wizards"] } })
);
await page.route(/openlibrary\.org\/search\.json/, (r) =>
  r.fulfill({
    json: {
      docs: [
        { key: "/works/OLrec1W", title: "The Name of the Wind", author_name: ["Patrick Rothfuss"], first_publish_year: 2007, cover_i: 5, ratings_average: 4.4, ratings_count: 900 },
        { key: "/works/OLrec2W", title: "Mistborn", author_name: ["Brandon Sanderson"], first_publish_year: 2006, cover_i: 6, ratings_average: 4.3, ratings_count: 800 },
      ],
    },
  })
);
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "isbn:1", title: "Book A", authors: ["Author One"], shelf: "owned", owned: true,
      workKey: "/works/OLa1W", coverUrl: null, ratings: { Zach: 5, Amy: 3 } },
    { id: "isbn:2", title: "Book B", authors: ["Author Two"], shelf: "wishlist", owned: false,
      profile: "Zach", coverUrl: null },
    { id: "isbn:3", title: "Book C", authors: ["Author Three"], shelf: "wishlist", owned: false,
      profile: "Amy", coverUrl: null },
    { id: "isbn:4", title: "Different Thing", authors: ["Author Four"], shelf: "owned", owned: true, coverUrl: null },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(500);

console.log("profile chip:", await page.textContent("#profile-chip"));

// Owned shelf: no member filter shown, but search works
console.log("owned cards:", (await page.$$(".grid-book")).length);
await page.fill("#list-search", "different");
await page.waitForTimeout(150);
console.log("after search:", (await page.$$eval(".grid-title", (els) => els.map((e) => e.textContent))));
await page.fill("#list-search", "");

// Wishlist shelf: defaults to Mine (Zach) -> only Book B
await page.click('[data-shelf="wishlist"]');
await page.waitForTimeout(200);
console.log("wishlist Mine:", await page.$$eval(".grid-title", (els) => els.map((e) => e.textContent)));
console.log("filter chips:", await page.$$eval(".filter-chip", (els) => els.map((e) => e.textContent.trim())));

// Switch to Everyone -> both wishlist books
await page.click('[data-filter="all"]');
await page.waitForTimeout(200);
console.log("wishlist Everyone:", await page.$$eval(".grid-title", (els) => els.map((e) => e.textContent)));

// Amy's view
await page.click('[data-filter="Amy"]');
await page.waitForTimeout(200);
console.log("wishlist Amy:", await page.$$eval(".grid-title", (els) => els.map((e) => e.textContent)));

// Detail: per-person ratings + assign chips
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(200);
await page.click(".grid-book");
await page.waitForTimeout(300);
console.log("my stars filled:", (await page.$$(".star-btn.filled")).length);
console.log("other rating shown:", (await page.textContent("#detail-content")).includes("Amy"));
await page.click('[data-assign="Amy"]');
await page.waitForTimeout(200);
const lib = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")));
console.log("assigned:", lib.find((b) => b.id === "isbn:1").profile);
await page.click('[data-close="detail-modal"]');

// Discover
await page.click("#discover-btn");
await page.waitForTimeout(800);
const recTitles = await page.$$eval("#discover-content .series-title strong", (els) => els.map((e) => e.textContent));
console.log("recs:", recTitles);
// wishlist one
await page.click('[data-rec-idx="0"]');
await page.waitForTimeout(200);
const lib2 = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")));
const added = lib2.find((b) => b.id.startsWith("ol:OLrec"));
console.log("rec wishlisted:", added?.title, added?.shelf, added?.profile);

// Profile modal
await page.click("#screen-discover .back-btn");
await page.click("#profile-chip");
await page.waitForTimeout(200);
console.log("profile options:", await page.$$eval("[data-pick-profile]", (els) => els.map((e) => e.textContent.trim())));

await page.screenshot({ path: "prof.png" });
console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
