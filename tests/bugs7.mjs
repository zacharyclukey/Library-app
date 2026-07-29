// Round 7 — the paths that touch the network: adding a book by search/ISBN
// and the Discover screen. What happens when the APIs are slow, broken,
// empty, or return nonsense?
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function phone(routes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    // This suite serves 500s and 404s on purpose; only unexpected errors count.
    if (m.type() === "error" && !/net::ERR|\b(404|500)\b/.test(m.text())) errors.push("CONSOLE: " + m.text());
  });
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await routes(page);
  await page.addInitScript(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify([
      { id: "own1", title: "Owned Fantasy", authors: ["Fanta Author"], shelf: "owned", owned: true,
        coverUrl: null, workKey: "/works/OWN1", pageCount: 400, ratings: { Zach: 5 },
        addedAt: "2026-01-01T00:00:00Z" },
      { id: "own2", title: "Second Fantasy", authors: ["Fanta Author"], shelf: "completed", owned: true,
        coverUrl: null, workKey: "/works/OWN2", pageCount: 350, ratings: { Zach: 4 },
        addedAt: "2026-01-02T00:00:00Z" },
      { id: "own3", title: "Third Book", authors: ["Other Author"], shelf: "owned", owned: true,
        coverUrl: null, workKey: "/works/OWN3", pageCount: 250, addedAt: "2026-01-03T00:00:00Z" },
    ]));
  });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(600);
  return { ctx, page };
}

const discoverText = async (page) =>
  (await page.textContent("#discover-content")).replace(/\s+/g, " ").trim().slice(0, 110);

// ---- 1. search API returns a 500 ----
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org/, (r) => r.fulfill({ status: 500, body: "boom" }));
  });
  await page.click("#add-book-btn");
  await page.waitForTimeout(400);
  await page.fill("#title-input", "anything").catch(() => {});
  await page.press("#title-input", "Enter").catch(() => {});
  await page.waitForTimeout(2000);
  const msg = (await page.textContent("#scan-status")).replace(/\s+/g, " ").trim();
  console.log("1. search with a 500 says:", JSON.stringify(msg));
  await page.click('[data-close="add-modal"]').catch(() => {});
  await page.click("#discover-btn");
  await page.waitForTimeout(2500);
  console.log("2. discover with a 500:", await discoverText(page));
  await ctx.close();
}

// ---- 2. APIs return empty result sets ----
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org\/search\.json/, (r) => r.fulfill({ json: { docs: [] } }));
    await p.route(/openlibrary\.org\/works\/.*\.json/, (r) => r.fulfill({ json: { subjects: [] } }));
  });
  await page.click("#discover-btn");
  await page.waitForTimeout(2500);
  console.log("3. discover with no results:", await discoverText(page));
  await ctx.close();
}

// ---- 3. APIs return nonsense shapes ----
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org\/search\.json/, (r) =>
      r.fulfill({ json: { docs: [
        null,
        "a string",
        { /* no key, no title */ },
        { key: "/works/W1", title: null, author_name: "not an array", ratings_average: "high",
          number_of_pages_median: "many", first_publish_year: "recently" },
        { key: "/works/W2", title: { obj: 1 }, author_name: [null], ratings_count: -5 },
        { key: "/works/W3", title: "Actually Fine", author_name: ["Real Person"],
          first_publish_year: 2020, ratings_average: 4.2, ratings_count: 100,
          number_of_pages_median: 320 },
      ] } }));
    await p.route(/openlibrary\.org\/works\/.*\.json/, (r) =>
      r.fulfill({ json: { subjects: [null, 12, { a: 1 }, "Fantasy"] } }));
  });
  await page.click("#discover-btn");
  await page.waitForTimeout(3000);
  const recTitles = await page.$$eval("#discover-content .series-title strong", (e) => e.map((x) => x.textContent));
  console.log("4. discover with junk API rows:", recTitles);
  console.log("5. still offers to wishlist:", (await page.$$("[data-rec-idx]")).length, "buttons");
  if ((await page.$$("[data-rec-idx]")).length) {
    await page.click("[data-rec-idx='0']");
    await page.waitForTimeout(600);
    console.log("6. wishlisting a junk rec saved:", await page.evaluate(() =>
      JSON.parse(localStorage.getItem("shelfie.library.v1")).filter((b) => b.shelf === "wishlist")
        .map((b) => ({ id: b.id, title: b.title, authors: b.authors }))));
  }
  await ctx.close();
}

// ---- 4. APIs that never answer ----
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org/, () => { /* hang forever */ });
  });
  await page.click("#discover-btn");
  await page.waitForTimeout(3000);
  console.log("7. discover while the API hangs:", await discoverText(page));
  await page.click("#nav-shelves");
  await page.waitForTimeout(500);
  console.log("8. can leave the hanging screen:", await page.$eval(".screen.active", (e) => e.id),
    "| shelf still works:", (await page.$$(".grid-book")).length, "cards");
  await ctx.close();
}

// ---- 5. adding the same book twice ----
{
  const { ctx, page } = await phone(async (p) => {
    await p.route(/openlibrary\.org\/search\.json/, (r) =>
      r.fulfill({ json: { docs: [{ key: "/works/DUP", title: "Owned Fantasy",
        author_name: ["Fanta Author"], first_publish_year: 2001,
        editions: { docs: [{ key: "/books/E1", title: "Owned Fantasy", isbn: ["9781234567897"],
          publish_date: "2001", number_of_pages: 400, physical_format: "Paperback" }] } }] } }));
    await p.route(/openlibrary\.org\/works\/.*\.json/, (r) => r.fulfill({ json: { subjects: ["Fantasy"] } }));
  });
  const startCount = await page.textContent("#count-owned");
  await page.click("#add-book-btn");
  await page.waitForTimeout(400);
  await page.fill("#title-input", "Owned Fantasy").catch(() => {});
  await page.press("#title-input", "Enter").catch(() => {});
  await page.waitForTimeout(2000);
  const results = await page.$$(".search-result");
  console.log("9. search results shown:", results.length);
  if (results.length) {
    await results[0].click();
    await page.waitForTimeout(1200);
    const addBtn = await page.$('[data-add-shelf="owned"]');
    if (addBtn) { await addBtn.click(); await page.waitForTimeout(900); }
  }
  console.log("10. owned count", startCount, "→", await page.textContent("#count-owned"),
    "| total records:", await page.evaluate(() =>
      JSON.parse(localStorage.getItem("shelfie.library.v1")).length));
  await ctx.close();
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
