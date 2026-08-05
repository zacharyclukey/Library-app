// Two things that used to be dead ends when adding a book:
//   · a mistyped ISBN came back "no book found", which reads as "this book
//     doesn't exist" rather than "you fumbled a digit";
//   · a book the free catalogues have never heard of simply could not be
//     recorded, even with the barcode read and the book in your hand.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

const GOOD = "9780593135204"; // Project Hail Mary — real, checksum valid
const TYPO = "9780593135203"; // same but the last digit fumbled

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  // Broadest first — in Playwright the last matching route wins.
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ status: 404, body: "" }));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(new RegExp(`openlibrary\\.org/isbn/${GOOD}\\.json`), (r) =>
    r.fulfill({
      json: {
        title: "Project Hail Mary", isbn_13: [GOOD], number_of_pages: 476,
        publish_date: "2021", physical_format: "Hardcover",
        works: [{ key: "/works/PHM" }], authors: [],
      },
    })
  );
  await page.addInitScript(() => localStorage.setItem("shelfie.profile.v1", "Zach"));
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(400);
  await page.click("#add-book-btn");
  await page.waitForTimeout(200);
  return { ctx, page };
}

const status = async (page) =>
  (await page.textContent("#scan-status")).replace(/\s+/g, " ").trim();
const shelved = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1") ?? "[]"));

// 1. A fumbled digit is named as such, and never reaches the network.
{
  const { ctx, page } = await open();
  let lookups = 0;
  page.on("request", (r) => { if (r.url().includes("/isbn/")) lookups++; });
  await page.fill("#isbn-input", TYPO);
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(700);
  console.log("1. mistyped ISBN");
  console.log("   says:", JSON.stringify(await status(page)));
  console.log("   lookups attempted:", lookups, "(want 0)");
  await ctx.close();
}

// 2. The valid one still sails through — the guard must not block real books.
{
  const { ctx, page } = await open();
  await page.fill("#isbn-input", GOOD);
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(1500);
  console.log("2. valid ISBN still works");
  console.log("   confirm sheet opens:", await page.isVisible("#confirm-modal"));
  await ctx.close();
}

// 3. Hyphens and spaces are fine — that's how ISBNs are printed.
{
  const { ctx, page } = await open();
  await page.fill("#isbn-input", "978-0-593-13520-4");
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(1500);
  console.log("3. ISBN typed with hyphens");
  console.log("   confirm sheet opens:", await page.isVisible("#confirm-modal"));
  await ctx.close();
}

// 4. A book no catalogue knows: the offer appears, and it can be added.
{
  const { ctx, page } = await open();
  await page.fill("#isbn-input", "9781234567897"); // valid checksum, unknown book
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(1500);
  const offered = await page.isVisible("[data-add-by-hand]");
  console.log("4. valid ISBN, no such book in the catalogues");
  console.log("   offers to add it yourself:", offered);
  if (offered) {
    await page.click("[data-add-by-hand]");
    await page.waitForTimeout(300);
    console.log("   ISBN carried into the form:", JSON.stringify(await page.inputValue("#hand-isbn")));
    await page.fill("#hand-title", "The Ninth Rain");
    await page.fill("#hand-author", "Jen Williams");
    await page.fill("#hand-year", "2017");
    await page.fill("#hand-pages", "544");
    await page.click("#by-hand-form button[type=submit]");
    await page.waitForTimeout(600);
    console.log("   confirm sheet opens:", await page.isVisible("#confirm-modal"));
    await page.click('[data-add-shelf="owned"]');
    await page.waitForTimeout(600);
    const books = await shelved(page);
    console.log("   on the shelf:", JSON.stringify(books.map((b) => ({
      title: b.title, authors: b.authors, pages: b.pageCount,
      year: b.publishDate, isbn: b.isbn13, shelf: b.shelf, byHand: b.byHand,
    }))));
  }
  await ctx.close();
}

// 5. A hand-added book keyed by ISBN is found again by scanning it, rather
//    than quietly becoming a second copy.
{
  const { ctx, page } = await open();
  await page.click("#by-hand summary");
  await page.fill("#hand-title", "A Small Press Book");
  await page.fill("#hand-isbn", GOOD);
  await page.click("#by-hand-form button[type=submit]");
  await page.waitForTimeout(400);
  await page.click('[data-add-shelf="owned"]');
  await page.waitForTimeout(600);
  // Now "scan" the same ISBN.
  await page.fill("#isbn-input", GOOD);
  await page.press("#isbn-input", "Enter");
  await page.waitForTimeout(1500);
  const books = await shelved(page);
  console.log("5. scanning a book you added by hand");
  console.log("   says:", JSON.stringify(await status(page)));
  console.log("   copies on the shelf:", books.length, "(want 1)");
  console.log("   title now:", JSON.stringify(books.map((b) => b.title)));
  await ctx.close();
}

// 6. No title, no book — the form shouldn't add an untitled placeholder.
{
  const { ctx, page } = await open();
  await page.click("#by-hand summary");
  await page.fill("#hand-author", "Someone");
  await page.click("#by-hand-form button[type=submit]");
  await page.waitForTimeout(400);
  console.log("6. submitting with no title");
  console.log("   confirm sheet opens:", await page.isVisible("#confirm-modal"), "(want false)");
  console.log("   books stored:", (await shelved(page)).length, "(want 0)");
  await ctx.close();
}

// 7. A title search with no matches offers the same way out, pre-filled.
{
  const { ctx, page } = await open();
  await page.route(/openlibrary\.org\/search\.json.*/, (r) =>
    r.fulfill({ json: { docs: [] } })
  );
  await page.fill("#title-input", "Whispers of the Ledger");
  await page.press("#title-input", "Enter");
  await page.waitForTimeout(1500);
  const offered = await page.isVisible("[data-add-by-hand]");
  console.log("7. title search with no matches");
  console.log("   offers to add it yourself:", offered);
  if (offered) {
    await page.click("[data-add-by-hand]");
    await page.waitForTimeout(300);
    console.log("   title carried into the form:", JSON.stringify(await page.inputValue("#hand-title")));
  }
  await ctx.close();
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
