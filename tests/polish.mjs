import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 420, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("console: " + m.text()); });
await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());

// A big library: 300 books across shelves, some finished-and-unrated.
const big = [];
const LET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
for (let i = 0; i < 300; i++) {
  const L = LET[i % 26];
  big.push({
    id: "b" + i,
    title: `${L}${i} Book Title`,
    authors: [`${LET[(i * 7) % 26]} Author`],
    shelf: i % 5 === 0 ? "completed" : i % 3 === 0 ? "tbr" : "owned",
    owned: true, coverUrl: null, pageCount: 200 + (i % 500),
    addedAt: new Date(2026, 0, 1 + (i % 28)).toISOString(),
    profile: "Zach",
  });
}
await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, big);

const t0 = Date.now();
await page.goto("http://localhost:8765/");
await page.waitForSelector(".grid-book");
console.log("1. 300-book shelf first paint (ms):", Date.now() - t0);
const rendered = () => page.$$eval(".grid-book", (e) => e.length);
console.log("2. renders a chunk, not everything:", await rendered(), "of ~194 owned");

// scroll to pull in more
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
console.log("3. more appended on scroll:", (await rendered()) > 60);
await page.evaluate(() => window.scrollTo(0, 0));

// --- A–Z rail (sorted by title) ---
await page.click("#filter-toggle");
await page.click('#filter-panel [data-sort="title"]');
await page.waitForTimeout(400);
await page.click("#filter-toggle");
console.log("4. A–Z rail visible when sorted:", await page.isVisible("#az-rail"));
const letters = await page.$$eval("#az-rail button", (e) => e.map((x) => x.textContent));
console.log("5. rail letters:", letters.slice(0, 8).join(""), "…", letters.length, "total");
await page.click('#az-rail button:has-text("M")');
await page.waitForTimeout(500);
const topTitle = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".grid-book")];
  const first = cards.find((c) => c.getBoundingClientRect().top > 40);
  return first?.querySelector(".grid-title")?.textContent;
});
console.log("6. jump to M lands on:", topTitle);
await page.screenshot({ path: "polish-big.png" });

// --- flip card quick actions ---
await page.evaluate(() => window.scrollTo(0, 0));
await page.click("#filter-toggle");
await page.click('#filter-panel [data-sort="added"]');
await page.click("#filter-toggle");
await page.waitForTimeout(300);
const firstCard = ".grid-book:first-child";
await page.click(`${firstCard} [data-flip]`);
await page.waitForTimeout(500);
console.log("7. ⋯ flips card:", await page.$eval(`${firstCard} .flip`, (e) => e.classList.contains("flipped")));
console.log("8. back has stars + actions:", (await page.$$(`${firstCard} [data-qa-rate]`)).length, (await page.$$(`${firstCard} [data-qa-move]`)).length);
const idOfFirst = await page.$eval(firstCard, (e) => e.dataset.id);
await page.click(`${firstCard} [data-qa-rate="4"]`);
await page.waitForTimeout(400);
console.log("9. quick rating saved:", await page.evaluate((id) =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === id)?.ratings?.Zach, idOfFirst));
console.log("10. toast with undo:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click(".toast-action");
await page.waitForTimeout(400);
console.log("11. undo reverted rating:", await page.evaluate((id) =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === id)?.ratings?.Zach ?? null, idOfFirst));

// quick move + undo
await page.click(`${firstCard} [data-flip]`);
await page.waitForTimeout(400);
await page.click(`${firstCard} [data-qa-move="completed"]`); // arms
await page.waitForTimeout(250);
console.log("11b. move needs confirming:", await page.$eval(`${firstCard} [data-qa-move="completed"]`,
  (e) => e.classList.contains("armed")));
await page.waitForTimeout(450);
await page.click(`${firstCard} [data-qa-move="completed"]`); // confirms
await page.waitForTimeout(400);
console.log("12. quick move toast:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click(".toast-action");
await page.waitForTimeout(400);

// --- detail sheet ---
await page.click(`${firstCard} [data-flip]`);
await page.waitForTimeout(400);
await page.click(`${firstCard} [data-qa-details]`);
await page.waitForTimeout(600);
console.log("13. sheet open:", await page.$eval("#detail-modal", (e) => e.classList.contains("sheet")));
console.log("14. hero + sections:", (await page.$$(".book-hero")).length, (await page.$$eval(".d-section summary", (e) => e.map((x) => x.textContent))).join(" / "));
await page.screenshot({ path: "polish-sheet.png" });
await page.click('[data-close="detail-modal"]');

// --- no-homework nudge ---
await page.waitForTimeout(300);
const nudgeVisible = await page.isVisible("#nudge-card");
console.log("15. gentle nudge shown:", nudgeVisible, nudgeVisible ? (await page.textContent(".nudge-q")).replace(/\s+/g, " ").trim() : "");
console.log("16. NO backlog counter anywhere:", !(await page.textContent("body")).match(/\d+ books? (need|to) (rating|rate|review)/i));
await page.click('[data-nudge-rate="5"]');
await page.waitForTimeout(500);
console.log("17. rated from nudge, then hidden:", !(await page.isVisible("#nudge-card")));
console.log("18. snoozed:", (await page.evaluate(() => Number(localStorage.getItem("shelfie.nudgeSnooze.v1")) > Date.now())));

// --- service worker + offline ---
await page.waitForTimeout(800);
const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
});
console.log("19. service worker registered:", swReady);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1200);
await ctx.setOffline(true);
await page.reload();
await page.waitForTimeout(1200);
const offlineOk = await page.$$(".grid-book");
console.log("20. app opens OFFLINE with books:", offlineOk.length > 0);
await ctx.setOffline(false);

// --- series cache persists ---
console.log("21. series cache persisted:", await page.evaluate(() => !!localStorage.getItem("shelfie.seriesCache.v1")));

console.log("errors:", errors);
await browser.close();
