// Selecting several books and moving them in one go.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
});
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));

const lib = Array.from({ length: 12 }, (_, i) => ({
  id: "b" + i, title: `Book ${String(i).padStart(2, "0")}`, authors: [`Author ${i % 3}`],
  shelf: i < 8 ? "owned" : "tbr", owned: true, coverUrl: null, pageCount: 200 + i * 10,
  reading: i === 9, ratings: i < 2 ? { Zach: 4 } : undefined,
  addedAt: new Date(2026, 0, 1 + i).toISOString(),
}));
await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, lib);
await page.goto("http://localhost:8765/");
await page.waitForTimeout(800);

const shelfOf = (id) => page.evaluate((x) =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === x)?.shelf, id);
const counts = async () => ({
  owned: await page.textContent("#count-owned"), tbr: await page.textContent("#count-tbr"),
  done: await page.textContent("#count-completed"), wish: await page.textContent("#count-wishlist"),
});

console.log("1. counts to start:", JSON.stringify(await counts()));
console.log("2. no bulk bar until asked:", await page.isHidden("#bulk-bar"));

// Enter select mode.
await page.click("#select-toggle");
await page.waitForTimeout(500);
console.log("3. bulk bar up:", await page.isVisible("#bulk-bar"),
  "| bottom nav stands aside:", await page.isHidden(".bottom-nav"));
console.log("4. every card offers a tick:", (await page.$$(".pick-dot")).length);
console.log("5. move buttons wait for a selection:",
  await page.$eval('[data-bulk-move="tbr"]', (e) => e.disabled));

// Tapping picks rather than opening.
await page.click('.grid-book[data-id="b0"]');
await page.waitForTimeout(300);
console.log("6. a tap picks, nothing opens:", await page.isHidden("#detail-modal"),
  "| marked:", await page.$eval('.grid-book[data-id="b0"]', (e) => e.classList.contains("picked")),
  "|", await page.textContent("#bulk-count"));

await page.click('.grid-book[data-id="b1"]');
await page.click('.grid-book[data-id="b2"]');
await page.waitForTimeout(300);
console.log("7. three picked:", await page.textContent("#bulk-count"));
await page.click('.grid-book[data-id="b2"]'); // tap again to unpick
await page.waitForTimeout(300);
console.log("8. tapping again unpicks:", await page.textContent("#bulk-count"));

// Move them.
await page.click('[data-bulk-move="completed"]');
await page.waitForTimeout(700);
console.log("9. moved:", await shelfOf("b0"), await shelfOf("b1"), "| b2 untouched:", await shelfOf("b2"));
console.log("10. counts now:", JSON.stringify(await counts()));
console.log("11. select mode ends itself:", await page.isHidden("#bulk-bar"));
console.log("12. one undo for the batch:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click(".toast-action");
await page.waitForTimeout(700);
console.log("13. undo put both back:", await shelfOf("b0"), await shelfOf("b1"),
  "| counts:", JSON.stringify(await counts()));

// Select all, respecting the current filter.
await page.click("#select-toggle");
await page.waitForTimeout(400);
await page.fill("#list-search", "Book 0");
await page.waitForTimeout(500);
console.log("14. select-all offers only what's shown:", await page.textContent("#bulk-all"));
await page.click("#bulk-all");
await page.waitForTimeout(400);
console.log("15. picked:", await page.textContent("#bulk-count"));
console.log("16. and offers to clear:", await page.textContent("#bulk-all"));
await page.click('[data-bulk-move="wishlist"]');
await page.waitForTimeout(700);
console.log("17. wishlist count:", (await counts()).wish);
await page.click(".toast-action");
await page.waitForTimeout(600);
await page.fill("#list-search", "");
await page.waitForTimeout(400);

// Reading flag and finish dates behave like a single move.
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(400);
await page.click("#select-toggle");
await page.waitForTimeout(400);
await page.click("#bulk-all");
await page.waitForTimeout(300);
await page.click('[data-bulk-move="completed"]');
await page.waitForTimeout(700);
console.log("18. finishing a whole To Read shelf:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1"))
    .filter((b) => b.id === "b8" || b.id === "b9")
    .map((b) => ({ id: b.id, shelf: b.shelf, reading: b.reading, dated: !!b.finishedAt, counts: !!b.readHere }))));

// Switching shelves drops the selection (the tabs stay reachable while the
// bottom nav is standing aside).
await page.click(".toast-action");
await page.waitForTimeout(600);
await page.click("#select-toggle");
await page.waitForTimeout(300);
await page.click(".grid-book");
await page.waitForTimeout(300);
console.log("19a. shelf tabs still reachable while selecting:", await page.isVisible('[data-shelf="owned"]'));
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(600);
console.log("19b. selection dropped on switching shelf:", await page.isHidden("#bulk-bar"),
  "| no leftover marks:", (await page.$$(".picked")).length === 0,
  "| nav back:", await page.isVisible(".bottom-nav"));

// Normal tapping is back.
await page.click(".grid-book");
await page.waitForTimeout(600);
console.log("20. tapping opens a book again:", await page.isVisible("#detail-modal"));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
