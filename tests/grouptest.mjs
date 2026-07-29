import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 420, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("console: " + m.text()); });
await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());

const yr = new Date().getFullYear();
await page.addInitScript((y) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "s1", title: "The Way of Kings", authors: ["Brandon Sanderson"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 1007, series: { name: "The Stormlight Archive", position: 1 }, addedAt: "2026-01-01T00:00:00Z" },
    { id: "s2", title: "Words of Radiance", authors: ["Brandon Sanderson"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 1087, series: { name: "The Stormlight Archive", position: 2 }, addedAt: "2026-01-02T00:00:00Z" },
    { id: "h1", title: "Chamber of Secrets", authors: ["J. K. Rowling"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 341, series: { name: "Harry Potter", position: 2 }, addedAt: "2026-01-03T00:00:00Z" },
    { id: "h2", title: "Philosopher's Stone", authors: ["J. K. Rowling"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 223, series: { name: "Harry Potter", position: 1 }, addedAt: "2026-01-04T00:00:00Z" },
    { id: "x1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 245, addedAt: "2026-01-05T00:00:00Z" },
    { id: "d1", title: "Circe", authors: ["Madeline Miller"], shelf: "completed", owned: true,
      coverUrl: null, pageCount: 393, ratings: { Zach: 5 }, finishedAt: `${y}-03-14T00:00:00Z`,
      readHere: true, addedAt: "2026-01-06T00:00:00Z" },
    // One read here, one logged as a prior read — only the first counts.
    { id: "d2", title: "Project Hail Mary", authors: ["Andy Weir"], shelf: "completed", owned: true,
      coverUrl: null, pageCount: 476, ratings: { Zach: 4 }, finishedAt: `${y}-03-02T00:00:00Z`, addedAt: "2026-01-07T00:00:00Z" },
  ]));
}, yr);

await page.goto("http://localhost:8765/");
await page.waitForTimeout(600);

// ---- group by series, as a sort mode ----
console.log("0. toolbar button says:", (await page.textContent("#filter-toggle")).replace(/\s+/g, " ").trim());
await page.click("#filter-toggle");
await page.waitForTimeout(300);
const firstLabel = await page.$eval("#filter-panel .filter-label", (e) => e.textContent);
console.log("1a. first thing in the panel:", firstLabel);
const sortChips = await page.$$eval("#filter-panel .sort-chip", (e) => e.map((x) => x.textContent));
console.log("1b. sort options:", sortChips.join(" | "));
await page.click('#filter-panel [data-sort="series"]');
await page.waitForTimeout(400);
console.log("1c. explains itself:", (await page.textContent(".sort-note")).trim());
await page.click("#filter-toggle");
await page.waitForTimeout(200);

const headers = await page.$$eval(".group-head", (e) =>
  e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
console.log("2. series headings:", headers);
console.log("3. standalone grouped last:", headers.at(-1).startsWith("Standalone"));
const order = await page.$$eval(".book-list > *", (e) =>
  e.map((x) => x.classList.contains("group-head")
    ? "## " + x.querySelector("span").textContent
    : x.querySelector(".grid-title").textContent));
console.log("4. order:");
order.forEach((o) => console.log("     " + o));
console.log("5. in-series order by position:",
  order.indexOf("Philosopher's Stone") < order.indexOf("Chamber of Secrets"));
console.log("6. A–Z rail hidden while grouped:", !(await page.isVisible("#az-rail")));
await page.screenshot({ path: "group-series.png" });

// cards still work inside groups
await page.click('.grid-book[title="Piranesi"]');
await page.waitForTimeout(500);
console.log("7. cards still open from a group:", await page.isVisible("#detail-modal"));
await page.click('[data-close="detail-modal"]');

// grouping choice survives a reload
await page.reload();
await page.waitForTimeout(700);
console.log("7b. grouping remembered after reload:", (await page.$$(".group-head")).length > 0);

// ---- quick actions are labelled and need a confirming second tap ----
await page.click('.grid-book[title="Piranesi"] [data-flip]');
await page.waitForTimeout(500);
const qa = await page.$$eval('.grid-book[title="Piranesi"] .qa-btn',
  (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
console.log("7c. quick actions read:", qa.join(" | "));
const moveBtn = '.grid-book[title="Piranesi"] [data-qa-move="tbr"]';
await page.click(moveBtn);
await page.waitForTimeout(250);
console.log("7d. first tap only arms it:",
  await page.$eval(moveBtn, (e) => e.classList.contains("armed")),
  "label:", (await page.textContent(moveBtn)).trim());
console.log("7e. book has NOT moved yet:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "x1").shelf));
await page.waitForTimeout(450); // a considered second tap, not a double-tap
await page.click(moveBtn);
await page.waitForTimeout(400);
console.log("7f. second tap moves it:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "x1").shelf));
console.log("7g. undo offered:", (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
await page.click(".toast-action");
await page.waitForTimeout(400);
console.log("7h. undone:", await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "x1").shelf));

// arming times out rather than lingering
await page.click('.grid-book[title="Piranesi"] [data-flip]');
await page.waitForTimeout(300);
await page.click(moveBtn);
await page.waitForTimeout(3800);
console.log("7i. arming expires on its own:",
  !(await page.$eval(moveBtn, (e) => e.classList.contains("armed"))));

// clearing filters returns to the default sort
await page.click("#filter-toggle");
await page.click("text=Clear all filters");
await page.waitForTimeout(300);
console.log("8. clear-all ungroups:", (await page.$$(".group-head")).length === 0);
await page.click("#filter-toggle");

// ---- stats ----
await page.click("#shelf-hero");
await page.waitForTimeout(500);
console.log("9. hero opens stats:", await page.$eval(".screen.active", (e) => e.id));
const tiles = await page.$$eval(".stat-tile", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
console.log("10. tiles:", tiles.join(" | "));
console.log("11. this-year line:", (await page.textContent(".stat-line")).replace(/\s+/g, " ").trim());
console.log("12. month bars:", (await page.$$(".month")).length);
const barLabels = await page.$$eval(".bar-label", (e) => e.map((x) => x.textContent));
console.log("13. top authors/genres:", barLabels.slice(0, 4).join(", "));
await page.screenshot({ path: "stats.png" });
await page.click("#screen-stats .back-btn");
await page.waitForTimeout(300);

// Settings route to the same screen
await page.click("#settings-btn");
await page.waitForTimeout(300);
await page.click('[data-go="stats"]');
await page.waitForTimeout(400);
console.log("14. settings route works:", await page.$eval(".screen.active", (e) => e.id));
await page.click("#nav-shelves");

// ---- offline pill ----
await ctx.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event("offline")));
await page.waitForTimeout(300);
console.log("15. offline pill:", (await page.textContent("#net-pill")).trim());
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await page.waitForTimeout(300);
console.log("16. pill clears when back online:", !(await page.isVisible("#net-pill")));

console.log("errors:", errors);
await browser.close();
