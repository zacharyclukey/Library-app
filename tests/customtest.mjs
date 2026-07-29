// The personalisation layer: the "Yours" aesthetic, and assets/ drop-ins
// appearing (and their absence doing no harm).
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function phone(skin) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) {
      errors.push("CONSOLE: " + m.text());
    }
  });
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  await page.addInitScript((s) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    if (s) localStorage.setItem("shelfie.skin.v1", s);
    localStorage.setItem("shelfie.library.v1", JSON.stringify([
      { id: "b1", title: "Circe", authors: ["Madeline Miller"], shelf: "owned", owned: true,
        coverUrl: null, pageCount: 393, addedAt: "2026-01-01T00:00:00Z" },
    ]));
  }, skin);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(900);
  return { ctx, page };
}

// ---- 1. the new aesthetic is offered, and works ----
{
  const { ctx, page } = await phone(null);
  await page.click("#settings-btn");
  await page.waitForTimeout(600);
  const skins = await page.$$eval(".theme-card", (e) =>
    e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  console.log("1. aesthetics offered:", skins.length);
  skins.forEach((s) => console.log("   ·", s));
  await page.click('.theme-card[data-skin="custom"]');
  await page.waitForTimeout(600);
  console.log("2. picking it sticks:", await page.evaluate(() =>
    document.documentElement.getAttribute("data-skin")),
    "| saved:", await page.evaluate(() => localStorage.getItem("shelfie.skin.v1")));
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ["--bg", "--card", "--ink", "--accent", "--accent-ink", "--header-solid"]
      .map((k) => `${k}=${cs.getPropertyValue(k).trim()}`);
  });
  console.log("3. its palette is live:", tokens.join(" "));
  await page.click("#nav-shelves");
  await page.waitForTimeout(500);
  console.log("4. shelf renders in it:", (await page.$$(".grid-book")).length, "cards");
  await page.screenshot({ path: "skin-yours.png" });
  await ctx.close();
}

// ---- 2. contrast check on the shipped defaults ----
{
  const { ctx, page } = await phone("custom");
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => {
      localStorage.setItem("shelfie.mode.v1", m);
      document.documentElement.setAttribute("data-mode", m);
    }, mode);
    await page.waitForTimeout(300);
    const c = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const rgb = (v) => {
        const d = document.createElement("div");
        d.style.color = cs.getPropertyValue(v).trim();
        document.body.appendChild(d);
        const out = getComputedStyle(d).color.match(/\d+/g).map(Number);
        d.remove();
        return out;
      };
      const lum = ([r, g, b]) => {
        const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
        return ((x + 0.05) / (y + 0.05)).toFixed(2);
      };
      return { inkOnBg: ratio("--ink", "--bg"), accentInk: ratio("--accent-ink", "--accent"),
               mutedOnBg: ratio("--muted", "--bg") };
    });
    console.log(`5. ${mode} contrast — ink/bg ${c.inkOnBg}, accent-ink/accent ${c.accentInk}, muted/bg ${c.mutedOnBg}`,
      Number(c.inkOnBg) >= 7 && Number(c.accentInk) >= 4.5 ? "✓" : "⚠ low");
  }
  await ctx.close();
}

// ---- 3. no assets present: nothing breaks, nothing changes ----
{
  const { ctx, page } = await phone(null);
  await page.waitForTimeout(600);
  const classes = await page.evaluate(() => document.body.className);
  console.log("6. with an empty assets folder, body classes:", JSON.stringify(classes));
  console.log("7. emoji brand mark still shows:",
    (await page.textContent(".brand-mark")).trim());
  await ctx.close();
}

// ---- 4. drop a logo in and it appears ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  // Stand in for a file the user dropped into assets/.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.route(/assets\/logo\.png$/, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await page.route(/assets\/shelf\.png$/, (r) => r.fulfill({ body: PNG, contentType: "image/png" }));
  await page.addInitScript(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify([
      { id: "b1", title: "Circe", authors: ["M"], shelf: "owned", owned: true,
        coverUrl: null, addedAt: "2026-01-01T00:00:00Z" }]));
  });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(1200);
  console.log("8. dropped-in files detected:", JSON.stringify(await page.evaluate(() => document.body.className)));
  console.log("9. logo is used, emoji hidden:", await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".brand-mark"));
    return { image: cs.backgroundImage !== "none", fontSize: cs.fontSize };
  }));
  console.log("10. shelf ledge uses the image:", await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".grid-book"), "::after");
    return cs.backgroundImage.includes("assets/shelf.png");
  }));
  await ctx.close();
}

// ---- 5. custom.css can be emptied without breaking anything ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  await page.route(/css\/custom\.css$/, (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.addInitScript(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.skin.v1", "custom");
    localStorage.setItem("shelfie.library.v1", JSON.stringify([
      { id: "b1", title: "Circe", authors: ["M"], shelf: "owned", owned: true,
        coverUrl: null, addedAt: "2026-01-01T00:00:00Z" }]));
  });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(900);
  const cs = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { bg: s.getPropertyValue("--bg").trim(), ink: s.getPropertyValue("--ink").trim() };
  });
  console.log("11. empty custom.css still renders:", (await page.$$(".grid-book")).length,
    "cards | falls back to:", JSON.stringify(cs));
  await ctx.close();
}

// ---- 6. a file added then removed doesn't leave a ghost ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64");
  let serveLogo = true;
  await page.route(/assets\/logo\.png$/, (r) =>
    serveLogo ? r.fulfill({ body: PNG, contentType: "image/png" }) : r.fulfill({ status: 404, body: "" }));
  await page.addInitScript(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify([
      { id: "b1", title: "Circe", authors: ["M"], shelf: "owned", owned: true,
        coverUrl: null, addedAt: "2026-01-01T00:00:00Z" }]));
  });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(1200);
  console.log("12. logo in place:", await page.evaluate(() => document.body.classList.contains("has-logo")),
    "| remembered:", await page.evaluate(() => localStorage.getItem("shelfie.assets.v1")));
  serveLogo = false;               // the user deletes the file
  await page.reload();
  await page.waitForTimeout(1400);
  console.log("13. after deleting it, emoji is back:",
    !(await page.evaluate(() => document.body.classList.contains("has-logo"))),
    "|", (await page.textContent(".brand-mark")).trim());
  await ctx.close();
}

// ---- 7. the folder isn't re-checked on every launch ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  let probes = 0;
  page.on("request", (r) => { if (r.url().includes("/assets/")) probes++; });
  await page.addInitScript(() => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", "[]");
  });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(1500);
  const first = probes;
  probes = 0;
  await page.reload();
  await page.waitForTimeout(1500);
  console.log(`14. asset checks — first launch ${first}, every launch after that ${probes}`);
  console.log("15. Settings can force a re-check:", await page.evaluate(async () => {
    const m = await import("/js/assets.js");
    return typeof m.refreshCustomAssets === "function";
  }));
  probes = 0;
  await page.evaluate(async () => (await import("/js/assets.js")).refreshCustomAssets());
  await page.waitForTimeout(1200);
  console.log("16. forcing one re-checks the folder:", probes > 0);
  await ctx.close();
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
