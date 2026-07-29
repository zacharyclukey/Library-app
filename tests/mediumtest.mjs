import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });

await page.route(/openlibrary/, (r) => r.fulfill({ json: {} }));
await page.route(/openlibrary\.org\/isbn\/9780593135204\.json/, (r) =>
  r.fulfill({ json: {
    title: "Project Hail Mary", authors: [{ key: "/authors/OL1A" }],
    publishers: ["Ballantine"], publish_date: "2021", number_of_pages: 476,
    isbn_13: ["9780593135204"], key: "/books/OL1M", works: [{ key: "/works/OL1W" }],
  } })
);
await page.route(/openlibrary\.org\/authors\/.*\.json/, (r) => r.fulfill({ json: { name: "Andy Weir" } }));
await page.route(/googleapis|gstatic|covers/, (r) => r.abort());

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.trackMedium.v1", "1");  // feature is opt-in
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "isbn:1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "completed",
      owned: true, coverUrl: null, medium: "print", addedAt: "2026-01-05T00:00:00Z", profile: "Zach" },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(400);

// --- Add an Audible listen (Finished, not owned) ---
await page.click("#add-book-btn");
await page.fill("#isbn-input", "9780593135204");
await page.click('#isbn-form button[type="submit"]');
await page.waitForTimeout(700);
console.log("medium chips shown:", await page.$$eval("#medium-choice .filter-chip", (e) => e.map((x) => x.textContent.trim())));
await page.click('[data-medium="audio"]');
await page.uncheck("#also-own-checkbox");
await page.click('[data-add-shelf="completed"]');
await page.waitForTimeout(300);
await page.click('[data-close="add-modal"]');
await page.waitForTimeout(200);

const saved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.title === "Project Hail Mary"));
console.log("saved medium:", saved.medium, "| owned:", saved.owned, "| shelf:", saved.shelf);

// --- Card shows the audiobook marker on the Finished shelf ---
await page.click('[data-shelf="completed"]');
await page.waitForTimeout(300);
console.log("grid audio marker:", (await page.$$eval(".mini-badge.medium", (e) => e.map((x) => x.textContent))).join(""));

// list view badge
await page.click("#view-toggle");
await page.waitForTimeout(300);
const badges = await page.$$eval(".medium-badge", (e) => e.map((x) => x.textContent.trim()));
console.log("list badge:", badges);
console.log("badge shows not owned:", badges.some((b) => b.includes("not owned")));
await page.click("#view-toggle");
await page.waitForTimeout(200);

// --- Filter by Audiobook ---
await page.click("#filter-toggle");
await page.waitForTimeout(200);
await page.click('#filter-panel .filter-chip:has-text("Audiobook")');
await page.waitForTimeout(200);
console.log("audio filter:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));
await page.click('#filter-panel .filter-chip:has-text("E-book")');
await page.waitForTimeout(200);
console.log("ebook filter (none):", (await page.$$(".grid-title")).length === 0);
await page.click("text=Clear all filters");
await page.click("#filter-toggle");

// --- Detail: copy row, switch medium, toggle owned ---
await page.click('.grid-book[title="Project Hail Mary"]');
await page.waitForTimeout(400);
const detail = await page.textContent("#detail-content");
console.log("detail copy row:", detail.includes("Audiobook") && detail.includes("not owned"));
await page.click('[data-set-medium="ebook"]');
await page.waitForTimeout(300);
console.log("switched to ebook:", (await page.textContent("#detail-content")).includes("E-book"));
await page.click("[data-owned-toggle]");
await page.waitForTimeout(300);
console.log("owned after toggle:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.title === "Project Hail Mary").owned));
// series 'owned' logic counts it now
console.log("counts as owned for series:", (await page.textContent("#detail-content")).includes("· owned"));
await page.click('[data-close="detail-modal"]');

// --- CSV includes copy type ---
await page.click("#export-btn");
await page.waitForTimeout(300);
await page.click('[data-scope="all"]');
await page.waitForTimeout(200);
const dl = page.waitForEvent("download");
await page.click('[data-format="csv"]');
const file = await dl;
const path = await file.path();
const { readFileSync } = await import("node:fs");
const csv = readFileSync(path, "utf8");
console.log("csv header has Copy type:", csv.split("\n")[0].includes("Copy type"));
console.log("csv row has e-book:", csv.includes("e-book"));

await page.screenshot({ path: "medium.png" });
console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
