// Round 8 — the duplicate-add guard, and what Discover actually says when
// there's nothing to show.
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function phone(routes, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await routes(page);
  await page.addInitScript((books) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
  }, seed);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(600);
  return { ctx, page };
}

const MANY = [
  { id: "m1", title: "Mistborn", authors: ["Brandon Sanderson"], shelf: "owned", owned: true,
    coverUrl: null, workKey: "/works/M1", ratings: { Zach: 5 }, addedAt: "2026-01-01T00:00:00Z" },
  { id: "m2", title: "Elantris", authors: ["Brandon Sanderson"], shelf: "owned", owned: true,
    coverUrl: null, workKey: "/works/M2", ratings: { Zach: 4 }, addedAt: "2026-01-02T00:00:00Z" },
  { id: "m3", title: "The Name of the Wind", authors: ["Patrick Rothfuss"], shelf: "completed",
    owned: true, coverUrl: null, workKey: "/works/M3", ratings: { Zach: 5 }, addedAt: "2026-01-03T00:00:00Z" },
];

const HAVE = [
  { id: "ol:SAME", title: "Project Hail Mary", authors: ["Andy Weir"], shelf: "owned", owned: true,
    coverUrl: null, workKey: "/works/SAME", isbn13: "9780593135204", pageCount: 476,
    ratings: { Zach: 5 }, addedAt: "2026-01-01T00:00:00Z" },
];

// same work, different edition
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org/, (r) => r.fulfill({ status: 404, body: "" }));
    await p.route(/openlibrary\.org\/search\.json/, (r) =>
      r.fulfill({ json: { docs: [{ key: "/works/SAME", title: "Project Hail Mary",
        author_name: ["Andy Weir"], first_publish_year: 2021 }] } }));
  }, HAVE);
  await page.click("#add-book-btn");
  await page.waitForTimeout(300);
  await page.fill("#title-input", "Project Hail Mary");
  await page.press("#title-input", "Enter");
  await page.waitForTimeout(1500);
  await page.click(".search-result");
  await page.waitForTimeout(1200);
  console.log("1. warns about a different edition:",
    JSON.stringify((await page.textContent(".dupe-note").catch(() => "(none)")).trim()));
  await page.click('[data-add-shelf="tbr"]');
  await page.waitForTimeout(600);
  console.log("2. user chose to add it anyway, records:", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) => b.id + "/" + b.shelf)));
  await ctx.close();
}

// exact same edition (matching ISBN) — must merge, not duplicate
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org/, (r) => r.fulfill({ status: 404, body: "" }));
    await p.route(/openlibrary\.org\/isbn\/.*\.json/, (r) =>
      r.fulfill({ json: { title: "Project Hail Mary", isbn_13: ["9780593135204"],
        number_of_pages: 476, publish_date: "2021", physical_format: "Hardcover",
        works: [{ key: "/works/SAME" }], authors: [] } }));
  }, HAVE);
  await page.click("#add-book-btn");
  await page.waitForTimeout(300);
  await page.fill("#isbn-input", "9780593135204");
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(2000);
  // Scanning a copy you already own on the Owned shelf doesn't ask anything —
  // it says so and offers to open the book (see scandupe.mjs).
  console.log("3. scanning an owned copy:", (await page.textContent("#scan-status")).replace(/\s+/g, " ").trim());
  console.log("4. no second record:", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) =>
      ({ id: b.id, shelf: b.shelf, rating: b.ratings?.Zach }))));
  await ctx.close();
}

// what Discover says with nothing to show
for (const [name, route] of [
  ["server error", (r) => r.fulfill({ status: 500, body: "boom" })],
  ["empty results", (r) => r.fulfill({ json: { docs: [] } })],
]) {
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org/, route);
  }, MANY);
  await page.click("#discover-btn");
  await page.waitForTimeout(3000);
  const text = (await page.textContent("#discover-content")).replace(/\s+/g, " ").trim();
  console.log(`6. discover (${name}) ends with:`, JSON.stringify(text.slice(-140)));
  await ctx.close();
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
