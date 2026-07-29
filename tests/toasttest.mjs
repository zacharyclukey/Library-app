import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
await page.route(/openlibrary\.org/, (r) => r.fulfill({ status: 404, body: "" }));
await page.route(/openlibrary\.org\/isbn\/.*\.json/, (r) =>
  r.fulfill({ json: { title: "Scanned Book", isbn_13: ["9780593135204"], number_of_pages: 300,
    publish_date: "2021", physical_format: "Hardcover", works: [{ key: "/works/S1" }], authors: [] } }));
await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", "[]");
});
await page.goto("http://localhost:8765/");
await page.waitForTimeout(600);
await page.click("#add-book-btn");
await page.waitForTimeout(300);
await page.fill("#isbn-input", "9780593135204");
await page.press("#isbn-input", "Enter");
await page.waitForTimeout(1800);
await page.click('[data-add-shelf="owned"]');
await page.waitForTimeout(500);
console.log("1. Undo visible while the add sheet is open:", await page.isVisible(".toast-action"));
console.log("   toast lives in:", await page.evaluate(() =>
  document.getElementById("toast-region").parentElement.tagName +
  (document.getElementById("toast-region").parentElement.id ? "#" + document.getElementById("toast-region").parentElement.id : "")));
await page.click('[data-close="add-modal"]');
await page.waitForTimeout(400);
console.log("2. still visible after closing the sheet:", await page.isVisible(".toast-action"),
  "| now in:", await page.evaluate(() => document.getElementById("toast-region").parentElement.tagName));
await page.click(".toast-action");
await page.waitForTimeout(400);
console.log("3. undo worked:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).length), "books");
console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
