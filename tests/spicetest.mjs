import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("console: " + m.text()); });

await page.route(/googleapis|gstatic|covers|openlibrary/, (r) => r.abort());
await page.route(/openlibrary\.org\/isbn\/1111111111\.json/, (r) =>
  r.fulfill({ json: { title: "Steamy Court Romance", isbn_10: ["1111111111"], key: "/books/B1",
    subjects: ["Erotic fiction", "Romance"] } }));

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Kelsey");
  localStorage.setItem("shelfie.trackContent.v1", "1"); // opt-in enabled
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "a", title: "Fourth Wing", authors: ["Rebecca Yarros"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 512, addedAt: "2026-01-05T00:00:00Z" },
    { id: "b", title: "The Very Hungry Caterpillar", authors: ["Eric Carle"], shelf: "owned",
      owned: true, coverUrl: null, content: "kids", addedAt: "2026-01-06T00:00:00Z" },
    { id: "c", title: "A Court of Mist and Fury", authors: ["Sarah J. Maas"], shelf: "owned",
      owned: true, coverUrl: null, content: "explicit", spice: 4, addedAt: "2026-01-07T00:00:00Z" },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(500);
const titles = () => page.$$eval(".grid-title", (e) => e.map((x) => x.textContent).sort());

// --- badges on cards ---
console.log("1. spice badge:", await page.$$eval(".mini-badge.spice", (e) => e.map((x) => x.textContent)));
console.log("2. kids badge:", (await page.$$(".mini-badge.kids-tag")).length === 1);

// --- manual tagging: give Fourth Wing 3 peppers + Mature ---
await page.click('.grid-book[title="Fourth Wing"]');
await page.waitForTimeout(400);
console.log("3. content chips + peppers offered:", (await page.$$("[data-set-content]")).length, (await page.$$("[data-spice]")).length);
await page.click('[data-spice="3"]');
await page.waitForTimeout(300);
await page.click('[data-set-content="mature"]');
await page.waitForTimeout(300);
const fw = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "a"));
console.log("4. saved:", fw.spice, fw.content);
// tapping active tag clears it
await page.click('[data-set-content="mature"]');
await page.waitForTimeout(300);
console.log("5. tap-again clears tag:", await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "a").content) === null);
await page.click('[data-set-content="mature"]'); // re-set for filters below
await page.waitForTimeout(200);
await page.click('[data-close="detail-modal"]');
await page.waitForTimeout(300);

// --- filters ---
await page.click("#filter-toggle");
await page.waitForTimeout(250);
console.log("6. content + spice groups present:", await page.$$eval("#filter-panel .filter-label", (e) => e.map((x) => x.textContent.split(" ")[0])).then((l) => l.includes("Content") && l.includes("Spice")));
await page.click('#filter-panel .filter-chip:has-text("🌶️ Spicy (any)")');
await page.waitForTimeout(250);
console.log("7. spicy filter:", await titles());
await page.click('#filter-panel .filter-chip:has-text("🌶️🌶️🌶️ 3+")');
await page.waitForTimeout(250);
console.log("8. 3+ filter:", await titles());
await page.click('#filter-panel .filter-chip:has-text("No spice")');
await page.waitForTimeout(250);
console.log("9. no-spice filter:", await titles());
await page.click('#filter-panel .filter-chip:has-text("No spice")'); // clear spice
await page.click('#filter-panel .filter-chip:has-text("✅ SFW")');
await page.waitForTimeout(250);
console.log("10. SFW hides mature+explicit:", await titles());
await page.click('#filter-panel .filter-chip:has-text("🧸 Kids")');
await page.waitForTimeout(250);
console.log("11. kids only:", await titles());
await page.click("text=Clear all filters");
await page.click("#filter-toggle");
await page.screenshot({ path: "spice.png" });

// --- auto-suggest from subject tags on add ---
await page.click("#add-book-btn");
await page.fill("#isbn-input", "1111111111");
await page.click('#isbn-form button[type="submit"]');
await page.waitForTimeout(700);
await page.click('[data-add-shelf="tbr"]');
await page.waitForTimeout(300);
await page.click('[data-close="add-modal"]');
const steamy = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.title === "Steamy Court Romance"));
console.log("12. auto-tagged from 'Erotic fiction' subject:", steamy?.content, "spice", steamy?.spice);

// --- CSV carries the columns ---
await page.click("#export-btn");
await page.waitForTimeout(400);
await page.click('[data-scope="all"]');
await page.waitForTimeout(200);
const dl = page.waitForEvent("download");
await page.click('[data-format="csv"]');
const file = await dl;
const csv = (await import("node:fs")).readFileSync(await file.path(), "utf8");
console.log("13. csv columns:", csv.split("\n")[0].includes("Content") && csv.split("\n")[0].includes("Spice"));
console.log("14. csv values:", csv.includes("explicit,4"));
await page.click("#nav-shelves");

// --- OFF by default on a fresh phone: invisible everywhere ---
const fresh = await browser.newPage({ viewport: { width: 420, height: 950 } });
fresh.on("pageerror", (e) => errors.push("fresh: " + e.message));
await fresh.route(/googleapis|gstatic|covers|openlibrary/, (r) => r.abort());
await fresh.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "c", title: "A Court of Mist and Fury", authors: ["Sarah J. Maas"], shelf: "owned",
      owned: true, coverUrl: null, content: "explicit", spice: 4, addedAt: "2026-01-07T00:00:00Z" },
  ]));
});
await fresh.goto("http://localhost:8765/");
await fresh.waitForTimeout(400);
console.log("15. OFF: no badges:", (await fresh.$$(".mini-badge.spice, .spice-badge, .mini-badge.mature-tag")).length === 0);
await fresh.click(".grid-book");
await fresh.waitForTimeout(400);
console.log("16. OFF: no editors in detail:", !(await fresh.$("[data-spice]")) && !(await fresh.$("[data-set-content]")));
await fresh.click('[data-close="detail-modal"]');
await fresh.click("#filter-toggle");
await fresh.waitForTimeout(250);
console.log("17. OFF: no filter groups:", await fresh.$$eval("#filter-panel .filter-label", (e) => e.map((x) => x.textContent.split(" ")[0])).then((l) => !l.includes("Content") && !l.includes("Spice")));
console.log("18. data kept though:", await fresh.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1"))[0].spice) === 4);

console.log("errors:", errors);
await browser.close();
