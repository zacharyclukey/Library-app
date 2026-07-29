// Round 2 — attribute injection, corrupt storage, and quota.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const dialogs = [];

async function phone(seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
  });
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  page.on("response", (r) => { if (r.status() >= 400) console.log("   [http]", r.status(), r.url().slice(0, 70)); });
  await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());
  if (seed) await page.addInitScript(seed);
  return { ctx, page };
}

// ---------- attribute breakout ----------
const attacks = [
  { id: `" onmouseover="window.__pwned=1`, title: `Quote In Id`, shelf: "owned", owned: true },
  { id: "atk2", title: `" onmouseover="window.__pwned=2" x="`, shelf: "owned", owned: true },
  { id: "atk3", title: "Ok", authors: [`" onfocus="window.__pwned=3`], shelf: "owned", owned: true },
  { id: "atk4", title: "Series Attack", shelf: "owned", owned: true,
    series: { name: `" onmouseover="window.__pwned=4`, position: 1 } },
  { id: "atk5", title: "Cover Attack", shelf: "owned", owned: true,
    coverUrl: `x" onerror="window.__pwned=5` },
  { id: "atk6", title: "Profile Attack", shelf: "tbr",
    profile: `" onmouseover="window.__pwned=6` },
];
{
  const { ctx, page } = await phone((books) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
  });
  await page.addInitScript((b) => {
    localStorage.setItem("shelfie.library.v1", JSON.stringify(b));
  }, attacks);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(700);
  console.log("1. cards rendered:", await page.$$eval(".grid-book", (e) => e.length));
  // hover everything, then flip and open a detail sheet
  for (const card of await page.$$(".grid-book")) {
    await card.hover().catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.click(".grid-book");
  await page.waitForTimeout(500);
  await page.click('[data-close="detail-modal"]').catch(() => {});
  console.log("2. no attribute breakout executed:",
    (await page.evaluate(() => window.__pwned ?? null)) === null);
  const stray = await page.evaluate(() =>
    [...document.querySelectorAll("*")].filter((el) =>
      [...el.attributes].some((a) => /^on/i.test(a.name))).map((el) => el.tagName + "[" + [...el.attributes].map(a=>a.name).join(",") + "]"));
  console.log("3. no stray on* attributes in the DOM:", stray.length === 0, stray.slice(0, 3));
  console.log("4. titles still readable:",
    (await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent))).slice(0, 3));
  await ctx.close();
}

// ---------- corrupt / hostile localStorage, with no re-seeding ----------
for (const [name, value] of [
  ["invalid JSON", "{not json"],
  ["object not array", '{"a":1}'],
  ["array of junk", '[1,"two",null,true,[],{"id":null}]'],
  ["deeply nested", JSON.stringify([{ id: "d", title: "Deep", shelf: "owned", series: { name: { deep: { deeper: 1 } } } }])],
  ["empty string", ""],
  ["null", "null"],
]) {
  const { ctx, page } = await phone();
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(300);
  await page.evaluate(([k, v]) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", v);
  }, ["x", value]);
  await page.reload();
  await page.waitForTimeout(600);
  const ok = await page.isVisible(".bottom-nav");
  const n = await page.$$eval(".grid-book", (e) => e.length);
  // and the app must still be usable afterwards
  await page.click("#filter-toggle");
  await page.waitForTimeout(150);
  const panelOk = (await page.$$("#filter-panel .sort-chip")).length === 9;
  console.log(`5. ${name}: app up=${ok} cards=${n} panel=${panelOk}`);
  await ctx.close();
}

// ---------- storage quota ----------
{
  const { ctx, page } = await phone();
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    // A realistically chunky library, so re-saving it needs real room.
    localStorage.setItem("shelfie.library.v1", JSON.stringify(
      Array.from({ length: 400 }, (_, n) => ({
        id: "q" + n, title: "Quota Book " + n, authors: ["Author " + n], shelf: "owned",
        owned: true, pageCount: 300, addedAt: "2026-01-01T00:00:00Z",
        subjects: ["fiction", "fantasy", "adventure", "long tag to take up room " + n],
      }))
    ));
  });
  await page.reload();
  await page.waitForTimeout(700);
  // Now wedge storage completely full, down to the last byte.
  const ballast = await page.evaluate(() => {
    let i = 0;
    const big = "x".repeat(50000);
    try { for (; i < 500; i++) localStorage.setItem("ballast" + i, big); } catch {}
    const small = "y".repeat(200);
    try { for (let j = 0; j < 5000; j++) localStorage.setItem("crumb" + j, small); } catch {}
    return i;
  });
  console.log("6. storage wedged full after", ballast, "chunks");
  // Writing a long review grows the library well past the last free byte.
  await page.click(".grid-book");
  await page.waitForTimeout(500);
  await page.fill("#review-input", "This review is deliberately enormous. ".repeat(400));
  await page.click("#save-review-btn");
  await page.waitForTimeout(700);
  const toastText = (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim();
  console.log("7. growth write fails loudly:", toastText.slice(0, 90));
  await page.click('[data-close="detail-modal"]').catch(() => {});
  await page.waitForTimeout(300);
  console.log("8. app still usable with storage full:", await page.isVisible(".bottom-nav"),
    "| cards:", await page.$$eval(".grid-book", (e) => e.length));
  await page.click("#add-book-btn");
  await page.waitForTimeout(400);
  console.log("9. add dialog still opens when storage is full:", await page.isVisible("#add-modal"));
  await page.click('[data-close="add-modal"]').catch(() => {});
  // And the warning path itself, independent of whether the browser's quota
  // happened to trip on that particular write.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("shelfie:storage-full")));
  await page.waitForTimeout(300);
  console.log("10. storage warning wording:",
    (await page.textContent("#toast-region")).replace(/\s+/g, " ").trim());
  await ctx.close();
}

console.log("\nDIALOGS (should be none):", dialogs.length ? dialogs : "none");
console.log("ERRORS:", errors.length ? errors : "none");
await browser.close();
