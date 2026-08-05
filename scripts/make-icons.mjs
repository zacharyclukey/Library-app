// Rewrites the home-screen icons from assets/brand/app-icon.svg.
//
//   npm run icons
//
// Run this after editing the icon artwork. The three PNGs it writes are the
// only rasterised assets in the project — a phone's home screen can't be
// handed an SVG, so these have to exist as files. Everything else the app
// draws is either vector or a photo you supply.
//
// It rasterises through the same headless Chromium the tests use, so there is
// nothing extra to install: whatever the browser shows is what the phone gets.

import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, "assets/brand/app-icon.svg");

// 180 is Apple's touch icon, 192 and 512 are the manifest's two sizes.
const SIZES = [180, 192, 512];

const svg = await readFile(SOURCE, "utf8");

// Serving the file rather than opening it from disk: a file:// page can't load
// its own siblings in a headless browser, and one day this artwork may want a
// texture next to it.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;background:transparent}svg{display:block}</style>
    ${svg}`);
}).listen(0);
await new Promise((ok) => server.once("listening", ok));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.goto(url);
  await page.$eval("svg", (el, s) => {
    el.setAttribute("width", s);
    el.setAttribute("height", s);
  }, size);
  const png = await page.locator("svg").screenshot({ omitBackground: true });
  await writeFile(resolve(ROOT, `icons/icon-${size}.png`), png);
  await page.close();
  console.log(`icons/icon-${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
}

await browser.close();
server.close();
console.log("\nDone. Commit the PNGs alongside the SVG you changed.");
