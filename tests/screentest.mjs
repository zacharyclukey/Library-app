import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push("console: " + m.text()); });

await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());
await page.route(/openlibrary\.org\/works\/.*\.json/, (r) => r.fulfill({ json: { subjects: ["Fantasy fiction"] } }));
await page.route(/openlibrary\.org\/search\.json/, (r) =>
  r.fulfill({ json: { docs: [
    { key: "/works/OLr1W", title: "The Name of the Wind", author_name: ["Patrick Rothfuss"], first_publish_year: 2007, ratings_average: 4.5, ratings_count: 900, number_of_pages_median: 662 },
  ] } }));

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify([
    { id: "a", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 245, publishDate: "2020", workKey: "/works/OL1W",
      ratings: { Zach: 5 }, addedAt: "2026-01-05T00:00:00Z" },
    { id: "b", title: "The Way of Kings", authors: ["Brandon Sanderson"], shelf: "owned", owned: true,
      coverUrl: null, pageCount: 1007, publishDate: "2010", workKey: "/works/OL2W",
      addedAt: "2026-01-06T00:00:00Z" },
  ]));
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(500);

const active = () => page.$eval(".screen.active", (e) => e.id);
const navActive = () => page.$$eval(".nav-btn.active", (e) => e.map((x) => x.id));
const dialogs = () => page.$$eval("dialog[open]", (e) => e.map((x) => x.id));

console.log("1. starts on shelves:", await active(), "| nav:", await navActive());
console.log("2. no dialogs for these screens:", (await page.$$("#screen-discover")).length === 1 && (await dialogs()).length === 0);

// --- Discover screen ---
await page.click("#discover-btn");
await page.waitForTimeout(900);
console.log("3. discover screen:", await active(), "| nav:", await navActive());
console.log("4. discover has heading + back:", await page.isVisible("#screen-discover .screen-head h2"), await page.isVisible("#screen-discover .back-btn"));
console.log("5. recs render:", await page.$$eval("#discover-content .series-title strong", (e) => e.map((x) => x.textContent)));
console.log("6. shelf toolbar hidden:", !(await page.isVisible(".toolbar")));
await page.screenshot({ path: "screen-discover.png" });

// Back button returns to shelves
await page.click("#screen-discover .back-btn");
await page.waitForTimeout(300);
console.log("7. back → shelves:", await active());

// --- Export screen ---
await page.click("#export-btn");
await page.waitForTimeout(500);
console.log("8. export screen:", await active(), "| scopes:", (await page.$$("[data-scope]")).length);
console.log("9. export preview:", (await page.textContent(".export-preview")).replace(/\s+/g, " ").trim());
await page.screenshot({ path: "screen-export.png" });

// --- Settings screen + sub-screens ---
await page.click("#settings-btn");
await page.waitForTimeout(400);
console.log("10. settings screen:", await active());
await page.screenshot({ path: "screen-settings.png" });

await page.click('[data-go="profile"]');
await page.waitForTimeout(300);
console.log("11. profile sub-screen:", await active(), "| settings nav still lit:", (await navActive()).includes("settings-btn"));
await page.click("#screen-profile .back-btn");
await page.waitForTimeout(300);
console.log("12. profile back → settings:", await active());

await page.click('[data-go="sync"]');
await page.waitForTimeout(400);
console.log("13. sync sub-screen:", await active(), "| has form:", !!(await page.$("#library-name")));
await page.screenshot({ path: "screen-sync.png" });

// --- Browser/Android back button walks the history ---
await page.goBack();
await page.waitForTimeout(300);
console.log("14. history back → settings:", await active());
await page.goBack();
await page.waitForTimeout(300);
console.log("15. history back walks the stack:", await active());

// In-app back should POP history, not push: after N screens + N backs,
// one phone-back press should leave the app's screen stack at shelves.
await page.click("#settings-btn");
await page.waitForTimeout(250);
await page.click('[data-go="sync"]');
await page.waitForTimeout(300);
const lenBefore = await page.evaluate(() => history.length);
await page.click("#screen-sync .back-btn");
await page.waitForTimeout(300);
const lenAfter = await page.evaluate(() => history.length);
console.log("15b. back pops instead of pushing:", lenAfter <= lenBefore, "| now:", await active());

// --- Bottom nav "Shelves" from another screen ---
await page.click("#nav-shelves");
await page.waitForTimeout(300);
console.log("16. nav shelves:", await active(), "| nav:", await navActive());

// --- Modals still work as modals, over the shelves ---
await page.click("#add-book-btn");
await page.waitForTimeout(300);
console.log("17. add stays a dialog:", await dialogs());
await page.click('[data-close="add-modal"]');
await page.click(".grid-book");
await page.waitForTimeout(600);
console.log("18. detail stays a dialog:", await dialogs());
await page.click('[data-close="detail-modal"]');
await page.waitForTimeout(200);

// --- Theme switch from settings still applies ---
await page.click("#settings-btn");
await page.waitForTimeout(300);
await page.click('[data-skin="dark-academia"]');
await page.waitForTimeout(300);
console.log("19. theme switch works on screen:", await page.getAttribute("html", "data-skin"));
await page.click('[data-skin="reading-room"]');

// --- First-run: no profile opens the profile screen ---
const fresh = await browser.newPage({ viewport: { width: 420, height: 900 } });
fresh.on("pageerror", (e) => errors.push("fresh: " + e.message));
await fresh.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());
await fresh.addInitScript(() => localStorage.clear());
await fresh.goto("http://localhost:8765/");
await fresh.waitForTimeout(500);
console.log("20. first run lands on profile screen:", await fresh.$eval(".screen.active", (e) => e.id));
await fresh.fill("#new-profile-input", "Kelsey");
await fresh.click('#new-profile-form button[type="submit"]');
await fresh.waitForTimeout(400);
console.log("21. after naming → shelves:", await fresh.$eval(".screen.active", (e) => e.id), "| chip:", (await fresh.textContent("#profile-chip")).trim());

console.log("errors:", errors.filter((e) => !e.includes("net::ERR")));
await browser.close();
