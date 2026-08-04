// What "Remove" means.
//
// The Owned tab is a view, not a shelf — it lists books whose shelf is Owned
// *plus* any book on another shelf still flagged as an owned copy. That makes
// "remove" ambiguous from the reader's side: does it take the book out of
// this one list, or out of the library? It takes it out of the library, and
// it says so before doing it.
//
// This suite exists because the only way to get a book off the Owned tab used
// to be to un-own it first — the quick actions couldn't remove at all, and the
// Remove button was buried at the bottom of Book details.

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
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    // Finished, but the copy is still on the shelf at home — so it shows up
    // under Owned as well. This is the book the whole problem was about.
    { id: "a", title: "Circe", authors: ["Madeline Miller"], shelf: "completed",
      owned: true, ratings: { Zach: 5 }, addedAt: "2025-01-01T00:00:00Z" },
    { id: "b", title: "The Ritual", authors: ["Shantel Tessier"], shelf: "owned",
      owned: true, addedAt: "2025-01-02T00:00:00Z" },
  ]));
});
await page.goto("http://localhost:8765/");
await page.waitForTimeout(700);

const shown = () => page.evaluate(() => document.querySelectorAll("#book-list article").length);
const ids = () => page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) => b.id).sort());

console.log("1. Owned tab lists both (one of them lives on Finished):", await shown());

// --- removing is reachable without opening Book details ---
await page.click('#book-list article:has-text("Circe") [data-flip]');
await page.waitForTimeout(500);
const reachable = await page.locator('article:has-text("Circe") [data-qa-remove]').count() > 0;
console.log("2. Remove offered on the flipped card:", reachable);
if (!reachable) problems.push("no way to remove a book without opening Book details");

// --- it asks first, and says the removal is library-wide ---
let asked = null;
page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
await page.click('article:has-text("Circe") [data-qa-remove]');
await page.waitForTimeout(400);
const saysEverywhere = /every shelf/i.test(asked ?? "");
console.log("3. asked before removing:", asked !== null, "| said it's library-wide:", saysEverywhere);
if (asked === null) problems.push("removing did not ask first");
if (!saysEverywhere) problems.push("the confirmation doesn't say the removal covers every shelf");

console.log("4. cancelling kept the book:", (await ids()).join(","));
if ((await ids()).length !== 2) problems.push("cancelling the confirmation still removed the book");

// --- confirming takes it off every shelf, not just this view ---
page.once("dialog", (d) => d.accept());
await page.click('article:has-text("Circe") [data-qa-remove]');
await page.waitForTimeout(600);
console.log("5. after confirming — stored:", (await ids()).join(","), "| Owned tab lists:", await shown());
if ((await ids()).includes("a")) problems.push("confirming did not remove the book from the store");

let lingering = [];
for (const shelf of ["tbr", "completed", "wishlist"]) {
  await page.click(`.tab[data-shelf="${shelf}"]`);
  await page.waitForTimeout(350);
  if (await shown()) lingering.push(shelf);
}
console.log("6. still showing on:", lingering.length ? lingering : "no shelf");
if (lingering.length) problems.push(`removed book still listed on: ${lingering.join(", ")}`);

// --- and it's undoable, rating included ---
await page.click('.tab[data-shelf="owned"]');
await page.waitForTimeout(300);
const undo = await page.locator(".toast-action").count();
if (undo) {
  await page.click(".toast-action");
  await page.waitForTimeout(600);
}
const back = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "a"));
console.log("7. undo restored it:", !!back, "| with its rating:", back?.ratings?.Zach ?? "none");
if (!back) problems.push("undo did not put the book back");
else if (back.ratings?.Zach !== 5) problems.push("undo lost the rating");

// --- the details button removes the same way ---
await page.click('#book-list article:has-text("Circe")');
await page.waitForTimeout(500);
let askedAgain = null;
page.once("dialog", (d) => { askedAgain = d.message(); d.accept(); });
await page.click("[data-delete]");
await page.waitForTimeout(600);
console.log("8. Book details removes identically:", askedAgain !== null, "| stored:", (await ids()).join(","));
if (askedAgain === null) problems.push("the Book details Remove button did not ask first");
if ((await ids()).includes("a")) problems.push("the Book details Remove button did not remove the book");

await browser.close();
console.log("errors:", [...errors, ...problems]);
