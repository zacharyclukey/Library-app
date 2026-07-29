// Scanning a book you already have, in every way it can already be there.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const ISBN = "9780593135204";

// Open Library's answer for the scanned barcode.
const EDITION = {
  title: "Project Hail Mary", isbn_13: [ISBN], number_of_pages: 476,
  publish_date: "2021", physical_format: "Hardcover",
  works: [{ key: "/works/PHM" }], authors: [],
};

async function scan(existing) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ status: 404, body: "" }));
  await page.route(new RegExp(`openlibrary\\.org/isbn/${ISBN}\\.json`), (r) => r.fulfill({ json: EDITION }));
  await page.addInitScript((books) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
  }, existing);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(500);
  await page.click("#add-book-btn");
  await page.waitForTimeout(300);
  // The manual ISBN box and the camera both land in handleFoundIsbn().
  await page.fill("#isbn-input", ISBN);
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(1800);
  const sheetOpen = await page.isVisible("#confirm-modal");
  const note = sheetOpen ? (await page.textContent(".dupe-note").catch(() => "(no note)")) : null;
  const status = (await page.textContent("#scan-status")).replace(/\s+/g, " ").trim();
  return { ctx, page, sheetOpen, status, note: note?.replace(/\s+/g, " ").trim() };
}

const base = { title: "Project Hail Mary", authors: ["Andy Weir"], coverUrl: null,
  pageCount: 476, addedAt: "2026-01-01T00:00:00Z", ratings: { Zach: 5 } };

// 1. Exact same copy, already Owned — the case you asked about.
{
  const r = await scan([{ ...base, id: "isbn:" + ISBN, isbn13: ISBN, workKey: "/works/PHM",
    shelf: "owned", owned: true }]);
  console.log("1. same copy, already Owned");
  console.log("   sheet opens:", r.sheetOpen, "| says:", JSON.stringify(r.status));
  await r.ctx.close();
}

// 2. Same copy, but it's on the Wishlist — you just bought it.
{
  const r = await scan([{ ...base, id: "isbn:" + ISBN, isbn13: ISBN, workKey: "/works/PHM",
    shelf: "wishlist", owned: false }]);
  console.log("2. same copy, on the Wishlist");
  console.log("   sheet opens:", r.sheetOpen, "| note:", JSON.stringify(r.note));
  if (r.sheetOpen) {
    await r.page.click('[data-add-shelf="owned"]');
    await r.page.waitForTimeout(600);
    console.log("   after tapping Owned:", await r.page.evaluate(() =>
      JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) =>
        ({ id: b.id, shelf: b.shelf, owned: b.owned, rating: b.ratings?.Zach }))));
  }
  await r.ctx.close();
}

// 3. Added earlier by title search, so no ISBN on the record — now scanned.
{
  const r = await scan([{ ...base, id: "ol:PHM", workKey: "/works/PHM",
    shelf: "owned", owned: true }]);
  console.log("3. added by title search (no ISBN), now scanned");
  console.log("   sheet opens:", r.sheetOpen, "| says:", JSON.stringify(r.status));
  console.log("   record now:", await r.page.evaluate(() =>
    JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) =>
      ({ id: b.id, isbn: b.isbn13 ?? null, format: b.format ?? null, pages: b.pageCount,
         shelf: b.shelf, rating: b.ratings?.Zach }))));
  if (r.sheetOpen) {
    await r.page.click('[data-add-shelf="owned"]');
    await r.page.waitForTimeout(600);
    console.log("   after tapping Owned:", await r.page.evaluate(() =>
      JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) =>
        ({ id: b.id, isbn: b.isbn13, format: b.format, rating: b.ratings?.Zach }))));
  }
  await r.ctx.close();
}

// 4. A genuinely different edition of a book you own.
{
  const r = await scan([{ ...base, id: "isbn:9780593135211", isbn13: "9780593135211",
    workKey: "/works/PHM", shelf: "owned", owned: true, format: "Paperback" }]);
  console.log("4. different edition of a book you own");
  console.log("   sheet opens:", r.sheetOpen, "| note:", JSON.stringify(r.note));
  if (r.sheetOpen) {
    await r.page.click('[data-add-shelf="owned"]');
    await r.page.waitForTimeout(600);
    console.log("   both editions kept:", await r.page.evaluate(() =>
      JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) => b.isbn13)));
  }
  await r.ctx.close();
}

// 4b. "Open it" turns a scan into a way to find the book on a big shelf.
{
  const r = await scan([{ ...base, id: "isbn:" + ISBN, isbn13: ISBN, workKey: "/works/PHM",
    shelf: "owned", owned: true }]);
  console.log("4b. scan-to-find on an owned book");
  console.log("   offers a way through:", await r.page.isVisible("[data-open-existing]"));
  await r.page.click("[data-open-existing]");
  await r.page.waitForTimeout(700);
  console.log("   opens the book:", await r.page.isVisible("#detail-modal"),
    "|", (await r.page.textContent("#detail-content")).replace(/\s+/g, " ").trim().slice(0, 40));
  await r.ctx.close();
}

// 5. A book you don't have at all — no note, normal flow.
{
  const r = await scan([{ ...base, id: "other", title: "Something Else",
    workKey: "/works/OTHER", shelf: "owned", owned: true }]);
  console.log("5. a book you don't have");
  console.log("   sheet opens:", r.sheetOpen, "| note:", JSON.stringify(r.note));
  await r.ctx.close();
}

// 6. Same copy on Finished — rescanning shouldn't lose the rating.
{
  const r = await scan([{ ...base, id: "isbn:" + ISBN, isbn13: ISBN, workKey: "/works/PHM",
    shelf: "completed", owned: true }]);
  console.log("6. same copy on Finished");
  console.log("   sheet opens:", r.sheetOpen, "| note:", JSON.stringify(r.note));
  if (r.sheetOpen) {
    await r.page.click('[data-add-shelf="owned"]');
    await r.page.waitForTimeout(600);
    console.log("   rating survived the re-add:", await r.page.evaluate(() =>
      JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) =>
        ({ shelf: b.shelf, rating: b.ratings?.Zach }))));
  }
  await r.ctx.close();
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
