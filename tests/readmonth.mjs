// Setting the month you read a book, and the stat staying quiet about how
// it's worked out.
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

const Y = new Date().getFullYear();
await page.addInitScript((y) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    // A prior read, logged straight onto Finished — not counted yet.
    { id: "old1", title: "Prior Read", authors: ["A"], shelf: "completed", owned: true,
      coverUrl: null, pageCount: 300, finishedAt: `${y}-01-01T00:00:00Z`, addedAt: `${y}-01-01T00:00:00Z` },
    // One the app watched being finished.
    { id: "new1", title: "Read Here", authors: ["B"], shelf: "completed", owned: true,
      coverUrl: null, pageCount: 200, finishedAt: `${y}-03-10T00:00:00Z`, readHere: true,
      addedAt: `${y}-01-02T00:00:00Z` },
    // Not finished — must not offer the control.
    { id: "tbr1", title: "Still Waiting", authors: ["C"], shelf: "tbr", owned: true,
      coverUrl: null, pageCount: 250, addedAt: `${y}-01-03T00:00:00Z` },
  ]));
}, Y);
await page.goto("http://localhost:8765/");
await page.waitForTimeout(800);

const yearLine = async () => {
  await page.click("#shelf-hero");
  await page.waitForTimeout(600);
  const line = (await page.textContent(".stat-line")).replace(/\s+/g, " ").trim();
  const note = await page.$(".stat-note");
  const months = await page.$$eval(".month i", (e) => e.map((x) => x.style.height));
  await page.click("#screen-stats .back-btn");
  await page.waitForTimeout(400);
  return { line, note: !!note, bars: months.map((h, i) => h !== "4%" ? i : null).filter((x) => x !== null) };
};

let s = await yearLine();
console.log("1. starting point:", s.line, "| bar months:", s.bars);
console.log("2. no explanation paragraph on the screen:", !s.note);

// The waiting book shouldn't offer a "read in" control.
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="tbr1"]');
await page.waitForTimeout(700);
console.log("3. unfinished book has no Read in control:", !(await page.$("#read-month")));
await page.click('[data-close="detail-modal"]');
await page.waitForTimeout(300);

// Put the prior read into a month.
await page.click('[data-shelf="completed"]');
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="old1"]');
await page.waitForTimeout(700);
console.log("4. finished book offers it, starting blank:",
  await page.$eval("#read-month", (e) => JSON.stringify(e.value)));
await page.selectOption("#read-month", "8"); // September
await page.waitForTimeout(500);
console.log("5. toast:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click('[data-close="detail-modal"]');
await page.waitForTimeout(400);
s = await yearLine();
console.log("6. now counted:", s.line, "| bar months:", s.bars, "(2 = March, 8 = September)");

// Change the year on a set book.
await page.click('.grid-book[data-id="old1"]');
await page.waitForTimeout(700);
await page.selectOption("#read-year", String(Y - 1));
await page.waitForTimeout(500);
await page.click('[data-close="detail-modal"]');
await page.waitForTimeout(400);
s = await yearLine();
console.log("7. moved to last year, so out of this year:", s.line, "| bars:", s.bars);
console.log("   stored as:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "old1").finishedAt));

// Bring it back, then take it out entirely.
await page.click('.grid-book[data-id="old1"]');
await page.waitForTimeout(700);
await page.selectOption("#read-year", String(Y));
await page.waitForTimeout(400);
console.log("8. reopened control remembers the month:",
  await page.$eval("#read-month", (e) => e.options[e.selectedIndex].textContent));
await page.selectOption("#read-month", "");
await page.waitForTimeout(500);
console.log("9. blanking it says:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click('[data-close="detail-modal"]');
await page.waitForTimeout(400);
s = await yearLine();
console.log("10. back out of the count:", s.line, "| bars:", s.bars);
console.log("11. the book itself is untouched:", await page.evaluate(() => {
  const b = JSON.parse(localStorage.getItem("shelfie.library.v1")).find((x) => x.id === "old1");
  return { shelf: b.shelf, finishedAt: b.finishedAt, readHere: b.readHere };
}));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
