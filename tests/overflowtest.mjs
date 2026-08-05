import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
// Narrow phone, long metadata, long labels — does the card back overflow?
// 367 is the cruelest width: the first one that fits three columns, so each
// cell is squeezed to the grid's 102px minimum and the card back has the
// least height it will ever have.
for (const width of [320, 360, 367, 390, 430, 768]) {
  const ctx = await browser.newContext({ viewport: { width, height: 780 } });
  const page = await ctx.newPage();
  await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify([
      { id: "x1", title: "A Book With A Really Very Long Title Indeed", authors: ["Someone"],
        shelf: "tbr", owned: true, coverUrl: null, pageCount: 1248, publishDate: "1998",
        series: { name: "The Extremely Long Series Name Chronicles", position: 12 },
        addedAt: "2026-01-03T00:00:00Z" }]));
  });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(500);
  await page.click(".grid-book [data-flip]");
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const back = document.querySelector(".flip-back");
    // Summing children breaks whenever the back nests rows inside columns
    // (stars up top, then facts beside the icon rail). scrollHeight is the
    // browser's own answer to "how tall does this content really want to
    // be", and it sees overflow anywhere in the tree — except inside the
    // review, whose own overflow:hidden is a design choice, not a bug.
    const btn = document.querySelector(".qa-btn").getBoundingClientRect();
    return {
      backH: Math.round(back.clientHeight),
      contentH: Math.round(back.scrollHeight),
      btnH: Math.round(btn.height), btnW: Math.round(btn.width),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(`${width}px:`, JSON.stringify(m), m.contentH > m.backH + 1 ? "  ⚠ OVERFLOWS" : "  ok");
  if (m.contentH > m.backH + 1 || m.pageOverflow > 0) errors.push(`${width}px: card back overflows`);
  await ctx.close();
}
console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
