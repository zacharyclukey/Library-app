import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
const errors = [];
const queries = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("console: " + m.text()); });

await page.route(/googleapis|gstatic|covers|openlibrary/, (r) => r.abort());
// The Sorcerer's Stone work: OL knows Spanish and English editions. With
// lang=en the English edition leads `editions`; with lang=es the Spanish one.
await page.route(/openlibrary\.org\/search\.json.*/, (r) => {
  const url = new URL(r.request().url());
  queries.push({ q: decodeURIComponent(url.searchParams.get("q") ?? ""), lang: url.searchParams.get("lang") });
  const lang = url.searchParams.get("lang");
  const eng = { key: "/books/OLENG", title: "Harry Potter and the Sorcerer's Stone",
                isbn: ["9780590353427"], language: ["eng"], cover_i: 1 };
  const spa = { key: "/books/OLSPA", title: "Harry Potter y la piedra filosofal",
                isbn: ["9788478884452"], language: ["spa"], cover_i: 2 };
  r.fulfill({ json: { docs: [{
    key: "/works/OLHP1W",
    title: "Harry Potter y la piedra filosofal", // work title cached in Spanish — the reported bug
    author_name: ["J. K. Rowling"],
    first_publish_year: 1997,
    cover_i: 2,
    language: ["spa", "eng"],
    isbn: ["9788478884452", "9780590353427"], // Spanish ISBN first — the old code took [0]
    editions: { docs: [lang === "es" ? spa : eng] },
  }] } });
});
await page.route(/openlibrary\.org\/isbn\/9780590353427\.json/, (r) =>
  r.fulfill({ json: { title: "Harry Potter and the Sorcerer's Stone", isbn_13: ["9780590353427"],
    key: "/books/OLENG", languages: [{ key: "/languages/eng" }] } }));
await page.route(/openlibrary\.org\/isbn\/9788478884452\.json/, (r) =>
  r.fulfill({ json: { title: "Harry Potter y la piedra filosofal", isbn_13: ["9788478884452"],
    key: "/books/OLSPA", languages: [{ key: "/languages/spa" }] } }));

await page.addInitScript(() => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", "[]");
});

await page.goto("http://localhost:8765/");
await page.waitForTimeout(400);

// --- default English search returns the English edition ---
await page.click("#add-book-btn");
console.log("1. language select present, defaults to:", await page.$eval("#search-lang", (e) => e.value));
await page.fill("#title-input", "harry potter piedra");
await page.click('#title-form button[type="submit"]');
await page.waitForTimeout(600);
const first = (await page.textContent(".search-result")).replace(/\s+/g, " ").trim();
console.log("2. result shows ENGLISH edition title:", first.includes("Sorcerer's Stone"), "|", first.slice(0, 60));
console.log("3. query constrained + lang param:", queries[0].q.includes("language:eng"), queries[0].lang === "en");

// Adding it fetches the ENGLISH ISBN (old code would take the Spanish isbns[0])
await page.click(".search-result");
await page.waitForTimeout(700);
console.log("4. confirm shows English edition:", (await page.textContent("#confirm-book")).includes("Sorcerer's Stone"));
await page.click('[data-add-shelf="owned"]');
await page.waitForTimeout(300);
const added = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1"))[0]);
console.log("5. stored English edition + language:", added.isbn13 === "9780590353427", added.language);

// --- switching the picker to Spanish gets the Spanish edition on purpose ---
await page.selectOption("#search-lang", "spa");
await page.click('#title-form button[type="submit"]');
await page.waitForTimeout(600);
const spaResult = (await page.textContent(".search-result")).replace(/\s+/g, " ");
console.log("6. Spanish search → Spanish edition:", spaResult.includes("piedra filosofal"));
console.log("7. spa query:", queries.at(-1).q.includes("language:spa"), "| lang:", queries.at(-1).lang);
console.log("8. picker choice remembered:", await page.evaluate(() => localStorage.getItem("shelfie.searchLang.v1")) === "spa");
await page.click(".search-result");
await page.waitForTimeout(700);
await page.click('[data-add-shelf="tbr"]');
await page.waitForTimeout(300);
await page.click('[data-close="add-modal"]');
await page.waitForTimeout(300);

// --- shelf Language filter appears now that two languages exist ---
await page.click("#filter-toggle");
await page.waitForTimeout(250);
const labels = await page.$$eval("#filter-panel .filter-label", (e) => e.map((x) => x.textContent.split(" ")[0]));
console.log("9. Language group appears:", labels.includes("Language"));
await page.click('#filter-panel .filter-chip:has-text("Spanish")');
await page.waitForTimeout(250);
console.log("10. Spanish filter:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));
await page.click('#filter-panel .filter-chip:has-text("English")');
await page.waitForTimeout(250);
console.log("11. English filter:", await page.$$eval(".grid-title", (e) => e.map((x) => x.textContent)));
console.log("12. badge counts language:", await page.textContent("#filter-count"));
await page.click("text=Clear all filters");
await page.click("#filter-toggle");

// --- detail shows the language row ---
await page.click(".grid-book");
await page.waitForTimeout(400);
console.log("13. detail language row:", (await page.textContent(".detail-table")).includes("Language"));
await page.screenshot({ path: "lang.png" });

console.log("errors:", errors);
await browser.close();
