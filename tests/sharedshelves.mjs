// Two people, one library, one book, two different answers.
//
// A shared library is for seeing each other's things, not for taking turns.
// She puts Piranesi on her To Read; he must be able to put the same book on
// his, without moving it off hers. Finished and Wishlist likewise. Only
// *owning* is shared, because there's one copy on one physical shelf.
//
// The bug this pins: a single `shelf` field per book can hold exactly one
// person's answer, so his move overwrote hers and the shared library became a
// thing that stopped them both using the same book.
//
// Runs against one browser with the profile swapped between checks — the
// per-person state lives in the record, so this exercises the real storage
// rather than mocking two phones.

import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
const problems = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await page.route(/googleapis|gstatic|covers\.openlibrary|openlibrary\.org/, (r) => r.abort());

// A library as it looks today: two books already on the single shelf, one of
// them assigned to her, plus an unassigned one from before profiles existed.
// Seed only once. addInitScript re-runs on every navigation, so setting these
// unconditionally would put the profile back to Kelsey on each reload and
// throw away the very changes this suite makes.
await page.addInitScript(() => {
  if (localStorage.getItem("shelfie.library.v1")) return;
  localStorage.setItem("shelfie.profile.v1", "Kelsey");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "p1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "tbr",
      owned: true, profile: "Kelsey", addedAt: "2025-01-01T00:00:00Z" },
    { id: "p2", title: "Circe", authors: ["Madeline Miller"], shelf: "tbr",
      owned: true, profile: null, addedAt: "2025-01-02T00:00:00Z" },
  ]));
});
await page.goto("http://localhost:8765/");
await page.waitForTimeout(800);

const shelfOf = (id, who) =>
  page.evaluate(({ id, who }) => {
    const b = JSON.parse(localStorage.getItem("shelfie.library.v1")).find((x) => x.id === id);
    const mine = who && b.shelves?.[who];
    if (mine) return mine.shelf ?? null;
    if (!["tbr", "completed", "wishlist"].includes(b.shelf)) return null;
    return !b.profile || b.profile === who ? b.shelf : null;
  }, { id, who });

const beAs = async (who) => {
  await page.evaluate((n) => localStorage.setItem("shelfie.profile.v1", n), who);
  await page.reload();
  await page.waitForTimeout(800);
};

// Finishing a book you were reading now offers the "what next" sheet
// (js/app.js, offerSunset). It's a moment, not a step in this suite, and it is
// modal — so close it before driving anything else.
const dismissSunset = async () => {
  if (await page.evaluate(() => document.querySelector("#sunset-modal")?.open === true)) {
    await page.evaluate(() => document.querySelector("#sunset-modal").close());
    await page.waitForTimeout(150);
  }
};

const openShelf = async (shelf) => {
  await dismissSunset();
  await page.click(`.tab[data-shelf="${shelf}"]`);
  await page.waitForTimeout(500);
};

// ---------- 1. her book starts on her To Read ----------
await openShelf("tbr");
console.log("1. Kelsey's To Read:", await page.locator(".grid-book").count(), "(want 2)");
if (await page.locator(".grid-book").count() !== 2) {
  problems.push("the existing library did not survive the per-person change");
}

// ---------- 2. he puts the same book on his To Read ----------
await beAs("Zach");
await openShelf("tbr");
// The legacy unassigned book reads as everyone's; her assigned one does not.
const zachStart = await page.locator(".grid-book").count();
console.log("2. Zach's To Read before he does anything:", zachStart,
  "(want 1 — the unassigned one only)");
if (zachStart !== 1) problems.push(`Zach starts with ${zachStart} on To Read, expected 1`);

// He finds her book on the Owned shelf (it's a copy in the house) and adds it.
await openShelf("owned");
await page.waitForTimeout(400);
await page.click('.grid-book[data-id="p1"] .page-edge');
await page.waitForTimeout(700);
await page.click('.grid-book[data-id="p1"] [data-qa-move="tbr"]');
await page.waitForTimeout(500);
await page.click('.grid-book[data-id="p1"] [data-qa-move="tbr"]'); // confirm
await page.waitForTimeout(900);

console.log("3. Zach's shelf for Piranesi:", await shelfOf("p1", "Zach"), "(want tbr)");
if (await shelfOf("p1", "Zach") !== "tbr") problems.push("Zach could not put the book on his To Read");

console.log("4. Kelsey's shelf for Piranesi:", await shelfOf("p1", "Kelsey"), "(want tbr — untouched)");
if (await shelfOf("p1", "Kelsey") !== "tbr") {
  problems.push("Zach's move took the book off Kelsey's To Read — the whole bug");
}

// ---------- 3. he finishes it; she still hasn't ----------
await openShelf("tbr");
await page.click('.grid-book[data-id="p1"] .page-edge');
await page.waitForTimeout(700);
await page.click('.grid-book[data-id="p1"] [data-qa-move="completed"]');
await page.waitForTimeout(500);
await page.click('.grid-book[data-id="p1"] [data-qa-move="completed"]');
await page.waitForTimeout(1200);
await dismissSunset();

console.log("5. Zach finished it:", await shelfOf("p1", "Zach"),
  "| Kelsey still to read:", await shelfOf("p1", "Kelsey"));
if (await shelfOf("p1", "Zach") !== "completed") problems.push("Zach's Finished did not stick");
if (await shelfOf("p1", "Kelsey") !== "tbr") {
  problems.push("finishing a book moved it off the other person's To Read");
}

// ---------- 4. the filter chips: mine, hers, everyone ----------
await openShelf("tbr");
await page.waitForTimeout(400);
const chips = await page.locator("#profile-filter .filter-chip").allTextContents();
console.log("6. filter chips:", chips.map((c) => c.trim()).join(" | "));
if (!chips.some((c) => /Kelsey/.test(c))) problems.push("no chip for the other person");
if (!chips.some((c) => /Everyone/.test(c))) problems.push("no Everyone chip");

const countWith = async (label) => {
  const chip = page.locator("#profile-filter .filter-chip", { hasText: label });
  await chip.first().click();
  await page.waitForTimeout(600);
  return page.locator(".grid-book").count();
};
const mineN = await countWith("Mine");
const hersN = await countWith("Kelsey");
const allN = await countWith("Everyone");
console.log("7. To Read — mine:", mineN, "| Kelsey:", hersN, "| everyone:", allN);
// Zach: only the legacy unassigned Circe (he finished Piranesi).
// Kelsey: Piranesi + Circe. Everyone: both books.
if (mineN !== 1) problems.push(`"Mine" shows ${mineN} on To Read, expected 1`);
if (hersN !== 2) problems.push(`"Kelsey" shows ${hersN} on To Read, expected 2`);
if (allN !== 2) problems.push(`"Everyone" shows ${allN} on To Read, expected 2`);

// ---------- 5. ownership stays shared ----------
const owned = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1"))
    .filter((b) => b.owned).map((b) => b.id).sort());
console.log("8. still owned by the household:", owned.join(", "), "(want p1, p2)");
if (owned.join(",") !== "p1,p2") {
  problems.push(`ownership changed under a personal move: owned = ${owned.join(",")}`);
}

// ---------- 6. wishlist is personal too, and doesn't disown the copy ----------
await openShelf("owned");
await page.waitForTimeout(400);
// Wishlist isn't on the quick-action rail (it's the one nobody reaches for
// mid-shelf), so this goes the way a reader would: open the book, move it.
await page.click('.grid-book[data-id="p2"] .page-edge');
await page.waitForTimeout(700);
await page.click('.grid-book[data-id="p2"] [data-qa-details]');
await page.waitForTimeout(800);
await page.click('#detail-content [data-move="wishlist"]');
await page.waitForTimeout(900);
const p2Owned = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "p2").owned);
console.log("9. wishlisting kept the household's copy:", p2Owned,
  "| Zach:", await shelfOf("p2", "Zach"), "| Kelsey:", await shelfOf("p2", "Kelsey"));
if (p2Owned !== true) problems.push("one person's wishlist marked the household's copy unowned");
if (await shelfOf("p2", "Kelsey") !== "tbr") {
  problems.push("wishlisting took the book off the other person's To Read");
}

// ---------- 7. an export says what YOU did with the book ----------
// The CSV reads b.shelf straight off the record unless it's told whose view
// to take, which would hand you a spreadsheet calling a book you finished
// "tbr" — the household's leftover answer, not yours.
await page.click("#export-btn");
await page.waitForTimeout(400);
await page.click('[data-scope="all"]');
await page.waitForTimeout(300);
const dl = page.waitForEvent("download");
await page.click('[data-format="csv"]');
const csv = (await import("node:fs")).readFileSync(await (await dl).path(), "utf8");
const rows = Object.fromEntries(
  csv.split("\n").slice(1).filter(Boolean).map((r) => [r.split(",")[0], r.split(",")])
);
const shelfCol = csv.split("\n")[0].split(",").indexOf("Shelf");
console.log("10. CSV shelf for Piranesi (Zach finished it):", rows.Piranesi?.[shelfCol]);
if (rows.Piranesi?.[shelfCol] !== "completed") {
  problems.push(`CSV says Piranesi is "${rows.Piranesi?.[shelfCol]}" for Zach, expected completed`);
}
console.log("11. CSV shelf for Circe (Zach wishlisted it):", rows.Circe?.[shelfCol]);
if (rows.Circe?.[shelfCol] !== "wishlist") {
  problems.push(`CSV says Circe is "${rows.Circe?.[shelfCol]}" for Zach, expected wishlist`);
}

await browser.close();
if (problems.length) console.log("\nPROBLEMS:\n- " + problems.join("\n- "));
console.log("\nERRORS:", errors.length || problems.length ? [...errors, ...problems] : "none");
