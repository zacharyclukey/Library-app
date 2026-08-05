import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
// Narrow phone, long metadata, long labels — does the card back overflow?
for (const width of [320, 360, 390, 430, 768]) {
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
    const kids = [...back.children];
    // The back lays its columns out side by side, so summing every child
    // counts the whole card twice. Columns are measured against the tallest
    // one; a stacked back is still a sum.
    const heights = kids.map((k) => k.getBoundingClientRect().height);
    const row = getComputedStyle(back).flexDirection === "row";
    const inner = row ? Math.max(0, ...heights) : heights.reduce((a, h) => a + h, 0);
    const cs = getComputedStyle(back);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const btn = document.querySelector(".qa-btn").getBoundingClientRect();
    // The label is hidden in the icon rail until a button is armed; measure
    // one that is actually laid out.
    const label = document.querySelector(".cc-main .qa-label") ?? document.querySelector(".qa-label");
    return {
      backH: Math.round(back.getBoundingClientRect().height),
      contentH: Math.round(inner + pad),
      btnH: Math.round(btn.height), btnW: Math.round(btn.width),
      clipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log(`${width}px:`, JSON.stringify(m), m.contentH > m.backH ? "  ⚠ OVERFLOWS" : "  ok");
  if (m.contentH > m.backH || m.pageOverflow > 0 || m.clipped) errors.push(`${width}px: card back overflows`);
  await ctx.close();
}
console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
