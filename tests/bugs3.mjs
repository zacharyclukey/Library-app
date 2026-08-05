// Round 3 — interaction and state. Rapid taps, interleaved actions, undo
// chains, flipping across re-renders, and navigation stress.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
});
await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());

const lib = [];
for (let i = 0; i < 40; i++) {
  lib.push({
    id: "b" + i, title: `Book ${String(i).padStart(2, "0")}`, authors: [`Author ${i % 5}`],
    shelf: i % 4 === 0 ? "completed" : i % 3 === 0 ? "tbr" : "owned", owned: true,
    coverUrl: null, pageCount: 100 + i * 10, addedAt: new Date(2026, 0, 1 + i).toISOString(),
    series: i % 6 === 0 ? { name: "Cycle " + (i % 12), position: (i % 3) + 1 } : null,
    profile: "Zach",
  });
}
await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
}, lib);
await page.goto("http://localhost:8765/");
await page.waitForTimeout(700);

const shelfOf = (id) => page.evaluate((x) =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === x)?.shelf, id);
const card = (id) => `.grid-book[data-id="${id}"]`;

// Section 1 spent a long time asserting nothing. It drove a quick-action move
// to Wishlist, which the card's rail has never offered — it carries To Read
// and Finished only. Each of those eleven clicks therefore waited out the full
// 30s Playwright timeout inside a .catch(), which is where five and a half of
// this suite's six minutes went, and the three observations printed a shelf
// that could not have changed.
//
// The moves go to To Read now, which exists. Not Wishlist: every fixture book
// carries owned:true, and a wishlist move clears that flag, which would drop
// b1 off the Owned shelf and shift the counts sections 7 and 10 observe.
// The expectations are checked rather than printed, so a selector that drifts
// again fails the suite instead of quietly costing six minutes.
function check(label, ok, ...rest) {
  console.log(`${label}:`, ok, ...rest);
  if (!ok) errors.push(`FAILED — ${label}`);
}

// ---- 1. mash the same move button many times ----
await page.click(`${card("b1")} [data-flip]`);
await page.waitForTimeout(400);
await page.dblclick(`${card("b1")} [data-qa-move="tbr"]`).catch(() => {});
await page.waitForTimeout(400);
check("1a. a double-tap does NOT move the book", (await shelfOf("b1")) === "owned", `(${await shelfOf("b1")})`);
// Flip away and back so the button starts disarmed for this phase.
await page.click(`${card("b1")} .qa-facts`).catch(() => {});
await page.waitForTimeout(300);
await page.click(`${card("b1")} [data-flip]`);
await page.waitForTimeout(300);
for (let i = 0; i < 8; i++) {
  await page.click(`${card("b1")} [data-qa-move="tbr"]`, { force: true }).catch(() => {});
  await page.waitForTimeout(60);
}
await page.waitForTimeout(500);
check("1b. mashing fast 8× still does not move it", (await shelfOf("b1")) === "owned", `(${await shelfOf("b1")})`);
await page.click(`${card("b1")} [data-qa-move="tbr"]`).catch(() => {});
await page.waitForTimeout(500);
await page.click(`${card("b1")} [data-qa-move="tbr"]`).catch(() => {});
await page.waitForTimeout(500);
check("1c. two deliberate taps DO move it", (await shelfOf("b1")) === "tbr", `(${await shelfOf("b1")})`);

// ---- 2. two different books armed at once ----
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(300);
await page.click(`${card("b2")} [data-flip]`);
await page.click(`${card("b7")} [data-flip]`);
await page.waitForTimeout(400);
await page.click(`${card("b2")} [data-qa-move="completed"]`);
await page.waitForTimeout(150);
await page.click(`${card("b7")} [data-qa-move="completed"]`);
await page.waitForTimeout(150);
const armedCount = await page.$$eval(".qa-btn.armed", (e) => e.length);
console.log("2. only one button can be armed at a time:", armedCount === 1, `(${armedCount})`);
console.log("   neither book moved yet:", await shelfOf("b2"), await shelfOf("b7"));

// ---- 3. arming then flipping the card away disarms ----
await page.click(`${card("b7")} [data-flip]`, { force: true }).catch(() => {});
await page.waitForTimeout(300);
await page.click(`${card("b7")} [data-flip]`, { force: true }).catch(() => {});
await page.waitForTimeout(300);
await page.click(`${card("b7")} [data-qa-move="completed"]`).catch(() => {});
await page.waitForTimeout(200);
console.log("3. b7 after arm→flip away→flip back→tap once:", await shelfOf("b7"),
  "(should still be owned)");

// ---- 4. arming survives nothing it shouldn't: switch shelves mid-arm ----
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(300);
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(300);
console.log("4. no armed buttons after a shelf switch:",
  (await page.$$(".qa-btn.armed")).length === 0);

// ---- 5. undo chain: three actions, undo the last ----
await page.click(`${card("b10")} [data-flip]`);
await page.waitForTimeout(300);
await page.click(`${card("b10")} [data-qa-rate="3"]`);
await page.waitForTimeout(300);
await page.click(`${card("b11")} [data-flip]`);
await page.waitForTimeout(300);
await page.click(`${card("b11")} [data-qa-rate="5"]`);
await page.waitForTimeout(300);
await page.click(".toast-action");
await page.waitForTimeout(400);
const ratings = await page.evaluate(() => {
  const all = JSON.parse(localStorage.getItem("shelfie.library.v1"));
  return { b10: all.find((b) => b.id === "b10")?.ratings?.Zach ?? null,
           b11: all.find((b) => b.id === "b11")?.ratings?.Zach ?? null };
});
console.log("5. undo reverts only the last action:", JSON.stringify(ratings), "(want b10:3, b11:null)");

// ---- 6. undo after the toast times out (stale undo must not fire) ----
await page.click(`${card("b7")} [data-flip]`);
await page.waitForTimeout(300);
await page.click(`${card("b7")} [data-qa-rate="2"]`);
await page.waitForTimeout(5600); // toast auto-dismisses at 5s
const toastGone = !(await page.isVisible("#toast-region.show"));
console.log("6. toast auto-dismisses, rating stands:", toastGone,
  await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "b7")?.ratings?.Zach));

// ---- 7. grouped + searched + filtered together ----
await page.click("#filter-toggle");
await page.click('#filter-panel [data-sort="series"]');
await page.waitForTimeout(300);
await page.click("#filter-toggle");
await page.fill("#list-search", "Book 1");
await page.waitForTimeout(400);
const groupedSearch = await page.$$eval(".book-list > *", (e) =>
  e.map((x) => x.classList.contains("group-head") ? "##" + x.querySelector("span").textContent : "·"));
console.log("7. grouped + search:", groupedSearch.join(" "));
console.log("   headers count only what's shown:",
  await page.$$eval(".group-head .group-count", (e) => e.map((x) => x.textContent)));

// ---- 8. filter down to nothing while grouped ----
await page.fill("#list-search", "zzzznothing");
await page.waitForTimeout(400);
console.log("8. empty state shows while grouped:", await page.isVisible("#empty-state"),
  "| stray headers:", (await page.$$(".group-head")).length);
await page.fill("#list-search", "");
await page.waitForTimeout(300);

// ---- 9. list view while grouped ----
await page.click("#view-toggle");
await page.waitForTimeout(400);
console.log("9. list view keeps groups:", (await page.$$(".group-head")).length > 0,
  "| list cards:", (await page.$$(".book-card")).length);
await page.click(".book-card");
await page.waitForTimeout(500);
console.log("   list card still opens details:", await page.isVisible("#detail-modal"));
await page.click('[data-close="detail-modal"]');
await page.click("#view-toggle");
await page.waitForTimeout(400);

// ---- 10. scroll a grouped shelf to the bottom (chunked render + headers) ----
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
const totalShown = await page.$$eval(".grid-book", (e) => e.length);
const headers = await page.$$eval(".group-head", (e) => e.length);
console.log("10. grouped scroll to end:", totalShown, "cards under", headers, "headers");
console.log("    no duplicate cards:", await page.evaluate(() => {
  const ids = [...document.querySelectorAll(".grid-book")].map((c) => c.dataset.id);
  return new Set(ids).size === ids.length;
}));
await page.evaluate(() => window.scrollTo(0, 0));

// ---- 11. rapid tab mashing ----
for (let i = 0; i < 12; i++) {
  await page.click(`[data-shelf="${["owned", "tbr", "completed", "wishlist"][i % 4]}"]`);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(600);
console.log("11. survives rapid tab mashing, active:",
  await page.$eval(".tab.active .tab-label", (e) => e.textContent));

// ---- 12. rapid screen navigation ----
for (const id of ["#discover-btn", "#export-btn", "#settings-btn", "#nav-shelves"]) {
  await page.click(id);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(700);
console.log("12. survives rapid nav, screen:", await page.$eval(".screen.active", (e) => e.id));

// ---- 13. browser back through the screen stack ----
await page.click("#settings-btn");
await page.waitForTimeout(300);
await page.click('[data-go="stats"]');
await page.waitForTimeout(300);
await page.goBack();
await page.waitForTimeout(400);
const afterBack = await page.$eval(".screen.active", (e) => e.id);
await page.goBack();
await page.waitForTimeout(400);
console.log("13. back stack:", afterBack, "→", await page.$eval(".screen.active", (e) => e.id));

// ---- 14. delete from the detail sheet, then check the counts ----
await page.click("#nav-shelves");
await page.waitForTimeout(400);
await page.click('[data-shelf="owned"]');
await page.waitForTimeout(400);
const before = Number(await page.textContent("#count-owned"));
await page.click(".grid-book");
await page.waitForTimeout(500);
page.once("dialog", (d) => d.accept());
const delBtn = await page.$("[data-delete]");
if (delBtn) {
  await delBtn.click();
  await page.waitForTimeout(700);
  console.log("14. delete updates counts:", before, "→", await page.textContent("#count-owned"));
} else {
  console.log("14. delete button not found (selector drift)");
  await page.click('[data-close="detail-modal"]').catch(() => {});
}

// ---- 15. profile switch mid-flip ----
await page.waitForTimeout(300);
await page.click(".grid-book [data-flip]");
await page.waitForTimeout(300);
await page.click("#profile-chip");
await page.waitForTimeout(500);
console.log("15. profile screen from a flipped card:", await page.$eval(".screen.active", (e) => e.id));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
