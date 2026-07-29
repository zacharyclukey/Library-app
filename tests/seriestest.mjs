// The LORDS case: books whose series no free database knows.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push("CONSOLE: " + m.text());
});
// Every lookup comes back empty — exactly the indie-romance situation.
await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));

const lords = ["The Ritual", "The Sinner", "The Sacrifice", "Sabotage", "Carnage", "Madness"];
const lib = lords.map((t, i) => ({
  id: "l" + i, title: t, authors: ["Shantel Tessier"], shelf: "owned", owned: true,
  coverUrl: null, pageCount: 400 + i, addedAt: `2026-01-0${i + 1}T00:00:00Z`,
}));
lib.push({ id: "x1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "owned", owned: true,
  coverUrl: null, pageCount: 245, addedAt: "2026-02-01T00:00:00Z" });

await page.addInitScript((books) => {
  localStorage.setItem("shelfie.profile.v1", "Zach");
  localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
  localStorage.setItem("shelfie.shelfSort.v1", "series");
}, lib);
await page.goto("http://localhost:8765/");
await page.waitForTimeout(1500);

const heads = () => page.$$eval(".group-head span:first-child", (e) => e.map((x) => x.textContent));
console.log("1. before tagging, groups:", await heads());

// The Series section is collapsed for a book with no series — open it the
// way a person would.
async function openSeriesSection() {
  const open = await page.evaluate(() => {
    const d = [...document.querySelectorAll("#detail-content .d-section")]
      .find((x) => x.querySelector("summary")?.textContent.trim() === "Series");
    return d?.open ?? null;
  });
  if (open === false) {
    await page.click("#detail-content .d-section summary:text-is('Series')");
    await page.waitForTimeout(300);
  }
}

// Tag the first book by hand.
async function setSeries(id, name, pos) {
  await page.click(`.grid-book[data-id="${id}"]`);
  await page.waitForTimeout(900);
  await openSeriesSection();
  await page.click(".series-editor > summary");
  await page.waitForTimeout(250);
  await page.fill("#series-name-input", name);
  if (pos != null) await page.fill("#series-pos-input", String(pos));
  await page.click("#series-save-btn");
  await page.waitForTimeout(700);
  await page.click('[data-close="detail-modal"]').catch(() => {});
  await page.waitForTimeout(400);
}

await setSeries("l0", "L.O.R.D.S.", 1);
console.log("2. after tagging one:", await heads());
console.log("   saved as:", await page.evaluate(() =>
  JSON.stringify(JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "l0").series)));

// The rest should be one tap each, with the name offered by the datalist.
const opts = await page.evaluate(async () => {
  const el = document.querySelector("#known-series");
  return el ? [...el.options].map((o) => o.value) : null;
});
console.log("3. datalist offers known series in the sheet:", opts);

await setSeries("l1", "L.O.R.D.S.", 2);
await setSeries("l2", "L.O.R.D.S.", 3);
console.log("4. three tagged:", await heads());

// A different spelling must land in the SAME group.
await setSeries("l3", "LORDS", 4);
await setSeries("l4", "the l.o.r.d.s. series", 5);
console.log("5. after two odd spellings:", await heads());
const order = await page.$$eval(".book-list > *", (e) =>
  e.map((x) => x.classList.contains("group-head")
    ? "## " + x.querySelector("span").textContent
    : "   " + x.querySelector(".grid-title").textContent));
console.log("6. shelf reads:");
order.forEach((o) => console.log("   " + o));

// Marking something a standalone sticks.
await page.click('.grid-book[data-id="l0"]');
await page.waitForTimeout(900);
await openSeriesSection();
await page.click(".series-editor > summary");
await page.waitForTimeout(250);
await page.click("#series-clear-btn");
await page.waitForTimeout(700);
await page.click('[data-close="detail-modal"]').catch(() => {});
await page.waitForTimeout(400);
console.log("7. after marking one a standalone:", await heads());
console.log("   and it stays cleared on reopen:", await page.evaluate(() => {
  const b = JSON.parse(localStorage.getItem("shelfie.library.v1")).find((x) => x.id === "l0");
  return { series: b.series, manual: b.seriesManual };
}));

// A fresh page in the same browser — no test seeding — proves the tags are
// really persisted and that detection doesn't undo them on next launch.
const fresh = await ctx.newPage();
fresh.on("pageerror", (e) => errors.push("PAGEERROR(fresh): " + e.message));
await fresh.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
await fresh.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
await fresh.goto("http://localhost:8765/");
await fresh.waitForTimeout(2000);
console.log("8. a fresh launch still groups them:",
  await fresh.$$eval(".group-head span:first-child", (e) => e.map((x) => x.textContent)));
console.log("   and the cleared one stayed standalone:", await fresh.evaluate(() => {
  const b = JSON.parse(localStorage.getItem("shelfie.library.v1")).find((x) => x.id === "l0");
  return { series: b.series, manual: b.seriesManual };
}));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
