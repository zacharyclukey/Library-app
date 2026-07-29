// Round 6 — every skin × light/dark: the new sort chips and labelled quick
// actions must stay legible, and nothing may overflow the viewport.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const skins = ["reading-room", "cottage", "dark-academia", "modern"];
const modes = ["light", "dark"];

const lib = [
  { id: "s1", title: "The Way of Kings", authors: ["Brandon Sanderson"], shelf: "owned",
    owned: true, coverUrl: null, pageCount: 1007, series: { name: "The Stormlight Archive", position: 1 },
    addedAt: "2026-01-01T00:00:00Z" },
  { id: "s2", title: "Words of Radiance", authors: ["Brandon Sanderson"], shelf: "owned",
    owned: true, coverUrl: null, pageCount: 1087, series: { name: "The Stormlight Archive", position: 2 },
    addedAt: "2026-01-02T00:00:00Z" },
  { id: "x1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "owned", owned: true,
    coverUrl: null, pageCount: 245, addedAt: "2026-01-03T00:00:00Z" },
];

for (const skin of skins) {
  for (const mode of modes) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${skin}/${mode}: ${e.message}`));
    await page.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());
    await page.addInitScript(([books, sk, md]) => {
      localStorage.setItem("shelfie.profile.v1", "Zach");
      localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
      localStorage.setItem("shelfie.skin.v1", sk);
      localStorage.setItem("shelfie.mode.v1", md);
      localStorage.setItem("shelfie.shelfSort.v1", "series");
    }, [lib, skin, mode]);
    await page.goto("http://localhost:8765/");
    await page.waitForTimeout(600);

    // horizontal overflow anywhere?
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);

    // flip a card and measure the labels
    await page.click('.grid-book[data-id="x1"] [data-flip]');
    await page.waitForTimeout(500);
    const qa = await page.$$eval('.grid-book[data-id="x1"] .qa-btn', (btns) =>
      btns.map((b) => {
        const label = b.querySelector(".qa-label");
        const cs = getComputedStyle(b);
        return {
          text: label.textContent,
          clipped: label.scrollWidth > label.clientWidth + 1,
          h: Math.round(b.getBoundingClientRect().height),
          fg: cs.color, bg: cs.backgroundColor,
        };
      }));
    const clipped = qa.filter((q) => q.clipped).map((q) => q.text);
    const tooSmall = qa.filter((q) => q.h < 24).map((q) => q.text);

    // arm one and check the highlighted state is readable
    await page.click('.grid-book[data-id="x1"] [data-qa-move="tbr"]');
    await page.waitForTimeout(300);
    const armed = await page.$eval('.grid-book[data-id="x1"] [data-qa-move="tbr"]', (b) => {
      const cs = getComputedStyle(b);
      return { text: b.textContent.trim(), fg: cs.color, bg: cs.backgroundColor };
    });

    // the sort panel
    await page.click('.grid-book[data-id="x1"] .qa-facts').catch(() => {});
    await page.click("#filter-toggle");
    await page.waitForTimeout(400);
    const sortActive = await page.$$eval("#filter-panel .sort-chip.active", (e) => e.map((x) => x.textContent));
    const panelOverflow = await page.$eval("#filter-panel", (el) => el.scrollWidth > el.clientWidth + 1);
    const toolLabel = (await page.textContent("#filter-toggle")).replace(/\s+/g, " ").trim();

    console.log(
      `${skin}/${mode}: overflow=${overflow}px clipped=${clipped.length ? clipped : "none"} ` +
      `short=${tooSmall.length ? tooSmall : "none"} armed="${armed.text}" ${armed.fg} on ${armed.bg} ` +
      `sort=${JSON.stringify(sortActive)} panelOverflow=${panelOverflow} tool="${toolLabel}"`
    );
    if (skin === "dark-academia" && mode === "dark") {
      await page.screenshot({ path: "theme-dark-academia.png" });
    }
    if (skin === "cottage" && mode === "light") {
      await page.screenshot({ path: "theme-cottage.png" });
    }
    await ctx.close();
  }
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
