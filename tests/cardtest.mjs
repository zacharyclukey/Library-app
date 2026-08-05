// The book card: how you open it, and where the room comes from.
//
// Turning a card lengthens it — the back is a checkout card and needs more
// room than a 2:3 cover. That reflows the grid, and the naive result is that
// everything below the card slides down into rows you haven't reached, taking
// the row you were looking at with it. The fix is to spend the new height
// upwards, on rows already scrolled past. This suite is the proof, because
// the bug it prevents is invisible in a screenshot and obvious in the hand.

import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
const problems = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.route(/googleapis|gstatic|covers\.openlibrary|openlibrary\.org/, (r) => r.abort());
await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(
    Array.from({ length: 24 }, (_, i) => ({
      id: "b" + i, title: "Book " + i, authors: ["An Author"], shelf: "owned",
      owned: true, pageCount: 300, publishDate: "2020",
      addedAt: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
    }))
  ));
});
await page.goto("http://localhost:8765/");
await page.waitForTimeout(900);

// --- 1. the way in is the book's own edge, not a button on the artwork ---
const edges = await page.locator(".page-edge").count();
const dots = await page.locator(".flip-btn").count();
console.log("1. page edges:", edges, "| leftover three-dot buttons:", dots);
if (!edges) problems.push("no page-edge affordance rendered");
if (dots) problems.push("the old three-dot flip button is still being rendered");

// --- 2. it opens the card ---
await page.click('article[data-id="b2"] .page-edge');
await page.waitForTimeout(800);
const open = await page.locator('article[data-id="b2"] .flip.flipped').count() > 0;
console.log("2. the edge opens the card:", open);
if (!open) problems.push("tapping the page edge did not turn the card");

// --- 3. the card actually grew (otherwise nothing below is being tested) ---
const grew = await page.evaluate(() => {
  const el = document.querySelector('article[data-id="b2"] .flip');
  const other = document.querySelector('article[data-id="b1"] .flip');
  return el.getBoundingClientRect().height - other.getBoundingClientRect().height;
});
console.log("3. turned card is taller than its neighbour by:", Math.round(grew), "px");
if (grew < 20) problems.push("the turned card did not lengthen, so the rest of this proves nothing");
// The front's edge is turned away once the card is open; a tap on the bare
// part of the card closes it, which is what a reader does too.
await page.click('article[data-id="b2"] .qa-facts');
await page.waitForTimeout(800);

// --- 4. growth goes into rows already scrolled past ---
// Scroll well down the list, then open a card and watch a row below it.
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(400);
// Playwright's click() scrolls the target into view first, which is exactly
// the measurement being taken here. Dispatch the click where the element
// already sits instead.
const tap = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
// The shelf sorts newest-first, so the book rendered *below* another is the
// one with the lower number. (Reaching for b14 here — a bigger number, so
// surely further down — measured a row above the card instead, and read a
// correct 38px correction as a 38px shove.)
const below = () => page.evaluate(() => {
  const el = document.querySelector('article[data-id="b2"]');
  return el ? Math.round(el.getBoundingClientRect().top) : null;
});
const target = 'article[data-id="b8"] .page-edge';
const beforeY = await below();
await tap(target);
await page.waitForTimeout(900);
const afterY = await below();
const moved = Math.abs(afterY - beforeY);
console.log("4. a row below stayed put:", beforeY, "→", afterY, `(moved ${moved}px)`);
if (moved > 6) problems.push(`opening a card pushed the rows below it by ${moved}px`);

// --- 5. closing it gives the room back the same way ---
const beforeClose = await below();
await tap('article[data-id="b8"] .qa-facts');
await page.waitForTimeout(900);
const afterClose = await below();
const movedBack = Math.abs(afterClose - beforeClose);
console.log("5. and on closing:", beforeClose, "→", afterClose, `(moved ${movedBack}px)`);
if (movedBack > 6) problems.push(`closing a card pushed the rows below it by ${movedBack}px`);

// --- 6. at the top of the list there's nothing above to spend ---
// Scrolling there would drag the list away from the top for no reason.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await tap('article[data-id="b0"] .page-edge');
await page.waitForTimeout(900);
const scrolled = await page.evaluate(() => Math.round(window.scrollY));
console.log("6. opening the first card left the scroll at:", scrolled);
if (scrolled > 6) problems.push(`opening a card at the top scrolled the page to ${scrolled}`);

await browser.close();
console.log("errors:", [...errors, ...problems]);
